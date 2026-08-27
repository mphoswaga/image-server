const { test, expect } = require('@playwright/test');
const { expectNoPageOverflow } = require('./helpers');

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
  await expect(page.getByRole('heading', { name: 'Rapid Relay' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play now' })).toBeVisible();
  await expect(page.locator('#skillNumber')).toContainText('Mission 1 of 6');
  await expectNoPageOverflow(page);
});
