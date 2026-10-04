const test = require('node:test');
const assert = require('node:assert/strict');
const { ColonyMatch } = require('../colonyquest-multiplayer');
const story = require('../colonyquest-story');
const core = require('../public/colonyquest-core');
const game = {
  id: 'story',
  lessonTitle: 'Moonroot',
  questions: Array.from({ length: 12 }, (_, i) => ({
    question: 'Q' + i,
    options: ['Yes', 'No'],
    correctIndex: 0,
  })),
};
function create(total = 12) {
  const g = { ...game, questions: game.questions.slice(0, total) };
  const m = new ColonyMatch(g, { now: 0 });
  m.join({ studentId: 'a', name: 'A' }, 0);
  m.join({ studentId: 'b', name: 'B' }, 0);
  return m;
}
function finishScenes(m) {
  let count = 0;
  while (m.state.phase === 'story') {
    m.tick(m.state.deadline);
    assert.ok(++count < 20);
  }
}
function round(m) {
  const start = m.state.phaseStartedAt;
  for (const p of m.active()) m.answer(p.id, m.state.round, 0, start + 1);
  m.tick(start + 4000);
  for (const p of m.active()) m.upgrade(p.id, m.state.round, 'supplies', null, start + 4001);
  m.tick(start + 8000);
  m.tick(start + 12000);
  finishScenes(m);
}
test('a full adventure runs every main-game encounter and ends after all questions', () => {
  const m = create();
  m.start(0);
  assert.equal(m.state.phase, 'story');
  assert.equal(m.state.story.key, 'intro');
  assert.throws(() => m.answer(m.active()[0].id, 0, 0, 100), /closed/);
  finishScenes(m);
  for (let i = 0; i < 12; i++) {
    assert.equal(m.state.round, i);
    assert.equal(m.state.phase, 'answer');
    round(m);
  }
  assert.equal(m.state.phase, 'ended');
  for (const key of Object.keys(story.beats)) assert.ok(m.state.storySeen.includes(key), key);
  assert.equal(new Set(m.state.storySeen).size, m.state.storySeen.length);
  assert.ok(m.active().every((p) => p.answers.length === 12 && p.answers.every((a) => a.correct)));
  assert.equal(m.report().learners[0].correct, 12);
  assert.equal(m.state.world.birdsOccurred, true);
  assert.equal(m.state.world.stompOccurred, true);
});
test('story scenes pause, restore and resume without a second reward or skipped question', () => {
  const m = create();
  m.start(0);
  finishScenes(m);
  m.state.storyQueue = [];
  m.state.afterStory = 'answer';
  const before = m.active()[0].colony.food;
  m.beginStory('fallen-fruit', 6000);
  const food = m.active()[0].colony.food;
  assert.ok(food > before);
  m.pause(7000);
  const frozen = m.snapshot(m.active()[0].id, false, 50000);
  assert.equal(frozen.story.elapsed, 1000);
  const restored = new ColonyMatch(game, { state: structuredClone(m.state) });
  restored.restore(60000);
  assert.equal(restored.state.phase, 'paused');
  restored.resume(60000);
  restored.tick(61000);
  assert.equal(restored.active()[0].colony.food, food);
  assert.equal(restored.state.phase, 'story');
  finishScenes(restored);
  assert.equal(restored.state.phase, 'answer');
  assert.equal(restored.state.round, 0);
  assert.equal(restored.state.storySeen.filter((k) => k === 'fallen-fruit').length, 1);
});
test('protection and final penalties use the board rules without changing learning marks', () => {
  const m = create(),
    [a, b] = m.active();
  for (const p of m.active()) {
    p.colony.food = 100;
    p.colony.workers = 4;
    p.colony.attempts = 2;
    p.colony.correct = 2;
  }
  a.colony.defense = 3;
  b.colony.defense = 0;
  const rain = story.apply(m, 'rain');
  assert.equal(a.colony.food, 100);
  assert.equal(b.colony.food, 85);
  assert.equal(rain[1].food, -15);
  story.apply(m, 'birds');
  assert.equal(a.colony.food, 100);
  assert.equal(b.colony.food, 51);
  const score = core.colonyStrength(b.colony);
  story.apply(m, 'footsteps');
  assert.equal(core.colonyStrength(b.colony), Math.round(score * 0.75));
  assert.equal(a.colony.collapsePenalty, 0);
  assert.equal(b.colony.correct, 2);
  const once = b.colony.collapsePenalty;
  story.apply(m, 'footsteps');
  assert.equal(b.colony.collapsePenalty, once);
});
test('learner snapshots contain their own story outcome and no question answers during scenes', () => {
  const m = create();
  m.start(0);
  const [a, b] = m.active();
  m.beginStory('fallen-fruit', 1);
  const view = m.snapshot(a.id, false, 2);
  assert.equal(view.story.results.length, 1);
  assert.equal(view.story.results[0].playerId, a.id);
  assert.ok(view.events.every((e) => !e.results || e.results.every((r) => r.playerId === a.id)));
  assert.equal(view.question.correctIndex, undefined);
  assert.equal(m.snapshot(null, true, 2).story.results.length, 2);
  m.beginStory('acorn', 3);
  assert.ok(m.snapshot(a.id, false, 3).story.winners.length);
});
test('short adventures have fewer optional encounters but keep the finale; legacy saves keep their flow', () => {
  const schedule = story.schedule(2);
  assert.ok(Object.values(schedule).flat().length < 12);
  assert.deepEqual(schedule[2].slice(-2), ['footsteps', 'acorn']);
  const m = create(2);
  delete m.state.storyVersion;
  delete m.state.storySeen;
  delete m.state.storyQueue;
  m.start(0);
  assert.equal(m.state.phase, 'answer');
});
