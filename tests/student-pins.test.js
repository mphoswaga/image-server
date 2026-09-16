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

test('a temporary class PIN works once, then restores the learner chosen PIN', () => {
  sa.setPin('S4-TEMP', '1122');
  const temporary = sa.issueTemporaryClassPin('S4-TEMP', '2468');
  assert.equal(sa.verifyPin('S4-TEMP', '1122'), false);
  assert.equal(sa.verifyPin('S4-TEMP', temporary.pin), true);
  assert.equal(sa.verifyPin('S4-TEMP', temporary.pin), false, 'the class PIN is consumed after one successful login');
  assert.equal(sa.verifyPin('S4-TEMP', '1122'), true, 'the learner returns to their original PIN');
});

test('a temporary class PIN expires back to setup when no earlier PIN exists', () => {
  const temporary = sa.issueTemporaryClassPin('S4-NEW', '2468', { now: 1000, ttlMs: 100 });
  assert.equal(sa.getAccountState('S4-NEW', 1200), 'unset');
  assert.equal(sa.verifyPin('S4-NEW', temporary.pin, 1200), false);
  assert.equal(sa.isRetiredTemporaryPin('S4-NEW', temporary.pin), true);
  assert.equal(sa.setPin('S4-NEW', temporary.pin), false, 'the expired class PIN cannot become the learner’s new PIN');
  assert.equal(sa.setPin('S4-NEW', '1357'), true);
  assert.equal(sa.verifyPin('S4-NEW', '1357'), true);
});

test('a temporary class PIN expires back to an earlier teacher-issued PIN', () => {
  sa.issuePin('S4-RESTORE', '1357');
  sa.issueTemporaryClassPin('S4-RESTORE', '2468', { now: 1000, ttlMs: 100 });
  assert.equal(sa.getAccountState('S4-RESTORE', 1200), 'set');
  assert.equal(sa.verifyPin('S4-RESTORE', '2468', 1200), false);
  assert.equal(sa.verifyPin('S4-RESTORE', '1357', 1200), true);
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

test('a verified Google identity links to an existing PIN account', () => {
  sa.issuePin('S7', '2468');
  const linked = sa.linkIdentity('S7', { provider: 'google', providerUserId: 'google-7', email: 'student@school.edu', name: 'Student Seven' });
  assert.equal(linked.ok, true);
  assert.equal(sa.findByIdentity('google', 'google-7').studentId, 'S7');
  assert.deepEqual(sa.identitySummary('S7').map(item => [item.provider, item.email]), [['google', 'student@school.edu']]);
});

test('one Google identity cannot take over a second Student ID', () => {
  sa.issuePin('S8', '2469');
  sa.issuePin('S9', '2470');
  assert.equal(sa.linkIdentity('S8', { provider: 'google', providerUserId: 'shared-google', email: 'one@school.edu' }).ok, true);
  assert.equal(sa.linkIdentity('S9', { provider: 'google', providerUserId: 'shared-google', email: 'one@school.edu' }).code, 'identity_in_use');
  assert.equal(sa.findByIdentity('google', 'shared-google').studentId, 'S8');
});

test('Google linking requires a PIN and can be revoked without deleting it', () => {
  assert.equal(sa.linkIdentity('S10', { provider: 'google', providerUserId: 'google-10', email: 'ten@school.edu' }).code, 'pin_required');
  sa.issuePin('S10', '2471');
  sa.linkIdentity('S10', { provider: 'google', providerUserId: 'google-10', email: 'ten@school.edu' });
  assert.equal(sa.unlinkProvider('S10', 'google'), 1);
  assert.equal(sa.findByIdentity('google', 'google-10'), null);
  assert.equal(sa.verifyPin('S10', '2471'), true);
});

test('teacher PIN replacement keeps the linked Google identity and learning account', () => {
  sa.issuePin('S11', '2472');
  sa.linkIdentity('S11', { provider: 'google', providerUserId: 'google-11', email: 'eleven@school.edu' });
  sa.issuePin('S11', '2473');
  assert.equal(sa.verifyPin('S11', '2472'), false);
  assert.equal(sa.verifyPin('S11', '2473'), true);
  assert.equal(sa.findByIdentity('google', 'google-11').studentId, 'S11');
});
