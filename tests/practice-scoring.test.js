const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../public/practice-scoring');

test('practice scoring rewards accuracy and efficient active time', () => {
  const precise = scoring.summarize({ baseScore: 1000, correctInputs: 40, mistakes: 0, activeSeconds: 40, targetSeconds: 60 });
  const onTime = scoring.summarize({ baseScore: 1000, correctInputs: 40, mistakes: 0, activeSeconds: 60, targetSeconds: 60 });
  const inaccurate = scoring.summarize({ baseScore: 1000, correctInputs: 30, mistakes: 10, activeSeconds: 40, targetSeconds: 60 });
  const slow = scoring.summarize({ baseScore: 1000, correctInputs: 40, mistakes: 0, activeSeconds: 120, targetSeconds: 60 });
  const verySlow = scoring.summarize({ baseScore: 1000, correctInputs: 40, mistakes: 0, activeSeconds: 600, targetSeconds: 60 });
  assert.equal(precise.score, onTime.score);
  assert.ok(onTime.score > slow.score);
  assert.ok(slow.score > verySlow.score);
  assert.equal(precise.accuracyPercent, 100);
  assert.equal(precise.accuracyMultiplierPercent, 100);
  assert.equal(precise.paceMultiplierPercent, 100);
  assert.equal(slow.paceMultiplierPercent, 64);
  assert.ok(inaccurate.score < precise.score);
  assert.equal(inaccurate.accuracyPointsLost + inaccurate.pacePointsLost + inaccurate.score, inaccurate.baseScore);
});

test('young learners keep a forgiving score floor while mistakes still matter', () => {
  const result = scoring.summarize({ baseScore: 1000, correctInputs: 10, mistakes: 30, activeSeconds: 1000, targetSeconds: 60 });
  assert.ok(result.score >= 300);
  assert.equal(result.accuracyPercent, 25);
  assert.equal(result.mistakes, 30);
});

test('campaign maximums and target times come from the shared mission catalogue', () => {
  const steps = [{ id:'move-pointer' }, { id:'word-blaster' }];
  assert.equal(scoring.maximumBaseScore(steps), scoring.scoreForGoal(8) + scoring.scoreForGoal(7));
  assert.equal(scoring.targetSecondsForSteps(steps), 125);
});

test('leaderboard ranking is deterministic and gives exact ties the same place', () => {
  const ranked = scoring.rankLeaderboard([
    { name:'Zola', totalMissionsCompleted:4, score:500, accuracyPercent:90, mistakes:1, activeSeconds:50 },
    { name:'Ama', totalMissionsCompleted:4, score:500, accuracyPercent:90, mistakes:1, activeSeconds:50 },
    { name:'Kai', totalMissionsCompleted:4, score:490, accuracyPercent:100, mistakes:0, activeSeconds:30 },
  ]);
  assert.deepEqual(ranked.map((entry) => entry.name), ['Ama', 'Zola', 'Kai']);
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 1, 3]);
});

test('typing summaries calculate real WPM and rank weak keys by mistakes', () => {
  const summary = scoring.summarizeTyping({
    typedCharacters: 50,
    typingSeconds: 60,
    keyStats: {
      a: { correct: 8, mistakes: 2, confusions: { s: 2 } },
      f: { correct: 2, mistakes: 4, confusions: { d: 3, g: 1 } },
      j: { correct: 12, mistakes: 0 },
    },
  });
  assert.equal(summary.wpm, 10);
  assert.equal(summary.typedCharacters, 50);
  assert.deepEqual(summary.problemKeys.map((item) => item.key), ['f', 'a']);
  assert.equal(summary.problemKeys[0].accuracyPercent, 33);
  assert.deepEqual(summary.problemKeys[0].confusedWith, [
    { key: 'd', count: 3 },
    { key: 'g', count: 1 },
  ]);
});

test('typing checkpoint summaries aggregate safely and bound untrusted key data', () => {
  const unsafe = JSON.parse('{"__proto__":{"correct":99,"mistakes":99},"a":{"correct":4,"mistakes":1,"confusions":{"s":1}},"toString":{"correct":1,"mistakes":1,"confusions":{"valueOf":1}},"constructor":{"correct":99,"mistakes":99}}');
  const normalized = scoring.normalizeKeyStats(unsafe);
  assert.deepEqual(Object.keys(normalized), ['a', 'toString']);

  const summary = scoring.typingSummaryFromCheckpoints([
    { typedCharacters: 10, typingSeconds: 12, keyStats: normalized },
    { typedCharacters: 15, typingSeconds: 18, keyStats: { a:{ correct:5, mistakes:1, confusions:{ s:1 } } } },
  ]);
  assert.equal(summary.typedCharacters, 25);
  assert.equal(summary.typingSeconds, 30);
  assert.equal(summary.wpm, 10);
  assert.deepEqual(summary.keyStats.a, { correct: 9, mistakes: 2, confusions: { s: 2 } });
  assert.deepEqual(summary.keyStats.toString, { correct: 1, mistakes: 1, confusions: { valueOf: 1 } });
});
