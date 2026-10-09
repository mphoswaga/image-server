const { test, expect } = require("@playwright/test");
const { signInDisposableTeacher } = require("./helpers");
test("parents read approved subjects without signing in, switch language and lose access on revocation", async ({
  page,
  browser,
}, testInfo) => {
  await signInDisposableTeacher(page, "-parent-news");
  let w = await (
    await page.request.post("/api/school-newsletters/demo", { data: {} })
  ).json();
  const reportId = w.reports[0].id;
  const change = async (action, extra = {}) => {
    const r = await page.request.post(
      "/api/school-newsletters/" + w.id + "/change",
      { data: { revision: w.revision, reportId, action, ...extra } },
    );
    expect(r.ok(), await r.text()).toBeTruthy();
    w = await r.json();
  };
  await change("english", {
    subject: "ICT",
    text: "Unsubmitted sample draft",
    submit: false,
  });
  await page.goto("/newsletters.html");
  await page.locator("#spaces").selectOption(w.id);
  await page
    .getByRole("button", { name: "Prepare parent demo", exact: true })
    .click();
  await expect(page.locator("#parentLink")).toBeVisible();
  const link = await page.locator("#parentLink").inputValue();
  const guest = await browser.newContext({
      viewport: testInfo.project.use.viewport,
    }),
    parent = await guest.newPage();
  try {
    const errors = [];
    parent.on("pageerror", (e) => errors.push(e.message));
    await parent.goto(link);
    await expect(parent.locator("h1")).toHaveText(
      "A little window into our week.",
    );
    await expect(parent.locator("#logo")).toBeVisible();
    await expect(parent.locator("#entries details")).toHaveCount(3);
    await parent
      .getByRole("button", { name: "Tiếng Việt", exact: true })
      .click();
    await expect(parent.locator("#entries details").first()).toContainText(
      "Tuần tới",
    );
    await parent.locator("#subjects a").nth(1).click();
    await expect(parent.locator("#subject-1")).toHaveAttribute("open", "");
    expect(
      await parent.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await parent.screenshot({
      path: testInfo.outputPath("parent-newsletter.png"),
      fullPage: true,
      animations: "disabled",
    });
    const download = parent.waitForEvent("download");
    await parent.locator("#download").click();
    expect((await download).suggestedFilename()).toBe("weekly-newsletter.pdf");
    w = await (
      await page.request.get("/api/school-newsletters/" + w.id)
    ).json();
    await change("english", {
      subject: "ICT",
      text: "UNPUBLISHED PRIVATE EDIT",
      submit: false,
    });
    await parent.reload();
    await expect(parent.locator("#entries")).not.toContainText(
      "UNPUBLISHED PRIVATE EDIT",
    );
    await change("revoke-publication");
    await parent.reload();
    await expect(parent.locator("#status")).toContainText("unavailable");
    await expect(parent.locator("#content")).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
});
