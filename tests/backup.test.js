const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBackup, restoreBackup, verifyBackup } = require('../backup');

test('a backup carries checksums and restores byte-for-byte into an empty target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lessonscope-backup-'));
  const source = path.join(root, 'source');
  const backup = path.join(root, 'snapshot');
  const restored = path.join(root, 'restored');
  fs.mkdirSync(path.join(source, 'rosters'), { recursive: true });
  fs.writeFileSync(path.join(source, 'users.json'), '{"users":[]}');
  fs.writeFileSync(path.join(source, 'rosters', 'class.json'), '{"students":["A","B"]}');
  const manifest = createBackup(source, backup);
  assert.equal(manifest.fileCount, 2);
  assert.equal(verifyBackup(backup).ok, true);
  restoreBackup(backup, restored);
  assert.equal(fs.readFileSync(path.join(restored, 'rosters', 'class.json'), 'utf8'), '{"students":["A","B"]}');
  fs.rmSync(root, { recursive: true, force: true });
});

test('verification detects changed data and restore refuses a populated target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lessonscope-backup-'));
  const source = path.join(root, 'source');
  const backup = path.join(root, 'snapshot');
  const target = path.join(root, 'target');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'state.json'), '{}');
  createBackup(source, backup);
  fs.writeFileSync(path.join(backup, 'data', 'state.json'), '{"changed":true}');
  assert.equal(verifyBackup(backup).ok, false);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'do not overwrite');
  assert.throws(() => restoreBackup(backup, target), /verification failed|must be empty/);
  fs.rmSync(root, { recursive: true, force: true });
});
