const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { REPOSITORY_METHODS, assertRepositorySet, objectKey, assertObjectStore } = require('../persistence/contracts');
const { classify, inventoryData } = require('../persistence/inventory');

test('repository boundary requires every migration domain and method', () => {
  const repositories = {};
  for (const [domain, methods] of Object.entries(REPOSITORY_METHODS)) {
    repositories[domain] = Object.fromEntries(methods.map(method => [method, () => {}]));
  }
  assert.equal(assertRepositorySet(repositories), repositories);
  delete repositories.rosters.save;
  assert.throws(() => assertRepositorySet(repositories), /rosters\.save/);
});

test('object keys are owner-scoped and reject traversal', () => {
  assert.equal(objectKey({ ownerId: 'teacher-1', domain: 'templates', recordId: 'tpl-2', filename: 'plan.xlsx' }), 'users/teacher-1/templates/tpl-2/plan.xlsx');
  assert.throws(() => objectKey({ ownerId: '..', domain: 'templates', recordId: 'tpl-2', filename: 'plan.xlsx' }), /unsafe/);
  assert.throws(() => objectKey({ ownerId: 'teacher-1/x', domain: 'templates', recordId: 'tpl-2', filename: 'plan.xlsx' }), /unsafe/);
});

test('object-store boundary declares the four lifecycle operations', () => {
  const store = { put() {}, get() {}, remove() {}, exists() {} };
  assert.equal(assertObjectStore(store), store);
  assert.throws(() => assertObjectStore({ put() {} }), /get/);
});

test('file inventory produces deterministic ownership migration evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lessonscope-inventory-'));
  fs.mkdirSync(path.join(root, 'users', 'teacher-1', 'rosters'), { recursive: true });
  fs.mkdirSync(path.join(root, 'practice', 'attempts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'users', 'teacher-1', 'rosters', '2b.json'), '{"id":"2b"}');
  fs.writeFileSync(path.join(root, 'practice', 'attempts', 'a1.json'), '{"id":"a1"}');
  const inventory = inventoryData(root);
  assert.equal(inventory.totals.files, 2);
  assert.deepEqual(Object.keys(inventory.domains).sort(), ['practice_attempts', 'rosters']);
  assert.match(inventory.files[0].sha256, /^[a-f0-9]{64}$/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('known file paths map to their migration domain', () => {
  assert.equal(classify('users/t1/rosters/r1.json'), 'rosters');
  assert.equal(classify('users/t1/planning-sources/p1.json'), 'planning_sources');
  assert.equal(classify('practice/live-sessions/ABC123.json'), 'live_rooms');
  assert.equal(classify('media/deck/image.png'), 'media');
});
