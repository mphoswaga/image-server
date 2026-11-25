const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

async function createRoster(page, name, rows) {
  const response = await page.request.post('/api/roster', {
    data: { name, rows, idCol: 'ID', nameCol: 'Name' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

function assessmentData(overrides = {}) {
  return {
    title: 'Grade 2 ICT project', subject: 'ICT', grade: 'Grade 2', assessmentType: 'project',
    deliveryMode: 'live', totalMarks: 2,
    objectives: [{ id: 'document', text: 'Create and check a document independently' }],
    instructions: 'Complete each section independently.',
    sections: [
      {
        id: 'knowledge', title: 'Knowledge check', type: 'mcq', objectiveIds: ['document'],
        instructions: 'Answer privately on your device.',
        items: [{ id: 'knowledge-1', prompt: 'Which action checks a misspelled word?', options: ['Use the spelling checker', 'Close the document'], correctIndex: 0, marks: 1 }],
      },
      {
        id: 'practical', title: 'Document task', type: 'practical', objectiveIds: ['document'],
        instructions: 'Complete the document task independently.',
        items: [{ id: 'practical-1', prompt: 'Formats the letter accurately without help', marks: 1 }],
      },
    ],
    ...overrides,
  };
}

async function publishAssessment(page, rosterId, assessment = assessmentData()) {
  const response = await page.request.post('/api/assessment', { data: { rosterId, assessment } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function createWorkspace(page, topic = 'Grade 2 ICT project') {
  const response = await page.request.post('/api/lesson-workspaces', {
    data: {
      context: { subject: 'ICT', topic, grade: 'Grade 2', lessonPurpose: 'project', workspaceView: 'plan' },
      plan: { sections: [{ heading: 'Activities', content: 'Students complete the project independently.' }] },
      stage: 'plan',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).workspace;
}

test('CodeQuest assignment restores blocks and marks the final program against its rubric', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  await signInDisposableTeacher(page, '-codequest-assessment');
  const roster = await createRoster(page, 'CodeQuest sample class', [{ ID: 'CQ-1', Name: 'Sample Learner' }]);
  const assessment = await publishAssessment(page, roster.id, assessmentData({
    title: 'CodeQuest · First treasure', deliveryMode: 'self-paced', totalMarks: 5,
    sections: [{
      id: 'build', type: 'practical', title: 'Build a route', objectiveIds: ['document'],
      items: [{ id: 'treasure', prompt: 'Move to the treasure and collect it.', marks: 5,
        activity: { kind: 'codequest-build', mission: { size: 4, start: [0, 2, 1], chest: [2, 2] }, rubric: { reach: 2, collect: 3 } } }],
    }],
  }));
  const api = '/api/assignment/' + assessment.assessmentId;
  const join = await (await page.request.get(api + '/join')).json();
  const context = await browser.newContext();
  try {
    const enter = await context.request.post(api + '/enter', { data: { handle: join.students[0].handle, pin: '4826' } });
    expect(enter.ok(), await enter.text()).toBeTruthy();
    const learner = await context.newPage();
    await learner.goto('/assignment/' + assessment.assessmentId);
    const task = learner.frameLocator('[data-code-task] iframe');
    await task.getByRole('button', { name: '↑ Move 1 square', exact:true }).click();
    await task.getByRole('button', { name: '↑ Move 1 square', exact:true }).click();
    const saved = learner.waitForResponse(response => response.url().endsWith(api + '/draft') && response.ok());
    await task.getByRole('button', { name: '💰 Collect', exact: true }).click();
    await saved;
    await learner.reload();
    await expect(task.locator('#program .longLabel')).toHaveText(['↑ Move 1 square', '↑ Move 1 square', '💰 Collect']);
    await task.getByRole('button', { name: 'Test my code' }).click();
    await expect(task.locator('#testResult')).toHaveText('Treasure collected!');
    await task.getByRole('button',{name:'Submit code',exact:true}).click();
    await task.getByRole('button',{name:'Keep editing'}).click();
    await task.getByRole('button',{name:'Submit code',exact:true}).click();
    await task.getByRole('button',{name:'Yes, submit code',exact:true}).click();
    await expect.poll(async () => (await (await context.request.get(api+'/take')).json()).confirmedCode).toEqual(['treasure']);
    await task.getByRole('button', { name: /Step 3: .*Collect/ }).click();
    await task.getByRole('button', { name: 'Remove step' }).click();
    const submitted = learner.waitForResponse(response => response.url().endsWith(api + '/submit') && response.ok());
    learner.once('dialog',dialog => dialog.accept());
    await learner.locator('#submitBtn').click();
    await submitted;
    const results = await (await page.request.get(api + '/results')).json();
    expect(results.submissions).toHaveLength(1);
    expect(results.submissions[0]).toMatchObject({
      totalMarks: 2, maxMarks: 5, answers: { treasure: [{op:'move'}, {op:'move'}] },
      grades: { treasure: { source: 'auto', processEvidence: ['Tested 1 distinct block sequences.'], criteria: [{awarded:2,max:2},{awarded:0,max:3}] } },
    });
    const marked = await page.request.patch(api + '/marked', { data: { marked: true } });
    expect(marked.ok(), await marked.text()).toBeTruthy();
    const progress = await (await page.request.get(`/api/roster/${roster.id}/progress`)).json();
    expect(progress.students[0].results).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignmentId: assessment.assessmentId, score: 2, total: 5 }),
    ]));
    expect((await context.request.post(api + '/submit', { data: { answers: {} } })).status()).toBe(409);
  } finally {
    await context.close();
  }
});

test('data project saves table work and gives independent criterion marks', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  await signInDisposableTeacher(page, '-data-table-assessment');
  const roster = await createRoster(page, 'Data project sample class', [{ ID: 'DATA-1', Name: 'Sample Learner' }]);
  const template = require('../../activity-templates/data-handling-first-project');
  const { assessmentId } = await publishAssessment(page, roster.id, { ...template, deliveryMode: 'self-paced' });
  const api = '/api/assignment/' + assessmentId;
  const join = await (await page.request.get(api + '/join')).json();
  const context = await browser.newContext();
  try {
    const enter = await context.request.post(api + '/enter', { data: { handle: join.students[0].handle, pin: '4826' } });
    expect(enter.ok(), await enter.text()).toBeTruthy();
    const take = await (await context.request.get(api + '/take')).json();
    expect(take.questions.flatMap(q => q.tableActivity.inputs).every(input => !('accepted' in input))).toBeTruthy();
    const learner = await context.newPage();
    await learner.goto('/assignment/' + assessmentId);
    await learner.getByLabel('Field for a crew job').selectOption('Role');
    await learner.getByLabel('Field for the number of packs').selectOption('Name');
    await learner.getByRole('button',{name:'Next station'}).click();
    await expect(learner.getByLabel('Correct Mia’s role')).toHaveValue('4');
    await learner.getByLabel('Correct Mia’s role').selectOption('Pilot');
    await learner.getByRole('button',{name:'Next station'}).click();
    await learner.getByLabel('Select the scientist’s record').selectOption('Nia');
    await learner.getByLabel('How many packs does Mia have?').selectOption('4');
    await learner.getByRole('button',{name:'Next station'}).click();
    const saved = learner.waitForResponse(response => response.url().endsWith(api + '/draft') && response.ok());
    await learner.getByLabel('Who has the most packs to share?').selectOption('Leo');
    await saved;
    await learner.reload();
    await learner.getByRole('button',{name:'Next station'}).click();
    await expect(learner.getByLabel('Correct Mia’s role')).toHaveValue('Pilot');
    await learner.getByRole('button',{name:'Next station'}).click();
    await learner.getByRole('button',{name:'Next station'}).click();
    await expect(learner.getByLabel('Who has the most packs to share?')).toHaveValue('Leo');
    const submitted = learner.waitForResponse(response => response.url().endsWith(api + '/submit') && response.ok());
    await learner.locator('#submitBtn').click();
    await learner.getByRole('button',{name:'Keep working'}).click();
    await learner.locator('#submitBtn').click();
    await learner.getByRole('button',{name:'Yes, submit project'}).click();
    await submitted;
    const results = await (await page.request.get(api + '/results')).json();
    expect(results.submissions[0]).toMatchObject({ totalMarks: 22, maxMarks: 50, grades: {
      arrange: { marksAwarded: 2 },
      repair: { marksAwarded: 5, processEvidence: ['Changed incorrect values to accepted values for: Correct Mia’s role.'], criteria: [{response:'Pilot',awarded:5},{response:'4',awarded:0},{response:'Many',awarded:0}] },
      find: { marksAwarded: 10 },
      interpret: { marksAwarded: 5 },
    } });
    expect((await page.request.patch(api + '/marked', { data: { marked: true } })).ok()).toBeTruthy();
    const progress = await (await page.request.get(`/api/roster/${roster.id}/progress`)).json();
    expect(progress.students[0].results).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignmentId: assessmentId, score: 22, total: 50 }),
    ]));
  } finally {
    await context.close();
  }
});

test('teacher previews, versions and assigns an activity without exposing class drafts', async ({page, browser}, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  await signInDisposableTeacher(page, '-activity-library');
  const first = await createRoster(page, 'Activity class A', [{ID:'CA-1',Name:'Sample A'}]);
  const second = await createRoster(page, 'Activity class B', [{ID:'CB-1',Name:'Sample B'}]);
  await page.goto('/activity-templates');
  await page.getByRole('combobox', {name:'Activity',exact:true}).selectOption('starter-codequest');
  await page.getByRole('button', {name:'Preview as learner'}).click();
  await expect(page.locator('#learnerPreview .preview-task:visible').frameLocator('iframe').getByRole('button', {name:'Test my code'})).toHaveCount(1);
  await expect(page.locator('#learnerPreview')).toContainText('Task 1 of 8');
  const island = page.locator('#learnerPreview .preview-task:visible').frameLocator('iframe');
  const move = island.getByRole('button',{name:'↑ Move 1 square',exact:true});
  await move.click();
  await move.click();
  await island.getByRole('button',{name:'💰 Collect',exact:true}).click();
  await island.getByRole('button',{name:'Test my code'}).click();
  await island.getByRole('button',{name:'Submit code',exact:true}).click();
  await island.getByRole('button',{name:'Yes, submit code',exact:true}).click();
  await expect(page.locator('#learnerPreview')).toContainText('Task 2 of 8');
  await page.reload();
  await page.locator('#template').selectOption('starter-codequest');
  await page.getByRole('button',{name:'Preview as learner'}).click();
  await expect(island.locator('#program .longLabel')).toHaveCount(3);
  await page.getByRole('button',{name:'Submit preview and see marks'}).click();
  await expect(page.getByRole('heading',{name:'Preview result · 3 / 50'})).toBeVisible();
  const rows = page.locator('#learnerPreview details').filter({has: page.locator('summary')});
  await rows.filter({hasText:'nearby treasure'}).locator('summary').click();
  await expect(rows.filter({hasText:'nearby treasure'})).toContainText('Collected the treasure · 2/2');
  await expect(page.locator('#learnerPreview summary').filter({hasText:'Unanswered'})).toHaveCount(7);
  await page.getByText('Customise tasks and marking',{exact:true}).click();
  await page.getByLabel('Title', {exact:true}).fill('My coding project');
  const firstSave = page.waitForResponse(response => response.url().endsWith('/api/activity-templates') && response.status() === 201);
  await page.getByRole('button', {name:'Save as template'}).click();
  const template = await (await firstSave).json();
  await expect(page.getByRole('status')).toHaveText('Saved version 1.');
  await page.getByRole('combobox', {name:'Class',exact:true}).selectOption(first.id);
  const firstAssign = page.waitForResponse(response => response.url().endsWith('/api/activity-templates/assign') && response.status() === 201);
  await page.getByRole('button', {name:'Create class draft'}).click();
  const draftA = await (await firstAssign).json();
  expect(draftA).toMatchObject({status:'draft',totalMarks:50});
  await page.locator('#editor summary').getByText('Build routes', {exact:true}).click();
  await page.locator('#editor .task-settings summary').first().click();
  await page.getByLabel('Reach treasure square points').first().fill('2');
  await expect(page.locator('#total')).toContainText('51 marks');
  await expect(page.getByRole('button', {name:'Save copy and create class draft'})).toBeEnabled();
  await page.getByRole('button', {name:'Save new version'}).click();
  await expect(page.getByRole('status')).toHaveText('Saved version 2.');
  await page.getByRole('combobox', {name:'Class',exact:true}).selectOption(second.id);
  const secondAssign = page.waitForResponse(response => response.url().endsWith('/api/activity-templates/assign') && response.status() === 201);
  await page.getByRole('button', {name:'Create class draft'}).click();
  const draftB = await (await secondAssign).json();
  expect(draftB).toMatchObject({status:'draft',totalMarks:51});
  const original = await (await page.request.get(`/api/assignment/${draftA.assessmentId}/results`)).json();
  expect(original).toMatchObject({totalMarks:50,rosterName:'Activity class A'});
  await page.getByRole('button', {name:'Save a separate copy'}).click();
  await expect(page.getByRole('status')).toHaveText('Saved version 1.');
  expect(await page.locator('#template').inputValue()).not.toBe(template.id);
  await page.getByRole('combobox',{name:'Activity',exact:true}).selectOption('starter-data');
  await expect(page.getByRole('combobox',{name:'Version',exact:true})).toHaveValue('8');
  await page.getByRole('combobox',{name:'Version',exact:true}).selectOption('5');
  const registration = page.locator('#editor > details').first();
  await registration.locator(':scope > summary').click();
  await registration.locator('.task-settings > summary').click();
  await registration.getByText('Task setup',{exact:true}).click();
  await registration.getByRole('combobox',{name:'Age answer method'}).selectOption('list');
  await registration.getByLabel('Age choices (separate with ;)').fill('8; 9');
  const customSave = page.waitForResponse(response => response.url().endsWith('/api/activity-templates') && response.status() === 201);
  await page.getByRole('button',{name:'Save as template'}).click();
  const fairCopy = await (await customSave).json();
  await expect(page.locator('#template')).toHaveValue(fairCopy.id);
  await page.getByRole('button',{name:'Preview as learner'}).click();
  await expect(page.locator('#learnerPreview').getByRole('combobox',{name:'Age',exact:true})).toBeVisible();
  await expect(page.locator('#learnerPreview').getByRole('textbox',{name:'Phone',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Activity',exact:true}).selectOption('starter-data');
  await page.getByRole('combobox',{name:'Version',exact:true}).selectOption('2');
  await page.getByRole('button',{name:'Preview as learner'}).click();
  const preview = page.locator('#learnerPreview');
  await expect(preview.locator('article:not([hidden])').getByText('Cellphone number: 000 000 0001',{exact:true})).toBeVisible();
  await preview.getByRole('button',{name:'Next station'}).click();
  await expect(preview.getByLabel('Fix Mia’s age')).toHaveValue('Ten');
  const outsider = await browser.newContext();
  try {
    const join = await outsider.request.get(`/api/assignment/${draftA.assessmentId}/join`);
    expect(join.status()).toBe(409);
    const otherTeacher = await outsider.newPage();
    await signInDisposableTeacher(otherTeacher, '-activity-library-other');
    const blocked = await otherTeacher.request.post('/api/activity-templates/assign', { data: {templateId:template.id,version:1,rosterId:first.id} });
    expect(blocked.status()).toBe(400);
    const library = await (await otherTeacher.request.get('/api/activity-templates')).json();
    expect(library.templates.every(item=>item.starter)).toBeTruthy();
  } finally { await outsider.close(); }
});

test('teacher can assign selected native CodeQuest stages with their original Repeat rules', async ({page, browser}, testInfo) => {
  test.skip(!['windows-100','windows-125'].includes(testInfo.project.name));
  await signInDisposableTeacher(page, '-activity-codequest-stages');
  const roster = await createRoster(page, 'Stage choice class', [{ID:'STAGE-1',Name:'Sample Learner'}]);
  await page.goto('/activity-templates');
  await page.getByRole('combobox', {name:'Activity',exact:true}).selectOption('starter-codequest-stages');
  const selector = page.frameLocator('iframe[title="Select and play CodeQuest stages"]');
  await selector.getByRole('button',{name:/Stage 3 ·/}).click();
  await page.locator('.stage-console').screenshot({path:testInfo.outputPath('CodeQuest assessment setup.png')});
  await selector.locator('#palette [data-op=move]').click();
  await expect(selector.locator('#program li')).toHaveCount(1);
  await selector.getByRole('button',{name:/Stage 1 ·/}).click();
  await expect(selector.locator('#program li')).toHaveCount(0);
  await selector.getByRole('button',{name:/Stage 3 ·/}).click();
  await expect(selector.locator('#program li')).toHaveCount(1);
  for (const number of [2, 4, 5]) await selector.getByRole('checkbox', {name:new RegExp('Stage ' + number)}).uncheck();
  await expect(page.locator('#total')).toContainText('20 marks');
  await expect(selector.locator('.island-count')).toHaveText('2 selected · 20 marks');
  await expect(page.locator('#editor')).toBeHidden();
  await page.getByRole('combobox',{name:'Class',exact:true}).selectOption(roster.id);
  await selector.getByRole('button',{name:/Stage 1 ·/}).click();
  await selector.getByRole('button',{name:'Move treasure'}).click();
  await selector.getByRole('button',{name:'Choose for me'}).click();
  await selector.getByRole('button',{name:'Move treasure'}).click();
  const square = selector.getByRole('button',{name:/Place treasure at row/}).first();
  const chestLabel = await square.getAttribute('aria-label');
  await square.click();
  const pending = page.waitForResponse(response => response.url().endsWith('/api/activity-templates/assign') && response.status() === 201);
  await page.getByRole('button', {name:'Save copy and create class draft'}).click();
  const { assessmentId } = await (await pending).json();
  const api = '/api/assignment/' + assessmentId;
  const opened = await page.request.post('/api/activity-templates/lessons/' + assessmentId, {data:{action:'open',minutes:30}});
  expect(opened.ok(), await opened.text()).toBeTruthy();
  const join = await (await page.request.get(api + '/join')).json();
  const context = await browser.newContext({viewport:page.viewportSize()});
  try {
    await context.request.post(api + '/enter', {data:{handle:join.students[0].handle,pin:'4826'}});
    const take = await (await context.request.get(api + '/take')).json();
    expect(take.questions.map(q => q.id)).toEqual(['codequest-stage-1','codequest-stage-3']);
    const [x,y] = take.questions[0].mission.chest;
    expect(chestLabel).toContain('row ' + (y+1) + ', column ' + (x+1));
    const learner = await context.newPage();
    await learner.goto('/assignment/' + assessmentId);
    const current = learner.frameLocator('[data-practical-page]:visible iframe');
    await expect(current.locator('#hint')).toHaveText('No Repeat');
    await current.getByRole('button',{name:'↑ Move 1 square',exact:true}).click();
    await current.getByRole('button',{name:'Submit code',exact:true}).click();
    await current.getByRole('button',{name:'Yes, submit code',exact:true}).click();
    await expect(current.locator('#hint')).toContainText('Use Repeat');
    const stage = take.questions[1];
    const solution = require('../../public/codequest-core').solve(stage.mission);
    const saved = await context.request.post(api + '/draft', { data:{answers:{[stage.id]:solution}} });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const reopened = await (await context.request.get(api + '/take')).json();
    expect(reopened.draftAnswers[stage.id]).toEqual(solution);
  } finally {
    await context.close();
  }
});

test('one lesson restores saved work but replacements admit only learners who never started', async ({page, browser}, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  await signInDisposableTeacher(page, '-activity-lesson');
  const roster = await createRoster(page, 'Lesson access class', [
    { ID:'LES-1', Name:'Original Learner' }, { ID:'LES-2', Name:'Replacement Learner' },
    { ID:'LES-3', Name:'Other Learner' },
  ]);
  const draft = await page.request.post('/api/activity-templates/assign', {
    data: {templateId:'starter-codequest',version:1,rosterId:roster.id},
  });
  expect(draft.status()).toBe(201);
  const { assessmentId } = await draft.json();
  const api = '/api/assignment/' + assessmentId;
  const consoleApi = '/api/activity-templates/lessons/' + assessmentId;
  const manage = (action, studentIds = []) => page.request.post(consoleApi, {data:{action,minutes:30,studentIds}});
  const original = await browser.newContext();
  const replacement = await browser.newContext();
  const other = await browser.newContext();
  try {
    expect((await original.request.get(api + '/join')).status()).toBe(409);
    const opened = await manage('open');
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const join = await (await original.request.get(api + '/join')).json();
    for (const [context, label] of [[original, 'Original'],[replacement, 'Replacement'],[other, 'Other']]) {
      const learner = join.students.find(student => student.label.startsWith(label));
      const entered = await context.request.post(api + '/enter', {data:{handle:learner.handle,pin:'4826'}});
      expect(entered.ok(), await entered.text()).toBeTruthy();
    }
    expect((await original.request.get(api + '/take')).ok()).toBeTruthy();
    const saved = await original.request.post(api + '/draft', {data:{answers:{near:[{op:'move'}]}}});
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const restored = await (await original.request.get(api + '/take')).json();
    expect(restored.draftAnswers.near).toEqual([{op:'move'}]);
    expect(restored.lessonClock.endsAt).toBeGreaterThan(restored.lessonClock.serverNow);
    const learnerPage = await original.newPage();
    await learnerPage.goto('/assignment/' + assessmentId);
    await learnerPage.getByText('Task options',{exact:true}).click();
    await learnerPage.getByRole('button', {name:'Show all tasks'}).click();
    await expect(learnerPage.locator('[data-practical-page]:visible')).toHaveCount(restored.questions.length);
    await page.goto('/activity-templates');
    await page.locator('#classTab').click();
    await page.locator('#lesson').selectOption(assessmentId);
    await page.getByRole('button',{name:'Pause timer'}).click();
    await expect(learnerPage.locator('#lessonClock')).toContainText('Lesson timer paused');
    const pausedText = await learnerPage.locator('#lessonClock').textContent();
    await learnerPage.reload();
    await expect(learnerPage.locator('#lessonClock')).toHaveText(pausedText);
    await expect(page.locator('#lessonClockDisplay')).toContainText('Paused');
    await page.getByRole('button',{name:'Resume timer'}).click();
    await expect(learnerPage.locator('#lessonClock')).toContainText('Lesson time left');
    await page.locator('#guideTask').selectOption(restored.questions[1].id);
    await page.locator('#guide').click();
    await expect(learnerPage.locator('[data-practical-page]')).toHaveCount(1);
    await expect(learnerPage.locator('[data-practical-page]')).toContainText(restored.questions[1].question);
    await expect(page.locator('#readDirections')).toBeEnabled();
    await expect(learnerPage.getByRole('button',{name:'Show all tasks'})).toHaveCount(0);
    await learnerPage.reload();
    await expect(learnerPage.locator('[data-practical-page]')).toHaveCount(1);
    await original.request.post(api + '/draft', {data:{answers:{near:[]}}});
    await page.locator('#releaseGuide').click();
    await expect(learnerPage.getByText('Task options',{exact:true})).toBeVisible();
    await expect(learnerPage.locator('[data-practical-page]:visible')).toHaveCount(1);
    expect((await (await original.request.get(api + '/take')).json()).draftAnswers.near).toEqual([{op:'move'}]);
    await expect(page.locator('#learnerProgress li').filter({hasText:'Original Learner'})).toContainText('1 of 5');
    const closed = await manage('close');
    expect(closed.ok(), await closed.text()).toBeTruthy();
    expect((await closed.json()).eligible.map(student=>student.id)).toEqual(['LES-2','LES-3']);
    expect((await original.request.post(api + '/draft', {data:{answers:{near:[]}}})).status()).toBe(409);
    expect((await original.request.get(api + '/lesson-clock')).status()).toBe(409);
    expect((await manage('replacement', ['LES-1'])).status()).toBe(409);
    expect((await manage('replacement', ['LES-2'])).ok()).toBeTruthy();
    expect((await original.request.get(api + '/take')).status()).toBe(409);
    expect((await other.request.get(api + '/take')).status()).toBe(409);
    expect((await replacement.request.get(api + '/take')).ok()).toBeTruthy();
    const final = await replacement.request.post(api + '/submit', {data:{answers:
      Object.fromEntries(restored.questions.map(q => [q.id,[{op:'move'}]]))}});
    expect(final.ok(), await final.text()).toBeTruthy();
    await expect(page.locator('#submissionCount')).toContainText('1 of 3 submitted');
    expect((await manage('close')).ok()).toBeTruthy();
    expect((await manage('replacement', ['LES-2'])).status()).toBe(409);
  } finally {
    await Promise.all([original.close(), replacement.close(), other.close()]);
  }
});

test('class plan prepares fourteen private drafts once, and practice creates no results', async ({page, browser}, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  await signInDisposableTeacher(page, '-unit-three-plan');
  const plan = require('../../activity-templates/unit-3-class-plan');
  for (const slot of plan.classes) await createRoster(page, 'Grade ' + slot.className, [{ID:'PLAN-'+slot.className,Name:'Test Learner'}]);
  const prepare = () => page.request.post('/api/activity-templates/class-plan', {data:{}});
  expect(await (await prepare()).json()).toEqual({created:14,alreadyPrepared:0});
  expect(await (await prepare()).json()).toEqual({created:0,alreadyPrepared:14});
  const { lessons } = await (await page.request.get('/api/activity-templates/lessons')).json();
  expect(lessons).toHaveLength(14);
  for (const lesson of lessons) {
    const taskCount = lesson.plan.templateId === 'starter-data' ? 10 : 8;
    const details = await (await page.request.get('/api/activity-templates/lessons/' + lesson.id)).json();
    expect(details.tasks).toHaveLength(taskCount);
    expect(lesson.suggestedMinutes).toBe(60);
  }
  expect(lessons.every(lesson=>lesson.status==='draft'&&!lesson.hasOpened&&lesson.plan.date)).toBeTruthy();
  const learner = await browser.newContext();
  try {
    const practice = await learner.newPage();
    const writes = [];
    practice.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
    await practice.goto('/practical-practice.html?activity=data');
    await practice.getByRole('textbox',{name:'Name',exact:true}).fill('Võ Khánh Linh');
    await practice.getByRole('textbox',{name:'Age',exact:true}).fill('8');
    await practice.getByLabel('Date of birth',{exact:true}).fill('3 June 2018');
    await practice.getByRole('textbox',{name:'Family phone',exact:true}).fill('0900000018');
    await practice.getByRole('button',{name:'Check my work'}).first().click();
    await expect(practice.getByText('Well done! All answers match.')).toBeVisible();
    expect(writes).toEqual([]);
    expect((await learner.request.get('/api/assignment/'+lessons[0].id+'/join')).status()).toBe(409);
  } finally { await learner.close(); }
});

test('automatic assessments and decks resolve the saved workspace under the signed-in teacher', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One browser covers workspace ownership at both server boundaries.');
  await signInDisposableTeacher(page, '-assessment-workspace-owner');
  const classRoster = await createRoster(page, 'Grade 2 Workspace', [{ ID: 'WORK-1', Name: 'Workspace Learner' }]);
  const workspace = await createWorkspace(page);
  const nonexistentWorkspaceId = '11111111-1111-4111-8111-111111111111';

  const foreignContext = await browser.newContext();
  let foreignWorkspace;
  try {
    const foreignPage = await foreignContext.newPage();
    await signInDisposableTeacher(foreignPage, '-assessment-workspace-foreign');
    foreignWorkspace = await createWorkspace(foreignPage, 'Another teacher project');
  } finally {
    await foreignContext.close();
  }

  for (const lessonWorkspaceId of [nonexistentWorkspaceId, foreignWorkspace.id]) {
    const rejectedPublication = await page.request.post('/api/assessment', {
      data: { rosterId: classRoster.id, assessment: assessmentData({ lessonWorkspaceId }) },
    });
    expect(rejectedPublication.status()).toBe(404);
    expect(await rejectedPublication.json()).toMatchObject({ code: 'assessment_workspace_not_found' });
  }

  // A manually composed assessment may still be published without a Plan
  // workspace, but it cannot later masquerade as the assessment for a deck.
  const manual = await publishAssessment(page, classRoster.id, assessmentData({ deliveryMode: 'self-paced' }));
  const manualDeck = await page.request.post('/api/generate', {
    data: {
      subject: 'ICT', topic: 'Grade 2 ICT project', grade: 'Grade 2', lessonPurpose: 'project',
      assessmentPublishedId: manual.assessmentId, lessonWorkspaceId: workspace.id, slideCount: 4,
    },
  });
  expect(manualDeck.status()).toBe(409);
  expect(await manualDeck.json()).toMatchObject({ code: 'assessment_workspace_missing' });

  const bound = await publishAssessment(page, classRoster.id, assessmentData({ lessonWorkspaceId: workspace.id }));
  for (const lessonWorkspaceId of [nonexistentWorkspaceId, foreignWorkspace.id]) {
    const rejectedDeck = await page.request.post('/api/generate', {
      data: {
        subject: 'ICT', topic: 'Grade 2 ICT project', grade: 'Grade 2', lessonPurpose: 'project',
        assessmentPublishedId: bound.assessmentId, lessonWorkspaceId, slideCount: 4,
      },
    });
    expect(rejectedDeck.status()).toBe(404);
    expect(await rejectedDeck.json()).toMatchObject({ code: 'assessment_workspace_not_found' });
  }
});

test('formal assessments enforce complete server-owned attempts and immutable released results', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One browser covers the assessment integrity contract.');
  await signInDisposableTeacher(page, '-assessment-integrity');
  const classRoster = await createRoster(page, 'Grade 2 ICT', [{ ID: 'LOCK-1', Name: 'Amina Learner' }]);

  const noClass = await page.request.post('/api/assessment', {
    data: { assessment: assessmentData({ deliveryMode: 'self-paced' }) },
  });
  expect(noClass.status()).toBe(400);
  expect((await noClass.json()).error).toMatch(/Choose a class roster/);

  const workspace = await createWorkspace(page);
  const assessment = await publishAssessment(page, classRoster.id, assessmentData({ lessonWorkspaceId: workspace.id }));
  const unboundDeck = await page.request.post('/api/generate', {
    data: {
      subject: 'ICT', topic: 'Grade 2 ICT project', grade: 'Grade 2', lessonPurpose: 'project',
      assessmentPublishedId: assessment.assessmentId, slideCount: 4,
    },
  });
  expect(unboundDeck.status()).toBe(400);
  expect(await unboundDeck.json()).toMatchObject({ code: 'assessment_workspace_required' });
  const join = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/join`)).json();
  const learnerContext = await browser.newContext();
  try {
    const enter = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/enter`, {
      data: { handle: join.students[0].handle, pin: '4826' },
    });
    expect(enter.ok(), await enter.text()).toBeTruthy();

    const teacherPreview = await page.request.get(`/api/assignment/${assessment.assessmentId}/take`);
    expect(teacherPreview.ok(), await teacherPreview.text()).toBeTruthy();
    const start = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'start' } });
    expect(start.ok()).toBeTruthy();

    const incomplete = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, {
      data: { answers: { 'knowledge-1': 9 }, complete: true },
    });
    expect(incomplete.status()).toBe(400);
    expect(await incomplete.json()).toMatchObject({ code: 'assessment_section_incomplete', missingQuestionIds: ['knowledge-1'] });

    const knowledge = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, {
      data: { answers: { 'knowledge-1': 0 }, complete: true },
    });
    expect(knowledge.ok(), await knowledge.text()).toBeTruthy();
    expect((await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'next' } })).ok()).toBeTruthy();
    const practical = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, {
      data: { answers: { 'practical-1': 'forged learner mark' }, complete: true },
    });
    expect(practical.ok(), await practical.text()).toBeTruthy();
    expect((await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'next' } })).ok()).toBeTruthy();

    const submitted = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/submit`, {
      data: { answers: { 'knowledge-1': 1, 'practical-1': 'forged at final submit' } },
    });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    const results = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/results`)).json();
    expect(results.submissions[0].answers).toEqual({ 'knowledge-1': 0 });

    const repeat = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/submit`, { data: { answers: { 'knowledge-1': 1 } } });
    expect(repeat.status()).toBe(409);
    expect((await repeat.json()).code).toBe('assessment_already_submitted');
    const lateDraft = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, { data: { answers: { 'knowledge-1': 1 } } });
    expect(lateDraft.status()).toBe(409);

    const grade = await page.request.patch(`/api/assignment/${assessment.assessmentId}/grade`, {
      data: { studentId: 'LOCK-1', questionId: 'practical-1', marksAwarded: 1 },
    });
    expect(grade.ok(), await grade.text()).toBeTruthy();
    const release = await page.request.patch(`/api/assignment/${assessment.assessmentId}/release`, { data: { released: true } });
    expect(release.ok(), await release.text()).toBeTruthy();

    const learner = await learnerContext.newPage();
    await learner.goto(new URL(`/assignment/${assessment.assessmentId}`, page.url()).toString());
    await expect(learner.locator('#scoreWrap')).toBeVisible();
    await expect(learner.locator('#scoreVal')).toHaveText('2');

    const lockedGrade = await page.request.patch(`/api/assignment/${assessment.assessmentId}/grade`, {
      data: { studentId: 'LOCK-1', questionId: 'practical-1', marksAwarded: 0 },
    });
    expect(lockedGrade.status()).toBe(409);
    expect((await lockedGrade.json()).code).toBe('assessment_finalised');
    const lockedSubmit = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/submit`, { data: { answers: {} } });
    expect(lockedSubmit.status()).toBe(409);
    expect((await lockedSubmit.json()).code).toBe('assessment_finalised');

    expect((await page.request.patch(`/api/assignment/${assessment.assessmentId}/release`, { data: { released: false } })).ok()).toBeTruthy();
    await expect(learner.locator('#pendingMsg')).toBeVisible({ timeout: 6_000 });
    await expect(learner.locator('#scoreWrap')).toBeHidden();
    const corrected = await page.request.patch(`/api/assignment/${assessment.assessmentId}/grade`, {
      data: { studentId: 'LOCK-1', questionId: 'practical-1', marksAwarded: 0 },
    });
    expect(corrected.ok(), await corrected.text()).toBeTruthy();
    const officialWhileHidden = await (await page.request.get(`/api/roster/${classRoster.id}/progress`)).json();
    expect(officialWhileHidden.students[0].results).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignmentId: assessment.assessmentId, provisional: false, status: 'marked' }),
    ]));
    const stillNoResubmit = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/submit`, { data: { answers: {} } });
    expect(stillNoResubmit.status()).toBe(409);
    expect((await stillNoResubmit.json()).code).toBe('assessment_already_submitted');
  } finally {
    await learnerContext.close();
  }
});

test('a teacher can submit complete saved attempts without forcing incomplete learners', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One browser covers teacher submission of saved attempts.');
  await signInDisposableTeacher(page, '-assessment-teacher-submit');
  const classRoster = await createRoster(page, 'Grade 2 Saved Attempts', [
    { ID: 'READY-1', Name: 'Ready Learner' },
    { ID: 'WAIT-1', Name: 'Waiting Learner' },
  ]);
  const assessment = await publishAssessment(page, classRoster.id, assessmentData({
    totalMarks: 2,
    sections: [{
      id: 'knowledge', title: 'Knowledge check', type: 'mcq', objectiveIds: ['document'], instructions: 'Answer privately.',
      items: [
        { id: 'copy', prompt: 'Which action copies selected text?', options: ['Copy', 'Delete'], correctIndex: 0, marks: 1 },
        { id: 'paste', prompt: 'Which action places copied text?', options: ['Undo', 'Paste'], correctIndex: 1, marks: 1 },
      ],
    }],
  }));
  const join = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/join`)).json();
  expect((await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'start' } })).ok()).toBeTruthy();
  const readyContext = await browser.newContext();
  const waitingContext = await browser.newContext();
  try {
    for (const [context, student] of [[readyContext, join.students[0]], [waitingContext, join.students[1]]]) {
      const entered = await context.request.post(`/api/assignment/${assessment.assessmentId}/enter`, { data: { handle: student.handle, pin: '4826' } });
      expect(entered.ok(), await entered.text()).toBeTruthy();
    }
    expect((await readyContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, { data: { answers: { copy: 0, paste: 1 }, complete: true } })).ok()).toBeTruthy();
    expect((await waitingContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, { data: { answers: { copy: 0 }, complete: false } })).ok()).toBeTruthy();
    expect((await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'next' } })).ok()).toBeTruthy();

    const before = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/results`)).json();
    expect(before).toMatchObject({ submittedCount: 0, completedDraftsCount: 1, incompleteDraftsCount: 1 });
    await page.locator('#assignmentsBtn').click();
    const card = page.locator('#assignmentsList .game-card').filter({ hasText: 'Grade 2 ICT project' });
    await card.locator('.a-toggle-btn').click();
    const results = card.locator(`#ares-${assessment.assessmentId}`);
    await expect(results).toContainText('1 complete and ready to submit');
    await expect(results).toContainText('1 still incomplete and will remain open');
    await results.getByRole('button', { name: 'Submit 1 completed attempt' }).click();
    await expect(results).toContainText('1 of 2 students have made their final submission.');

    const after = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/results`)).json();
    expect(after).toMatchObject({ submittedCount: 1, completedDraftsCount: 0, incompleteDraftsCount: 1 });
    const official = after.submissions.find(student => !student.draftOnly);
    const unfinished = after.submissions.find(student => student.draftOnly && student.studentId === 'WAIT-1');
    expect(official).toMatchObject({ studentId: 'READY-1', totalMarks: 2, maxMarks: 2 });
    expect(unfinished).toMatchObject({ readyToSubmit: false, missingAnswerCount: 1 });
  } finally {
    await readyContext.close();
    await waitingContext.close();
  }
});

test('a shared device never carries one assessment learner answers into another learner session', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One shared-device browser covers identity and draft isolation.');
  await signInDisposableTeacher(page, '-assessment-shared-device');
  const classRoster = await createRoster(page, 'Grade 2 Shared', [
    { ID: 'SHARED-A', Name: 'Amina Learner' },
    { ID: 'SHARED-B', Name: 'Bao Student' },
  ]);
  const otherRoster = await createRoster(page, 'Other Class', [{ ID: 'OUTSIDE-1', Name: 'Outside Learner' }]);
  expect(otherRoster.id).toBeTruthy();
  const assessment = await publishAssessment(page, classRoster.id, assessmentData({
    totalMarks: 1,
    sections: [assessmentData().sections[0]],
  }));
  const publicJoin = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/join`)).json();
  expect((await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'start' } })).ok()).toBeTruthy();

  const outsiderContext = await browser.newContext();
  try {
    const login = await outsiderContext.request.post('/api/student/login', { data: { studentId: 'OUTSIDE-1', pin: '1357' } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const blockedMeta = await outsiderContext.request.get(`/api/assignment/${assessment.assessmentId}`);
    const blockedTake = await outsiderContext.request.get(`/api/assignment/${assessment.assessmentId}/take`);
    expect(blockedMeta.status()).toBe(401);
    expect(blockedTake.status()).toBe(401);
  } finally {
    await outsiderContext.close();
  }

  const sharedContext = await browser.newContext();
  const learner = await sharedContext.newPage();
  try {
    const firstEnter = await sharedContext.request.post(`/api/assignment/${assessment.assessmentId}/enter`, {
      data: { handle: publicJoin.students[0].handle, pin: '2468' },
    });
    expect(firstEnter.ok(), await firstEnter.text()).toBeTruthy();
    await learner.goto(new URL(`/assignment/${assessment.assessmentId}`, page.url()).toString());
    await expect(learner.locator('.opts input')).toHaveCount(2);
    await learner.locator('.opt').first().click();
    const saved = await sharedContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, {
      data: { answers: { 'knowledge-1': 0 }, complete: false },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    expect(await learner.evaluate(id => Object.keys(localStorage).filter(key => key.includes(id)), assessment.assessmentId)).toEqual([]);

    const reset = await sharedContext.request.post(`/api/assignment/${assessment.assessmentId}/pin/reset-request`, {
      data: { handle: publicJoin.students[0].handle },
    });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const logout = await sharedContext.request.post('/api/student/logout');
    expect(logout.ok()).toBeTruthy();
    expect((await sharedContext.cookies()).filter(cookie => ['lc_student', 'lc_game'].includes(cookie.name))).toEqual([]);

    const secondEnter = await sharedContext.request.post(`/api/assignment/${assessment.assessmentId}/enter`, {
      data: { handle: publicJoin.students[1].handle, pin: '8642' },
    });
    expect(secondEnter.ok(), await secondEnter.text()).toBeTruthy();
    await learner.reload();
    await expect(learner.locator('.opts input:checked')).toHaveCount(0);
  } finally {
    await sharedContext.close();
  }
});

test('School Fair Data Lab saves each station and exports its rubric score to class marks', async ({page, browser}, testInfo) => {
  test.setTimeout(90000);
  test.skip(!['windows-100','mobile','desktop-safari'].includes(testInfo.project.name));
  await signInDisposableTeacher(page, '-fair-' + testInfo.project.name);
  const roster = await createRoster(page, 'School fair class', [{ID:'FAIR-1', Name:'Sample Learner'}, {ID:'FAIR-2', Name:'Second Learner'}]);
  await page.goto('/activity-templates');
  await page.getByRole('combobox',{name:'Activity',exact:true}).selectOption('starter-data');
  await expect(page.locator('.station-directory button')).toHaveCount(10);
  await page.locator('.station-directory button').filter({hasText:'Media desk'}).click();
  const preview = page.locator('#learnerPreview');
  await expect(preview.locator('.station-navigation')).toContainText('Station 1 of 10');
  const ready = view => view.getByRole('button',{name:'I’m ready to try'});
  await ready(preview).click();
  const nextPreview = preview.getByRole('button',{name:'Next station'});
  await expect(nextPreview).toBeDisabled();
  await preview.getByText('Station menu',{exact:true}).click();
  await expect(preview.getByLabel('Jump to station').locator('option[value="5"]')).toBeDisabled();
  await preview.getByText('Station menu',{exact:true}).click();
  const previewFields = preview.locator('article:visible').getByRole('textbox');
  await expect(previewFields).toHaveCount(12);
  for (const field of (await previewFields.all()).slice(0,-1)) await field.fill('example');
  await expect(nextPreview).toBeDisabled();
  await previewFields.last().fill('   ');
  await expect(nextPreview).toBeDisabled();
  await previewFields.last().fill('example');
  await nextPreview.click();
  await ready(preview).click();
  const fieldDesigner = preview.locator('article:visible');
  await expect(fieldDesigner).toContainText('Field designer');
  const typeOptions = await fieldDesigner.locator('fieldset').evaluateAll(groups =>
    groups.slice(0,4).map(group => [...group.querySelectorAll('input[type=radio]')].map(input => input.value)));
  expect(new Set(typeOptions.map(options => options.join('|'))).size).toBeGreaterThan(1);

  const template = require('../../activity-templates/data-class-investigation');
  const previewAnswers = Object.fromEntries(template.sections.flatMap(section => section.items).map(task =>
    [task.id, task.activity.inputs.map(input => input.accepted[0])]));
  previewAnswers['decision-task'][3] = null;
  await page.evaluate(answers => {
    const key = Object.keys(sessionStorage).find(name => name.startsWith('lesson-practical-preview-'));
    sessionStorage.setItem(key, JSON.stringify(answers));
  }, previewAnswers);
  await page.locator('.station-directory button').filter({hasText:'Advise the organisers'}).click();
  await ready(preview).click();
  const markPreview = preview.getByRole('button',{name:'Submit preview and see marks'});
  await markPreview.click();
  const finalPreview = preview.locator('article:visible');
  await expect(finalPreview.getByRole('status')).toContainText('Fill in every answer');
  await finalPreview.getByRole('radio',{name:'The visitor did not choose a booth.'}).check();
  await markPreview.click();
  await expect(preview.getByRole('heading',{name:'Preview result · 50 / 50'})).toBeVisible();
  await page.getByRole('combobox',{name:'Class',exact:true}).selectOption(roster.id);
  const assigned = page.waitForResponse(r => r.url().endsWith('/api/activity-templates/assign') && r.ok());
  await page.getByRole('button',{name:'Create class draft'}).click();
  const {assessmentId} = await (await assigned).json();
  const api = '/api/assignment/' + assessmentId;
  const opened = await page.request.post('/api/activity-templates/lessons/' + assessmentId, {data:{action:'open',minutes:60}});
  expect(opened.ok(), await opened.text()).toBeTruthy();
  const join = await (await page.request.get(api + '/join')).json();
  const context = await browser.newContext({viewport:page.viewportSize(),isMobile:testInfo.project.name==='mobile'});
  try {
    const enter = await context.request.post(api + '/enter',{data:{handle:join.students[0].handle,pin:'4826'}});
    expect(enter.ok(),await enter.text()).toBeTruthy();
    const take = await (await context.request.get(api + '/take')).json();
    expect(take.questions.flatMap(q => q.tableActivity.inputs).every(input => !('accepted' in input))).toBeTruthy();
    const other = await browser.newContext();
    try {
      const joined = await other.request.post(api + '/enter', {data:{handle:join.students[1].handle,pin:'4826'}});
      expect(joined.ok()).toBeTruthy();
      const anotherTake = await (await other.request.get(api + '/take')).json();
      const options = data => data.questions.flatMap(q => q.tableActivity.inputs.map(input => input.options));
      expect(options(anotherTake)).not.toEqual(options(take));
      expect(options(await (await context.request.get(api + '/take')).json())).toEqual(options(take));
    } finally { await other.close(); }
    const learner = await context.newPage();
    await learner.goto('/assignment/' + assessmentId);
    const current = learner.locator('[data-practical-page]:visible');
    await expect(learner.locator('#submitBtn')).toBeHidden();
    const tutorial = learner.getByRole('dialog');
    await expect(tutorial).toHaveAccessibleName('Registration desk');
    await expect.poll(() => tutorial.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(0);
    await tutorial.screenshot({path:testInfo.outputPath('Opening video.png')});
    await ready(learner).click();
    await expect(current.getByRole('textbox')).toHaveCount(12);
    await expect(learner.getByRole('button',{name:'Next station'})).toBeDisabled();
    await learner.getByText('Station menu',{exact:true}).click();
    await expect(learner.getByLabel('Jump to station').locator('option[value="1"]')).toBeDisabled();
    await learner.getByText('Station menu',{exact:true}).click();
    await current.screenshot({path:testInfo.outputPath('Registration desk.png')});
    // A lost save must recover even if the child stops interacting with the page.
    await learner.route('**' + api + '/draft', route => route.abort('connectionreset'));
    await current.getByRole('textbox',{name:'Helper 1 · Age',exact:true}).fill('9');
    await expect(learner.locator('#saveState')).toContainText('Trying again');
    await learner.reload();
    await expect(current.getByRole('textbox',{name:'Helper 1 · Age',exact:true})).toHaveValue('9');
    await learner.unroute('**' + api + '/draft');
    await expect(learner.locator('#saveState')).toHaveText('Your work is saved.');
    await learner.reload();
    await expect(current.getByRole('textbox',{name:'Helper 1 · Age',exact:true})).toHaveValue('9');
    await expect(tutorial).toHaveCount(0);
    await current.getByRole('button',{name:'Click me to watch the video again'}).click();
    await expect.poll(() => tutorial.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(0);
    await learner.keyboard.press('Escape');
    await expect(current.getByRole('textbox',{name:'Helper 1 · Age',exact:true})).toHaveValue('9');
    await page.reload();
    await page.locator('#classTab').click();
    await page.locator('#lesson').selectOption(assessmentId);
    await expect(page.locator('#stationSaved')).toContainText('1 of 2');
    await page.getByRole('button',{name:'Preview station video'}).click();
    await expect(page.getByRole('dialog')).toHaveAccessibleName('Registration desk');
    await expect(learner.locator('.station-navigation')).toContainText('Station 1 of 10');
    await page.getByRole('button',{name:'Back to console'}).click();
    await page.locator('#guide').click();
    await expect(learner.locator('#questions')).toContainText('opened 1 of 10 stations');
    await expect(learner.locator('#submitBtn')).toBeHidden();
    await page.locator('#nextStation').click();
    await expect(learner.locator('#questions')).toContainText('opened 2 of 10 stations');
    await expect(current).toContainText('Registration desk');
    await expect(learner.getByRole('button',{name:'Next station'})).toBeDisabled();
    const registration = template.sections[0].items[0];
    for (const input of registration.activity.inputs) {
      await current.getByRole('textbox',{name:input.label,exact:true}).fill(input.accepted[0]);
    }
    await expect(learner.getByRole('button',{name:'Next station'})).toBeEnabled();
    await expect.poll(async () => {
      const data = await (await context.request.get(api + '/take')).json();
      return data.draftAnswers?.[registration.id]?.every(Boolean);
    }).toBe(true);
    await page.locator('#previousStation').click();
    await expect(learner.locator('#questions')).toContainText('opened 1 of 10 stations');
    await page.locator('#releaseGuide').click();
    await expect(learner.locator('.station-navigation')).toContainText('Station 1 of 10');
    const topics = ['register','types','paper','repair','stock','files','order','storage','tally','decision'];
    for (const [index, section] of template.sections.entries()) {
      const task = section.items[0];
      if (index) {
        await learner.getByRole('button',{name:'Next station'}).click();
        await expect(tutorial).toHaveAccessibleName(section.title);
        await expect(tutorial.locator('video')).toHaveAttribute('src','/assets/data-lab/stations/'+topics[index]+'.mp4');
        await expect.poll(() => tutorial.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(0);
        await ready(learner).click();
      }
      if (index === 1) {
        const name = current.getByRole('group',{name:'Name',exact:true});
        await expect(name.locator('.field-example')).toContainText('Mia');
        await name.getByRole('radio',{name:'Date',exact:true}).check();
        await expect(name.getByRole('radio',{name:'Date',exact:true})).toBeChecked();
        await name.getByRole('radio',{name:'Text',exact:true}).check();
        await expect(name.getByRole('radio',{name:'Date',exact:true})).not.toBeChecked();
      }
      if (index === 2 && testInfo.project.name === 'mobile') {
        const paper = current.locator('.station-row-cards');
        expect(await paper.evaluate(node => node.scrollWidth <= node.clientWidth+1)).toBeTruthy();
      }
      if (index === 1 || index === 2) await current.screenshot({path:testInfo.outputPath(section.title + '.png')});
      await expect(current).toContainText(task.id === 'stock-sheet-task' ? 'Complete all five answer boxes.' : task.prompt);
      if (task.activity.presentation === 'order') {
        const list = current.locator('ol.unit-order');
        const handles = list.locator('.unit-handle');
        await list.scrollIntoViewIfNeeded();
        const moving = await handles.nth(2).innerText();
        const start = await handles.nth(2).boundingBox();
        const end = await handles.first().boundingBox();
        const x = start.x + 12, y1 = start.y + start.height / 2, y2 = end.y + end.height / 2;
        if (testInfo.project.name === 'mobile') {
          const touch = await context.newCDPSession(learner);
          for (const [type, touchPoints] of [['touchStart',[{x,y:y1}]],['touchMove',[{x,y:y2}]],['touchEnd',[]]]) {
            await touch.send('Input.dispatchTouchEvent',{type,touchPoints});
          }
          await touch.detach();
        } else {
          await learner.mouse.move(x,y1);
          await learner.mouse.down();
          await learner.mouse.move(x,y2,{steps:8});
          await learner.mouse.up();
        }
        await expect(handles.first()).toHaveText(moving);
        for (const [position, field] of task.activity.inputs.entries()) {
          const unit = field.accepted[0];
          let index = (await handles.allTextContents()).indexOf(unit);
          while (index-- > position) await list.getByRole('button',{name:'Move ' + unit + ' up',exact:true}).press('Enter');
        }
        if (testInfo.project.name === 'mobile') await list.getByRole('button',{name:'Move Kilobyte (KB) down'}).click();
        const placed = await handles.allTextContents();
        await expect.poll(async () => (await (await context.request.get(api+'/take')).json()).draftAnswers?.[task.id]).toEqual(placed);
        await learner.reload();
        await expect(current).toContainText('File-size ladder');
        await expect(handles).toHaveText(placed);
        await current.screenshot({path:testInfo.outputPath('File-size ladder.png')});
        continue;
      }
      if (task.activity.presentation === 'worksheet') {
        await expect(current.locator('.stock-steps li')).toHaveCount(3);
        await expect(current.locator('.stock-steps li').last()).toContainText('B2 means column B, row 2');
        await expect(current.getByRole('table',{name:'Kits at each booth'})).toBeVisible();
        await expect(current.locator('.stock-decision')).toContainText('Booth needing more kits');
        await expect(current.locator('[data-address="D2"] input')).toHaveAccessibleName('D2 · Art kits left');
        await current.screenshot({path:testInfo.outputPath('Update the stock sheet.png')});
      }
      if (task.activity.presentation === 'ballots') {
        await expect(current.locator('.project-data-source li')).toHaveCount(12);
        await expect.poll(() => current.locator('.ballot-scene').evaluate(img => img.naturalWidth)).toBe(1050);
        if (task.id === 'count-task') {
          await current.getByRole('checkbox').first().check();
          await expect(current.getByRole('textbox').first()).toHaveValue('');
          await current.screenshot({path:testInfo.outputPath('Vote tally.png')});
        }
      }
      for (const input of task.activity.inputs) {
        if (index === template.sections.length - 1 && input === task.activity.inputs.at(-1)) continue;
        if (input.entry === 'text') {
          const value = testInfo.project.name === 'mobile' && input.label === 'Helper 1 · Phone' ? '1' : input.accepted[0];
          await current.getByRole('textbox',{name:input.label,exact:true}).fill(value);
        } else if (input.row !== undefined) await current.getByLabel(input.label,{exact:true}).selectOption(input.accepted[0]);
        else await current.getByRole('group',{name:input.label,exact:true}).getByRole('radio',{name:input.accepted[0],exact:true}).check();
      }
      if (task.activity.presentation === 'files') {
        await expect(current.frameLocator('iframe[title="Welcome note text file"]').locator('body')).toContainText('Pick up a map');
        await expect.poll(() => current.getByRole('img',{name:'Open the full school fair art poster'}).evaluate(img => img.naturalWidth)).toBe(640);
        const movie = current.locator('video');
        await movie.scrollIntoViewIfNeeded();
        await movie.evaluate(video => { video.muted = true; return video.play(); });
        await expect.poll(() => movie.evaluate(video => video.currentTime)).toBeGreaterThan(0);
        await movie.evaluate(video => video.pause());
        await expect(current.getByRole('radio',{name:'Art poster.png',exact:true}).first()).toBeChecked();
        await current.scrollIntoViewIfNeeded();
        await current.screenshot({path:testInfo.outputPath('School Fair Data Lab.png')});
      }
    }
    await learner.locator('#submitBtn').click();
    await expect(current.getByRole('status')).toContainText('Fill in every answer here');
    await expect(learner.getByRole('button',{name:'Yes, submit project'})).toBeHidden();
    await current.getByRole('radio',{name:'The visitor did not choose a booth.'}).check();
    await expect.poll(async () => {
      const data = await (await context.request.get(api + '/take')).json();
      return data.draftAnswers?.['decision-task']?.[3];
    }).toBe(template.sections.at(-1).items[0].activity.inputs[3].accepted[0]);
    await learner.reload();
    await expect(current).toContainText('Advise the organisers');
    await learner.getByText('Station menu',{exact:true}).click();
    await learner.getByLabel('Jump to station').selectOption('0');
    await expect(current.getByRole('textbox',{name:'Helper 1 · Age',exact:true})).toHaveValue('9');
    await learner.getByText('Station menu',{exact:true}).click();
    await learner.getByLabel('Jump to station').selectOption(String(template.sections.length-1));
    await expect(current.getByRole('radio',{name:'The visitor did not choose a booth.'})).toBeChecked();
    const incomplete = await context.request.post(api + '/submit',{data:{answers:{'desk-task':Array(12).fill(null)}}});
    expect(incomplete.status()).toBe(400);
    expect((await incomplete.json()).missingQuestionIds).toContain('desk-task');
    // The final server check can also send the learner back to an earlier station.
    await learner.route('**' + api + '/submit', route => {
      const payload = route.request().postDataJSON();
      payload.answers['desk-task'][0] = null;
      return route.continue({postData:JSON.stringify(payload)});
    }, {times:1});
    await learner.locator('#submitBtn').click();
    await learner.getByRole('button',{name:'Yes, submit project'}).click();
    await expect(current).toContainText('Registration desk');
    await expect(current.getByRole('status')).toContainText('Fill in every answer here');
    const submitted = learner.waitForResponse(r => r.url().endsWith(api+'/submit') && r.ok());
    await learner.getByRole('button',{name:'Check and submit project'}).click();
    await learner.getByRole('button',{name:'Keep working'}).click();
    await learner.locator('#submitBtn').click();
    await learner.getByRole('button',{name:'Yes, submit project'}).click();
    await submitted;
    await expect(learner).toHaveURL(/practical-practice\.html\?activity=codequest/);
    await expect(learner.getByRole('heading',{name:/CodeQuest practice/})).toBeVisible();
    await expect(learner.locator('.practice-card:visible').frameLocator('iframe').getByRole('button',{name:'Test my code'})).toBeVisible();
    const results = await (await page.request.get(api+'/results')).json();
    const deductions = testInfo.project.name === 'mobile' ? {'desk-task':1,'order-units':2} : {};
    const missed = Object.values(deductions).reduce((sum, n) => sum + n, 0);
    expect(results.submissions[0]).toMatchObject({totalMarks:50-missed,maxMarks:50});
    for (const {items:[task]} of template.sections) expect(results.submissions[0].grades[task.id].marksAwarded).toBe(task.marks - (deductions[task.id] || 0));
    expect((await page.request.patch(api+'/marked',{data:{marked:true}})).ok()).toBeTruthy();
    const progress = await (await page.request.get('/api/roster/'+roster.id+'/progress')).json();
    expect(progress.students[0].results).toContainEqual(expect.objectContaining({assignmentId:assessmentId,score:50-missed,total:50}));
  } finally { await context.close(); }
});

test('classroom submits one reviewed incomplete practical without making up answers', async ({page,browser}, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  await signInDisposableTeacher(page,'-submit-practical-draft');
  const roster = await createRoster(page,'Recovery class',[{ID:'RE-1',Name:'Sample Captain'}]);
  const assignment = await page.request.post('/api/activity-templates/assign',{
    data:{templateId:'starter-codequest',version:3,rosterId:roster.id}
  });
  expect(assignment.ok(),await assignment.text()).toBeTruthy();
  const {assessmentId} = await assignment.json();
  const desk = '/api/activity-templates/lessons/'+assessmentId;
  const api = '/api/assignment/'+assessmentId;
  expect((await page.request.post(desk,{data:{action:'open',minutes:60}})).ok()).toBeTruthy();
  const context = await browser.newContext();
  try {
    const join = await (await context.request.get(api+'/join')).json();
    expect((await context.request.post(api+'/enter',{data:{handle:join.students[0].handle,pin:'5628'}})).ok()).toBeTruthy();
    expect((await context.request.get(api+'/take')).ok()).toBeTruthy();
    const saved = await context.request.post(api+'/draft',{
      data:{answers:{near:[{op:'move'},{op:'move'},{op:'collect'}]}}
    });
    expect(saved.ok(),await saved.text()).toBeTruthy();
    expect((await page.request.post(desk,{data:{action:'close'}})).ok()).toBeTruthy();
    await page.goto('/activity-templates');
    await page.locator('#classTab').click();
    await page.locator('#lesson').selectOption(assessmentId);
    await expect(page.locator('#submissionCount')).toBeVisible();
    await page.getByLabel('Find a student').fill('Captain');
    await expect(page.locator('#learnerProgress')).toContainText('Sample Captain');
    await page.getByLabel('Find a student').fill('Missing');
    await expect(page.locator('#learnerProgress')).toContainText('No students in this view.');
    await page.getByLabel('Find a student').fill('');
    await page.locator('#submissionFilter [data-filter=pending]').click();
    await page.getByRole('button',{name:'Review saved work for Sample Captain'}).click();
    await expect(page.locator('#classMarks')).toContainText('Move forward → Move forward → Collect');
    await expect(page.locator('#classMarks')).toContainText('No saved answer');
    page.once('dialog',dialog => dialog.accept());
    await page.getByRole('button',{name:'Submit saved work for this student'}).click();
    await expect(page.locator('#classMarks')).toContainText('Sample Captain · Submitted');
    await expect(page.locator('#learnerProgress')).toContainText('No students in this view.');
    await page.locator('#submissionFilter [data-filter=submitted]').click();
    await expect(page.locator('#learnerProgress')).toContainText('Sample Captain');
    const {submissions} = await (await page.request.get(api+'/results')).json();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({totalMarks:3,maxMarks:50,grades:{'two-flags':{marksAwarded:0}}});
    expect(Object.keys(submissions[0].answers)).toEqual(['near']);
  } finally { await context.close(); }
});

test('the two-flag voyage restores programs, runs both flags and records the fifty-mark rubric', async ({page,browser}, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  test.slow();
  const game = require('../../public/codequest-core');
  await signInDisposableTeacher(page,'-two-flags');
  const roster = await createRoster(page,'Two-flag class',[{ID:'CAP-1',Name:'Sample Captain'}]);
  const assigned = await page.request.post('/api/activity-templates/assign',{data:{templateId:'starter-codequest',version:3,rosterId:roster.id}});
  expect(assigned.ok(),await assigned.text()).toBeTruthy();
  const {assessmentId} = await assigned.json();
  const api = '/api/assignment/'+assessmentId;
  await page.goto('/activity-templates');
  await page.locator('#classTab').click();
  await page.locator('#lesson').selectOption(assessmentId);
  await expect(page.locator('#lessonMinutes')).toHaveValue('60');
  await page.locator('#openLesson').click();
  await expect(page.locator('#learnerLink')).toBeVisible();
  const context = await browser.newContext();
  try {
    const join = await (await context.request.get(api+'/join')).json();
    const enter = await context.request.post(api+'/enter',{data:{handle:join.students[0].handle,pin:'5628'}});
    expect(enter.ok(),await enter.text()).toBeTruthy();
    const {questions} = await (await context.request.get(api+'/take')).json();
    const answers = {};
    for (const task of questions) {
      const {mission} = task;
      let start = mission.start;
      const program = [];
      for (const chest of [task.checkpoint,task.secondCheckpoint].filter(Boolean)) {
        const leg = {...mission,start,chest};
        const steps = game.solve(leg).slice(0,-1);
        const end = game.run(leg,steps).frames.at(-1);
        program.push(...steps);
        start = [end.x,end.y,end.d];
      }
      program.push(...game.solve({...mission,start}));
      answers[task.id] = mission.repeatRequired ? game.compact(program) : program;
    }
    const saved = await context.request.post(api+'/draft',{data:{answers}});
    expect(saved.ok(),await saved.text()).toBeTruthy();
    const learner = await context.newPage();
    const musicDownloads = [];
    learner.on('request', request => { if (/\.(mp3|wav)(\?|$)/i.test(request.url())) musicDownloads.push(request.url()); });
    await learner.goto('/assignment/'+assessmentId);
    const current = learner.locator('[data-practical-page]:visible');
    const frame = current.frameLocator('iframe');
    const submitIsland = async () => {
      await frame.getByRole('button',{name:'Submit code',exact:true}).click();
      await frame.getByRole('button',{name:'Yes, submit code',exact:true}).click();
    };
    for (let i=0;i<5;i++) {
      await submitIsland();
      await expect(learner.locator('.project-task-nav')).toContainText('Task ' + (i+2) + ' of 8');
    }
    await frame.getByRole('button',{name:'Test my code'}).click();
    await expect(frame.locator('#testResult')).toContainText('You saved 8 blocks!',{timeout:10000});
    await submitIsland();
    await expect(current).toContainText('Corner crossing');
    await submitIsland();
    await expect(current).toContainText('both lookout flags');
    await expect(frame.locator('#island .assessment-flag')).toHaveText(['1','2']);
    await frame.locator('#island').screenshot({path:testInfo.outputPath('Lookout island.png')});
    await frame.getByRole('button',{name:'Test my code'}).click();
    await expect(frame.locator('#testResult')).toContainText('2 of 2 flags visited.',{timeout:20000});
    await expect(frame.locator('#island .flag-visited')).toHaveCount(2);
    const submission = learner.waitForResponse(r => r.url().endsWith(api+'/submit') && r.ok());
    learner.once('dialog',dialog => dialog.accept());
    await learner.locator('#submitBtn').click();
    await submission;
    expect(musicDownloads).toEqual([]);
    const results = await (await page.request.get(api+'/results')).json();
    expect(results.submissions[0]).toMatchObject({totalMarks:50,maxMarks:50,grades:{'two-flags':{marksAwarded:12}}});
    await page.getByRole('button',{name:'View class results'}).click();
    const studentResult = page.locator('#classMarks details');
    await expect(studentResult.locator('summary')).toHaveText('Sample Captain · 50/50');
    await studentResult.locator('summary').click();
    await expect(studentResult).toContainText('both lookout flags');
    expect((await page.request.patch(api+'/marked',{data:{marked:true}})).ok()).toBeTruthy();
    const progress = await (await page.request.get('/api/roster/'+roster.id+'/progress')).json();
    expect(progress.students[0].results).toContainEqual(expect.objectContaining({assignmentId:assessmentId,score:50,total:50}));
  } finally { await context.close(); }
});
