const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

test('teacher-controlled classwork keeps learners waiting, starts together, and ends remotely', async ({ page, browser }, testInfo) => {
  test.skip(!['windows-100', 'desktop-safari'].includes(testInfo.project.name), 'One Chromium and one WebKit run cover the coordinated room workflow.');

  await signInDisposableTeacher(page, `-live-${testInfo.project.name}`);
  await page.goto('/practice');
  await expect(page.getByRole('heading', { name: 'Class arcade' })).toBeVisible();
  await expect(page.locator('#progressPanel')).toBeHidden();
  await page.locator('#toggleProgressBtn').click();
  await expect(page.locator('#progressPanel')).toBeVisible();
  await page.locator('#toggleProgressBtn').click();
  await expect(page.locator('#progressPanel')).toBeHidden();
  await page.locator('#liveMode').selectOption('classwork');
  await page.locator('#liveDuration').selectOption('10');
  await page.locator('#teacherMusic').uncheck();
  await page.locator('#teacherVoice').uncheck();
  await page.locator('#createRoomBtn').click();
  await expect(page.locator('#liveRoomStage')).toBeVisible();
  await expect(page.locator('#liveRoomCode')).toHaveText(/^[A-Z0-9]{6}$/);
  await expect(page.locator('#liveRoomState')).toContainText('Class lobby open');
  const roomCode = (await page.locator('#liveRoomCode').textContent()).trim();
  expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  const origin = new URL(page.url()).origin;
  try {
    await learner.goto(`${origin}/student/practice/guest?session=${roomCode}`);
    await expect(learner.locator('#guestEntry')).toBeVisible();
    await learner.locator('#nicknameInput').fill('Amina');
    await learner.locator('#joinRoomBtn').click();
    await expect(learner.locator('#liveLobby')).toBeVisible();
    await expect(learner.locator('#liveLobbyText')).toContainText('Amina');
    await expect(learner.locator('#startBtn')).toBeHidden();
    await expect(learner.locator('#saveState')).toContainText('Waiting for your teacher');

    const secondJoin = await learner.request.post(`${origin}/api/practice/live-sessions/${roomCode}/join`, {
      data: { name: 'Bongani' },
    });
    expect(secondJoin.ok()).toBeTruthy();
    await page.evaluate(() => loadLiveRoom());
    await expect(page.locator('#liveLeaderboard')).toContainText('Amina');
    await expect(page.locator('#liveLeaderboard')).toContainText('Bongani');
    await expect(page.locator('#telemetryPlaying')).toHaveText('2');
    await expect(page.locator('#sessionActivityFeed')).toContainText('joined the room');

    await page.locator('#startRoomBtn').click();
    await expect(page.locator('#liveRoomState')).toContainText('Class game in progress');
    await expect(page.locator('#liveRoomEmpty')).toBeHidden();
    await expect(page.locator('#startRoomBtn')).toBeHidden();
    await expect(page.locator('#roomClock')).toBeVisible();
    await expect(page.locator('#sessionBeacon')).toBeVisible();
    await expect(page.locator('#sessionBeacon')).toContainText('Live class connected');
    await expect(page.locator('#liveTelemetry')).toBeVisible();
    await learner.evaluate(() => refreshLiveRoom());
    await expect(learner.locator('#activity')).toBeVisible({ timeout: 8_000 });
    await expect(learner.locator('#liveStripTitle')).toContainText('left');
    await expect(page.locator('#roomClock')).toHaveText(/\d+:\d{2}/);
    const teacherClock = await page.locator('#roomClock').textContent();
    const learnerClock = await learner.locator('#liveStripTitle').textContent();
    const asSeconds = value => { const match=String(value).match(/(\d+):(\d{2})/); return match ? Number(match[1])*60+Number(match[2]) : NaN; };
    expect(Math.abs(asSeconds(teacherClock)-asSeconds(learnerClock))).toBeLessThanOrEqual(2);
    await learner.locator('#nextBtn').click();
    await expect(learner.locator('#phaseLabel')).toHaveText('Your mission');
    for(let target=0;target<8;target+=1){
      const bug=learner.locator('#skillTarget');
      await expect(bug).toBeVisible();
      await bug.dispatchEvent('pointerenter');
      if(target<7) await learner.waitForTimeout(500);
    }
    await expect(learner.locator('#saveState')).toContainText(`Room ${roomCode} updated`);
    await expect(learner.locator('#nextBtn')).not.toHaveText('Retry save');
    await page.evaluate(() => loadLiveRoom());
    await expect(page.locator('#sessionActivityFeed')).toContainText('Amina cleared a mission');
    await page.locator('#pauseRoomBtn').click();
    await expect(page.locator('#liveRoomState')).toContainText('Class game paused');
    await expect(page.locator('#pauseRoomBtn')).toHaveText('Resume game');
    const pausedClock = await page.locator('#roomClock').textContent();
    await page.waitForTimeout(1100);
    await expect(page.locator('#roomClock')).toHaveText(pausedClock);
    await learner.evaluate(() => refreshLiveRoom());
    await expect(learner.locator('#pauseLayer')).toHaveClass(/show/);
    await expect(learner.locator('#pauseLayer')).toContainText('Your teacher paused the game');
    await expect(learner.locator('#resumeBtn')).toBeHidden();
    await page.locator('#pauseRoomBtn').click();
    await expect(page.locator('#liveRoomState')).toContainText('Class game in progress');
    await learner.evaluate(() => refreshLiveRoom());
    await expect(learner.locator('#pauseLayer')).not.toHaveClass(/show/);
    await expect(learner.locator('#liveMiniBoard')).toContainText('Amina');
    await expect(learner.locator('#liveMiniBoard')).not.toContainText('Bongani');
    await expect(learner.locator('#timeValue')).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#endRoomBtn').click();
    await expect(page.locator('#liveRoomState')).toContainText('Class game ended');
    await learner.evaluate(() => refreshLiveRoom());
    await expect(learner.locator('#completionTitle')).toHaveText('Teacher ended the game');
    await expect(learner.locator('#scoreSummary')).toContainText('Your score');
    await expect(learner.locator('#liveFinalBoard')).toBeHidden();
  } finally {
    await learnerContext.close();
  }
});

test('homework opens immediately for each learner and keeps its own deadline', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One Chromium run covers the self-paced homework workflow.');

  await signInDisposableTeacher(page, '-homework-room');
  await page.goto('/practice');
  await page.locator('#liveMode').selectOption('homework');
  await expect(page.locator('#liveDuration')).toBeHidden();
  await expect(page.locator('#liveHomeworkDays')).toBeVisible();
  await page.locator('#liveHomeworkDays').selectOption('3');
  await page.locator('#teacherMusic').uncheck();
  await page.locator('#createRoomBtn').click();
  await expect(page.locator('#liveRoomState')).toContainText('Homework assignment open');
  await expect(page.locator('#startRoomBtn')).toBeHidden();
  await expect(page.locator('#copyRoomBtn')).toHaveText('Copy homework link');
  const roomCode = (await page.locator('#liveRoomCode').textContent()).trim();

  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  const origin = new URL(page.url()).origin;
  try {
    await learner.goto(`${origin}/student/practice/guest?session=${roomCode}`);
    await learner.locator('#nicknameInput').fill('Amina');
    await learner.locator('#joinRoomBtn').click();
    await expect(learner.locator('#liveLobby')).toBeHidden();
    await expect(learner.locator('#startBtn')).toBeVisible();
    await expect(learner.locator('#previewNote')).toContainText('Work at your own pace');
    await expect(learner.locator('#liveStripTitle')).toContainText('Homework');
    await learner.locator('#startBtn').click();
    await expect(learner.locator('#activity')).toBeVisible();

    await page.locator('#newRoomBtn').click();
    await expect(page.locator('#liveRoomEmpty')).toContainText('Existing homework assignments will remain open');
    await page.locator('#liveMode').selectOption('classwork');
    await expect(page.locator('#liveDuration')).toBeVisible();
    await page.locator('#createRoomBtn').click();
    await expect(page.locator('#liveRoomState')).toContainText('Class lobby open');
    await expect(page.locator('#roomSwitcher option')).toHaveCount(2);
    await page.locator('#roomSwitcher').selectOption(roomCode);
    await expect(page.locator('#liveRoomState')).toContainText('Homework assignment open');

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#endRoomBtn').click();
    await expect(page.locator('#liveRoomState')).toContainText('Homework closed');
    await learner.evaluate(() => refreshLiveRoom());
    await expect(learner.locator('#completionTitle')).toHaveText('Homework closed');
  } finally {
    await learnerContext.close();
  }
});
