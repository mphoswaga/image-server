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
