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
  await page.getByLabel('Number of questions or criteria').fill('15');
  await page.getByRole('button', {name:'Set number of fields'}).click();
  await expect(page.locator('[data-item-prompt]')).toHaveCount(15);
  await expect(page.locator('#assessmentTotalStatus')).toHaveClass(/valid/);
  await page.getByRole('button',{name:'Paste a marking rubric'}).click();
  await page.getByLabel('Rubric table with step, task, objective and marks').fill(
    'Step\tTask\tLearning Objective Alignment\tMarks\n1\tOpened Chrome\t—\t1\n2\tFormats a heading\tCreate a document\t49'
  );
  await page.getByRole('button', {name:'Create criteria from rubric'}).click();
  await expect(page.locator('#assessmentRubricStatus')).toContainText('2 criteria imported · 50 marks');
  await expect(page.locator('[data-item-marks]').first()).toHaveValue('1');
  await page.locator('#assessmentRoster').selectOption(roster.id);
  const published = page.waitForResponse(response =>
    response.url().endsWith('/api/assessment') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save practical assessment' }).click();
  const created = await published;
  expect(created.ok(), await created.text()).toBeTruthy();
  const { assessmentId, roomCode } = await created.json();
  expect(roomCode).toBeNull();
  const wrap = page.locator('#manual-practical-results');
  await wrap.getByRole('button', { name: 'By question' }).click();
  await expect(wrap.getByLabel('Mark for Amina')).toHaveValue('');
  await wrap.getByLabel('Select Amina').check();
  await wrap.getByLabel('Mark for selected learners').fill('0');
  await wrap.getByRole('button', { name: 'Apply to 1 selected' }).click();
  await expect(wrap.getByLabel('Mark for Amina')).toHaveValue('0');
  const url = '/api/assignment/' + assessmentId;
  const partial = await (await page.request.get(url + '/results')).json();
  expect(partial.submissions).toHaveLength(0);
  expect((await page.request.patch(url + '/marked', {data:{marked:true}})).status()).toBe(409);

  await wrap.getByLabel('Select Amina').check();
  await wrap.getByLabel('Marks to add').fill('2');
  await wrap.getByRole('button', { name: 'Add to 1 selected' }).click();
  await expect(wrap.getByLabel('Mark for Amina')).toHaveValue('1');
  await wrap.getByRole('button', { name: 'Next', exact: true }).click();
  await wrap.getByLabel('Mark for Amina').fill('0');
  await wrap.locator('.grade-row').filter({hasText:'Amina'}).getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(async () => {
    const current = await (await page.request.get(url + '/results')).json();
    return current.submissions.length;
  }).toBe(1);

  const result = await (await page.request.get(url + '/results')).json();
  expect(result.questions[0].objectiveIds).toEqual([]);
  expect(result.questions[1].objectiveIds).toEqual(['objective-create-a-document']);
  expect(result.submissions[0]).toMatchObject({ studentId: 'P1', totalMarks: 1, maxMarks: 50 });
  expect(result.submissions[0].grades[result.questions[1].id].marksAwarded).toBe(0);

  await wrap.getByRole('button', { name: 'By student' }).click();
  const marking = wrap.locator('form');
  await expect(marking.getByLabel('Learner')).toHaveValue('P2');
  await expect(marking.getByLabel('Formats a heading (49 marks)')).toHaveValue('');
  const completed = page.waitForResponse(response => response.url().endsWith('/marked') && response.request().method() === 'PATCH');
  await marking.getByRole('button', { name: 'Mark as completed' }).click();
  expect(await (await completed).json()).toMatchObject({ recordedResults: 1 });
});
