const { test, expect } = require('@playwright/test');
const { expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

test('teacher builds a marked assessment and a learner sees practical criteria safely', async ({ page, browser }, testInfo) => {
  test.skip(!['windows-100', 'mobile'].includes(testInfo.project.name), 'Desktop and mobile cover the new responsive assessment flow.');
  const learnerId = `G2-${testInfo.project.name}`;
  await signInDisposableTeacher(page, `-assessment-${testInfo.project.name}`);
  const unrosteredLive = await page.request.post('/api/assessment', {
    data: { assessment: {
      title: 'Unrostered live project', subject: 'Computing', grade: 'Grade 2', assessmentType: 'project', deliveryMode: 'live', totalMarks: 10,
      objectives: [{ id: 'create-document', text: 'Create and edit a document' }], instructions: 'Complete the project independently.',
      sections: [{ id: 'practical', title: 'Document task', type: 'practical', objectiveIds: ['create-document'], instructions: 'Complete your own document.', items: [{ id: 'criterion', prompt: 'Creates a document and corrects its spelling independently', marks: 10 }] }],
    } },
  });
  expect(unrosteredLive.status()).toBe(400);
  expect((await unrosteredLive.json()).error).toMatch(/Choose a class roster/);
  const rosterResponse = await page.request.post('/api/roster', {
    data: { name: 'Grade 2 ICT', rows: [{ ID: learnerId, Name: 'Amina Learner' }], idCol: 'ID', nameCol: 'Name' },
  });
  expect(rosterResponse.ok(), await rosterResponse.text()).toBeTruthy();
  const classRoster = await rosterResponse.json();
  const replacementRosterResponse = await page.request.post('/api/roster', {
    data: { name: 'Grade 2 ICT B', rows: [{ ID: `${learnerId}-B`, Name: 'Bao Learner' }], idCol: 'ID', nameCol: 'Name' },
  });
  expect(replacementRosterResponse.ok(), await replacementRosterResponse.text()).toBeTruthy();
  const replacementRoster = await replacementRosterResponse.json();
  const anotherRosterResponse = await page.request.post('/api/roster', {
    data: { name: 'Grade 2 ICT C', rows: [
      { ID: `${learnerId}-C`, Name: 'Hoàng My Chi' },
      { ID: `${learnerId}-D`, Name: 'Nguyễn Mỹ Chi' },
    ], idCol: 'ID', nameCol: 'Name' },
  });
  expect(anotherRosterResponse.ok(), await anotherRosterResponse.text()).toBeTruthy();
  const anotherRoster = await anotherRosterResponse.json();
  const correctedNameResponse = await page.request.patch(`/api/roster/${anotherRoster.id}/student/${learnerId}-C`, {
    data: { name: 'Hoàng Mỹ Chi' },
  });
  expect(correctedNameResponse.ok(), await correctedNameResponse.text()).toBeTruthy();
  expect((await correctedNameResponse.json()).name).toBe('Hoàng Mỹ Chi');

  await page.locator('#assignmentsBtn').click();
  await expect(page.getByRole('heading', { name: 'Test or project' })).toBeVisible();
  await page.locator('#newAssessmentBtn').click();
  await page.locator('#assessmentTitle').fill('Document creation project');
  await page.locator('#assessmentSubject').fill('Computing');
  await page.locator('#assessmentGrade').fill('Grade 2');
  await page.locator('#assessmentKind').selectOption('project');
  await page.locator('#assessmentObjectives').fill('Create and edit a document');
  await page.locator('#assessmentObjectives').blur();
  await page.locator('[data-section-type]').selectOption('practical');
  await page.locator('[data-item-prompt]').fill('Creates a document and corrects spelling');
  await page.locator('[data-item-marks]').fill('10');
  await page.locator('#assessmentRoster').selectOption(classRoster.id);
  await expect(page.locator('#assessmentTotalStatus')).toHaveClass(/valid/);
  await expectNoPageOverflow(page);

  const published = page.waitForResponse(response => response.url().endsWith('/api/assessment') && response.request().method() === 'POST');
  await page.locator('#publishAssessmentBtn').click();
  const response = await published;
  expect(response.ok()).toBeTruthy();
  const assessment = await response.json();
  await expect(page.locator('#assessmentPublishResult')).toContainText('Assessment published');
  await expect(page.locator('#assignmentsList')).toContainText('Document creation project');
  const assessmentCard=page.locator('#assignmentsList .game-card').filter({hasText:'Document creation project'});
  await assessmentCard.getByRole('button',{name:'Change class'}).click();
  await assessmentCard.locator('.a-class-picker').selectOption(replacementRoster.id);
  const classUpdate=page.waitForResponse(result=>result.url().endsWith(`/api/assignment/${assessment.assessmentId}/class`)&&result.request().method()==='PATCH');
  await assessmentCard.getByRole('button',{name:'Save class'}).click();
  expect((await classUpdate).ok()).toBeTruthy();
  await expect(page.locator('#assignmentsList .game-card').filter({hasText:'Document creation project'})).toContainText('Grade 2 ICT B');
  const changedAssessmentCard=page.locator('#assignmentsList .game-card').filter({hasText:'Grade 2 ICT B'});
  await changedAssessmentCard.getByRole('button',{name:'Give to another class'}).click();
  await changedAssessmentCard.locator('.a-class-copy-picker').selectOption(anotherRoster.id);
  const classCopyResponse=page.waitForResponse(result=>result.url().endsWith(`/api/assignment/${assessment.assessmentId}/class-copy`)&&result.request().method()==='POST');
  await changedAssessmentCard.getByRole('button',{name:'Create class run'}).click();
  const classCopyResult=await classCopyResponse;
  expect(classCopyResult.ok(),await classCopyResult.text()).toBeTruthy();
  const classCopy=await classCopyResult.json();
  expect(classCopy.assessmentId).not.toBe(assessment.assessmentId);
  expect(classCopy.roomCode).not.toBe(assessment.roomCode);
  await expect(page.locator(`#assignmentsList .game-card[data-assignment-id="${classCopy.assessmentId}"]`)).toContainText('Grade 2 ICT C');
  const [originalJoin,copyJoin]=await Promise.all([
    page.request.get(`/api/assignment/${assessment.assessmentId}/join`).then(result=>result.json()),
    page.request.get(`/api/assignment/${classCopy.assessmentId}/join`).then(result=>result.json()),
  ]);
  expect(originalJoin.students.map(student=>student.label)).toEqual(['Bao L.']);
  expect(copyJoin.students.map(student=>student.label)).toEqual(['Mỹ Chi (Hoàng)','Mỹ Chi (Nguyễn)']);
  expect(JSON.stringify(copyJoin)).not.toContain('Hoàng Mỹ Chi');
  expect(JSON.stringify(copyJoin)).not.toContain('Nguyễn Mỹ Chi');
  expect(JSON.stringify(originalJoin)).not.toContain('Mỹ Chi');
  expect(JSON.stringify(copyJoin)).not.toContain('Bao L.');

  const presentation = await page.context().newPage();
  await presentation.goto(new URL(`/assessment/${assessment.assessmentId}/present`, page.url()).toString());
  await expect(presentation.locator('#title')).toHaveText('Document creation project');
  await expect(presentation.locator('#liveState')).toContainText('Lobby open');

  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  try {
    await learner.goto(new URL(assessment.path, page.url()).toString());
    await expect(learner.locator('#authScreen')).toBeVisible();
    await expect(learner.locator('#authTitle')).toHaveText('Choose your name');
    await expect(learner.locator('#auSid')).toBeHidden();
    await learner.getByRole('button', { name: 'Bao L.' }).click();
    await expect(learner.locator('#pinSetupBlock')).toBeVisible();
    await learner.locator('#auPinNew').fill('4826');
    await learner.locator('#auPinConfirm').fill('4826');
    await learner.locator('#authBtn').click();
    await expect(learner.locator('#liveStatusTitle')).toHaveText('Waiting for your teacher');
    const startResponse = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'start' } });
    expect(startResponse.ok()).toBeTruthy();
    await expect(presentation.locator('#title')).toHaveText('1. Practical / observation');
    await expect(presentation.locator('#bullets')).toContainText('Complete this section independently');
    await expect(presentation.locator('#bullets')).not.toContainText('Creates a document and corrects spelling');
    await expect(learner.locator('.section-head')).toHaveText('Practical / observation');
    await expect(learner.locator('.practical-note')).toContainText('Your teacher will observe it');
    const pauseResponse = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'pause' } });
    expect(pauseResponse.ok()).toBeTruthy();
    await expect(learner.locator('#liveStatusTitle')).toHaveText('Assessment paused');
    const resumeResponse = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'resume' } });
    expect(resumeResponse.ok()).toBeTruthy();
    await expect(learner.locator('.practical-note')).toBeVisible();
    await learner.locator('#submitBtn').click();
    await expect(learner.locator('#liveStatusTitle')).toHaveText('Section saved');
    const finishResponse = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'next' } });
    expect(finishResponse.ok()).toBeTruthy();
    await expect(learner.locator('#submitBtn')).toHaveText('Submit assessment');
    await learner.locator('#submitBtn').click();
    await expect(learner.locator('#pendingMsg')).toBeVisible();
    await expect(learner.locator('#scoreWrap')).toBeHidden();

    const resultsResponse = await page.request.get(`/api/assignment/${assessment.assessmentId}/results`);
    const results = await resultsResponse.json();
    expect(results.releaseReady).toBeFalsy();
    expect(results.pendingGrades).toBe(1);
    const submission = results.submissions[0];
    const criterion = results.questions[0];
    const gradeResponse = await page.request.patch(`/api/assignment/${assessment.assessmentId}/grade`, {
      data: { studentId: submission.studentId, questionId: criterion.id, marksAwarded: 8 },
    });
    expect(gradeResponse.ok()).toBeTruthy();
    const releaseResponse = await page.request.patch(`/api/assignment/${assessment.assessmentId}/release`, { data: { released: true } });
    expect(releaseResponse.ok()).toBeTruthy();
    await learner.reload();
    await expect(learner.locator('#scoreWrap')).toBeVisible();
    await expect(learner.locator('#scoreVal')).toHaveText('8');
    await expect(learner.locator('#scoreMax')).toHaveText('10');
  } finally {
    await presentation.close();
    await learnerContext.close();
  }
});

test('an open My assignments panel updates learner readiness without being reopened', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One desktop browser covers the live teacher polling contract.');
  await signInDisposableTeacher(page, '-assessment-results-polling');
  const learnerId = `POLL-${Date.now()}`;
  const rosterResponse = await page.request.post('/api/roster', {
    data: { name: 'Grade 2 ICT polling', rows: [{ ID: learnerId, Name: 'Amina Learner' }], idCol: 'ID', nameCol: 'Name' },
  });
  const classRoster = await rosterResponse.json();
  expect(rosterResponse.ok(), JSON.stringify(classRoster)).toBeTruthy();
  const assessmentResponse = await page.request.post('/api/assessment', {
    data: {
      rosterId: classRoster.id,
      assessment: {
        title: 'Live document project', subject: 'ICT', grade: 'Grade 2', assessmentType: 'project', deliveryMode: 'live', totalMarks: 10,
        objectives: [{ id: 'document', text: 'Create a document independently' }],
        instructions: 'Complete the project independently.',
        sections: [{
          id: 'practical', title: 'Document task', type: 'practical', objectiveIds: ['document'], instructions: 'Create and check your document.',
          items: [
            { id: 'criterion', prompt: 'Creates a document independently', marks: 5 },
            { id: 'criterion-check', prompt: 'Checks and improves the document', marks: 5 },
          ],
        }],
      },
    },
  });
  const assessment = await assessmentResponse.json();
  expect(assessmentResponse.ok(), JSON.stringify(assessment)).toBeTruthy();

  let resultsRequests = 0;
  page.on('request', request => {
    if(request.method()==='GET'&&request.url().endsWith(`/api/assignment/${assessment.assessmentId}/results`))resultsRequests += 1;
  });
  await page.locator('#assignmentsBtn').click();
  const card = page.locator('#assignmentsList .game-card').filter({ hasText: 'Live document project' });
  await expect(card).toBeVisible();
  const toggle = card.locator('.a-toggle-btn');
  await expect(toggle).toHaveText('Run classroom / mark');
  await toggle.click();
  const results = card.locator(`#ares-${assessment.assessmentId}`);
  await expect(results).toContainText('Live classroom lobby');
  await expect(results).toContainText('Updates automatically while these controls are open.');
  await results.getByRole('button', { name: 'By question' }).click();
  await expect(results).toHaveAttribute('data-view', 'question');
  const questionSelect = results.getByLabel('Question to mark');
  await expect(questionSelect.locator('option')).toHaveCount(2);
  await questionSelect.selectOption('criterion-check');
  await expect(results.locator('.assessment-question-navigator + div')).toContainText('2. Checks and improves the document');
  await results.getByRole('button', { name: 'Previous' }).click();
  await expect(questionSelect).toHaveValue('criterion');

  const learnerContext = await browser.newContext();
  try {
    const join = await (await learnerContext.request.get(`/api/assignment/${assessment.assessmentId}/join`)).json();
    const entered = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/enter`, {
      data: { handle: join.students[0].handle, pin: '4826' },
    });
    expect(entered.ok(), await entered.text()).toBeTruthy();
    const started = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'start' } });
    expect(started.ok(), await started.text()).toBeTruthy();
    await expect(results).toContainText('0 of 1 students ready');

    const ready = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/draft`, {
      data: { answers: {}, complete: true },
    });
    expect(ready.ok(), await ready.text()).toBeTruthy();
    await expect(results).toContainText('1 of 1 students ready');
    await expect(toggle).toHaveText('Hide controls');
    await expect(results).toHaveAttribute('data-view', 'question');

    const finished = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'next' } });
    expect(finished.ok(), await finished.text()).toBeTruthy();
    const submitted = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/submit`, { data: { answers: {} } });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    await expect(results).toContainText('Amina Learner');
    await expect(results.getByRole('button', { name: /grades? pending/ })).toBeDisabled();

    await results.locator('.bulk-grade-student').check();
    await results.getByLabel('Mark for selected learners').fill('4');
    await results.getByRole('button', { name: 'Apply to 1 selected' }).click();
    await expect(page.locator('#toastWrap')).toContainText('Mark applied to 1 learner');
    await results.getByLabel('Question to mark').selectOption('criterion-check');
    await results.locator('.bulk-grade-student').check();
    await results.getByLabel('Mark for selected learners').fill('4');
    await results.getByRole('button', { name: 'Apply to 1 selected' }).click();
    await expect(page.locator('#toastWrap')).toContainText('Mark applied to 1 learner');
    await expect(results.getByRole('button', { name: 'Release results' })).toBeEnabled();
    const released = await page.request.patch(`/api/assignment/${assessment.assessmentId}/release`, { data: { released: true } });
    expect(released.ok(), await released.text()).toBeTruthy();
    await expect(results).toContainText('Results released to students');
  } finally {
    await learnerContext.close();
  }

  await page.locator('#assignmentsBackTop').click();
  await page.waitForTimeout(100);
  const requestsAfterClose = resultsRequests;
  await page.waitForTimeout(1600);
  expect(resultsRequests).toBe(requestsAfterClose);
});

test('multiple-choice answers are visibly auto-confirmed without per-learner save buttons', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One desktop browser covers deterministic MCQ marking.');
  await signInDisposableTeacher(page, '-assessment-mcq-auto-confirm');
  const learnerId = `MCQ-${Date.now()}`;
  const rosterResponse = await page.request.post('/api/roster', {
    data: { name: 'Grade 4 Science MCQ', rows: [{ ID: learnerId, Name: 'Minh Anh' }], idCol: 'ID', nameCol: 'Name' },
  });
  const classRoster = await rosterResponse.json();
  expect(rosterResponse.ok(), JSON.stringify(classRoster)).toBeTruthy();
  const assessmentResponse = await page.request.post('/api/assessment', {
    data: {
      rosterId: classRoster.id,
      assessment: {
        title: 'Plant knowledge test', subject: 'Science', grade: 'Grade 4', assessmentType: 'test', deliveryMode: 'self-paced', totalMarks: 2,
        objectives: [{ id: 'plants', text: 'Identify what plants need to grow' }],
        instructions: 'Choose one answer for each question.',
        sections: [{
          id: 'knowledge', title: 'Multiple choice', type: 'mcq', objectiveIds: ['plants'], instructions: 'Choose the best answer.',
          items: [
            { id: 'sunlight', prompt: 'Which resource helps a plant make food?', marks: 1, options: ['Sunlight', 'Plastic', 'Metal', 'Glass'], correctIndex: 0 },
            { id: 'roots', prompt: 'Which part usually absorbs water?', marks: 1, options: ['Flower', 'Roots', 'Fruit', 'Seed'], correctIndex: 1 },
          ],
        }],
      },
    },
  });
  const assessment = await assessmentResponse.json();
  expect(assessmentResponse.ok(), JSON.stringify(assessment)).toBeTruthy();

  const learnerContext = await browser.newContext();
  try {
    const join = await (await learnerContext.request.get(`/api/assignment/${assessment.assessmentId}/join`)).json();
    const entered = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/enter`, {
      data: { handle: join.students[0].handle, pin: '4826' },
    });
    expect(entered.ok(), await entered.text()).toBeTruthy();
    const submitted = await learnerContext.request.post(`/api/assignment/${assessment.assessmentId}/submit`, {
      data: { answers: { sunlight: 0, roots: 0 } },
    });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();

    const rosterProgress = await (await page.request.get(`/api/roster/${classRoster.id}/progress`)).json();
    expect(rosterProgress.students[0].results).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignmentId: assessment.assessmentId, lessonTitle: 'Plant knowledge test', status: 'marked', provisional: true, score: 1, total: 2, pct: 50 }),
    ]));
    const marks = await (await page.request.get(`/api/gradebook/${classRoster.id}`)).json();
    expect(marks.assessments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assessment.assessmentId, provisional: true }),
    ]));
    expect(marks.rows[0].cells[assessment.assessmentId]).toEqual(expect.objectContaining({ mark: 1, max: 2, pct: 0.5 }));

    await page.locator('#rostersBtn').click();
    const rosterCard = page.locator('.roster-row').filter({ hasText: 'Grade 4 Science MCQ' });
    await rosterCard.getByRole('button', { name: 'Progress' }).click();
    await expect(page.locator('#progressStats')).toContainText('Activities');
    await expect(page.locator('#progressStats')).toContainText('1');
    await page.locator('#progressStudents .stu-head').filter({ hasText: 'Minh Anh' }).click();
    await expect(page.locator('#progressStudents')).toContainText('Plant knowledge test');
    await expect(page.locator('#progressStudents')).toContainText('50% · Marked');

    await page.locator('#assignmentsBtn').click();
    const card = page.locator('#assignmentsList .game-card').filter({ hasText: 'Plant knowledge test' });
    await card.locator('.a-toggle-btn').click();
    const results = card.locator(`#ares-${assessment.assessmentId}`);
    await results.getByRole('button', { name: 'By question' }).click();
    await expect(results.locator('.mcq-auto-note')).toContainText('marked and confirmed every submitted answer automatically');
    await expect(results.locator('.auto-marked-badge')).toHaveText('Automatically marked & confirmed');
    await expect(results.locator('.grade-auto-result b')).toHaveText('1/1');
    await expect(results.locator('.grade-override-btn')).toHaveCount(0);
    await expect(results.getByRole('button', { name: 'Release results' })).toBeEnabled();
    await expectNoPageOverflow(page);
  } finally {
    await learnerContext.close();
  }
});

test('one bulk question mark updates every selected learner and rejects a mixed invalid selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One desktop browser covers the bulk marking API.');
  await signInDisposableTeacher(page, '-assessment-bulk-marking');
  const rosterResponse = await page.request.post('/api/roster', {
    data: {
      name: 'Grade 2 bulk marking',
      rows: [{ ID: 'BULK-1', Name: 'Amina Learner' }, { ID: 'BULK-2', Name: 'Bao Learner' }],
      idCol: 'ID', nameCol: 'Name',
    },
  });
  const classRoster = await rosterResponse.json();
  expect(rosterResponse.ok(), JSON.stringify(classRoster)).toBeTruthy();
  const createdResponse = await page.request.post('/api/assessment', {
    data: {
      rosterId: classRoster.id,
      assessment: {
        title: 'Bulk practical', subject: 'ICT', grade: 'Grade 2', assessmentType: 'project', deliveryMode: 'live', totalMarks: 5,
        objectives: [{ id: 'document', text: 'Create a document' }],
        instructions: 'Complete the task.',
        sections: [{
          id: 'practical', title: 'Practical', type: 'practical', objectiveIds: ['document'], instructions: 'Create the document.',
          items: [{ id: 'criterion', prompt: 'Creates the document', marks: 5 }],
        }],
      },
    },
  });
  const assessment = await createdResponse.json();
  expect(createdResponse.ok(), JSON.stringify(assessment)).toBeTruthy();

  const applied = await page.request.patch(`/api/assignment/${assessment.assessmentId}/grade/bulk`, {
    data: { questionId: 'criterion', studentIds: ['BULK-1', 'BULK-2'], marksAwarded: 4 },
  });
  expect(applied.ok(), await applied.text()).toBeTruthy();
  expect((await applied.json()).updated).toBe(2);

  const rejected = await page.request.patch(`/api/assignment/${assessment.assessmentId}/grade/bulk`, {
    data: { questionId: 'criterion', studentIds: ['BULK-1', 'NOT-IN-CLASS'], marksAwarded: 1 },
  });
  expect(rejected.status()).toBe(404);
  const results = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/results`)).json();
  expect(results.submissions).toHaveLength(2);
  expect(results.submissions.map(student => student.grades.criterion.marksAwarded)).toEqual([4, 4]);
});
