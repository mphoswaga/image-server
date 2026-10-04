const { test, expect } = require('@playwright/test');
const { beats } = require('../../colonyquest-story');

test('all automatic story scenes render, pause and resume without changing resources', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/healthz');
  await page.setContent(
    '<style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas id="world"></canvas>',
  );
  await page.addScriptTag({ url: '/colonyquest-core.js' });
  await page.addScriptTag({ url: '/colonyquest-live-story.js' });
  await page.addScriptTag({ url: '/colonyquest-live-art.js' });
  await page.evaluate(() => {
    const colony = ColonyQuestCore.createTeam({ name: 'Story colony' }, 0);
    Object.assign(colony, {
      workers: 4,
      food: 30,
      sticks: 12,
      leaves: 12,
      soldiers: 2,
      territory: 3,
      defense: 2,
      pantryBuilt: true,
    });
    window.fixture = {
      id: 'story-world',
      phase: 'story',
      round: 3,
      world: {},
      events: [],
      me: { id: 'a', colony },
    };
    window.scene = new ColonyScene(document.getElementById('world'));
  });
  for (const [key, beat] of Object.entries(beats)) {
    await page.evaluate(
      ({ key, beat }) => {
        fixture.story = {
          ...beat,
          key,
          id: key,
          duration: beat.seconds * 1000,
          elapsed: beat.seconds * 500,
          results: [{ playerId: 'a', food: -3, pointsLost: 5 }],
        };
        scene.update(structuredClone(fixture));
      },
      { key, beat },
    );
    await expect(page.locator('canvas')).toHaveAttribute('data-story', key);
    await page.waitForTimeout(100);
    if (key === 'predator') await expect(page.locator('canvas')).toHaveAttribute('data-spider-artwork', 'ready');
    if (key === 'birds') await expect(page.locator('canvas')).toHaveAttribute('data-bird-artwork', 'ready');
    if (['predator', 'birds', 'footsteps', 'acorn'].includes(key))
      await page.screenshot({ path: info.outputPath(key + '.png') });
  }
  await page.evaluate(() => {
    fixture.phase = 'paused';
    scene.update(structuredClone(fixture));
  });
  const clock = await page.evaluate(() => scene.clock);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => scene.clock)).toBe(clock);
  await page.evaluate(() => {
    fixture.phase = 'story';
    scene.update(structuredClone(fixture));
  });
  await expect.poll(() => page.evaluate(() => scene.clock)).toBeGreaterThan(clock);
  expect(await page.evaluate(() => fixture.me.colony.food)).toBe(30);
  expect(errors).toEqual([]);
});
