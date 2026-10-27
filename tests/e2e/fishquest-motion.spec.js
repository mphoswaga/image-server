const { test, expect } = require('@playwright/test');
const sharp = require('sharp');

for(const solo of [false,true]) test(`a ${solo?'single-player':'class'} ocean renders and moves smoothly between packets`, async ({ page }, testInfo) => {
  test.skip(!['windows-100', 'mobile'].includes(testInfo.project.name));
  await page.route('**/api/game/motion-test', route => route.fulfill({ json: { lessonTitle: 'Ocean motion', hasRoster: false } }));
  await page.route('**/api/game/motion-test/fishquest/ticket', route => route.fulfill({ json: { token: 'test' } }));
  await page.addInitScript(() => {
    window.WebSocket = class {
      static OPEN = 1;
      constructor() { window.motionSocket = this; this.readyState = 1; this.bufferedAmount = 0; setTimeout(() => this.onopen?.(), 0); }
      send(data) { (window.sentMovement ||= []).push(JSON.parse(data)); }
      close() {}
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/fishquest-play/motion-test');
  await expect.poll(() => page.evaluate(() => !!window.motionSocket)).toBeTruthy();
  await page.evaluate((solo) => {
    const Original = Phaser.Game;
    Phaser.Game = function(config) { window.motionGame = new Original(config); return window.motionGame; };
    window.motionState = { solo, phase: 'running', matchId: 'motion', me: '0', now: Date.now(), endsAt: Date.now() + 600000,
      players: Array.from({ length: solo?9:30 }, (_, i) => ({ npc:solo&&i>0, id: String(i), name: `Learner ${i + 1}`, x: 950 + i % 6 * 90, y: 650 + Math.floor(i / 6) * 85, mass: 100 + i * 9, score: 0, variant: i })),
      food: Array.from({ length: 871 }, (_, i) => i<70?[i, 700 + i % 10 * 85, 400 + Math.floor(i / 10) * 90]:[i, 100+i%32*65,100+Math.floor(i/32)*50]) };
    window.sendMotion = () => motionSocket.onmessage({ data: JSON.stringify({ type: 'state', state: { ...motionState, now: Date.now() } }) });
    sendMotion();
  },solo);
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.motionGame?.scene.scenes[0]?.children.list.filter(o => o.type === 'Container').length)).toBe(solo?9:30);
  await page.keyboard.down('ArrowRight');
  await expect.poll(()=>page.evaluate(()=>window.sentMovement?.some(m=>m.type==='input'&&m.x===1))).toBeTruthy();
  await page.keyboard.up('ArrowRight');
  await expect.poll(()=>page.evaluate(()=>window.sentMovement?.filter(m=>m.type==='input').at(-1)?.x)).toBe(0);
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
  await page.evaluate(() => { clearInterval(motionTick); motionState.world={width:4200,height:2800};motionState.players[0].mass=850;motionState.players[0].biteAt=Date.now();sendMotion(); });
  await expect(page.locator('#fishForm')).toHaveText('whale');
  await expect.poll(() => page.evaluate(() => motionGame.scene.scenes[0].cameras.main.getBounds().width)).toBe(4200);
  await expect.poll(() => page.evaluate(() => motionGame.scene.scenes[0].children.list.find(o=>o.type==='Container').scaleY)).toBeLessThan(1.9);
  await page.evaluate(() => { motionState.players[0].mass=700;sendMotion(); });
  await expect(page.locator('#fishForm')).toHaveText('orca');
  const encounter=await page.evaluate(() => {
    const fish=motionGame.scene.scenes[0].children.list.find(o=>o.type==='Container'&&o.depth===19);
    const before=fish.x;
    const leader=document.querySelector('#oceanLeaders span');
    motionState.players[0].x=before+45;motionState.players[0].locked=true;
    motionState.players.forEach(p=>p.score+=1);
    sendMotion();
    return {snap:Math.abs(fish.x-before),sameLeaderNode:leader===document.querySelector('#oceanLeaders span'),target:before+45};
  });
  expect(encounter.snap).toBeLessThan(1);
  expect(encounter.sameLeaderNode).toBe(true);
  await expect.poll(()=>page.evaluate(()=>motionGame.scene.scenes[0].children.list.find(o=>o.type==='Container'&&o.depth===19).x)).toBeGreaterThan(encounter.target-3);
  await page.evaluate(() => {
    motionState.question={id:'whale-question',kind:'whale',prompt:'Which device shows pictures?',options:['Monitor','Keyboard'],canAnswer:true,expiresAt:Date.now()+30000};
    motionState.players[0].mass=800;motionState.players[0].challengeWins=2;
    sendMotion();
  });
  await expect(page.locator('#qrole')).toHaveText('Whale challenge · both can win');
  await expect(page.locator('#rivalry')).toBeHidden();
  await expect(page.getByRole('button',{name:'Monitor',exact:true})).toBeEnabled();
  await page.screenshot({path:`/tmp/fishquest-whale-${testInfo.project.name}.png`});
  await page.evaluate(() => {
    const {food,...next}=motionState;motionState=next;
    motionState.question={...motionState.question,id:'pearl-question',kind:'pearl'};
    motionState.foodDelta={remove:[0],upsert:[[1,900,700]]};sendMotion();
  });
  await expect(page.locator('#qrole')).toContainText('Pearl challenge');
  const deltaFood=await page.evaluate(()=>motionGame.scene.scenes[0].children.list.filter(o=>o.texture?.key?.startsWith('plankton-')).map(o=>({x:o.foodX,y:o.foodY,visible:o.visible})));
  expect(deltaFood.some(f=>f.x===900&&f.y===700&&f.visible)).toBe(true);
  expect(deltaFood.some(f=>f.x===700&&f.y===400&&!f.visible)).toBe(true);
  await page.evaluate(() => { clearInterval(motionTick); motionState.phase = 'paused'; sendMotion(); });
  await expect(page.locator('#teacherPause')).toBeVisible();
  expect(errors).toEqual([]);
});
