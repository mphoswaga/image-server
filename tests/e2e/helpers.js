const { expect } = require('@playwright/test');

async function signInDisposableTeacher(page, suffix = '') {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}@example.test`;
  const response = await page.request.post('/api/signup', {
    data: { email, password: 'Test-password-123!', name: 'Test Teacher' },
  });
  expect(response.ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem('lc_wizard_done', '1'));
  await page.goto('/');
  await expect(page.locator('#navName')).toContainText('Test Teacher');
  await expect(page.locator('#authScreen')).toBeHidden();
}

async function expectNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll('body *')].map(element => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, id: element.id, className: String(element.className || '').slice(0, 100), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    }).filter(item => item.right > document.documentElement.clientWidth + 2 || item.left < -2 || item.scrollWidth > item.clientWidth + 2).sort((a, b) => Math.max(b.right, b.scrollWidth) - Math.max(a.right, a.scrollWidth)).slice(0, 12),
  }));
  expect(Math.max(dimensions.body, dimensions.root), JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 2);
}

async function expectNoOverlap(first, second) {
  expect(await first.count()).toBeGreaterThan(0);
  expect(await second.count()).toBeGreaterThan(0);
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlap).toBeFalsy();
}

module.exports = { expectNoOverlap, expectNoPageOverflow, signInDisposableTeacher };
