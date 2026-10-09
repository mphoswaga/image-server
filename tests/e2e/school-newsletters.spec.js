const { test, expect } = require("@playwright/test");
const { signInDisposableTeacher } = require("./helpers");
test("school newsletter drafts, minimum, bilingual review and print layout", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signInDisposableTeacher(page, "-school-newsletter");
  await page.goto("/newsletters.html");
  await page
    .getByText("Create a newsletter workspace", { exact: true })
    .click();
  await page.locator("#createSpace input").fill("Cambridge newsletter team");
  await page.locator("#createSpace button").click();
  await expect(page.locator("#spaceName")).toHaveText(
    "Cambridge newsletter team",
  );
  await page.getByText("+ Add class and week", { exact: true }).click();
  await page.locator("[name=className]").fill("Grade 3B2");
  await page.locator("[name=week]").fill("Week 10");
  await page.locator("[name=subjects]").first().fill("ICT\nMaths");
  await page.locator("#reportForm button").click();
  await expect(page.locator(".subject")).toHaveCount(2);
  await page.getByText("Format and minimum length", { exact: true }).click();
  await page.locator("#settings [name=minimum]").fill("20");
  await page.locator("#settings [name=vietnameseMinimum]").fill("10");
  await page.locator("#settings button").click();
  const en = page.locator("[data-field=english]");
  await en.nth(0).fill("Too short");
  await page.locator("[data-action=submit]").first().click();
  await expect(page.locator("#message")).toContainText("minimum");
  await expect(en.first()).toHaveValue("Too short");
  await en
    .nth(0)
    .fill("Next week we will explore file sizes and compare examples.");
  await en
    .nth(1)
    .fill("Next week we will compare and order larger whole numbers.");
  await page.locator("[data-action=submit]").first().click();
  await expect(en.nth(1)).toHaveValue(
    "Next week we will compare and order larger whole numbers.",
  );
  await page.locator("[data-action=submit]").nth(1).click();
  await page.reload();
  await expect(en.first()).toHaveValue(
    "Next week we will explore file sizes and compare examples.",
  );
  for (let i = 0; i < 2; i++) {
    await page
      .locator("[data-field=vietnamese]")
      .nth(i)
      .fill("Tuần tới, các em sẽ tìm hiểu và thực hành.");
    await page.locator("[data-action=review]").nth(i).click();
  }
  await page.locator("[data-action=approve]").click();
  await expect(page.locator("#editor")).toContainText("Approved for sharing");
  await page.evaluate(() => (window.print = () => {}));
  await page.locator("[data-action=print]").click();
  await expect(page.locator("#printReport")).toContainText("Grade 3B2");
  await expect(page.locator("#printReport")).toContainText("Tiếng Việt");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#printReport")).toBeVisible();
  await expect(page.locator("main")).toBeHidden();
  if (testInfo.project.use.browserName === "chromium") await page.pdf({path:testInfo.outputPath("approved-newsletter.pdf"),format:"A4",printBackground:true});
  await page.emulateMedia({ media: "screen" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("invited new teacher receives only assigned newsletter access and can upload a plan", async ({
  page,
  browser,
}) => {
  await signInDisposableTeacher(page, "-coordinator");
  let w = await (
    await page.request.post("/api/school-newsletters", {
      data: { name: "School invitation test" },
    })
  ).json();
  w = await (
    await page.request.post(`/api/school-newsletters/${w.id}/change`, {
      data: {
        revision: w.revision,
        action: "create-report",
        className: "3B2",
        week: "Week 10",
        subjects: ["ICT", "Maths"],
      },
    })
  ).json();
  const email = `new-newsletter-${Date.now()}@example.test`;
  const invite = await (
    await page.request.post(`/api/school-newsletters/${w.id}/invite`, {
      data: { revision: w.revision, email, role: "teacher", subjects: ["ICT"] },
    })
  ).json();
  const context = await browser.newContext();
  const teacher = await context.newPage();
  try {
    await teacher.request.post("/api/signup", {
      data: { email, password: "Test-password-123!", name: "Subject Teacher" },
    });
    await teacher.goto("/newsletters.html#invite=" + invite.token);
    await expect(teacher.locator("#role")).toHaveText("teacher");
    await expect(
      teacher.locator("[data-field=english]").first(),
    ).toBeEditable();
    await expect(
      teacher.locator("[data-field=english]").nth(1),
    ).not.toBeEditable();
    const me = await (await teacher.request.get("/api/me")).json();
    expect(me.user.accessMode).toBe("newsletter");
    expect((await teacher.request.get("/api/rosters")).status()).toBe(403);
    expect((await teacher.request.get("/api/lesson-workspaces")).status()).toBe(
      403,
    );
    const upload = await teacher.request.post(
      `/api/school-newsletters/${w.id}/upload`,
      {
        multipart: {
          file: {
            name: "lesson.txt",
            mimeType: "text/plain",
            buffer: Buffer.from(
              "Students compare file sizes. Vocabulary: byte and kilobyte.",
            ),
          },
        },
      },
    );
    expect(upload.ok()).toBeTruthy();
    expect((await upload.json()).text).toContain("kilobyte");
    const forbidden = await teacher.request.post(
      `/api/school-newsletters/${w.id}/change`,
      {
        data: {
          revision: invite.workspace.revision + 1,
          action: "english",
          reportId: w.reports[0].id,
          subject: "Maths",
          text: "No permission",
        },
      },
    );
    expect(forbidden.status()).toBe(403);
    await teacher.goto("/");
    await expect(teacher).toHaveURL(/newsletters.html/);
  } finally {
    await context.close();
  }
});

test("coordinator regenerates selected subjects through a preview", async ({
  page,
}, testInfo) => {
  await signInDisposableTeacher(page, "-preview");
  let w = await (
    await page.request.post("/api/school-newsletters", {
      data: { name: "Vinschool · Cambridge newsletters" },
    })
  ).json();
  w = await (
    await page.request.post(`/api/school-newsletters/${w.id}/change`, {
      data: {
        revision: w.revision,
        action: "create-report",
        className: "Grade 3B2",
        week: "Week 10 · 12–16 October",
        subjects: ["ICT", "Maths"],
      },
    })
  ).json();
  const reportId = w.reports[0].id;
  for (const subject of ["ICT", "Maths"])
    w = await (
      await page.request.post(`/api/school-newsletters/${w.id}/change`, {
        data: {
          revision: w.revision,
          action: "english",
          reportId,
          subject,
          text: `Next week in ${subject}, the children will compare examples and explain their ideas.`,
          submit: true,
        },
      })
    ).json();
  await page.route("**/api/school-newsletters/*/generate", (route) => {
    const body = route.request().postDataJSON();
    expect(body.subjects).toEqual(["ICT"]);
    w = {
      ...w,
      revision: w.revision + 1,
      preview: {
        reportId,
        revision: w.revision + 1,
        entries: [
          {
            subject: "ICT",
            english:
              "Next week in ICT, we will compare file sizes.\n\nKey vocabulary\nByte: a unit of digital storage.",
          },
        ],
      },
    };
    return route.fulfill({ json: w });
  });
  await page.goto("/newsletters.html");
  await expect(page.locator("#spaceName")).toHaveText(
    "Vinschool · Cambridge newsletters",
  );
  await page
    .getByText("Regenerate subjects using your example", { exact: true })
    .click();
  await page.locator("[data-subject][value=Maths]").uncheck();
  await page.locator("[data-action=reformat]").click();
  await expect(page.locator("#preview")).toBeVisible();
  await expect(page.locator("#previewBody")).toContainText("Key vocabulary");
  await expect(page.locator("[data-field=english]").first()).toContainText(
    "children will compare examples",
  );
  await page.locator("#closePreview").click();
  await page.screenshot({
    path: testInfo.outputPath("newsletter-workspace.png"),
    fullPage: true,
  });
});
