const { test, expect } = require('@playwright/test');
test('shared File Lab preview link opens without teacher login', async ({page,request}) => {
  const response = await page.goto('/practice/file-sizes');
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/student\/practice\/file-sizes$/);
  await expect(page.locator('body')).not.toContainText('Not signed in');
  await expect(page.getByRole('button', {name:/2.*Experiment/})).toBeVisible();
  const redirect = await request.get('/practice/file-sizes?session=ABC123', {maxRedirects:0});
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe('/student/practice/file-sizes?session=ABC123');
  const control = await request.patch('/api/practice/live-sessions/ABC123/stage',{data:{stage:1}});
  expect(control.status()).toBe(401);
});
