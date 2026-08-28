const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

test('teacher-controlled classwork keeps learners waiting, starts together, and ends remotely', async ({ page, browser }, testInfo) => {
  test.skip(!['windows-100', 'desktop-safari'].includes(testInfo.project.name), 'One Chromium and one WebKit run cover the coordinated room workflow.');

  await signInDisposableTeacher(page, `-live-${testInfo.project.name}`);
  await page.goto('/practice');
  await expect(page.getByRole('heading', { name: 'Class arcade' })).toBeVisible();
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
