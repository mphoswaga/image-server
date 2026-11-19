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
    const task = learner.locator('[data-code-task]');
    await task.getByRole('button', { name: 'Move forward', exact:true }).click();
    await task.getByRole('button', { name: 'Move forward', exact:true }).click();
    const saved = learner.waitForResponse(response => response.url().endsWith(api + '/draft') && response.ok());
    await task.getByRole('button', { name: 'Collect', exact: true }).click();
    await saved;
    await learner.reload();
    await expect(task.locator('ol li > span')).toHaveText(['Move forward', 'Move forward', 'Collect']);
    await task.getByRole('button', { name: 'Run code' }).click();
    await expect(task.getByRole('status')).toHaveText('Treasure collected!');
    await task.getByRole('button', { name: 'Edit step 3: Collect' }).click();
    await task.getByRole('button', { name: 'Remove' }).last().click();
    const submitted = learner.waitForResponse(response => response.url().endsWith(api + '/submit') && response.ok());
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
    await learner.getByRole('button',{name:'Next task'}).click();
    await expect(learner.getByLabel('Correct Mia’s role')).toHaveValue('4');
    await learner.getByLabel('Correct Mia’s role').selectOption('Pilot');
    await learner.getByRole('button',{name:'Next task'}).click();
    await learner.getByLabel('Select the scientist’s record').selectOption('Nia');
    await learner.getByLabel('How many packs does Mia have?').selectOption('4');
    await learner.getByRole('button',{name:'Next task'}).click();
    const saved = learner.waitForResponse(response => response.url().endsWith(api + '/draft') && response.ok());
    await learner.getByLabel('Who has the most packs to share?').selectOption('Leo');
    await saved;
    await learner.reload();
    await learner.getByRole('button',{name:'Next task'}).click();
    await expect(learner.getByLabel('Correct Mia’s role')).toHaveValue('Pilot');
    await learner.getByRole('button',{name:'Next task'}).click();
    await learner.getByRole('button',{name:'Next task'}).click();
    await expect(learner.getByLabel('Who has the most packs to share?')).toHaveValue('Leo');
    const submitted = learner.waitForResponse(response => response.url().endsWith(api + '/submit') && response.ok());
    await learner.locator('#submitBtn').click();
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
  await expect(page.locator('#learnerPreview').getByRole('button', {name:'Run code'})).toHaveCount(1);
  await expect(page.locator('#learnerPreview')).toContainText('Task 1 of 5');
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
  await page.getByLabel('Reach treasure square points').first().fill('3');
  await expect(page.locator('#total')).toContainText('51 marks');
  await expect(page.getByRole('button', {name:'Create class draft'})).toBeDisabled();
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
  await expect(page.getByRole('combobox',{name:'Version',exact:true})).toHaveValue('2');
  await page.getByRole('button',{name:'Preview as learner'}).click();
  const preview = page.locator('#learnerPreview');
  await expect(preview.locator('article:not([hidden])').getByText('Cellphone number: 000 000 0001',{exact:true})).toBeVisible();
  await preview.getByRole('button',{name:'Next task'}).click();
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
    await learnerPage.getByRole('button', {name:'Show all tasks'}).click();
    await expect(learnerPage.locator('[data-practical-page]:visible')).toHaveCount(restored.questions.length);
    await page.goto('/activity-templates');
    await page.locator('#lesson').selectOption(assessmentId);
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
    await expect(learnerPage.getByRole('button',{name:'Next task'})).toBeVisible();
    await expect(learnerPage.locator('[data-practical-page]:visible')).toHaveCount(1);
    expect((await (await original.request.get(api + '/take')).json()).draftAnswers.near).toEqual([{op:'move'}]);
    await expect(page.locator('#learnerProgress')).toContainText('Original Learner · 1 of 5');
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
  expect(lessons.every(lesson=>lesson.status==='draft'&&!lesson.hasOpened&&lesson.plan.date)).toBeTruthy();
  const learner = await browser.newContext();
  try {
    const practice = await learner.newPage();
    const writes = [];
    practice.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
    await practice.goto('/practical-practice.html?activity=data');
    await practice.getByLabel('Field for the plant type').selectOption('Type');
    await practice.getByLabel('Correct the number of Tulip pots').selectOption('3');
    await practice.getByRole('button',{name:'Check my work'}).first().click();
    await expect(practice.getByRole('status').first()).toHaveText('That matches the data.');
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
