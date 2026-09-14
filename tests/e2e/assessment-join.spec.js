const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

test('a first-time rostered pupil joins a live assessment by tapping a privacy-safe name', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One Chromium classroom flow covers the room-code entry contract.');

  await signInDisposableTeacher(page, '-assessment-name-join');
  const learnerId = `JOIN-${Date.now()}`;
  const secondLearnerId = `${learnerId}-B`;
  const rosterResponse = await page.request.post('/api/roster', {
    data: {
      name: 'Grade 2 ICT',
      rows: [
        { ID: learnerId, Name: 'Amina Learner' },
        { ID: secondLearnerId, Name: 'Bao Student' },
      ],
      idCol: 'ID',
      nameCol: 'Name',
    },
  });
  expect(rosterResponse.ok(), await rosterResponse.text()).toBeTruthy();
  const classRoster = await rosterResponse.json();

  const assessmentResponse = await page.request.post('/api/assessment', {
    data: {
      rosterId: classRoster.id,
      assessment: {
        title: 'Grade 2 document project',
        subject: 'ICT',
        grade: 'Grade 2',
        assessmentType: 'project',
        deliveryMode: 'live',
        totalMarks: 10,
        objectives: [{ id: 'document', text: 'Create a document independently' }],
        instructions: 'Complete each project stage independently.',
        sections: [{
          id: 'practical',
          title: 'Document task',
          type: 'practical',
          objectiveIds: ['document'],
          instructions: 'Create and check your document.',
          items: [{ id: 'criterion', prompt: 'Creates and checks a document independently', marks: 10 }],
        }],
      },
    },
  });
  expect(assessmentResponse.ok(), await assessmentResponse.text()).toBeTruthy();
  const assessment = await assessmentResponse.json();

  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  try {
    const publicMetaResponse = await learner.request.get(`/api/assignment/${assessment.assessmentId}/join`);
    expect(publicMetaResponse.ok()).toBeTruthy();
    const publicMeta = await publicMetaResponse.json();
    const publicText = JSON.stringify(publicMeta);
    expect(publicMeta.students).toHaveLength(2);
    expect(publicText).not.toContain(learnerId);
    expect(publicText).not.toContain('Amina Learner');
    expect(publicMeta.students[0]).toMatchObject({ label: 'Amina L.' });
    expect(publicMeta.students[0].handle).toMatch(/^[a-f0-9]{16}$/);

    await learner.goto(new URL('/join', page.url()).toString());
    await learner.locator('#roomCode').fill(assessment.roomCode);
    await learner.locator('#codeBtn').click();

    await expect(learner.getByRole('heading', { name: 'Choose your name' })).toBeVisible();
    await expect(learner.locator('#studentId')).toBeHidden();
    await expect(learner.getByRole('button', { name: 'Amina L.' })).toBeVisible();
    await expect(learner.getByRole('button', { name: 'Bao S.' })).toBeVisible();
    await expect(learner.locator('body')).not.toContainText(learnerId);
    await expect(learner.locator('body')).not.toContainText('Amina Learner');

    const firstEntryRequest = learner.waitForRequest(request =>
      request.method() === 'POST' && request.url().endsWith(`/api/assignment/${assessment.assessmentId}/enter`));
    await learner.getByRole('button', { name: 'Amina L.' }).click();
    const entryRequest = await firstEntryRequest;
    expect(entryRequest.postDataJSON()).toEqual({ handle: publicMeta.students[0].handle });
    await expect(learner.locator('#pinSetupBlock')).toBeVisible();

    await learner.locator('#pinNew').fill('4826');
    await learner.locator('#pinConfirm').fill('4826');
    await Promise.all([
      learner.waitForURL(new RegExp(`/assignment/${assessment.assessmentId}$`)),
      learner.locator('#idBtn').click(),
    ]);
    await expect(learner.locator('#liveStatusTitle')).toHaveText('Waiting for your teacher');
  } finally {
    await learnerContext.close();
  }
});

test('a direct assessment link keeps school IDs private and authenticates with the opaque name handle', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One Chromium classroom flow covers the direct-link entry contract.');

  await signInDisposableTeacher(page, '-assessment-direct-name-join');
  const learnerId = `DIRECT-${Date.now()}`;
  const secondLearnerId = `${learnerId}-B`;
  const rosterResponse = await page.request.post('/api/roster', {
    data: {
      name: 'Grade 2 Direct Link',
      rows: [
        { ID: learnerId, Name: 'Amina Learner' },
        { ID: secondLearnerId, Name: 'Bao Student' },
      ],
      idCol: 'ID',
      nameCol: 'Name',
    },
  });
  expect(rosterResponse.ok(), await rosterResponse.text()).toBeTruthy();
  const classRoster = await rosterResponse.json();

  const assessmentResponse = await page.request.post('/api/assessment', {
    data: {
      rosterId: classRoster.id,
      assessment: {
        title: 'Grade 2 direct-link project',
        subject: 'ICT',
        grade: 'Grade 2',
        assessmentType: 'project',
        deliveryMode: 'live',
        totalMarks: 10,
        objectives: [{ id: 'document', text: 'Create a document independently' }],
        instructions: 'Complete each project stage independently.',
        sections: [{
          id: 'practical',
          title: 'Document task',
          type: 'practical',
          objectiveIds: ['document'],
          instructions: 'Create and check your document.',
          items: [{ id: 'criterion', prompt: 'Creates and checks a document independently', marks: 10 }],
        }],
      },
    },
  });
  expect(assessmentResponse.ok(), await assessmentResponse.text()).toBeTruthy();
  const assessment = await assessmentResponse.json();
  const publicMeta = await (await page.request.get(`/api/assignment/${assessment.assessmentId}/join`)).json();
  const amina = publicMeta.students.find(student => student.label === 'Amina L.');
  expect(amina && amina.handle).toMatch(/^[a-f0-9]{16}$/);

  const legacySetupResponse = await page.request.get(`/api/my-work?studentId=${encodeURIComponent(learnerId)}`);
  expect(legacySetupResponse.status()).toBe(428);
  const legacySetupChallenge = await legacySetupResponse.json();
  expect(legacySetupChallenge).toMatchObject({
    code: 'STUDENT_PIN_SETUP_REQUIRED',
    needsPinSetup: true,
    path: '/start',
  });
  expect(legacySetupChallenge).not.toHaveProperty('name');
  expect(JSON.stringify(legacySetupChallenge)).not.toContain(learnerId);
  expect(JSON.stringify(legacySetupChallenge)).not.toContain('Amina Learner');

  const studentSetupResponse = await page.request.post('/api/student/login', {
    data: { studentId: secondLearnerId },
  });
  expect(studentSetupResponse.status()).toBe(428);
  const studentSetupChallenge = await studentSetupResponse.json();
  expect(studentSetupChallenge).toMatchObject({ needsPinSetup: true });
  expect(studentSetupChallenge).not.toHaveProperty('name');
  expect(JSON.stringify(studentSetupChallenge)).not.toContain(secondLearnerId);
  expect(JSON.stringify(studentSetupChallenge)).not.toContain('Bao Student');

  const studentLoginResponse = await page.request.post('/api/student/login', {
    data: { studentId: secondLearnerId, pin: '7315' },
  });
  expect(studentLoginResponse.ok(), await studentLoginResponse.text()).toBeTruthy();
  const studentPinResponse = await page.request.post('/api/student/login', {
    data: { studentId: secondLearnerId },
  });
  expect(studentPinResponse.status()).toBe(428);
  const studentPinChallenge = await studentPinResponse.json();
  expect(studentPinChallenge).toMatchObject({ needsPin: true });
  expect(studentPinChallenge).not.toHaveProperty('name');
  expect(JSON.stringify(studentPinChallenge)).not.toContain(secondLearnerId);
  expect(JSON.stringify(studentPinChallenge)).not.toContain('Bao Student');

  const myWorkPinResponse = await page.request.get(`/api/my-work?studentId=${encodeURIComponent(secondLearnerId)}`);
  expect(myWorkPinResponse.status()).toBe(428);
  const myWorkPinChallenge = await myWorkPinResponse.json();
  expect(myWorkPinChallenge).toMatchObject({ needsPin: true });
  expect(myWorkPinChallenge).not.toHaveProperty('name');
  expect(JSON.stringify(myWorkPinChallenge)).not.toContain(secondLearnerId);
  expect(JSON.stringify(myWorkPinChallenge)).not.toContain('Bao Student');

  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  const directUrl = new URL(assessment.path, page.url()).toString();
  try {
    await learner.goto(new URL('/my-work', page.url()).toString());
    await learner.locator('#studentId').fill(learnerId);
    await Promise.all([
      learner.waitForURL(new RegExp('/start$')),
      learner.locator('#lookupBtn').click(),
    ]);

    await learner.goto(directUrl);
    await expect(learner.locator('#authScreen')).toBeVisible();
    await expect(learner.locator('#authTitle')).toHaveText('Choose your name');
    await expect(learner.locator('#authSub')).toHaveText('Tap your name, then enter your PIN.');
    await expect(learner.locator('#auSid')).toBeHidden();
    await expect(learner.getByRole('button', { name: 'Amina L.' })).toBeVisible();
    await expect(learner.getByRole('button', { name: 'Bao S.' })).toBeVisible();
    await expect(learner.locator('body')).not.toContainText(learnerId);
    await expect(learner.locator('body')).not.toContainText(secondLearnerId);
    await expect(learner.locator('body')).not.toContainText('Amina Learner');

    const firstEntryRequest = learner.waitForRequest(request =>
      request.method() === 'POST' && request.url().endsWith(`/api/assignment/${assessment.assessmentId}/enter`));
    const firstEntryResponse = learner.waitForResponse(response =>
      response.request().method() === 'POST' && response.url().endsWith(`/api/assignment/${assessment.assessmentId}/enter`));
    await learner.getByRole('button', { name: 'Amina L.' }).click();
    expect((await firstEntryRequest).postDataJSON()).toEqual({ handle: amina.handle });
    const setupChallenge = await (await firstEntryResponse).json();
    expect(setupChallenge).toMatchObject({ needsPinSetup: true });
    expect(setupChallenge).not.toHaveProperty('name');
    expect(JSON.stringify(setupChallenge)).not.toContain(learnerId);
    expect(JSON.stringify(setupChallenge)).not.toContain('Amina Learner');
    await expect(learner.locator('#auSid')).toHaveValue('');
    await expect(learner.locator('#pinSetupBlock')).toBeVisible();

    await learner.locator('#auPinNew').fill('4826');
    await learner.locator('#auPinConfirm').fill('4826');
    const pinSetupRequest = learner.waitForRequest(request =>
      request.method() === 'POST' && request.url().endsWith(`/api/assignment/${assessment.assessmentId}/enter`));
    await learner.locator('#authBtn').click();
    expect((await pinSetupRequest).postDataJSON()).toEqual({ handle: amina.handle, pin: '4826' });
    await expect(learner.locator('#liveStatusTitle')).toHaveText('Waiting for your teacher');

    await learnerContext.clearCookies();
    await learner.goto(directUrl);
    await expect(learner.locator('#authTitle')).toHaveText('Choose your name');
    const returnEntryRequest = learner.waitForRequest(request =>
      request.method() === 'POST' && request.url().endsWith(`/api/assignment/${assessment.assessmentId}/enter`));
    const returnEntryResponse = learner.waitForResponse(response =>
      response.request().method() === 'POST' && response.url().endsWith(`/api/assignment/${assessment.assessmentId}/enter`));
    await learner.getByRole('button', { name: 'Amina L.' }).click();
    expect((await returnEntryRequest).postDataJSON()).toEqual({ handle: amina.handle });
    const pinChallenge = await (await returnEntryResponse).json();
    expect(pinChallenge).toMatchObject({ needsPin: true });
    expect(pinChallenge).not.toHaveProperty('name');
    expect(JSON.stringify(pinChallenge)).not.toContain(learnerId);
    expect(JSON.stringify(pinChallenge)).not.toContain('Amina Learner');
    await expect(learner.locator('#pinEnterBlock')).toBeVisible();

    const forgotRequest = learner.waitForRequest(request =>
      request.method() === 'POST' && request.url().endsWith(`/api/assignment/${assessment.assessmentId}/pin/reset-request`));
    await learner.locator('#forgotPinBtn').click();
    expect((await forgotRequest).postDataJSON()).toEqual({ handle: amina.handle });
    await expect(learner.locator('#forgotMsg')).toContainText('teacher has been notified');
  } finally {
    await learnerContext.close();
  }
});
