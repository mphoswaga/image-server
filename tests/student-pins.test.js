// Teacher-issued student PINs.
//
// The model this supports: the teacher generates a PIN for every child, keeps
// the list, and hands out a new one when someone forgets. That only works if
// the teacher can READ the codes back, so teacher-issued PINs are stored
// recoverably (encrypted at rest) while a PIN a student chose stays hash-only.
//
// The line between those two is the thing worth protecting: a teacher can read
// what they issued, and can replace — but never read — what a student chose.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-pins-'));
const sa = require('../student-account.js');

test('a teacher can read back a PIN they issued', () => {
  const pin = sa.issuePin('S1');
  assert.match(pin, /^\d{4}$/);
  assert.equal(sa.revealPin('S1'), pin, 'the whole point: the teacher holds the list');
  assert.ok(sa.verifyPin('S1', pin), 'and the child can sign in with it');
});

test('a PIN the student chose is never readable by the teacher', () => {
  sa.setPin('S2', '4321');
  assert.equal(sa.revealPin('S2'), null, 'resettable, not readable');
  assert.ok(sa.verifyPin('S2', '4321'));
});

test('issuing replaces a student-chosen PIN rather than skipping the child', () => {
  // A teacher who keeps the list needs every child on it. Skipping the ones
  // they cannot read would leave holes exactly where it matters.
  sa.setPin('S3', '1122');
  assert.equal(sa.revealPin('S3'), null);
  const issued = sa.issuePin('S3');
  assert.equal(sa.revealPin('S3'), issued);
  assert.equal(sa.verifyPin('S3', '1122'), false, 'the old one stops working');
});

test('a new PIN retires the old one immediately', () => {
  const first = sa.issuePin('S4');
  const second = sa.issuePin('S4');
  assert.notEqual(first, second);
  assert.equal(sa.verifyPin('S4', first), false, 'a forgotten PIN must not keep working');
  assert.ok(sa.verifyPin('S4', second));
});

test('generated PINs avoid the ones a child would guess first', () => {
  const weak = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123']);
  for (let i = 0; i < 400; i++) assert.ok(!weak.has(sa.generatePin()));
});

test('PINs are not sitting in the file in plain text', () => {
  // Encrypted at rest: a copy of the data directory should not be a list of
  // every child's code.
  const pin = sa.issuePin('S5');
  const raw = fs.readFileSync(path.join(process.env.DATA_DIR, 'student-accounts.json'), 'utf8');
  assert.ok(!raw.includes(`"${pin}"`), 'the PIN must not appear verbatim on disk');
  assert.equal(sa.revealPin('S5'), pin, 'but it still comes back for the teacher');
});

test('a rejected PIN format changes nothing', () => {
  const good = sa.issuePin('S6');
  assert.equal(sa.issuePin('S6', '12'), null, 'three digits is not a PIN');
  assert.equal(sa.revealPin('S6'), good, 'and the working one is left alone');
});
