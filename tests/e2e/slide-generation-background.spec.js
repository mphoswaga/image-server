const { test, expect } = require("@playwright/test");
const { signInDisposableTeacher } = require("./helpers");
const result = {
  deckId: "background-deck",
  filename: "ICT-Data.pptx",
  band: "early",
  slideCount: 1,
  slides: [
    {
      type: "title",
      title: "Data detectives",
      subtitle: "ICT",
      bullets: [],
      image: null,
    },
  ],
};
async function planPage(page) {
  await signInDisposableTeacher(page, "-background-slides");
  await page.evaluate(() => {
    ctx = {
      subject: "ICT",
      topic: "Data",
      grade: "Grade 3",
      lessonPurpose: "lesson",
      useWeekPlanner: false,
    };
    renderPlan({
      sections: [
        { heading: "Teaching", content: "Explain fields and records." },
      ],
      successCriteria: ["I can identify a field."],
    });
    show("plan");
  });
}
test("a lesson running beyond the old timeout finishes after a transient HTML response", async ({
  page,
}) => {
  await planPage(page);
  await page.clock.install();
  let posts = 0,
    polls = 0,
    ready = false;
  await page.route("**/api/generate", (r) => {
    posts++;
    expect(r.request().postDataJSON().background).toBe(true);
    return r.fulfill({
      status: 202,
      json: { jobId: "slow-job", status: "running", pollAfterMs: 1000 },
    });
  });
  await page.route("**/api/generate/jobs/slow-job", (r) => {
    polls++;
    if (polls === 1)
      return r.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<!DOCTYPE html><h1>Gateway error</h1>",
      });
    return r.fulfill({
      json: ready
        ? { jobId: "slow-job", status: "completed", httpStatus: 200, result }
        : { jobId: "slow-job", status: "running", pollAfterMs: 1000 },
    });
  });
  await page.locator("#acceptBtn").click();
  await expect(page.locator("#acceptBtn")).toBeDisabled();
  await page.clock.runFor(1100);
  await expect.poll(() => polls).toBeGreaterThan(0);
  await page.clock.fastForward(126000);
  await expect(page.locator("#status")).not.toContainText("Unexpected token");
  ready = true;
  await page.clock.runFor(2100);
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#deck")).toContainText("Data detectives");
  expect(posts).toBe(1);
});
test("a lost start response reconnects with the same request ID and preserves the plan", async ({
  page,
}) => {
  await planPage(page);
  const keys = [];
  await page.route("**/api/generate", (r) => {
    keys.push(r.request().postDataJSON().generationRequestId);
    return keys.length === 1
      ? r.fulfill({
          status: 524,
          contentType: "text/html",
          body: "<!DOCTYPE html>Timed out",
        })
      : r.fulfill({
          status: 202,
          json: { jobId: "reconnected", status: "running", pollAfterMs: 1000 },
        });
  });
  await page.route("**/api/generate/jobs/reconnected", (r) =>
    r.fulfill({
      json: {
        jobId: "reconnected",
        status: "completed",
        httpStatus: 200,
        result,
      },
    }),
  );
  await page.locator("#acceptBtn").click();
  await expect(page.locator("#results")).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(page.locator("#planSections .content").first()).toHaveValue(
    "Explain fields and records.",
  );
});
test("background validation and polling use the real server, without consuming generation limits", async ({
  page,
  browser,
}) => {
  await signInDisposableTeacher(page, "-job-auth");
  const response = await page.request.post("/api/generate", {
    data: { background: true, generationRequestId: "test_invalid_1234567890" },
  });
  expect(response.status()).toBe(202);
  const job = await response.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get("/api/generate/jobs/" + job.jobId)
          ).json()
        ).status,
    )
    .toBe("failed");
  for (let i = 0; i < 45; i++)
    expect(
      (await page.request.get("/api/generate/jobs/" + job.jobId)).status(),
    ).toBe(200);
  const done = await (
    await page.request.get("/api/generate/jobs/" + job.jobId)
  ).json();
  expect(done.httpStatus).toBe(400);
  expect(done.result.error).toContain("subject and topic");
  const other = await browser.newContext(),
    tab = await other.newPage();
  await signInDisposableTeacher(tab, "-other-job");
  expect(
    (await tab.request.get("/api/generate/jobs/" + job.jobId)).status(),
  ).toBe(404);
  await other.close();
});

test("a longer outage shows a useful message and the next click reconnects to the same request", async ({
  page,
}) => {
  await planPage(page);
  const keys = [];
  let recovered = false;
  await page.route("**/api/generate", (route) => {
    keys.push(route.request().postDataJSON().generationRequestId);
    return route.fulfill(
      recovered
        ? {
            json: {
              jobId: "recovered-job",
              status: "completed",
              httpStatus: 200,
              result,
            },
          }
        : {
            status: 502,
            contentType: "text/html",
            body: "<!DOCTYPE html>Service unavailable",
          },
    );
  });
  await page.locator("#acceptBtn").click();
  await expect(page.locator("#status")).toContainText(
    "Click create slides again to reconnect",
  );
  await expect(page.locator("#acceptBtn")).toBeEnabled();
  expect(keys).toHaveLength(3);
  recovered = true;
  await page.locator("#acceptBtn").click();
  await expect(page.locator("#results")).toBeVisible();
  expect(keys).toHaveLength(4);
  expect(new Set(keys).size).toBe(1);
});
