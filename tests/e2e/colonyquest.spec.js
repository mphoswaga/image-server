const { test, expect } = require('@playwright/test');
const sharp = require('sharp');
const pptxgen = require('pptxgenjs');
const colonyCore = require('../../public/colonyquest-core');
const { expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

const questions = [
  { question: 'Which place is a habitat?', options: ['Forest', 'Pencil', 'Spoon', 'Shoe'], correctIndex: 0, explanation: 'A forest is a habitat.' },
  { question: 'What do plants need to grow?', options: ['Light', 'Plastic', 'Glass', 'Metal'], correctIndex: 0, explanation: 'Plants need light.' },
  { question: 'Which animal might live in a pond?', options: ['Frog', 'Camel', 'Lion', 'Penguin'], correctIndex: 0, explanation: 'A frog can live in a pond.' },
];

test('growing colonies draw every soldier, retain every room, and scroll to a new expansion', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(!['windows-100', 'mobile'].includes(testInfo.project.name), 'Verify the growing world with a mouse and on a narrow touch screen.');
  const colonies = [colonyCore.createTeam({ name: 'Leaf Colony' }, 0), colonyCore.createTeam({ name: 'River Colony' }, 1)];
  Object.assign(colonies[0], { soldiers: 11, workers: 16, population: 28, pantryBuilt: true, barracksBuilt: true, barracksAnnexes: 1, workerLodges: 1, expansionRooms: 7, territory: 8, defense: 4 });
  const setup = { teamCount: 2, rounds: 12, matchType: 'rounds', durationMinutes: 15, sound: false, teams: colonies };
  let saved = colonyCore.normalizeSession({ phase: 'reward', introSeen: true, teams: colonies, currentTeamIndex: 0, turnIndex: 1 });
  await page.route(/\/api\/game\/cq-growth\/colonyquest(?:\/session)?$/, async route => {
    if (route.request().method() === 'PUT') {
      saved = colonyCore.normalizeSession(route.request().postDataJSON().session);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { game: { id: 'cq-growth', lessonTitle: 'Habitats', questions, colonyquest: setup }, session: saved } });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/colonyquest/cq-growth');
  await page.locator('#resumeBtn').click();
  const world = page.locator('#worldViewport');
  await expect(world).toHaveAttribute('aria-description', /Leaf Colony: 1 queen, 16 workers, 11 soldiers/);
  await expect(world).toHaveAttribute('aria-description', /Stone and steel walls/);
  const beforeRooms = colonyCore.colonyRooms(saved.teams[0]).length;
  await page.locator('[data-reward="expansion"]').click();
  await expect(page.locator('#worldStory')).toBeVisible();
  await expect(page.locator('#worldStoryEffect')).toContainText('+1 permanent room');
  expect(colonyCore.colonyRooms(saved.teams[0])).toHaveLength(beforeRooms + 1);
  await expect.poll(() => world.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  const deep = await page.locator('#gameMount canvas').screenshot();
  await testInfo.attach('expanded-colony', { body: deep, contentType: 'image/png' });
  await page.locator('#worldSurface').click();
  await expect.poll(() => world.evaluate(element => element.scrollTop)).toBe(0);
  const surface = await page.locator('#gameMount canvas').screenshot();
  expect(Buffer.compare(deep, surface)).not.toBe(0);
  await world.hover({ position: { x: 40, y: 250 } });
  await page.mouse.wheel(0, 400);
  await expect.poll(() => world.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await page.reload();
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#worldStoryEffect')).toContainText('+1 permanent room');
  await expect(world).toHaveAttribute('aria-description', new RegExp(`${beforeRooms + 1} rooms`));
  await expect(world).toHaveAttribute('aria-description', /16 workers, 11 soldiers/);
  await expect.poll(() => world.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('LessonScope creates ColonyQuest as a teacher-owned whole-class game', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'The server creation contract only needs one browser.');
  await signInDisposableTeacher(page, '-colonyquest-create');
  const pptx = new pptxgen();
  const slide = pptx.addSlide();
  slide.addText('Habitats', { x: 1, y: 1, w: 6, h: 1 });
  slide.addText('A habitat gives living things food, water, shelter, and space.', { x: 1, y: 2, w: 7, h: 1 });
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  const response = await page.request.post('/api/game/from-pptx', {
    multipart: {
      file: { name: 'habitats.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer },
      subject: 'Science', topic: 'Habitats', grade: 'Grade 3', questionCount: '4', mode: 'colonyquest', rosterId: '', cutoffAt: '',
    },
  });
  const raw = await response.text();
  expect(response.ok(), raw).toBeTruthy();
  const created = JSON.parse(raw);
  expect(created).toMatchObject({ mode: 'colonyquest', roomCode: null, questionCount: 4 });
  expect(created.path).toMatch(/^\/colonyquest\/[a-z0-9-]+$/);

  const details = await page.request.get(`/api/game/${created.gameId}/colonyquest`);
  expect(details.ok()).toBeTruthy();
  const body = await details.json();
  expect(body.game.colonyquest.teamCount).toBe(4);
  expect(body.game.questions).toHaveLength(4);
  expect(body.roster).toBeNull();

  await page.goto(created.path);
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#lessonTitle')).toHaveText('habitats');

  await page.goto(`/play/${created.gameId}`);
  await page.locator('#startBtn').click();
  await expect(page.locator('#colonyQuestPick')).toBeVisible();
  await page.locator('#colonyQuestPick').click();
  await expect(page).toHaveURL(new RegExp(`/colonyquest/${created.gameId}$`));
  await expect(page.locator('#setup')).toBeVisible();
});

test('a teacher can run, recover, pause, and finish a one-screen ColonyQuest match', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(!['windows-100', 'tablet', 'mobile'].includes(testInfo.project.name), 'The classroom journey runs at representative desktop and touch viewports.');

  let session = null;
  let setup = {
    teamCount: 2,
    matchType: 'rounds',
    rounds: 3,
    durationMinutes: 15,
    sound: false,
    teams: [
      { id: 'team-1', name: 'Leaf Colony', colorIndex: 0, members: [{ id: 'S1', name: 'Amina', turns: 0 }] },
      { id: 'team-2', name: 'River Colony', colorIndex: 1, members: [{ id: 'S2', name: 'Ben', turns: 0 }] },
    ],
  };

  await page.route(/\/api\/game\/cq-e2e\/colonyquest(?:\/session)?$/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const isSession = url.pathname.endsWith('/session');
    if (!isSession && request.method() === 'GET') {
      return route.fulfill({ json: {
        game: { id: 'cq-e2e', lessonTitle: 'Habitats', subject: 'Science', topic: 'Habitats', grade: 'Grade 3', questions, colonyquest: setup },
        roster: { id: 'class-3', name: 'Grade 3', students: [{ id: 'S1', name: 'Amina' }, { id: 'S2', name: 'Ben' }] },
        session,
      } });
    }
    if (!isSession && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      setup = { ...setup, ...body, questions: undefined };
      return route.fulfill({ json: { ok: true, colonyquest: setup, questions: body.questions } });
    }
    if (isSession && request.method() === 'PUT') {
      session = { ...request.postDataJSON().session, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { ok: true, updatedAt: session.updatedAt, summary: session.phase === 'ended' ? { phase: 'ended' } : null } });
    }
    if (isSession && request.method() === 'DELETE') {
      session = null;
      return route.fulfill({ json: { ok: true } });
    }
    return route.abort();
  });

  await page.goto('/colonyquest/cq-e2e');
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#lessonTitle')).toHaveText('Habitats');
  await expect(page.locator('.team-line')).toHaveCount(2);
  await expect(page.locator('.student-row')).toHaveCount(2);
  await expectNoPageOverflow(page);

  await page.locator('#startBtn').click();
  await expect(page.locator('#gameScreen')).toBeVisible();
  await expect(page.locator('#storyOverlay')).toBeVisible();
  await expect(page.locator('#storyTitle')).toHaveText('Moonroot Meadow needs you');
  await page.locator('#storyContinue').click();
  await expect(page.locator('#questionOverlay')).toBeVisible();
  await expect(page.locator('#questionText')).toHaveText(questions[0].question);
  await expect(page.locator('#scoreStrip .score-card')).toHaveCount(2);
  await expect(page.locator('#gameMount canvas')).toBeVisible();
  if (testInfo.project.name === 'windows-100') {
    const questionBox = await page.locator('.question-dialog').boundingBox();
    expect(questionBox.width).toBeLessThan(1366 * .5);
    expect(questionBox.x).toBeGreaterThan(1366 * .5);
  }

  const canvasShot = await page.locator('#gameMount canvas').screenshot();
  await testInfo.attach('colony-world', { body: canvasShot, contentType: 'image/png' });
  const stats = await sharp(canvasShot).stats();
  const spread = stats.channels.slice(0, 3).reduce((sum, channel) => sum + (channel.max - channel.min), 0);
  expect(spread).toBeGreaterThan(120);

  await page.locator('.answer').first().click();
  await expect(page.locator('#feedback')).toContainText('Correct');
  await page.locator('#feedbackNext').click();
  await expect(page.locator('#rewardOverlay')).toBeVisible();
  expect(session.phase).toBe('reward');

  await page.reload();
  await expect(page.locator('#resumeBar')).toBeVisible();
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#rewardOverlay')).toBeVisible();
  await page.getByRole('button', { name: /Add one worker/ }).click();
  await expect(page.locator('#worldStory')).toBeVisible();
  await expect(page.locator('#worldStoryTitle')).toContainText('foraging trail');
  await expect(page.locator('#worldStoryEffect')).toContainText('+1 worker');
  await expect(page.locator('#worldViewport')).toHaveAttribute('aria-description', /Leaf Colony: 1 queen, 2 workers, 0 soldiers. 1 rooms/);
  expect(session.teams[0].workers).toBe(2);
  expect(session.teams[0].food).toBe(8);
  expect(colonyCore.colonyRooms(session.teams[0])).toHaveLength(1);
  expect(session.phase).toBe('event');
  await page.locator('#worldStoryContinue').click();
  await expect(page.locator('#questionOverlay')).toBeVisible();
  await expect(page.locator('#turnTeam')).toContainText('River Colony');

  await page.locator('.answer').nth(1).click();
  await expect(page.locator('#feedback')).toContainText('Try again');
  await page.locator('#feedbackNext').click();
  await expect(page.locator('#worldStoryTitle')).toHaveText('Deep Roots');
  await expect(page.locator('#worldStoryEffect')).toContainText('how far every colony has grown');
  await page.locator('#worldStoryContinue').click();
  await expect(page.locator('#questionOverlay')).toBeVisible();

  await page.locator('#pauseBtn').click();
  await expect(page.locator('#eventTitle')).toHaveText('The colonies are resting');
  expect(session.phase).toBe('paused');
  await page.locator('#pauseBtn').click();
  await expect(page.locator('#questionOverlay')).toBeVisible();
  expect(session.phase).toBe('question');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#teacherHandle').click();
  await page.locator('#endGameBtn').click();
  await expect(page.locator('#finalOverlay')).toBeVisible();
  await expect(page.locator('#podium')).toContainText('Colony');
  expect(session.phase).toBe('ended');
  expect(session.answers).toHaveLength(2);
  expect(session.answers[0].studentId).toBe('S1');
  expect(session.answers[1].studentId).toBe('S2');
});
