const { test, expect } = require('@playwright/test');
const pptxgen = require('pptxgenjs');
const { expectNoOverlap, expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

async function simpleLessonDeck() {
  const pptx = new pptxgen();
  const title = pptx.addSlide();
  title.addText('Plants and habitats', { x: 0.8, y: 0.8, w: 8, h: 0.6 });
  const content = pptx.addSlide();
  content.addText('What plants need', { x: 0.8, y: 0.6, w: 8, h: 0.5 });
  content.addText('Water\nLight\nAir', { x: 1, y: 1.4, w: 5, h: 2 });
  return pptx.write({ outputType: 'nodebuffer' });
}

test.beforeEach(async ({ page }, testInfo) => {
  await signInDisposableTeacher(page, `-${testInfo.project.name}`);
});

test('lesson setup advances as a focused three-page wizard', async ({ page }) => {
  await page.getByRole('button', { name: /Start with objectives/ }).click();
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 1 of 3');
  await page.locator('#subject').fill('Science');
  await page.locator('#topic').fill('Plants');
  await page.locator('#flowSourceNextBtn').click();
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 2 of 3');
  await expect(page.locator('[data-flow-page="1"]')).not.toHaveClass(/active/);
  await page.locator('#objectives').fill('Identify the parts of a plant and explain what each part does.');
  await page.locator('#flowObjectivesNextBtn').click();
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 3 of 3');
  await expect(page.locator('#planBtn')).toBeVisible();
  await expect(page.locator('#planBtn')).toBeEnabled();
  await expectNoPageOverflow(page);
});

test('desktop navigation remains clickable and does not sit under account controls', async ({ page }) => {
  const menu = page.locator('#mainNavMenu');
  await expect(menu).toBeVisible();
  await expectNoOverlap(page.locator('#nav .logo'), page.locator('#nav .nav-user'));
  const rosters = page.locator('#rostersBtn');
  await rosters.click();
  await expect(page.locator('#rostersPanel')).toBeVisible();
  await page.locator('#homeBtn').click();
  await expect(page.locator('#modeSelect')).toBeVisible();
  await expectNoPageOverflow(page);
});

test('teacher can reopen and keep editing a saved lesson workspace', async ({ page }) => {
  const created = await page.request.post('/api/lesson-workspaces', {
    data: {
      context: {
        subject: 'ICT', topic: 'Create folders', grade: 'Grade 3', objectives: 'Create and name a folder.',
        slideCount: 5, tone: 'clear and engaging', teachingModelId: 'standard',
      },
      stage: 'plan',
      plan: { sections: [{ heading: 'Learning objective', content: 'Create and name a folder.' }] },
      deckRefs: [],
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.locator('#lessonsBtn').click();
  await expect(page.locator('#lessonsPanel')).toBeVisible();
  await expect(page.locator('#lessonsList')).toContainText('Create folders');
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'Resume lesson' }).click();
  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#planSections textarea.content')).toHaveValue('Create and name a folder.');

  const saved = page.waitForResponse(response => response.url().includes('/api/lesson-workspaces/') && response.request().method() === 'PATCH');
  await page.locator('#planSections textarea.content').fill('Create, name, and reopen a folder.');
  await saved;
  await expect(page.locator('#workspaceSaveStatus')).toContainText('Saved');

  const listing = await page.request.get('/api/lesson-workspaces');
  const body = await listing.json();
  expect(body.lessons).toHaveLength(1);
  expect(body.lessons[0].stage).toBe('plan');
});

test('saved lesson restores its working view and editable deck without regenerating it', async ({ page }) => {
  const imported = await page.request.post('/api/import/slides', {
    multipart: {
      file: { name: 'plants.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await simpleLessonDeck() },
      subject: 'Science', topic: 'Plants and habitats', grade: 'Grade 3', teachingModelId: 'standard',
    },
  });
  expect(imported.ok()).toBeTruthy();
  const deck = await imported.json();
  const created = await page.request.post('/api/lesson-workspaces', {
    data: {
      context: { subject: 'Science', topic: 'Plants and habitats', grade: 'Grade 3', teachingModelId: 'standard', deckImported: true, workspaceView: 'plan' },
      plan: { sections: [{ heading: 'Learning objective', content: 'Identify what plants need.' }] },
      stage: 'slides', activeDeckId: deck.deckId, deckRefs: [{ deckId: deck.deckId, edits: [] }],
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.locator('#lessonsBtn').click();
  await page.getByRole('button', { name: 'Resume lesson' }).click();
  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#planSections')).toContainText('Identify what plants need.');
  await page.locator('#acceptBtn').click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#deck')).toContainText('Plants and habitats');
  await expectNoPageOverflow(page);
});

test('roster upload controls keep their actions visible and separated', async ({ page }) => {
  await page.locator('#rostersBtn').click();
  await page.locator('#rosterAdd > summary').click();
  await expect(page.locator('#rosterDropZone')).toBeVisible();
  await expectNoPageOverflow(page);
  const visibleButtons = page.locator('#rostersPanel button:visible');
  const count = await visibleButtons.count();
  for (let i = 0; i < count; i += 1) {
    const box = await visibleButtons.nth(i).boundingBox();
    if (!box) continue;
    expect(box.width).toBeGreaterThan(20);
    expect(box.height).toBeGreaterThan(20);
  }
});
