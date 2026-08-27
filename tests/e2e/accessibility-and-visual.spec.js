const { test, expect } = require('@playwright/test');
const { expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

test.beforeEach(async ({ page }, testInfo) => {
  await signInDisposableTeacher(page, `-a11y-${testInfo.project.name}`);
});

test('primary teacher navigation and lesson setup work from the keyboard', async ({ page }) => {
  const rosters = page.locator('#rostersBtn');
  await rosters.focus();
  await expect(rosters).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#rostersPanel')).toBeVisible();

  const addRoster = page.locator('#rosterAdd > summary');
  await addRoster.focus();
  await expect(addRoster).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#rosterDropZone')).toBeVisible();

  const home = page.locator('#homeBtn');
  await home.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#modeSelect')).toBeVisible();

  const objectives = page.getByRole('button', { name: /Start with objectives/ });
  await objectives.focus();
  await expect(objectives).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 1 of 3');

  await page.locator('#subject').fill('Science');
  await page.locator('#topic').fill('Habitats');
  const next = page.locator('#flowSourceNextBtn');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 2 of 3');
  await expect(page.locator('#objectives')).toBeVisible();
  await expectNoPageOverflow(page);
});

test('planning and roster surfaces retain their approved responsive layout', async ({ page }, testInfo) => {
  test.skip(!['windows-100', 'mobile'].includes(testInfo.project.name), 'Visual baselines cover the two layout extremes.');

  await page.getByRole('button', { name: /Start with objectives/ }).click();
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 1 of 3');
  const screenshotStyle = await page.addStyleTag({ content: '.app-menu { visibility: hidden !important; }' });
  const planningImage = await page.locator('#composer').screenshot({ animations: 'disabled', caret: 'hide' });
  expect(planningImage).toMatchSnapshot(`planning-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.002 });

  await screenshotStyle.evaluate((style) => style.remove());
  await page.locator('#rostersBtn').click();
  await page.locator('#rosterAdd > summary').click();
  await expect(page.locator('#rosterDropZone')).toBeVisible();
  await page.addStyleTag({ content: '.app-menu { visibility: hidden !important; }' });
  const rosterImage = await page.locator('#rostersPanel').screenshot({ animations: 'disabled', caret: 'hide' });
  expect(rosterImage).toMatchSnapshot(`roster-${testInfo.project.name}.png`, { maxDiffPixelRatio: 0.002 });
});
