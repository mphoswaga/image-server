const { test, expect } = require("@playwright/test");
const { signInDisposableTeacher } = require("./helpers");
test("coordinator exports progress and publishes images and links after review", async ({
  page,
  browser,
}, testInfo) => {
  await signInDisposableTeacher(page, "-media-report");
  let w = await (
    await page.request.post("/api/school-newsletters/demo", { data: {} })
  ).json();
  const id = w.reports[0].id;
  await page.goto("/newsletters.html");
  await page.locator("#spaces").selectOption(w.id);
  await page.getByText("Coordinator reports", { exact: true }).click();
  await page.locator("#progressFilters [name=type]").selectOption("missing");
  await page.getByRole("button", { name: "Run report", exact: true }).click();
  await expect(page.locator("#progressResult")).toContainText("contributions");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV" }).click();
  await download;
  const card = page.locator(".subject").first();
  await card.locator("summary").first().click();
  await card.getByText("Links and images", { exact: true }).click();
  await card
    .locator("[data-links]")
    .fill("Learning resource | https://example.com/lesson");
  await card.locator("[data-image]").setInputFiles({
    name: "example.png",
    mimeType: "image/png",
    buffer: require("fs").readFileSync(
      require("path").join(__dirname, "../../assets/newsletters/vinschool.png"),
    ),
  });
  await expect(card.locator("[data-caption]")).toBeVisible();
  await card.locator("[data-caption]").fill("Our school");
  await card.getByRole("button", { name: "Save links and images" }).click();
  await expect(page.locator("#message")).toContainText(
    "Links and images saved",
  );
  w = await (await page.request.get("/api/school-newsletters/" + w.id)).json();
  expect(w.reports[0].entries[0].images).toHaveLength(1);
  expect(w.reports[0].entries[0].submitted).toBe(false);
  for (const e of w.reports[0].entries) {
    for (const [action, extra] of [
      ["english", { text: e.english, submit: true }],
      ["vietnamese", { text: e.vietnamese, review: true }],
    ])
      w = await (
        await page.request.post("/api/school-newsletters/" + w.id + "/change", {
          data: {
            action,
            reportId: id,
            revision: w.revision,
            subject: e.subject,
            ...extra,
          },
        })
      ).json();
  }
  for (const action of ["approve", "publish"])
    w = await (
      await page.request.post("/api/school-newsletters/" + w.id + "/change", {
        data: { action, reportId: id, revision: w.revision },
      })
    ).json();
  const guest = await browser.newContext({
    viewport: testInfo.project.use.viewport,
  });
  try {
    const p = await guest.newPage();
    await p.goto(
      "/family-newsletter.html#" +
        w.id +
        "/" +
        id +
        "/" +
        w.reports[0].publication.token,
    );
    await expect(
      p.getByRole("link", { name: "Learning resource" }),
    ).toHaveAttribute("href", "https://example.com/lesson");
    await expect(p.getByRole("img", { name: "Our school" })).toBeVisible();
    await p.screenshot({
      path: testInfo.outputPath("parent-media.png"),
      fullPage: true,
      animations: "disabled",
    });
    const d = p.waitForEvent("download");
    await p.locator("#download").click();
    await (await d).saveAs(testInfo.outputPath("media-newsletter.pdf"));
  } finally {
    await guest.close();
  }
});
