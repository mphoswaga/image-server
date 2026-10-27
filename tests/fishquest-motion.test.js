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

test('crowded oceans keep only useful nearby learner and NPC labels', () => {
  const players = [
    { id: 'me', x: 0, y: 0 },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `learner-${index}`, name: `Learner Number ${index}`, x: 40 + index * 30, y: 0 })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `npc-${index}`, npc: true, x: 50 + index * 40, y: 20 })),
  ];
  const visible = motion.visibleLabels(players, 'me');
  assert.equal(visible.has('me'), true);
  assert.equal([...visible].filter(id => id.startsWith('learner')).length, 6);
  assert.equal([...visible].filter(id => id.startsWith('npc')).length, 3);
  assert.equal(visible.has('learner-11'), false);
  assert.equal(motion.shortName('Nguyen Lam Thien Di'), 'Nguyen Di');
  assert.equal(motion.shortName('Learner Number 13'), 'Learner 13');
});

test('server timeline keeps constant swimming speed despite uneven Wi-Fi arrivals', () => {
  const clock = motion.timeline(), samples = [];
  const arrivals = [1000, 1135, 1205, 1330, 1400, 1535, 1605];
  for (let i=0;i<arrivals.length;i++) {
    const stamp=clock.receive(50000+i*100,arrivals[i],'ocean');
    motion.push(samples,{x:i*18,y:20},stamp.time,stamp.reset);
  }
  const points=[1520,1530,1540,1550,1560].map(t=>motion.sample(samples,clock.render(t)).x);
  for(let i=1;i<points.length;i++) assert.ok(Math.abs(points[i]-points[i-1]-1.8)<1e-8);
});
test('movement clock resets after connection gaps and when changing oceans',()=>{
 const clock=motion.timeline();
 assert.equal(clock.receive(10000,100,'one').reset,true);
 assert.equal(clock.receive(10100,230,'one').reset,false);
 assert.equal(clock.receive(11000,1100,'one').reset,true);
 assert.equal(clock.receive(11100,1200,'two').reset,true);
 assert.equal(clock.render(1200),10960);
});
