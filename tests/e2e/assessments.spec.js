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
    await learner.getByRole('button', { name: 'Amina L.' }).click();
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
          items: [{ id: 'criterion', prompt: 'Creates and checks a document independently', marks: 10 }],
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

    const graded = await page.request.patch(`/api/assignment/${assessment.assessmentId}/grade`, {
      data: { studentId: learnerId, questionId: 'criterion', marksAwarded: 8 },
    });
    expect(graded.ok(), await graded.text()).toBeTruthy();
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
