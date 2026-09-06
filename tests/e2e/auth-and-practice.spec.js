const { test, expect } = require('@playwright/test');
const { expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

test('signed-out learners can enter guest practice without an account', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#authScreen')).toBeVisible();
  const guest = page.getByRole('link', { name: 'Student guest practice' });
  await expect(guest).toBeVisible();
  await guest.click();
  await expect(page).toHaveURL(/\/student\/practice\/guest/);
  await page.getByRole('button', { name: 'Play on my own' }).click();
  await expect(page.getByRole('button', { name: 'Begin the rescue' })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('Grade 3 practice opens as a distinct playable world', async ({ page }) => {
  await page.goto('/student/practice/guest?world=g3&continue=1');
  await expect(page.getByRole('heading', { name: 'File Base' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play now' })).toBeVisible();
  await expect(page.locator('#skillNumber')).toContainText('Mission 1 of 7');
  await expect(page.locator('.combo-stat')).toBeVisible();
  await expectNoPageOverflow(page);
});

test('FishQuest keeps each learner audio choice on their device', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One Chromium run covers local audio preferences.');
  await page.goto('/fishquest-play/audio-controls-test');
  await expect(page.locator('#soundToggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#soundToggle').evaluate(button => button.click());
  await expect(page.locator('#soundToggle')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('#soundToggle')).toHaveAttribute('aria-pressed', 'false');
});

test('Typing Academy repairs a missed number key before unlocking the next lesson', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One desktop Chromium run covers physical-key interaction.');
  await signInDisposableTeacher(page, '-typing-repair');
  await page.goto('/practice/preview?world=typing&stage=number-launch');

  await expect(page.getByRole('heading', { name: 'Number Launch' })).toBeVisible();
  await expect(page.locator('#skillNumber')).toHaveText('Mission 9 of 12');
  await expect(page.locator('#typingWpmStat')).toBeVisible();
  await expect(page.locator('.progress-step.locked')).toHaveCount(3);
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Play now' }).click();
  const roomLabel = page.locator('.room-label');
  await expect(roomLabel).toContainText('Code 1 of 5');
  await page.keyboard.press('2');
  await expect(page.locator('#feedback')).toContainText('Next: 1');

  for (const [index, pattern] of ['123 321', '456 654', '789 987', '2026', '10 20 30'].entries()) {
    await page.keyboard.type(pattern);
    if (index < 4) await expect(roomLabel).toContainText(`Code ${index + 2} of 5`);
  }

  await expect(page.getByText('Personal key practice', { exact: true })).toBeVisible();
  await expect(page.locator('.adaptive-copy h3')).toHaveText('Press 1');
  await page.keyboard.press('1');
  await expect(page.locator('.adaptive-progress')).toHaveText('Key 2 of 2');
  await page.keyboard.press('1');
  await expect(page.getByRole('button', { name: 'Next mission' })).toBeVisible();
  await expect(page.locator('#saveState')).toContainText('Preview only');
});

test('Typing Academy punctuation lesson remains usable on a phone-sized screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'This check targets the smallest supported viewport.');
  await signInDisposableTeacher(page, '-typing-mobile');
  await page.goto('/practice/preview?world=typing&stage=punctuation-port');

  await expect(page.getByRole('heading', { name: 'Punctuation Port' })).toBeVisible();
  await expect(page.locator('#skillNumber')).toHaveText('Mission 10 of 12');
  await page.getByRole('button', { name: 'Play now' }).click();
  await expect(page.locator('#typingCard')).toContainText('cat, dog.');
  await expect(page.locator('#typingCard')).toContainText('Hold Shift for ? and !');
  await expect.poll(() => page.locator('.progress').evaluate((progress) => {
    const current = progress.querySelector('.current');
    const outer = progress.getBoundingClientRect();
    const inner = current && current.getBoundingClientRect();
    return Boolean(inner && inner.left >= outer.left && inner.right <= outer.right);
  })).toBe(true);
  expect(await page.locator('.game-hud').evaluate((hud) => getComputedStyle(hud).gridTemplateColumns.split(' ').length)).toBe(3);
  await expectNoPageOverflow(page);
});
