const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

test('sets, adds and removes marks on one matching question across classes', async ({ page }) => {
  await signInDisposableTeacher(page, '-across-classes');
  async function createClass(name, grade, question = 'Opens Chrome', firstId = 'first') {
    const roster = await page.request.post('/api/roster', { data: {
      name, rows: [{ ID: 'P1', Name: name + ' learner' }], idCol: 'ID', nameCol: 'Name',
    } });
    expect(roster.ok()).toBeTruthy();
    const items = [{ id: firstId, prompt: question, marks: 2 }, { id: 'second', prompt: 'Verifies a fact', marks: 3 }];
    if (firstId === 'local-id') items.reverse();
    const saved = await page.request.post('/api/assessment', { data: {
      rosterId: (await roster.json()).id,
      assessment: {
        title: 'Safe Digital Research', subject: 'ICT', grade, assessmentType: 'practical', deliveryMode: 'manual', totalMarks: 5,
        objectives: [{ id: 'skill', text: 'Research safely' }],
        sections: [{ id: 'tasks', type: 'practical', title: 'Tasks', objectiveIds: ['skill'], items }],
      },
    } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    return (await saved.json()).assessmentId;
  }

  const a = await createClass('Grade 2A', 'Grade 2');
  const b = await createClass('Grade 2B', 'Grade 2', 'Opens Chrome', 'local-id');
  const different = await createClass('Grade 2C', 'Grade 2', 'Opens Firefox');
  const otherGrade = await createClass('Grade 3A', 'Grade 3');

  const endpoint = '/api/assignment/' + a + '/grade/matching-classes';
  const initial = await (await page.request.get(endpoint)).json();
  expect(initial.classes.map(item => item.id)).toEqual([a, b]);
  const bad = await page.request.patch(endpoint, { data: { classIds: [a, different], questionId: 'first', operation: 'set', amount: 1 } });
  expect(bad.status()).toBe(409);
  await page.locator('#assignmentsBtn').click();
  await page.locator('#assessmentAcrossClasses').click();
  const dialog = page.getByRole('dialog', { name: 'Mark across classes' });
  await dialog.getByRole('combobox',{name:'Grade',exact:true}).selectOption('Grade 2');
  await expect(dialog.getByRole('combobox',{name:'Topic',exact:true}).locator('option')).toHaveCount(2);
  // Start from the version used in the two matching classes.
  await dialog.getByRole('button', { name: 'Close' }).click();
  const card = page.locator(`[data-assignment-id="${a}"]`);
  await card.getByRole('button', {name:'Mark work'}).click();
  await card.getByRole('button', {name:'By question'}).click();
  await card.getByRole('button', {name:'Mark across classes'}).click();
  await expect(dialog.getByRole('combobox',{name:'Question',exact:true})).toHaveValue('first');
  await expect(dialog.getByText('Grade 2A · 1 learner')).toBeVisible();
  await expect(dialog.getByText('Grade 2B · 1 learner')).toBeVisible();
  await expect(dialog.getByRole('group', {name:'Classes with matching questions'}).getByText('Grade 2C', {exact:false})).toHaveCount(0);

  for (const [operation, amount, expected] of [['set','1',1],['add','3',2],['remove','4',0]]) {
    await dialog.getByRole('combobox',{name:'Action',exact:true}).selectOption(operation);
    await dialog.getByLabel('Select all eligible classes').check();
    await dialog.getByLabel('Marks',{exact:true}).fill(amount);
    await dialog.getByRole('button',{name:'Apply to 2 learners'}).click();
    await expect(dialog.getByRole('status')).toContainText('2 learners updated');
    for (const [id, question] of [[a,'first'],[b,'local-id']]) {
      const result = await (await page.request.get('/api/assignment/' + id + '/results')).json();
      expect(result.manualLearners[0].grades[question].marksAwarded).toBe(expected);
      expect(result.manualLearners[0].grades.second).toBeUndefined();
      expect(result.submissions).toHaveLength(0);
    }
  }
  for (const id of [different, otherGrade]) {
    const result = await (await page.request.get('/api/assignment/' + id + '/results')).json();
    expect(result.manualLearners[0].grades).toEqual({});
  }
});
