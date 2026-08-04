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
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const ACCOUNTS_PATH = path.join(DATA_DIR, 'student-accounts.json');

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

module.exports = { getAccountState, setPin, verifyPin, requestPinReset, approvePinReset, getResetRequest };
