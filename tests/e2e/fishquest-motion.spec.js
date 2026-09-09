const { test, expect } = require('@playwright/test');
const sharp = require('sharp');

test('a full ocean renders and moves smoothly between packets on desktop and mobile', async ({ page }, testInfo) => {
  test.skip(!['windows-100', 'mobile'].includes(testInfo.project.name));
  await page.route('**/api/game/motion-test', route => route.fulfill({ json: { lessonTitle: 'Ocean motion', hasRoster: false } }));
  await page.route('**/api/game/motion-test/fishquest/ticket', route => route.fulfill({ json: { token: 'test' } }));
  await page.addInitScript(() => {
    window.WebSocket = class {
      static OPEN = 1;
      constructor() { window.motionSocket = this; this.readyState = 1; this.bufferedAmount = 0; setTimeout(() => this.onopen?.(), 0); }
      send() {}
      close() {}
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/fishquest-play/motion-test');
  await expect.poll(() => page.evaluate(() => !!window.motionSocket)).toBeTruthy();
  await page.evaluate(() => {
    const Original = Phaser.Game;
    Phaser.Game = function(config) { window.motionGame = new Original(config); return window.motionGame; };
    window.motionState = { phase: 'running', matchId: 'motion', me: '0', now: Date.now(), endsAt: Date.now() + 600000,
      players: Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `Learner ${i + 1}`, x: 950 + i % 6 * 90, y: 650 + Math.floor(i / 6) * 85, mass: 100 + i * 9, score: 0, variant: i })),
      food: Array.from({ length: 70 }, (_, i) => [i, 700 + i % 10 * 85, 400 + Math.floor(i / 10) * 90]) };
    window.sendMotion = () => motionSocket.onmessage({ data: JSON.stringify({ type: 'state', state: { ...motionState, now: Date.now() } }) });
    sendMotion();
  });
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.motionGame?.scene.scenes[0]?.children.list.filter(o => o.type === 'Container').length)).toBe(30);
  const labelCounts = await page.evaluate(() => {
    const labels = window.motionGame.scene.scenes[0].children.list.filter(object => object.type === 'Text');
    return { visible: labels.filter(label => label.visible).length, own: labels.filter(label => label.visible && label.text === 'You').length };
  });
  expect(labelCounts.own).toBe(1);
  expect(labelCounts.visible).toBeLessThanOrEqual(7);
  const before = await canvas.screenshot();
  const stats = await sharp(before).stats();
  expect(stats.channels.some(channel => channel.stdev > 15)).toBeTruthy();
  await page.evaluate(() => {
    window.motionTick = setInterval(() => { motionState.players.forEach(p => p.x += 10); sendMotion(); }, 100);
  });
  await expect.poll(() => page.evaluate(() => motionGame.scene.scenes[0].children.list.find(o => o.type === 'Container').x)).toBeGreaterThan(1010);
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  await page.screenshot({ path: `/tmp/fishquest-motion-${testInfo.project.name}.png` });
  await page.evaluate(() => { clearInterval(motionTick); motionState.phase = 'paused'; sendMotion(); });
  await expect(page.locator('#teacherPause')).toBeVisible();
  expect(errors).toEqual([]);
});
