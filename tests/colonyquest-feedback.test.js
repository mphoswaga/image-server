const test = require('node:test');
const assert = require('node:assert/strict');
const { overtakeEvidence, survivalEvidence } = require('../public/colonyquest-core');
test('overtakes require a real change from behind to ahead without changing scores', () => {
  const before = [{ id: 'a', strength: 10 }, { id: 'b', name: 'Blue', strength: 20 }];
  const after = [{ id: 'a', strength: 21 }, before[1]];
  const original = JSON.stringify([before, after]);
  assert.deepEqual(overtakeEvidence(before, after, 'a'), { rank: 1, name: 'Blue', count: 1 });
  assert.equal(overtakeEvidence(after, after, 'a'), null);
  assert.equal(overtakeEvidence(before, [{ id: 'a', strength: 20 }, before[1]], 'a'), null);
  assert.equal(overtakeEvidence(before, [after[0]], 'a'), null);
  assert.equal(overtakeEvidence([before[0]], after, 'a'), null);
  assert.equal(overtakeEvidence(null, after, 'a'), null);
  assert.equal(JSON.stringify([before, after]), original);
});
test('survival feedback respects actual losses and earned wall protection', () => {
  assert.equal(survivalEvidence('rain', { defense: 0 }, { food: 0 }).good, false);
  assert.equal(survivalEvidence('rain', { defense: 1 }, { food: 0 }).good, true);
  assert.equal(survivalEvidence('birds', { defense: 1 }, { food: 0 }).good, false);
  assert.equal(survivalEvidence('birds', { defense: 2 }, { food: 0 }).good, true);
  assert.match(survivalEvidence('rain', { defense: 2 }, { food: -6 }).text, /6 food lost/);
  assert.equal(survivalEvidence('footsteps', { defense: 2 }, { pointsLost: 0 }), null);
  assert.equal(survivalEvidence('footsteps', { defense: 3 }, { pointsLost: 0 }).good, true);
  assert.equal(survivalEvidence('footsteps', { defense: 3 }, { pointsLost: 5 }).good, false);
  assert.equal(survivalEvidence('dry', { dryPrepared: true }, {}).good, true);
  assert.equal(survivalEvidence('dry', { dryShortfall: 5 }, {}).good, false);
  assert.equal(survivalEvidence('dry', {}, {}), null);
  assert.equal(survivalEvidence('rain', { defense: 4 }, null), null);
});
