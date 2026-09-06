const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../public/answer-runner');

function advance(s, duration, input = {}) {
  const events = [];
  for (let i = 0; i < Math.round(duration * 60); i++) events.push(...runner.step(s, 1 / 60, i === 0 ? input : {}, () => .5));
  return events;
}
function emptyTrail() { const s = runner.createState(360, 480); s.spawnIn = s.coinIn = 100; s.invulnerable = 0; return s; }
function obstacle(s, kind) { return { x: s.playerX + 10, kind, width: kind === 'branch' ? 68 : 34, height: 34 }; }

test('runner jumps have a smooth arc and buffered input starts at landing', () => {
  const s = emptyTrail();
  advance(s, .35, { jump: true });
  assert.ok(s.lift > 75 && s.lift < 82);
  advance(s, .3);
  advance(s, .15, { jump: true });
  assert.ok(s.lift > 0 && s.velocity > 0, 'jump pressed shortly before landing is remembered');
  advance(s, .8);
  assert.equal(s.lift, 0);
  assert.equal(s.velocity, 0);
});

test('a jump must actually clear the stone, and slides fit under branches', () => {
  const tooLate = emptyTrail(); tooLate.obstacles.push(obstacle(tooLate, 'rock'));
  assert.ok(runner.step(tooLate, 1 / 60, { jump: true }).some(e => e.type === 'crash'));
  assert.equal(tooLate.state, 'question');
  const jumped = emptyTrail(); advance(jumped, .25, { jump: true }); jumped.obstacles.push(obstacle(jumped, 'rock'));
  assert.ok(!runner.step(jumped, 1 / 60).some(e => e.type === 'crash'));
  const slid = emptyTrail(); slid.obstacles.push(obstacle(slid, 'branch'));
  assert.ok(!runner.step(slid, 1 / 60, { slide: true }).some(e => e.type === 'crash'));
  const stood = emptyTrail(); stood.obstacles.push(obstacle(stood, 'branch'));
  assert.ok(runner.step(stood, 1 / 60).some(e => e.type === 'crash'));
});

test('pause and question states do not advance distance or consume gameplay time', () => {
  for (const state of ['paused', 'question']) {
    const s = emptyTrail(); s.state = state;
    const before = JSON.stringify(s);
    advance(s, 5, { jump: true });
    assert.equal(JSON.stringify(s), before);
  }
});

test('safe resumption clears hazards and buffered inputs without erasing collected points', () => {
  const s = emptyTrail(); s.collected = 12; s.distance = 1000; s.state = 'question';
  s.obstacles.push(obstacle(s, 'rock')); s.jumpBuffer = .1;
  runner.resume(s);
  assert.equal(s.obstacles.length, 0);
  assert.equal(s.jumpBuffer, 0);
  assert.equal(s.collected, 12);
  assert.equal(s.distance, 1000);
  assert.ok(s.invulnerable >= 1.5 && s.spawnIn >= 1.8);
});

test('skilled runners reach one question checkpoint without losing a life', () => {
  const s = emptyTrail();
  const events = advance(s, 26);
  assert.equal(events.filter(e => e.type === 'checkpoint').length, 1);
  assert.equal(events.filter(e => e.type === 'crash').length, 0);
  assert.equal(s.state, 'question');
});

test('coin streak bonuses occur once and missed coins reset the streak', () => {
  const s = emptyTrail();
  for (let i = 0; i < 5; i++) {
    s.coins.push({ x: s.playerX + 2, y: s.ground - 37 });
    const events = runner.step(s, 1 / 60);
    assert.equal(events.find(e => e.type === 'coin').amount, i === 4 ? 3 : 1);
  }
  assert.equal(s.collected, 5);
  assert.equal(s.coins.length, 0);
  s.coins.push({ x: s.playerX - 30, y: s.ground - 100 }); runner.step(s, 1 / 60);
  assert.equal(s.streak, 0);
});

test('long runs have bounded speed and obstacle spacing at every viewport', () => {
  for (const width of [360, 800]) {
    const s = runner.createState(width, 480);
    let previousSpawn = null;
    for (let i = 0; i < 180 * 60; i++) {
      if (s.state === 'question') runner.resume(s);
      s.invulnerable = 10;
      const count = s.spawned;
      runner.step(s, 1 / 60, {}, () => .1);
      if (s.spawned > count) {
        if (previousSpawn !== null) assert.ok(s.elapsed - previousSpawn >= 1.44);
        previousSpawn = s.elapsed;
      }
      assert.ok(s.obstacles.length <= 5);
      assert.ok(s.coins.length < 40);
      assert.ok(runner.speed(s) <= 352);
    }
  }
});

test('invalid or stalled frame durations cannot fling the player through the world', () => {
  const s = emptyTrail();
  for (const dt of [NaN, Infinity, -1]) runner.step(s, dt);
  assert.equal(s.distance, 0);
  runner.step(s, 500);
  assert.ok(s.distance < 12);
});
