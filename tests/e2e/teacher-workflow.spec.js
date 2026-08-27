const { test, expect } = require('@playwright/test');
const { expectNoOverlap, expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

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
