const test = require('node:test');
const assert = require('node:assert/strict');
const { ColonyMatch } = require('../colonyquest-multiplayer');
const core = require('../public/colonyquest-core');
const game = {
  id: 'game',
  lessonTitle: 'Habitats',
  questions: Array.from({ length: 10 }, (_, i) => ({
    question: 'Question ' + i,
    options: ['Yes', 'No'],
    correctIndex: 0,
    explanation: 'Yes is right.',
  })),
};
function room(n = 2) {
  const m = new ColonyMatch(game, { now: 0 });
  for (let i = 0; i < n; i++) m.join({ studentId: 's' + i, name: 'Learner ' + i }, 0);
  m.start(0);
  return m;
}
function next(m, answer = 0) {
  let now = m.state.phaseStartedAt;
  for (const p of m.active()) m.answer(p.id, m.state.round, answer, now + 100);
  m.tick(now + 4000);
  assert.equal(m.state.phase, 'upgrade');
  m.tick(now + 16000);
  assert.equal(m.state.phase, 'reveal');
  m.tick(now + 20000);
}
test('30 individual colonies use simultaneous questions without the six-team board limit', () => {
  const m = room(30);
  assert.equal(m.active().length, 30);
  const p = m.active()[0];
  assert.equal(m.snapshot(p.id).question.correctIndex, undefined);
  assert.equal(m.snapshot(p.id).me.correct, undefined);
  for (const p of m.active()) m.answer(p.id, 0, 0, 100);
  m.tick(3999);
  assert.equal(m.state.phase, 'answer');
  m.tick(4000);
  assert.equal(m.state.phase, 'upgrade');
  assert.equal(m.snapshot(p.id).question.correctIndex, 0);
  assert.equal(m.snapshot(p.id).me.correct, true);
  for (const p of m.active()) m.upgrade(p.id, 0, 'workers', null, 4100);
  assert.ok(m.active().every((p) => p.colony.workers === 2));
  m.tick(8000);
  m.tick(12000);
  assert.equal(m.state.round, 1);
  assert.equal(m.state.phase, 'answer');
});
test('answers and upgrades are idempotent and reject stale or forged input', () => {
  const m = room(),
    p = m.active()[0];
  m.answer(p.id, 0, 0, 10);
  m.answer(p.id, 0, 1, 20);
  assert.equal(p.answers.length, 1);
  assert.equal(p.answers[0].choice, 0);
  assert.throws(() => m.answer(p.id, 1, 0, 30), /finished/);
  assert.throws(() => m.answer(m.active()[1].id, 0, NaN, 30), /Choose/);
  assert.throws(() => m.upgrade(p.id, 0, 'workers', null, 100), /closed/);
  m.tick(25000);
  m.upgrade(p.id, 0, 'workers', null, 25001);
  m.upgrade(p.id, 0, 'workers', null, 25002);
  assert.equal(p.colony.workers, 2);
  assert.throws(() => m.upgrade(m.active()[1].id, 0, 'workers', null, 25003), /correctly/);
});
test('missing answers stay missing, incorrect answers earn no upgrade, timers advance automatically', () => {
  const m = room(),
    p = m.active()[0];
  m.answer(p.id, 0, 1, 10);
  m.tick(25000);
  assert.equal(m.state.phase, 'upgrade');
  assert.equal(m.active()[1].answers.length, 0);
  m.tick(29000);
  assert.equal(m.state.phase, 'reveal');
  m.tick(33000);
  assert.equal(m.state.round, 1);
  assert.equal(p.colony.upgrades, 0);
  const r = m.report();
  assert.equal(r.questions[0].answered, 1);
  assert.equal(r.questions[0].correct, 0);
});
test('correct learner receives food automatically if no upgrade chosen', () => {
  const m = room(),
    p = m.active()[0];
  m.answer(p.id, 0, 0, 10);
  m.tick(25000);
  m.tick(37000);
  assert.equal(p.upgrades[0].key, 'food');
  assert.equal(p.colony.upgrades, 1);
});
test('raids cap theft, leave reserves, protect recovering targets and cannot raid self', () => {
  const m = room(3),
    [a, b, c] = m.active();
  a.colony.soldiers = 3;
  c.colony.soldiers = 3;
  b.colony.food = 9;
  for (const p of m.active()) m.answer(p.id, 0, 0, 10);
  m.tick(4000);
  assert.throws(() => m.upgrade(a.id, 0, 'raid', a.id, 4100), /rival/);
  m.upgrade(a.id, 0, 'raid', b.id, 4200);
  assert.equal(b.colony.food, 4);
  assert.equal(m.state.events.at(-1).stolen, 5);
  assert.throws(() => m.upgrade(c.id, 0, 'raid', b.id, 4300), /recovering/);
  assert.ok(a.colony.raidAway > 0);
  assert.equal(m.raidAllowed(a, b).allowed, false);
});
test('walls and rooms require collected materials', () => {
  const m = room(),
    p = m.active()[0];
  m.answer(p.id, 0, 0, 10);
  m.tick(25000);
  assert.throws(() => m.upgrade(p.id, 0, 'expansion', null, 25100), /Need/);
  p.colony.sticks = 3;
  p.colony.leaves = 2;
  m.upgrade(p.id, 0, 'expansion', null, 25100);
  assert.equal(p.colony.territory, 2);
  assert.equal(p.colony.sticks, 0);
});
test('dry season and rain are shared and never remove a learner', () => {
  const m = room();
  for (let i = 0; i < 3; i++) next(m);
  assert.equal(m.state.world.dryOccurred, true);
  assert.equal(m.state.world.rainOccurred, false);
  for (let i = 0; i < 4; i++) next(m);
  assert.equal(m.state.world.rainOccurred, true);
  assert.equal(m.active().length, 2);
  while (m.state.phase !== 'ended') next(m);
  assert.equal(m.report().learners[0].correct, 10);
  assert.equal(m.report().questions.length, 10);
});
test('pause and reload preserve deadlines, resources and answers; reconnect does not duplicate colonies', () => {
  const m = room(),
    p = m.active()[0];
  m.answer(p.id, 0, 0, 100);
  m.tick(2000);
  m.pause(6000);
  const food = p.colony.food;
  m.tick(900000);
  assert.equal(p.colony.food, food);
  m.resume(900000);
  assert.equal(m.state.deadline, 919000);
  m.tick(901000);
  const restored = new ColonyMatch(game, { state: structuredClone(m.state) });
  restored.restore(990000);
  assert.equal(restored.state.phase, 'paused');
  assert.equal(restored.state.remaining, 18000);
  const joined = restored.join({ studentId: p.studentId, name: p.name }, 990000);
  assert.equal(joined.id, p.id);
  assert.equal(restored.active().length, 2);
  assert.equal(joined.answers.length, 1);
  assert.throws(() => restored.join({ studentId: 'new', name: 'Late' }), /started/);
});
test('preview computer colonies answer automatically; snapshot never gives other learner choices', () => {
  const m = new ColonyMatch(game, { preview: true, now: 0 }),
    p = m.join({ studentId: 'teacher', name: 'Teacher' }, 0);
  m.join({ studentId: 'npc', name: 'Fern', npc: true }, 0);
  m.start(0);
  m.tick(9000);
  assert.equal(m.active()[1].answers.length, 1);
  const view = m.snapshot(p.id);
  assert.ok(view.players.every((p) => !('answers' in p)));
  assert.equal(m.report().learners.length, 1);
});
test('colony score and learning marks remain separate', () => {
  const m = room(),
    p = m.active()[0];
  m.answer(p.id, 0, 1, 10);
  core.applyReward(p.colony, 'workers', m.teams());
  const r = m.report();
  assert.equal(r.learners[0].correct, 0);
  assert.ok(r.learners[0].strength > 0);
});

test('raid cooldown survives a busy classroom event history and reload', () => {
  const m = room(3),
    [a, b] = m.active();
  a.colony.soldiers = 3;
  b.colony.food = 20;
  for (const p of m.active()) m.answer(p.id, 0, 0, 10);
  m.tick(4000);
  m.upgrade(a.id, 0, 'raid', b.id, 4200);
  for (let i = 0; i < 100; i++) m.event('Another colony event');
  const restored = new ColonyMatch(game, { state: structuredClone(m.state) });
  restored.state.round = 2;
  restored.active()[0].colony.raidAway = 0;
  restored.active()[0].colony.raidReturnMs = 0;
  assert.match(restored.raidAllowed(restored.active()[0], restored.active()[1]).reason, /three rounds/);
});

test('visual feedback exposes only the learner upgrade and retains their raid amid rival activity', () => {
  const m = room(3),
    [a, b, c] = m.active();
  a.upgrades.push({ round: 0, key: 'workers', target: null });
  m.event('Own raid', { kind: 'raid', attacker: a.id, target: b.id, success: true });
  for (let i = 0; i < 8; i++) m.event('Other raid', { kind: 'raid', attacker: b.id, target: c.id });
  assert.deepEqual(m.snapshot(a.id).me.lastUpgrade, { round: 0, key: 'workers', target: null });
  assert.equal(m.snapshot(b.id).me.lastUpgrade, null);
  assert.equal(m.snapshot(a.id).events.length, 1);
  assert.equal(m.snapshot(a.id).events[0].text, 'Own raid');
  assert.equal(m.snapshot(null, true).events.length, 4);
  assert.equal(m.snapshot(a.id).question.correctIndex, undefined);
});
