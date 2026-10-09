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
  await page.getByRole('button',{name:'Use Vinschool design'}).click();
  await expect(page.locator('#pdfFrame')).toHaveAttribute('src', /^blob:/);
  await page.locator('#closePdfPreview').click();
  await expect(page.locator('.report-preview-card')).toContainText('Vinschool');
  await page.getByText("Manage workspace", { exact: true }).click();
  await page.getByText("Format and minimum length", { exact: true }).click();
  await page.locator("#settings [name=design]").selectOption("vinschool");
  await page.locator("#settings [name=minimum]").fill("20");
  await page.locator("#settings [name=vietnameseMinimum]").fill("10");
  await page.locator("#settings button").click();
  await page.locator(".subject > summary").nth(0).click();
  await page.locator(".subject > summary").nth(1).click();
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
  await expect(page.locator(".subject .status").first()).toContainText("English submitted");
  await page.locator("[data-action=submit]").nth(1).click();
  await expect(page.locator(".subject .status").nth(1)).toContainText("English submitted");
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
    await expect(page.locator(".subject .status").nth(i)).toContainText("Vietnamese reviewed");
  }
  await page.locator("[data-action=approve]").click();
  await expect(page.locator("#editor")).toContainText("Approved for sharing");
  await expect(page.locator("#settings [name=design]")).toHaveValue(
    "vinschool",
  );
  await page.locator("[data-action=print]").click();
  await expect(page.locator("#pdfFrame")).toHaveAttribute("src", /^blob:/);
  const pendingDownload = page.waitForEvent("download");
  await page.locator("#pdfDownload").click();
  const download = await pendingDownload;
  await download.saveAs(testInfo.outputPath("approved-newsletter.pdf"));
  await page.locator("#pdfPreview button").filter({ hasText: "Close" }).click();
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
    const ownDemo = await teacher.request.post("/api/school-newsletters/demo", {
      data: {},
    });
    expect(ownDemo.ok()).toBeTruthy();
    expect((await ownDemo.json()).demo).toBe(true);
    expect((await teacher.request.get("/api/rosters")).status()).toBe(403);
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
    .getByText("Report tools and previous versions", { exact: true })
    .click();
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

test("staff demo offers role rehearsal, teacher preview and actual PDF download", async ({
  page,
}, testInfo) => {
  await signInDisposableTeacher(page, "-demo");
  await page.goto("/newsletters.html");
  await page.locator("#openDemo").click();
  await expect(page.locator("#demoBar")).toBeVisible();
  await expect(page.locator(".subject")).toHaveCount(3);
  await page.locator("#demoRole").selectOption("teacher");
  await expect(page.locator("#role")).toHaveText("teacher");
  await expect(page.locator("[data-field=english]").first()).toBeEditable();
  await expect(page.locator("[data-field=english]").nth(1)).not.toBeEditable();
  await page
    .locator("[data-field=english]")
    .first()
    .fill("Testing the sample teacher contribution.");
  await page.locator("[data-action=save-en]").click();
  await page.locator("[data-action=teacher-preview]").click();
  await expect(page.locator("#teacherPreview")).toBeVisible();
  await expect(page.locator("#teacherPreviewBody textarea")).toHaveValue(
    "Testing the sample teacher contribution.",
  );
  await expect(page.locator("#teacherPreviewBody textarea")).not.toBeEditable();
  await page.screenshot({ path: testInfo.outputPath("teacher-preview.png") });
  await page.locator("#teacherPdf").click();
  await expect(page.locator("#pdfPreview")).toBeVisible();
  await expect(page.locator("#pdfStatus")).toContainText("Demo PDF");
  await expect(page.locator("#pdfFrame")).toHaveAttribute("src", /^blob:/);
  const download = page.waitForEvent("download");
  await page.locator("#pdfDownload").click();
  const file = await download;
  await file.saveAs(testInfo.outputPath("demo-newsletter.pdf"));
  await page.locator("#closePdfPreview").click();
  await page.locator("#closeTeacherPreview").click();
  await page.locator("#demoRole").selectOption("translator");
  await expect(page.locator("[data-field=english]").first()).not.toBeEditable();
  await expect(page.locator("[data-field=vietnamese]").first()).toBeEditable();
  page.once("dialog", (d) => d.accept());
  await page.locator("#resetDemo").click();
  await expect(page.locator("[data-field=english]").first()).toHaveValue(
    /file types/,
  );
  await page.route("**/reports/*/pdf", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Please try the preview again." },
    }),
  );
  await page.locator("[data-action=pdf-preview]").click();
  await expect(page.locator("#pdfStatus")).toHaveText(
    "Please try the preview again.",
  );
  await page.locator("#closePdfPreview").click();
  await page.unroute("**/reports/*/pdf");
  await page.locator("#exitDemo").click();
  await expect(page.locator("#demoBar")).toBeHidden();
});

test("demo bypasses old cached script and responds visibly while opening", async ({
  page,
}) => {
  await signInDisposableTeacher(page, "-demo-cache");
  let oldScriptRequested = false;
  await page.route(/\/newsletters\.js$/, (route) => {
    oldScriptRequested = true;
    return route.fulfill({
      contentType: "application/javascript",
      body: "window.oldNewsletterScript=true;",
    });
  });
  await page.goto("/newsletters.html");
  await expect(page.locator("#home")).toBeVisible();
  expect(oldScriptRequested).toBe(false);
  const script = await page.request.get("/newsletters.js?v=demo2");
  expect(script.headers()["cache-control"]).toContain("no-store");
  expect(script.headers()["cloudflare-cdn-cache-control"]).toBe("no-store");
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route("**/api/school-newsletters/demo", async (route) => {
    await gate;
    await route.continue();
  });
  await page.locator("#openDemo").click();
  await expect(page.locator("#openDemo")).toHaveText("Opening demo…");
  await expect(page.locator("#openDemo")).toBeDisabled();
  release();
  await expect(page.locator("#demoBar")).toBeVisible();
  await expect(page.locator("#openDemo")).toBeEnabled();
  await expect(page.locator("#role")).toHaveText("coordinator");
});

test("newsletter publishing overview stays compact and previews both languages", async ({
  page,
}, testInfo) => {
  await signInDisposableTeacher(page, "-publishing");
  await page.goto("/newsletters.html");
  await page.locator("#openDemo").click();
  await expect(page.locator(".subject")).toHaveCount(3);
  await expect(page.locator(".subject[open]")).toHaveCount(0);
  await expect(page.locator("#coordinator")).not.toHaveAttribute("open", "");
  await expect(page.locator(".report-preview-card")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("newsletter-workspace.png"),
    fullPage: true,
  });
  await page.locator("[data-action=teacher-preview]").click();
  await page.locator("#previewLanguage").selectOption("vietnamese");
  await expect(page.locator("#teacherPreviewBody textarea")).toContainText(
    "Tuần tới",
  );
  await page.locator("#closeTeacherPreview").click();
  await page.locator(".subject > summary").first().click();
  await expect(page.locator("[data-field=english]").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
