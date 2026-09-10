const { test, expect } = require('@playwright/test');
const { expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

test('teacher builds a marked assessment and a learner sees practical criteria safely', async ({ page, browser }, testInfo) => {
  test.skip(!['windows-100', 'mobile'].includes(testInfo.project.name), 'Desktop and mobile cover the new responsive assessment flow.');
  await signInDisposableTeacher(page, `-assessment-${testInfo.project.name}`);

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
  await expect(page.locator('#assessmentTotalStatus')).toHaveClass(/valid/);
  await expectNoPageOverflow(page);

  const published = page.waitForResponse(response => response.url().endsWith('/api/assessment') && response.request().method() === 'POST');
  await page.locator('#publishAssessmentBtn').click();
  const response = await published;
  expect(response.ok()).toBeTruthy();
  const assessment = await response.json();
  await expect(page.locator('#assessmentPublishResult')).toContainText('Assessment published');
  await expect(page.locator('#assignmentsList')).toContainText('Document creation project');

  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  try {
    await learner.goto(new URL(assessment.path, page.url()).toString());
    await expect(learner.locator('#authScreen')).toBeVisible();
    await learner.locator('#auSid').fill('Amina Learner');
    await learner.locator('#authBtn').click();
    await expect(learner.locator('#pinSetupBlock')).toBeVisible();
    await learner.locator('#auPinNew').fill('4826');
    await learner.locator('#auPinConfirm').fill('4826');
    await learner.locator('#authBtn').click();
    await expect(learner.locator('#liveStatusTitle')).toHaveText('Waiting for your teacher');
    const startResponse = await page.request.patch(`/api/assignment/${assessment.assessmentId}/live-state`, { data: { action: 'start' } });
    expect(startResponse.ok()).toBeTruthy();
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
    await learnerContext.close();
  }
});
