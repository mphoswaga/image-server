const { test, expect } = require('@playwright/test');

test('EducScope shared session creates the trusted LessonScope teacher session', async ({ page }, testInfo) => {
  test.skip(!['windows-100', 'desktop-safari'].includes(testInfo.project.name), 'The cross-app cookie bridge needs one Chromium and one WebKit contract run.');

  await page.context().addCookies([{
    name: 'es_session',
    value: 'e2e-valid',
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  const response = await page.request.get('/api/educscope/session');
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  expect(session).toMatchObject({
    authenticated: true,
    user: { email: 'shared-teacher@example.test', name: 'Shared Teacher' },
  });

  await page.addInitScript(() => localStorage.setItem('lc_wizard_done', '1'));
  await page.goto('/');
  await expect(page.locator('#authScreen')).toBeHidden();
  await expect(page.locator('#navName')).toContainText('Shared Teacher');
});

test('EducScope bridge keeps a signed-out visitor signed out', async ({ page }, testInfo) => {
  test.skip(!['windows-100', 'desktop-safari'].includes(testInfo.project.name), 'The cross-app cookie bridge needs one Chromium and one WebKit contract run.');

  const response = await page.request.get('/api/educscope/session');
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({
    authenticated: false,
    loginUrl: /account\?mode=login/,
  });
});
