const { test, expect } = require('@playwright/test');
const pptxgen = require('pptxgenjs');
const { signInDisposableTeacher, expectNoPageOverflow } = require('./helpers');
const questions = [
  {
    question: 'Which place is a habitat?',
    options: ['Forest', 'Pencil', 'Spoon', 'Shoe'],
    correctIndex: 0,
    explanation: 'A forest gives living things food and shelter.',
  },
  {
    question: 'What do plants need?',
    options: ['Water', 'Plastic', 'Metal', 'Glass'],
    correctIndex: 0,
    explanation: 'Water helps plants grow.',
  },
];
async function create(page) {
  await signInDisposableTeacher(page, '-colonyrivals');
  const pptx = new pptxgen();
  pptx.addSlide().addText('Habitats provide food, water and shelter.', { x: 1, y: 1, w: 7, h: 1 });
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  const r = await page.request.post('/api/game/from-pptx', {
    multipart: {
      file: {
        name: 'habitats.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        buffer,
      },
      subject: 'Science',
      topic: 'Colony habitats',
      grade: 'Grade 3',
      questionCount: '4',
      mode: 'arcade',
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const { gameId } = await r.json();
  const edited = await page.request.patch(`/api/game/${gameId}/questions`, { data: { questions } });
  expect(edited.ok(), await edited.text()).toBeTruthy();
  return gameId;
}
test('learner name and PIN join, locked answer, one upgrade, reconnect and permanent report', async ({
  page,
  browser,
}, info) => {
  test.skip(!['windows-100', 'mobile', 'desktop-safari'].includes(info.project.name));
  test.setTimeout(125000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await create(page);
  const roster = await (
    await page.request.post('/api/roster', {
      data: {
        name: 'Rivals class',
        rows: [{ ID: 'LIVE-' + id, Name: 'Amina Test' }],
        idCol: 'ID',
        nameCol: 'Name',
      },
    })
  ).json();
  expect(
    (await page.request.patch(`/api/game/${id}/classes`, { data: { rosterIds: [roster.id] } })).ok(),
  ).toBeTruthy();
  await page.goto('/colonyquest-live/' + id);
  await page.getByRole('button', { name: 'Open lobby', exact: true }).click();
  await expect(page.locator('#hostPhase')).toHaveText('Lobby open');
  const context = await browser.newContext({ viewport: info.project.use.viewport });
  const learner = await context.newPage();
  learner.on('pageerror', (e) => errors.push(e.message));
  try {
    await learner.goto('/play/' + id + '?activity=colonyquest-live');
    await expect(learner.locator('#nameGrid button')).toHaveCount(1);
    await learner.locator('#nameGrid button').click();
    await learner.locator('#authForm button[type=submit]').click();
    await learner.locator('#auPinNew').fill('2468');
    await learner.locator('#auPinConfirm').fill('2468');
    await learner.locator('#authForm button[type=submit]').click();
    await expect(learner).toHaveURL(new RegExp('/colonyquest-live-play/' + id));
    await expect(learner.locator('#question')).toHaveText('Your colony is ready!');
    await expect(page.locator('#hostCount')).toContainText('1 colonies');
    await page.locator('#start').click();
    await expect(learner.locator('#question')).toHaveText('The quest for the Ancient Acorn');
    await expect(learner.locator('#choices button')).toHaveCount(0);
    await expect(learner.locator('#question')).toHaveText(questions[0].question);
    await learner.locator('#sound').click();
    await expect.poll(() => learner.locator('audio[data-colony-music]').evaluate(el => el.currentTime)).toBeGreaterThan(0.1);
    await learner.getByRole('button', { name: 'A. Forest', exact: true }).click();
    await expect(learner.locator('#instruction')).toContainText('Answer locked in');
    await expect(learner.locator('[data-choice="0"]')).toHaveClass(/selected/);
    const cheat = await learner.request.post(`/api/game/${id}/answer`, {
      data: { questionIndex: 0, choice: 0 },
    });
    expect(cheat.status()).toBe(409);
    await expect(learner.locator('#question')).toHaveText('Correct! Grow your colony.');
    await learner.getByRole('button', { name: /Worker ant/ }).click();
    await expect(learner.locator('#resources')).toContainText('2 workers');
    await page.locator('#pause').click();
    await expect(learner.locator('#question')).toHaveText('The meadow is resting');
    await expect.poll(() => learner.locator('audio[data-colony-music]').evaluate(el => el.paused)).toBe(true);
    await learner.reload();
    await expect(learner.locator('#question')).toHaveText('The meadow is resting');
    await expect(learner.locator('#resources')).toContainText('2 workers');
    await page.locator('#resume').click();
    await expect(learner.locator('#question')).toHaveText(questions[1].question, { timeout: 35000 });
    await learner.getByRole('button', { name: 'A. Water', exact: true }).click();
    await expect(learner.locator('#question')).toHaveText('Correct! Grow your colony.');
    await learner.getByRole('button', { name: /^🍃Collect materials/ }).click();
    await expect(learner.locator('#question')).toHaveText('Your colony made it through!', { timeout: 45000 });
    await expect(page.locator('#hostPhase')).toHaveText('Game complete');
    const payload = await (await page.request.get(`/api/game/${id}/colonyquest-live`)).json();
    await page.selectOption('#history', payload.match.id);
    await page.locator('#viewReport').click();
    await expect(page.locator('#report')).toContainText('Amina Test');
    await expect(page.locator('#report')).toContainText('2 correct · 2 answered · 0 unanswered');
    expect((await learner.request.get(`/api/game/${id}/colonyquest-live/report`)).status()).toBe(401);
    await page.reload();
    await page.selectOption('#history', payload.match.id);
    await page.locator('#viewReport').click();
    await expect(page.locator('#report')).toContainText('Amina Test');
    await expectNoPageOverflow(learner);
    await expectNoPageOverflow(page);
    expect(errors).toEqual([]);
    await learner.screenshot({ path: info.outputPath('colony-rivals-learner.png') });
    await page.screenshot({ path: info.outputPath('colony-rivals-report.png'), fullPage: true });
  } finally {
    await context.close();
  }
});
test('teacher can test against computer colonies without changing the smartboard setup', async ({
  page,
}, info) => {
  test.skip(!['windows-100', 'mobile', 'desktop-safari'].includes(info.project.name));
  test.setTimeout(40000);
  const id = await create(page);
  await page.goto('/colonyquest/' + id);
  await expect(page.locator('#setup')).toBeVisible();
  const before = await (await page.request.get(`/api/game/${id}/colonyquest`)).json();
  await page.locator('#multiplayerLink').click();
  const pop = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Test against computer colonies' }).click();
  const learner = await pop;
  await expect(learner.locator('#connection')).toHaveText('Practice vs computer');
  await expect(learner.locator('#rank')).toContainText('of 4');
  await expect(learner.locator('#choices button')).toHaveCount(4);
  const music = learner.locator('audio[data-colony-music]');
  await expect.poll(() => music.evaluate((el) => el.paused)).toBe(true);
  await learner.locator('#sound').click();
  await expect.poll(() => music.evaluate((el) => el.currentTime)).toBeGreaterThan(0.1);
  await expect.poll(() => music.evaluate((el) => el.currentSrc)).toContain('ghibli-station');
  await learner.locator('.music-settings summary').click();
  await expect(learner.locator('#musicTrackLabel')).toContainText('The Mini Vandals');
  await learner.locator('#musicVolume').fill('25');
  await expect.poll(() => music.evaluate((el) => el.volume)).toBe(0.125);
  await expectNoPageOverflow(learner);
  await learner.locator('.music-settings summary').click();
  await learner.locator('#sound').click();
  await expect.poll(() => music.evaluate((el) => el.paused)).toBe(true);
  await learner.locator('#sound').click();
  await expect.poll(() => music.evaluate((el) => el.paused)).toBe(false);
  await expectNoPageOverflow(learner);
  await learner.screenshot({ path: info.outputPath('colony-rivals-playing.png') });
  const after = await (await page.request.get(`/api/game/${id}/colonyquest`)).json();
  expect(after.game.colonyquest).toEqual(before.game.colonyquest);
  expect(after.session).toEqual(before.session);
  const live = await (await page.request.get(`/api/game/${id}/colonyquest-live`)).json();
  expect(live.match).toBeNull();
  expect(live.history).toHaveLength(0);
  await learner.close();
});
