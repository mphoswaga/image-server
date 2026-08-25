const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../public/practice-scoring');

test('practice scoring rewards accuracy and efficient active time', () => {
  const precise = scoring.summarize({ baseScore: 1000, correctInputs: 40, mistakes: 0, activeSeconds: 40, targetSeconds: 60 });
  const inaccurate = scoring.summarize({ baseScore: 1000, correctInputs: 30, mistakes: 10, activeSeconds: 40, targetSeconds: 60 });
  const slow = scoring.summarize({ baseScore: 1000, correctInputs: 40, mistakes: 0, activeSeconds: 120, targetSeconds: 60 });
  assert.equal(precise.score, 1000);
  assert.equal(precise.accuracyPercent, 100);
  assert.ok(inaccurate.score < precise.score);
  assert.ok(slow.score < precise.score);
});

test('young learners keep a forgiving score floor while mistakes still matter', () => {
  const result = scoring.summarize({ baseScore: 1000, correctInputs: 10, mistakes: 30, activeSeconds: 1000, targetSeconds: 60 });
  assert.ok(result.score >= 500);
  assert.equal(result.accuracyPercent, 25);
  assert.equal(result.mistakes, 30);
});

test('campaign maximums and target times come from the shared mission catalogue', () => {
  const steps = [{ id:'move-pointer' }, { id:'word-blaster' }];
  assert.equal(scoring.maximumBaseScore(steps), scoring.scoreForGoal(8) + scoring.scoreForGoal(7));
  assert.equal(scoring.targetSecondsForSteps(steps), 125);
});
