const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

test('optional newsletter is generated, editable, saved, reopened and excluded from plan downloads', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const text = 'Next week, students will explore habitats in Science.\n\nHow can you help at home?\nAsk where a bird lives.\n\nHomework\nPlease make sure your child completes the Science homework on LMS.';
  let newsletterCalls = 0, downloadPayload;
  await page.route('**/api/lesson-plan', route => route.fulfill({ json: { sections: [{ heading: 'Learning', content: 'Match animals to habitats.' }], teachingModelId: 'standard' } }));
  await page.route('**/api/lesson-workspaces/*/newsletter', async route => {
    newsletterCalls++;
    const id = route.request().url().split('/').at(-2);
    const saved = await (await page.request.get(`/api/lesson-workspaces/${id}/resume`)).json();
    expect(saved.workspace.plan.sections[0].content).toBe('Match animals to habitats.');
    await route.fulfill({ json: { newsletter: { text, timing: 'next' } } });
  });
  await page.route('**/api/lesson-plan/download', async route => {
    downloadPayload = route.request().postDataJSON();
    await route.fulfill({ headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="plan.txt"' }, body: 'Match animals to habitats.' });
  });
  await signInDisposableTeacher(page, '-newsletter');
  await page.getByRole('button', { name: /Start with objectives/ }).click();
  await page.locator('#subject').fill('Science');await page.locator('#topic').fill('Habitats');
  await page.locator('#flowSourceNextBtn').click();await page.locator('#objectives').fill('Match animals to habitats.');
  await page.locator('#flowObjectivesNextBtn').click();
  await page.locator('#newsletterEnabled').check();await page.locator('#planBtn').click();
  await expect(page.locator('#newsletterText')).toHaveValue(text);
  await expect(page.locator('#newsletterText')).toBeEnabled();
  await expect(page.locator('#newsletterStatus')).toContainText('Newsletter saved');
  await page.locator('#newsletterText').fill(text + '\nTeacher addition.');
  await page.locator('#newsletterSave').click();await expect(page.locator('#newsletterStatus')).toHaveText('Newsletter saved.');
  await page.locator('#dlPlanBtn').click();
  await expect.poll(() => downloadPayload).toBeTruthy();
  expect(downloadPayload.sections).toEqual([{ heading: 'Learning', content: 'Match animals to habitats.' }]);
  expect(JSON.stringify(downloadPayload)).not.toContain('Teacher addition');
  expect(downloadPayload.newsletter).toBeUndefined();
  await page.locator('#lessonsBtn').click();
  await page.locator('[data-workspace-resume]').first().click();
  await expect(page.locator('#newsletterText')).toHaveValue(text + '\nTeacher addition.');
  expect(newsletterCalls).toBe(1);
  const list = await (await page.request.get('/api/lesson-workspaces')).json();
  const stored = await (await page.request.get(`/api/lesson-workspaces/${list.lessons[0].id}/resume`)).json();
  expect(stored.workspace.newsletter.text).toContain('Teacher addition.');
  expect(stored.workspace.plan.sections[0].content).toBe('Match animals to habitats.');
  expect(errors).toEqual([]);
});
