const { test, expect } = require("@playwright/test");
const { signInDisposableTeacher } = require("./helpers");
test("coordinator creates a week, reuses content, previews and shares a class archive", async ({
  page,
  browser,
}, testInfo) => {
  await signInDisposableTeacher(page, "-weekly-workflow");
  let w = await (
    await page.request.post("/api/school-newsletters/demo", { data: {} })
  ).json();
  await page.goto("/newsletters.html");
  await page.locator("#spaces").selectOption(w.id);
  await page.getByText("Set up next week", { exact: true }).click();
  await page.locator("#nextWeekForm [name=week]").fill("Week 11");
  await page.locator("#nextWeekForm [name=deadline]").fill("2026-10-27");
  await page.locator("#nextWeekForm [name=sendDate]").fill("2026-10-30");
  await page
    .getByRole("button", { name: "Create next week", exact: true })
    .click();
  await expect(page.locator(".report-heading")).toContainText("Week 11");
  await page
    .locator("#reports")
    .getByRole("button", { name: /Demo Grade 3.*Sample week/ })
    .click();
  await page
    .getByText("Copy a saved subject to other classes", { exact: true })
    .click();
  await page.locator("#copySubjectForm [name=target]").check();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Apply to selected reports", exact: true })
    .click();
  w = await (await page.request.get("/api/school-newsletters/" + w.id)).json();
  expect(w.reports[1].entries[0].english).toContain("Next week");
  expect(w.reports[1].entries[0].submitted).toBe(false);
  await page
    .getByRole("button", { name: "Preview on a phone", exact: true })
    .click();
  await expect(
    page.frameLocator(".phone-dialog iframe").locator("#entries details"),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare parent demo", exact: true })
    .click();
  await page.getByText("Permanent class link", { exact: true }).click();
  await page
    .getByRole("button", { name: "Create class link", exact: true })
    .click();
  await page.getByText("Permanent class link", { exact: true }).click();
  const link = await page
    .getByRole("textbox", { name: "Permanent class link", exact: true })
    .inputValue();
  w = await (await page.request.get("/api/school-newsletters/" + w.id)).json();
  await page.request.post("/api/school-newsletters/" + w.id + "/change", {
    data: {
      revision: w.revision,
      action: "prepare-parent-demo",
      reportId: w.reports[1].id,
    },
  });
  const guest = await browser.newContext({
    viewport: testInfo.project.use.viewport,
  });
  try {
    const p = await guest.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(link);
    await expect(p.locator("#week")).toHaveText("Week 11");
    await p
      .getByLabel("Choose a week / Chọn tuần")
      .selectOption(w.reports[0].id);
    await expect(p.locator("#week")).toHaveText("Sample week");
    const download = p.waitForEvent("download");
    await p.locator("#download").click();
    await download;
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
  }
  await page.screenshot({
    path: testInfo.outputPath("weekly-workflow.png"),
    fullPage: true,
    animations: "disabled",
  });
});
