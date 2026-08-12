// Global per-Student-ID account: one 4-digit PIN per Student ID across the
// WHOLE app, independent of which teacher's roster(s) it appears in. This is
// deliberately separate from roster.js — roster.js answers "which classes is
// this ID in, and what's the real name", this module answers "does this ID
// have an account, and is this the right PIN". An account only makes sense
// for an ID a teacher has actually added to a roster (see
// roster.findStudentAcrossAllTeachers) — this module doesn't gate that
// itself, callers must check roster membership before allowing setup.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const ACCOUNTS_PATH = path.join(DATA_DIR, 'student-accounts.json');
const PIN_KEY_PATH = path.join(DATA_DIR, '.student-pin-key');

// ── Teacher-issued PINs ─────────────────────────────────────────────────────
// A teacher who hands out PINs has to be able to read them back: a child who
// forgets theirs on Tuesday should cost their teacher five seconds, not a
// reset dance in front of a waiting class.
//
// That means teacher-issued PINs are stored recoverably, encrypted at rest,
// and revealed only to the signed-in teacher whose roster the student is on.
// This is a proportionate call, not a lapse: a 4-digit code gating a quiz
// attempt is not a password, the teacher can already see every result it
// protects, and the same file holds the class list, which is the more
// sensitive half.
//
// A PIN the STUDENT chose is never stored this way. It stays hash-only and
// unreadable — the teacher can reset it, but not read it. Only what the
// teacher issued can be read back by the teacher.
function pinKey() {
  try {
    if (fs.existsSync(PIN_KEY_PATH)) return Buffer.from(fs.readFileSync(PIN_KEY_PATH, "utf8").trim(), "hex");
  } catch {}
  const key = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PIN_KEY_PATH, key.toString("hex"), { mode: 0o600 });
  return key;
}

function sealPin(pin) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', pinKey(), iv);
  const out = Buffer.concat([c.update(String(pin), 'utf8'), c.final()]);
  return [iv.toString('hex'), c.getAuthTag().toString('hex'), out.toString('hex')].join(':');
}

function openPin(sealed) {
  try {
    const [iv, tag, body] = String(sealed || '').split(':');
    if (!iv || !tag || !body) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', pinKey(), Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(body, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
}

// Four digits, evenly distributed, and not the handful a child would guess
// first. 0000 and 1234 are the '1234' of PINs.
const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123']);
function generatePin() {
  for (;;) {
    const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    if (!WEAK_PINS.has(pin)) return pin;
  }
}

// Set (or replace) a PIN on the teacher's authority. Unlike setPin, this is
// allowed to overwrite — that IS the reset, and a teacher standing in front of
// a class should not need a two-step approval to help a child back in.
function issuePin(studentId, pin) {
  const id = normalizeStudentId(studentId);
  const code = String(pin || generatePin());
  if (!/^\d{4}$/.test(code)) return null;
  const accounts = loadAccounts();
  const acc = accounts[id] || {};
  acc.pinHash = bcrypt.hashSync(code, 10);
  acc.issuedPin = sealPin(code);      // readable by the teacher who issued it
  acc.pinResetRequested = null;
  accounts[id] = acc;
  saveAccounts(accounts);
  return code;
}

// The PIN a teacher issued, or null when the student chose their own — those
// are hash-only and stay that way.
function revealPin(studentId) {
  const acc = loadAccounts()[normalizeStudentId(studentId)];
  if (!acc || !acc.issuedPin) return null;
  return openPin(acc.issuedPin);
}

function normalizeStudentId(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')); } catch { return {}; }
}
function saveAccounts(accounts) { writeJsonAtomic(ACCOUNTS_PATH, accounts); }

// 'unset' (never set up, or a reset was approved) | 'set' (has an active PIN).
function getAccountState(studentId) {
  studentId = normalizeStudentId(studentId);
  const acc = loadAccounts()[studentId];
  return acc && acc.pinHash ? 'set' : 'unset';
}

// First-time setup only — refuses to overwrite an active PIN so a student
// can't silently clobber another student's PIN by re-"setting up" on their
// ID. Overwriting requires a teacher-approved reset first.
function setPin(studentId, pin) {
  studentId = normalizeStudentId(studentId);
  const accounts = loadAccounts();
  const acc = accounts[studentId] || {};
  if (acc.pinHash) return false;
  acc.pinHash = bcrypt.hashSync(String(pin), 10);
  // Chosen by the student, so it is theirs and not for the teacher to read.
  delete acc.issuedPin;
  acc.pinResetRequested = null;
  accounts[studentId] = acc;
  saveAccounts(accounts);
  return true;
}

function verifyPin(studentId, pin) {
  studentId = normalizeStudentId(studentId);
  const acc = loadAccounts()[studentId];
  if (!acc || !acc.pinHash) return false;
  return bcrypt.compareSync(String(pin || ''), acc.pinHash);
}

// Student-initiated — just flags the account for a teacher to see. Doesn't
// touch pinHash by itself (a bare reset *request* needs no proof of
// identity, so it must not unlock anything on its own).
function requestPinReset(studentId) {
  studentId = normalizeStudentId(studentId);
  const accounts = loadAccounts();
  if (!accounts[studentId] || !accounts[studentId].pinHash) return false;
  accounts[studentId].pinResetRequested = new Date().toISOString();
  saveAccounts(accounts);
  return true;
}

// Teacher-initiated — clears the PIN so the student's next attempt falls
// back into the setup flow.
function approvePinReset(studentId) {
  studentId = normalizeStudentId(studentId);
  const accounts = loadAccounts();
  if (!accounts[studentId]) return null;
  accounts[studentId].pinHash = null;
  accounts[studentId].pinResetRequested = null;
  saveAccounts(accounts);
  return accounts[studentId];
}

function getResetRequest(studentId) {
  studentId = normalizeStudentId(studentId);
  const acc = loadAccounts()[studentId];
  return (acc && acc.pinResetRequested) || null;
}

module.exports = { getAccountState, setPin, verifyPin, requestPinReset, approvePinReset, getResetRequest, issuePin, revealPin, generatePin };
