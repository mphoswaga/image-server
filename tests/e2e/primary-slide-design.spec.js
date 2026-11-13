const { test, expect } = require("@playwright/test");
const pptxgen = require("pptxgenjs");
const PizZip = require("pizzip");
const { signInDisposableTeacher, expectNoPageOverflow } = require("./helpers");
async function importLesson(page) {
  const pptx = new pptxgen();
  for (const [title, body] of [
    ["Data detectives", "Read a table."],
    ["Learning outcomes", "Identify fields and records."],
    ["Your turn", "Create a table for three pets."],
  ]) {
    const slide = pptx.addSlide();
    slide.addText(title, { x: 0.5, y: 0.5, w: 9, h: 1 });
    slide.addText(body, { x: 0.5, y: 2, w: 9, h: 2 });
  }
  const response = await page.request.post("/api/import/slides", {
    multipart: {
      subject: "ICT",
      topic: "Data detectives",
      grade: "Grade 3",
      file: {
        name: "data.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: await pptx.write({ outputType: "nodebuffer" }),
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function openDeck(page, d) {
  await page.evaluate((d) => {
    ctx = {
      subject: "ICT",
      topic: "Data detectives",
      grade: "Grade 3",
      lessonPurpose: "lesson",
    };
    currentDeckId = d.deckId;
    renderDeck(d);
    show("slides");
  }, d);
}
test("design changes preserve edits, resources, saved lessons and real PowerPoint output", async ({
  page,
  browser,
}) => {
  await signInDisposableTeacher(page, "-primary");
  const d = await importLesson(page);
  await openDeck(page, d);
  await page
    .locator(".slide")
    .first()
    .locator("[data-field=title]")
    .fill("Our data detectives");
  await page.evaluate(() => {
    $("packPreview").innerHTML =
      '<span id="keep-resource">Prepared resource</span>';
  });
  await page.locator("#deckDesignSelect").selectOption("primary-discovery");
  await page.locator("#applyDeckDesign").click();
  await expect(page.locator("#deckDesignStatus")).toHaveText(
    "Design applied. Lesson content preserved.",
  );
  await expect(page.locator(".slide").first()).toHaveAttribute(
    "data-design",
    "primary",
  );
  await expect(
    page.locator(".slide").first().locator("[data-field=title]"),
  ).toHaveText("Our data detectives");
  await expect(page.locator("#keep-resource")).toHaveText("Prepared resource");
  await expectNoPageOverflow(page);
  await page.evaluate(() => saveWorkspaceNow());
  const workspaceId = await page.evaluate(() => currentWorkspaceId);
  expect(workspaceId).toBeTruthy();
  await page.reload();
  await page.evaluate((id) => resumeLessonWorkspace(id), workspaceId);
  await expect(page.locator("#deckDesignSelect")).toHaveValue(
    "primary-discovery",
  );
  await expect(
    page.locator(".slide").first().locator("[data-field=title]"),
  ).toHaveText("Our data detectives");
  const id = await page.evaluate(() => currentDeckId);
  const download = await page.request.post(`/api/download/${id}`, {
    data: { edits: [] },
  });
  expect(download.ok()).toBeTruthy();
  const zip = new PizZip(await download.body());
  expect(zip.file("ppt/slides/slide1.xml").asText()).toContain(
    "Our data detectives",
  );
  expect(zip.file("ppt/slides/slide1.xml").asText()).toContain(
    "Arial Rounded MT Bold",
  );
  const invalid = await page.request.post(`/api/deck/${id}/design`, {
    data: { presetId: "missing", edits: [{ index: 0, title: "LOST" }] },
  });
  expect(invalid.status()).toBe(400);
  const kept = await (await page.request.get(`/api/deck/${id}`)).json();
  expect(kept.slides[0].title).toBe("Our data detectives");
  const foreign = await browser.newContext();
  const other = await foreign.newPage();
  await signInDisposableTeacher(other, "-foreign-primary");
  expect(
    (
      await other.request.post(`/api/deck/${id}/design`, {
        data: { presetId: "primary-ocean" },
      })
    ).status(),
  ).toBe(404);
  await foreign.close();
  await page.locator("#deckDesignSelect").selectOption("ocean-classic");
  await page.locator("#applyDeckDesign").click();
  await expect(page.locator(".slide").first()).toHaveAttribute(
    "data-design",
    "classic",
  );
});

test("adding an AI picture to an empty slide preserves edits and supports hide/restore", async ({
  page,
}) => {
  await signInDisposableTeacher(page, "-primary-media");
  const d = await importLesson(page);
  await openDeck(page, d);
  await page.locator("#deckDesignSelect").selectOption("primary-discovery");
  await page.locator("#applyDeckDesign").click();
  await expect(page.locator("#deckDesignStatus")).toContainText(
    "Design applied",
  );
  // Exercise the display path without purchasing an image during a test.
  const picture =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const first = page.locator(".slide").first();
  await first.locator("[data-field=title]").fill("Keep my title");
  await page.route("**/api/slide/*/ai-image", (r) =>
    r.fulfill({ json: { image: picture, imageSource: "ai-generated" } }),
  );
  await first.locator("[data-action=ai]").click();
  await expect(first.locator(".thumb img")).toHaveAttribute("src", picture);
  await expect(first.locator("[data-field=title]")).toHaveText("Keep my title");
  await first.locator("[data-action=hide-picture]").click();
  await expect(first.locator(".thumb img")).toHaveCount(0);
  await expect(first.locator("[data-action=restore-picture]")).toBeVisible();
  expect(
    (await (await page.request.get(`/api/deck/${d.deckId}`)).json()).slides[0]
      .pictureMode,
  ).toBe("hide");
  await expectNoPageOverflow(page);
});
