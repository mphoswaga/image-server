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
  await expect(dialog.getByRole('group', {name:'Grade 2A'}).getByRole('checkbox', {name:'Grade 2A learner'})).toBeVisible();
  await expect(dialog.getByRole('group', {name:'Grade 2B'}).getByRole('checkbox', {name:'Grade 2B learner'})).toBeVisible();
  await expect(dialog.getByRole('group', {name:'Grade 2C'})).toHaveCount(0);

  const firstClass = dialog.getByRole('group', {name:'Grade 2A'});
  await firstClass.getByRole('spinbutton', {name:'Mark for Grade 2A learner'}).fill('1');
  await firstClass.getByRole('button', {name:'Save',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('1 learner updated');
  const other = await (await page.request.get('/api/assignment/' + b + '/results')).json();
  expect(other.manualLearners[0].grades).toEqual({});

  for (const [operation, amount, expected] of [['set','1',1],['add','3',2],['remove','4',0]]) {
    await dialog.getByRole('combobox',{name:'Action',exact:true}).selectOption(operation);
    await dialog.getByLabel('Select all matching learners').check();
    await dialog.getByRole('spinbutton',{name:'Marks',exact:true}).fill(amount);
    await dialog.getByRole('button',{name:'Apply to 2 learners'}).click();
    await expect(dialog.getByRole('status')).toContainText('2 learners updated');
    for (const [id, question] of [[a,'first'],[b,'local-id']]) {
      const result = await (await page.request.get('/api/assignment/' + id + '/results')).json();
      expect(result.manualLearners[0].grades[question].marksAwarded).toBe(expected);
      expect(result.manualLearners[0].grades.second).toBeUndefined();
      expect(result.submissions).toHaveLength(0);
    }
  }

  await dialog.getByRole('button',{name:'Next question'}).click();
  await expect(dialog.getByRole('combobox',{name:'Question',exact:true})).toHaveValue('second');
  await dialog.getByRole('combobox',{name:'Action',exact:true}).selectOption('set');
  await dialog.getByLabel('Select all matching learners').check();
  await dialog.getByRole('spinbutton',{name:'Marks',exact:true}).fill('3');
  await dialog.getByRole('button',{name:'Apply to 2 learners'}).click();
  await expect(dialog.getByRole('status')).toContainText('2 learners updated');
  for (const [id, question] of [[a,'first'],[b,'local-id']]) {
    const result = await (await page.request.get('/api/assignment/' + id + '/results')).json();
    expect(result.submissions[0].grades[question].marksAwarded).toBe(0);
    expect(result.submissions[0].grades.second.marksAwarded).toBe(3);
  }

  for (const id of [different, otherGrade]) {
    const result = await (await page.request.get('/api/assignment/' + id + '/results')).json();
    expect(result.manualLearners[0].grades).toEqual({});
  }
});

test('shows the submitted choice beside each learner and follows the selected question', async ({ page, browser }) => {
  await signInDisposableTeacher(page, '-cross-class-answers');
  for (const [index, name] of ['Class A', 'Class B'].entries()) {
    const roster = await page.request.post('/api/roster', { data: {
      name, rows: [{ ID: 'P1', Name: name + ' learner' }], idCol: 'ID', nameCol: 'Name',
    } });
    const questions = ['Which part absorbs water?', 'Which part makes food?'].map((prompt, i) => ({
      id: 'q' + index + i, prompt, options: ['Roots', 'Leaves'], correctIndex: i, marks: 1,
    }));
    const saved = await page.request.post('/api/assessment', { data: {
      rosterId: (await roster.json()).id,
      assessment: { title: 'Plants', grade: 'Grade 2', subject: 'Science', totalMarks: 2,
        assessmentType: 'test', deliveryMode: 'self-paced', objectives: [{ id: 'plants', text: 'Identify plant parts' }],
        sections: [{ id: 's', title: 'Plant parts', type: 'mcq', objectiveIds: ['plants'], items: index ? questions.reverse() : questions }],
      },
    } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const base = '/api/assignment/' + (await saved.json()).assessmentId;
    const learner = await browser.newContext();
    try {
      const join = await (await learner.request.get(base + '/join')).json();
      const entered = await learner.request.post(base + '/enter', { data: { handle: join.students[0].handle, pin: '4826' } });
      expect(entered.ok(), await entered.text()).toBeTruthy();
      const submitted = await learner.request.post(base + '/submit', { data: { answers: {
        ['q' + index + '0']: index, ['q' + index + '1']: 1 - index,
      } } });
      expect(submitted.ok(), await submitted.text()).toBeTruthy();
    } finally { await learner.close(); }
  }
  await page.locator('#assignmentsBtn').click();
  await page.locator('#assessmentAcrossClasses').click();
  const dialog = page.getByRole('dialog', { name: 'Mark across classes' });
  const questions = dialog.getByRole('combobox', { name: 'Question', exact: true });
  for (const [prompt, a, b] of [['absorbs water', 'Roots', 'Leaves'], ['makes food', 'Leaves', 'Roots']]) {
    const option = questions.locator('option').filter({ hasText: prompt });
    await questions.selectOption(await option.getAttribute('value'));
    await expect(dialog.locator('[data-cross-prompt]')).toContainText(prompt);
    await expect(dialog.getByRole('group', { name: 'Class A' }).locator('.assessment-cross-answer')).toHaveText('Student answer' + a);
    await expect(dialog.getByRole('group', { name: 'Class B' }).locator('.assessment-cross-answer')).toHaveText('Student answer' + b);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  }
});
