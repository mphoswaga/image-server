const { test, expect } = require("@playwright/test");
const { signInDisposableTeacher } = require("./helpers");
test("teacher lands on a compact actionable contribution overview", async ({
  page,
}, testInfo) => {
  await signInDisposableTeacher(page, "-focused-news");
  const w = await (
    await page.request.post("/api/school-newsletters/demo", { data: {} })
  ).json();
  await page.goto("/newsletters.html");
  await page.locator("#spaces").selectOption(w.id);
  await page.locator("#demoRole").selectOption("teacher");
  await expect(
    page.getByRole("heading", { name: "My contributions", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#taskSummary")).toContainText("1 submitted");
  await expect(page.locator(".layout>aside")).toBeHidden();
  const task = page.locator(".task-card").first();
  await expect(task).toContainText("View contribution");
  if (testInfo.project.name === "windows-100")
    expect((await task.boundingBox()).y).toBeLessThan(700);
  if (testInfo.project.name === "mobile")
    expect((await page.locator("#spaces").boundingBox()).width).toBeGreaterThan(
      200,
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("teacher-overview.png"),
    fullPage: false,
  });
  await task.click();
  await expect(page.locator(".subject").first()).toHaveAttribute("open", "");
});
