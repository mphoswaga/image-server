const { test, expect } = require('@playwright/test');
const sharp = require('sharp');
const { expectNoPageOverflow } = require('./helpers');

const questions = [
  { question: 'What do plants need?', options: ['Sunlight', 'Plastic', 'Metal', 'Paint'] },
  { question: 'Which place is a habitat?', options: ['Forest', 'Pencil', 'Spoon', 'Book'] },
];
async function launch(page) {
  const submitted = [];
  await page.route('**/api/game/runner-test*', route => route.fulfill({ json: {
    lessonTitle: 'The living world', subject: 'Science', topic: 'Habitats', grade: 'Grade 3', summary: { overview: 'Plants and their habitats', concepts: [] },
  } }));
  await page.route('**/api/game/runner-test/play', route => route.fulfill({ json: { questions } }));
  await page.route('**/api/game/runner-test/answer', route => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ json: { correct: true, correctIndex: 0, explanation: 'Plants use sunlight to grow.' } });
  });
  await page.route('**/api/game/runner-test/finish', route => route.fulfill({ json: { score: 2, total: 2, highScores: {} } }));
  await page.goto('/play/runner-test');
  await page.locator('#startBtn').click();
  await page.locator('[data-game="runner"]').click();
  await expect(page.locator('#gameCanvas')).toHaveAttribute('data-runner-state', 'run');
  return submitted;
}

test('runner art, movement, touch, pause and recovery work together', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const submitted = await launch(page);
  const canvas = page.locator('#gameCanvas');
  await page.locator('#jumpBtn').click();
  await expect(canvas).toHaveAttribute('data-runner-action', 'jump');
  await expect(canvas).toHaveAttribute('data-runner-action', 'run');
  await page.locator('#duckBtn').click();
  await expect(canvas).toHaveAttribute('data-runner-action', 'slide');
  await expect(canvas).toHaveAttribute('data-runner-action', 'run');
  await page.locator('#runnerPauseBtn').click();
  await expect(canvas).toHaveAttribute('data-runner-state', 'paused');
  const controlsFit = await page.locator('#vertControls').evaluate(el => el.getBoundingClientRect().bottom <= window.innerHeight);
  expect(controlsFit, 'Jump and slide controls fit in the initial viewport').toBe(true);
  const distance = await page.locator('#runnerDistance').textContent();
  await page.waitForTimeout(200);
  await expect(page.locator('#runnerDistance')).toHaveText(distance);
  await page.locator('#runnerPauseBtn').click();
  await canvas.click({ position: { x: 35, y: 50 } });
  await expect(canvas).toHaveAttribute('data-runner-action', 'jump');
  await page.screenshot({ path: `/tmp/runner-${testInfo.project.name}.png` });
  const frame = await canvas.screenshot();
  const stats = await sharp(frame).stats();
  expect(stats.channels[0].stdev).toBeGreaterThan(25);
  await expect(page.locator('#qOverlay')).toBeVisible({ timeout: 12000 });
  await page.locator('#qOptions .opt').first().click();
  await expect(page.locator('#qFeedback')).toContainText('+1 life');
  await page.locator('#nextBtn').click();
  await expect(canvas).toHaveAttribute('data-runner-state', 'run');
  await expect(page.locator('#runnerChapter')).toHaveText('Waterfall steps');
  expect(submitted).toEqual([{ questionIndex: 0, choice: 0 }]);
  await page.locator('#runnerPauseBtn').click();
  await expectNoPageOverflow(page);
  await page.locator('#fsBtn').click();
  await expect(page.locator('#gameScreen')).toHaveClass(/immersive-view/);
  await expect(canvas).toHaveAttribute('data-runner-state', 'paused');
  await page.screenshot({ path: `/tmp/runner-immersive-${testInfo.project.name}.png` });
  await page.locator('#fsBtn').click();
  expect(errors).toEqual([]);
});

test('a question checkpoint awards points without changing hearts and finishes normally', async ({ page }) => {
  // Shorten only the checkpoint wait; the shipped 25-second threshold is covered by unit tests.
  await page.route('**/answer-runner.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('CHECKPOINT_TIME = 25', 'CHECKPOINT_TIME = 1') });
  });
  const submitted = await launch(page);
  const hearts = await page.locator('#hudLives').textContent();
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('#qOverlay')).toBeVisible();
    await expect(page.locator('#qOverlay .crash')).toContainText('Trail checkpoint');
    await page.locator('#qOptions .opt').first().click();
    await expect(page.locator('#qFeedback')).toContainText('+5 checkpoint bonus');
    await expect(page.locator('#hudLives')).toHaveText(hearts);
    await page.locator('#nextBtn').click();
  }
  await expect(page.locator('#resultScreen')).toBeVisible();
  expect(submitted).toHaveLength(2);
  await page.locator('#againBtn').click();
  await page.locator('[data-game="car"]').click();
  await expect(page.locator('#runnerJourney')).toBeHidden();
  await expect(page.locator('#gameScreen')).not.toHaveClass(/runner-game/);
});

test('runner remains playable when the art cannot load', async ({ page }) => {
  await page.route('**/assets/runner/**', route => route.abort());
  await launch(page);
  await page.locator('#jumpBtn').click();
  await expect(page.locator('#gameCanvas')).toHaveAttribute('data-runner-action', 'jump');
  const stats = await sharp(await page.locator('#gameCanvas').screenshot()).stats();
  expect(stats.channels[0].stdev).toBeGreaterThan(15);
});

test('keyboard and swipe inputs stay usable after a pause', async ({ page }) => {
  await launch(page);
  const canvas = page.locator('#gameCanvas');
  await page.keyboard.press('Space');
  await expect(canvas).toHaveAttribute('data-runner-action', 'jump');
  await expect(canvas).toHaveAttribute('data-runner-action', 'run');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 160);
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-runner-action', 'slide');
  await expect(canvas).toHaveAttribute('data-runner-action', 'run');
  await page.locator('#runnerPauseBtn').click();
  await page.locator('#runnerPauseBtn').click();
  await page.keyboard.press('ArrowUp');
  await expect(canvas).toHaveAttribute('data-runner-action', 'jump');
});
