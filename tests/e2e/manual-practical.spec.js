const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

test('teacher builds a 50-mark practical and saves recorded zeros from a tablet', async ({ page }) => {
  await signInDisposableTeacher(page, '-manual-practical');
  const rosterResponse = await page.request.post('/api/roster', {
    data: { name: 'Practical class', rows: [{ ID: 'P1', Name: 'Amina' }, { ID: 'P2', Name: 'Bao' }], idCol: 'ID', nameCol: 'Name' }
  });
  expect(rosterResponse.ok()).toBeTruthy();
  const roster = await rosterResponse.json();
  await page.locator('#assignmentsBtn').click();
  await page.locator('#newAssessmentBtn').click();
  await page.getByRole('button', { name: '50 marks: practical only' }).click();
  await expect(page.locator('#assessmentDelivery')).toHaveValue('manual');
  await expect(page.locator('#assessmentGeneratePracticalMarks')).toHaveValue('50');
  await page.locator('#assessmentTitle').fill('Document practical');
  await page.locator('#assessmentSubject').fill('Computing');
  await page.locator('#assessmentGrade').fill('Grade 2');
  await page.locator('#assessmentObjectives').fill('Create a document');
  await page.locator('[data-item-prompt]').fill('Formats a heading');
  await page.locator('#assessmentRoster').selectOption(roster.id);
  const published = page.waitForResponse(response =>
    response.url().endsWith('/api/assessment') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save practical assessment' }).click();
  const created = await published;
  expect(created.ok(), await created.text()).toBeTruthy();
  const { assessmentId, roomCode } = await created.json();
  expect(roomCode).toBeNull();
  const marking = page.locator('#manual-practical-results form');
  await expect(marking.getByLabel('Learner')).toHaveValue('P1');
  await expect(marking.getByLabel('Formats a heading (50 marks)')).toHaveValue('');
  await marking.getByLabel('Formats a heading (50 marks)').fill('0');
  await marking.getByRole('button', { name: 'Save marks and go to next learner' }).click();
  await expect(marking.getByLabel('Learner')).toHaveValue('P2');
  await expect(marking.getByLabel('Formats a heading (50 marks)')).toHaveValue('');
  const result = await (await page.request.get('/api/assignment/' + assessmentId + '/results')).json();
  expect(result.submissions).toHaveLength(1);
  expect(result.submissions[0]).toMatchObject({ studentId: 'P1', totalMarks: 0, maxMarks: 50 });
  const completed = page.waitForResponse(response => response.url().endsWith('/marked') && response.request().method() === 'PATCH');
  await marking.getByRole('button', { name: 'Mark as completed' }).click();
  expect(await (await completed).json()).toMatchObject({ recordedResults: 1 });
});
