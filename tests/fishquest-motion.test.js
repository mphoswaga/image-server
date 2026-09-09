const test = require('node:test');
const assert = require('node:assert/strict');
const motion = require('../public/fishquest-motion');

test('fish presentation interpolates uneven packets and bounds late-packet drift', () => {
  const samples = [];
  motion.push(samples, { x: 0, y: 10 }, 0);
  motion.push(samples, { x: 20, y: 30 }, 100);
  motion.push(samples, { x: 50, y: 60 }, 250);
  assert.deepEqual(motion.sample(samples, 175), { x: 35, y: 45 });
  assert.deepEqual(motion.sample(samples, 10000), motion.sample(samples, 330));
});

test('respawn, pause and reconnect discard stale movement history', () => {
  const samples = [];
  motion.push(samples, { x: 0, y: 0 }, 0);
  motion.push(samples, { x: 10, y: 0 }, 100);
  motion.push(samples, { x: 15, y: 0 }, 110, true);
  assert.equal(samples.length, 1);
  assert.equal(motion.sample(samples, 500).x, 15);
  motion.push(samples, { x: 1200, y: 800 }, 200);
  assert.equal(samples.length, 1);
  motion.push(samples, { x: 1201, y: 800 }, 1000);
  assert.equal(samples.length, 1);
  for (let i = 1; i <= 20; i++) motion.push(samples, { x: 1201 + i, y: 800 }, 1000 + i * 50);
  assert.equal(samples.length, 8);
});
