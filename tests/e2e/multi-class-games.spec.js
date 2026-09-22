const { test, expect } = require('@playwright/test');
const pptxgen = require('pptxgenjs');
const { signInDisposableTeacher } = require('./helpers');

async function createClass(page, name, studentId, studentName) {
  const response = await page.request.post('/api/roster', {
    data: { name, rows: [{ ID: studentId, Name: studentName }], idCol: 'ID', nameCol: 'Name' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('a published game can add and remove several classes from My games', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await signInDisposableTeacher(page, '-multi-class-game');
  const runId = testInfo.project.name.replace(/[^a-z0-9]+/gi, '').toUpperCase();
  const studentIds = {
    classA: `G3A-${runId}`,
    classB: `G3B-${runId}`,
    classC: `G3C-${runId}`,
  };
  const [classA, classB, classC] = await Promise.all([
    createClass(page, 'Grade 3A', studentIds.classA, 'Amina One'),
    createClass(page, 'Grade 3B', studentIds.classB, 'Bao Two'),
    createClass(page, 'Grade 3C', studentIds.classC, 'Chi Three'),
  ]);

  const deck = new pptxgen();
  const slide = deck.addSlide();
  slide.addText('File skills', { x: 1, y: 1, w: 6, h: 1 });
  slide.addText('Create a folder and save a document inside it.', { x: 1, y: 2, w: 7, h: 1 });
  const buffer = await deck.write({ outputType: 'nodebuffer' });
  const createdResponse = await page.request.post('/api/game/from-pptx', {
    multipart: {
      file: { name: 'files.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer },
      subject: 'ICT', topic: 'File skills', grade: 'Grade 3', questionCount: '4', mode: 'arcade',
      rosterIds: JSON.stringify([classA.id, classB.id]), cutoffAt: '',
    },
  });
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
  const created = await createdResponse.json();
  expect(created.rosterIds).toEqual([classA.id, classB.id]);
  const previewResult = await page.request.post(`/api/game/${created.gameId}/finish`, {data:{answers:[0,0,0,0],arcadeScore:9999,gameType:'car'}});
  expect((await previewResult.json()).preview).toBe(true);
  const unchangedResults=await (await page.request.get(`/api/game/${created.gameId}/results`)).json();
  expect(unchangedResults.results).toHaveLength(0);


  const initialJoin = await (await page.request.get(`/api/game/${created.gameId}/join`)).json();
  expect(initialJoin.hasRoster).toBe(true);
  expect(initialJoin.students).toHaveLength(2);
  const setupChallengeResponse = await page.request.post(`/api/game/${created.gameId}/enter`, {
    data: { handle: initialJoin.students[0].handle },
  });
  expect(setupChallengeResponse.status()).toBe(428);
  const setupChallenge = await setupChallengeResponse.json();
  expect(setupChallenge).toMatchObject({ needsPinSetup: true });
  expect(setupChallenge).not.toHaveProperty('name');
  expect(JSON.stringify(setupChallenge)).not.toContain(studentIds.classA);
  expect(JSON.stringify(setupChallenge)).not.toContain('Amina One');
  const firstEntry = await page.request.post(`/api/game/${created.gameId}/enter`, {
    data: { handle: initialJoin.students[0].handle, pin: '2468' },
  });
  expect(firstEntry.ok(), await firstEntry.text()).toBeTruthy();
  const pinChallengeResponse = await page.request.post(`/api/game/${created.gameId}/enter`, {
    data: { handle: initialJoin.students[0].handle },
  });
  expect(pinChallengeResponse.status()).toBe(428);
  const pinChallenge = await pinChallengeResponse.json();
  expect(pinChallenge).toMatchObject({ needsPin: true });
  expect(pinChallenge).not.toHaveProperty('name');
  expect(JSON.stringify(pinChallenge)).not.toContain(studentIds.classA);
  expect(JSON.stringify(pinChallenge)).not.toContain('Amina One');
  const resetFromHandle = await page.request.post(`/api/game/${created.gameId}/pin/reset-request`, {
    data: { handle: initialJoin.students[0].handle },
  });
  expect(resetFromHandle.ok(), await resetFromHandle.text()).toBeTruthy();

  await page.goto('/');
  await page.locator('#gamesBtn').click();
  const card = page.locator('.game-card').filter({ hasText: 'file skills' });
  await expect(card).toContainText('Grade 3A');
  await expect(card).toContainText('Grade 3B');
  const previewTabPromise=page.waitForEvent('popup');
  await card.getByRole('link',{name:'Test game',exact:true}).click();
  const previewTab=await previewTabPromise;
  await expect(previewTab.getByText('Teacher test — scores are not saved to learner records.')).toBeVisible();
  await previewTab.close();
  const results = card.locator(`#res-${created.gameId}`);
  await expect(results).toBeHidden();
  await card.getByRole('button', { name: 'View results' }).click();
  await expect(results).toBeVisible();
  await expect(results).toContainText('No students have played yet.');
  await card.getByRole('button', { name: 'Hide results' }).click();
  await expect(results).toBeHidden();
  await card.getByRole('button', { name: 'Manage classes' }).click();
  const picker = card.locator('.gc-class-row .class-picker');
  await picker.getByText('Grade 3A', { exact: false }).click();
  await picker.getByText('Grade 3C', { exact: false }).click();
  await card.getByRole('button', { name: 'Save classes' }).click();

  const visibleClasses = card.locator('.gc-meta');
  await expect(visibleClasses).toContainText('Grade 3B');
  await expect(visibleClasses).toContainText('Grade 3C');
  await expect(visibleClasses).not.toContainText('Grade 3A');
  const updatedJoin = await (await page.request.get(`/api/game/${created.gameId}/join`)).json();
  expect(updatedJoin.students).toHaveLength(2);
  const removedClassJoin = await page.request.post(`/api/game/${created.gameId}/enter`, {
    data: { studentId: studentIds.classA, pin: '2468' },
  });
  expect(removedClassJoin.status()).toBe(403);
  const addedClassJoin = await page.request.post(`/api/game/${created.gameId}/enter`, {
    data: { studentId: studentIds.classC, pin: '2468' },
  });
  expect(addedClassJoin.ok(), await addedClassJoin.text()).toBeTruthy();
  const gradebooks = await (await page.request.get('/api/gradebook')).json();
  expect(gradebooks.classes.find(item => item.rosterId === classA.id).games).toBe(0);
  expect(gradebooks.classes.find(item => item.rosterId === classB.id).games).toBe(1);
  expect(gradebooks.classes.find(item => item.rosterId === classC.id).games).toBe(1);
});
