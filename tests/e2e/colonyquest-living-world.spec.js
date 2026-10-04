const { test, expect } = require('@playwright/test');

async function world(page, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.goto('/healthz');
  await page.setContent(
    '<style>body{margin:0;background:#24382e}canvas{display:block;width:100vw;height:100vh}</style><canvas id="world"></canvas>',
  );
  await page.addScriptTag({ url: '/colonyquest-core.js' });
  await page.addScriptTag({ url: '/colonyquest-live-art.js' });
  await page.evaluate(() => {
    const colony = ColonyQuestCore.createTeam({ name: 'Test colony' }, 0);
    Object.assign(colony, {
      workers: 4,
      food: 26,
      sticks: 8,
      leaves: 7,
      soldiers: 2,
      territory: 5,
      pantryBuilt: true,
      barracksBuilt: true,
      expansionRooms: 2,
      defense: 2,
      eggs: [{ roundsLeft: 1 }],
      forageProgress: [0.1, 0.43, 0.7, 0.96],
      forageTrips: [1, 2, 1, 2],
    });
    window.fixture = {
      id: 'living-world',
      phase: 'answer',
      round: 1,
      world: {},
      events: [],
      me: { id: 'a', colony, lastUpgrade: null },
    };
    window.scene = new ColonyScene(document.getElementById('world'));
    window.cues = [];
    document.getElementById('world').addEventListener('colony-action', (e) => cues.push(e.detail));
    scene.update(structuredClone(fixture));
  });
}

test('living underground has purposeful journeys, earned rooms and a frozen pause', async ({
  page,
}, info) => {
  test.skip(!['windows-100', 'mobile', 'desktop-safari'].includes(info.project.name));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await world(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-rooms', '5');
  await expect.poll(() => page.evaluate(() => scene.workers.some((a) => a.job === 'carrying'))).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        scene.workers.some((a) => a.y > scene.layout(innerWidth, innerHeight, fixture.me.colony).surface),
      ),
    )
    .toBe(true);
  const start = await page.evaluate(() => scene.workers[0].y);
  await expect.poll(() => page.evaluate(() => scene.workers[0].y)).not.toBe(start);
  await page.evaluate(() => {
    fixture.phase = 'paused';
    scene.update(structuredClone(fixture));
  });
  const clock = await page.evaluate(() => scene.clock);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => scene.clock)).toBe(clock);
  expect(await page.evaluate(() => fixture.me.colony.food)).toBe(26);
  await page.screenshot({ path: info.outputPath('living-underground.png') });
  await page.evaluate(() => {
    fixture.phase = 'answer';
    scene.update(structuredClone(fixture));
  });
  await expect.poll(() => page.evaluate(() => scene.clock)).toBeGreaterThan(clock);
  expect(errors).toEqual([]);
});

test('upgrade, hatch and raid scenes are one-time feedback and survive replayed snapshots', async ({
  page,
}, info) => {
  test.skip(!['windows-100', 'mobile', 'desktop-safari'].includes(info.project.name));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await world(page);
  await page.evaluate(() => {
    fixture.me.colony.territory++;
    fixture.me.colony.expansionRooms++;
    fixture.me.lastUpgrade = { round: 1, key: 'expansion' };
    scene.update(structuredClone(fixture));
    scene.update(structuredClone(fixture));
  });
  await expect(page.locator('canvas')).toHaveAttribute('data-action', 'expansion');
  expect(await page.evaluate(() => cues.filter((c) => c === 'Digging a new room!').length)).toBe(1);
  await expect(page.locator('canvas')).toHaveAttribute('data-rooms', '6');
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath('digging-new-room.png') });
  await page.evaluate(() => {
    fixture.me.colony.eggs = [];
    fixture.me.colony.workers++;
    fixture.me.lastUpgrade = { round: 2, key: 'defense' };
    fixture.me.colony.defense++;
    scene.update(structuredClone(fixture));
  });
  expect(await page.evaluate(() => cues)).toContain('A baby worker has hatched!');
  await page.evaluate(() => {
    fixture.me.lastUpgrade = { round: 3, key: 'raid', target: 'b' };
    fixture.events = [
      { id: 'raid-1', kind: 'raid', attacker: 'a', target: 'b', success: true, at: Date.now() },
    ];
    scene.update(structuredClone(fixture));
    scene.update(structuredClone(fixture));
  });
  await expect(page.locator('canvas')).toHaveAttribute('data-action', 'raid');
  expect(await page.evaluate(() => scene.effects.filter((e) => e.kind === 'raid').length)).toBe(1);
  for (const [progress, phase] of [
    [0.05, 'rally'],
    [0.3, 'approach'],
    [0.58, 'clash'],
    [0.8, 'return'],
  ]) {
    await page.evaluate((progress) => {
      fixture.phase = 'paused';
      scene.update(structuredClone(fixture));
      const raid = scene.effects.find((e) => e.kind === 'raid');
      scene.clock = raid.start + raid.duration * progress;
    }, progress);
    await expect(page.locator('canvas')).toHaveAttribute('data-raid-phase', phase);
    if (phase === 'clash') await page.screenshot({ path: info.outputPath('raid-in-motion.png') });
  }
  for (const [index, key] of ['food', 'supplies', 'soldiers', 'queen'].entries()) {
    await page.evaluate(
      ({ index, key }) => {
        fixture.phase = 'upgrade';
        ColonyQuestCore.applyReward(fixture.me.colony, key, [fixture.me.colony]);
        fixture.me.lastUpgrade = { round: 4 + index, key };
        scene.update(structuredClone(fixture));
      },
      { index, key },
    );
    await expect(page.locator('canvas')).toHaveAttribute('data-action', key);
    await page.waitForTimeout(150);
  }
  // Reloading a saved snapshot must not pretend the same upgrades were earned again.
  await page.evaluate(() => {
    scene.destroy();
    scene = new ColonyScene(document.querySelector('canvas'));
    cues = [];
    scene.update(structuredClone(fixture));
  });
  expect(await page.evaluate(() => scene.effects.length)).toBe(0);
  expect(await page.evaluate(() => cues.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('reduced motion keeps workers still while showing room and reward feedback', async ({ page }, info) => {
  test.skip(info.project.name !== 'windows-100');
  await world(page, true);
  await expect(page.locator('canvas')).toHaveAttribute('data-rooms', '5');
  const positions = await page.evaluate(() => scene.workers.map((a) => [a.x, a.y]));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => scene.workers.map((a) => [a.x, a.y]))).toEqual(positions);
  await page.evaluate(() => {
    window.invalidGeometry = [];
    const original = scene.ctx.roundRect.bind(scene.ctx);
    scene.ctx.roundRect = (...args) => {
      if (!args.slice(0, 4).every(Number.isFinite)) invalidGeometry.push(args.slice(0, 4));
      return original(...args);
    };
    fixture.me.lastUpgrade = { round: 2, key: 'food' };
    fixture.me.colony.food += 5;
    scene.update(structuredClone(fixture));
  });
  expect(await page.evaluate(() => cues)).toContain('Food delivery!');
  await expect(page.locator('canvas')).toHaveAttribute('data-action', 'food');
  expect(
    await page.evaluate(() => scene.effects.filter((e) => e.kind === 'income').map((e) => e.text)),
  ).toEqual(['+5 🌾']);
  await page.evaluate(() => scene.update(structuredClone(fixture)));
  expect(await page.evaluate(() => scene.effects.filter((e) => e.kind === 'income').length)).toBe(1);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => invalidGeometry)).toEqual([]);
});

test('every wall level grows the soil dome and survives a restored snapshot', async ({ page }, info) => {
  await world(page, true);
  const heights = [];
  for (let defense = 0; defense <= 4; defense++) {
    await page.evaluate((level) => {
      fixture.me.colony.defense = level;
      scene.update(structuredClone(fixture));
    }, defense);
    await expect(page.locator('canvas')).toHaveAttribute('data-wall-level', String(defense + 1));
    heights.push(Number(await page.locator('canvas').getAttribute('data-dome-height')));
    if ([0, 4].includes(defense)) await page.screenshot({ path: info.outputPath(`dome-${defense}.png`) });
  }
  for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
  await page.evaluate(() => scene.update(structuredClone(fixture)));
  await expect(page.locator('canvas')).toHaveAttribute('data-dome-height', String(heights[4]));
});
