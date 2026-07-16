// Shared credit wallet — the balance a teacher spends across BOTH LessonScope
// and TeacherScope. Keyed by email (the one identity both apps share, made
// reliable by Google sign-in), so a pack bought once is usable in either app.
//
// Persisted to DATA_DIR/credits.json:
//   { byEmail: { <email>: { balance, freeGranted, history:[…] } },
//     processed: { <stripeEventOrSessionId>: true } }   ← webhook idempotency
//
// Same file-based read-modify-write model as the rest of the app; writeJsonAtomic
// protects against corruption. Purchases are de-duplicated by Stripe's event id
// so a re-delivered webhook never double-credits.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const CREDITS_PATH = path.join(DATA_DIR, 'credits.json');
const FREE_CREDITS = (() => { const v = parseInt(process.env.FREE_CREDITS, 10); return Number.isFinite(v) && v >= 0 ? v : 3; })();
const HISTORY_MAX = 100;

const norm = e => String(e || '').trim().toLowerCase();

function load() {
  try { const d = JSON.parse(fs.readFileSync(CREDITS_PATH, 'utf8')); d.byEmail = d.byEmail || {}; d.processed = d.processed || {}; return d; }
  catch { return { byEmail: {}, processed: {} }; }
}
function save(d) { try { writeJsonAtomic(CREDITS_PATH, d); } catch (e) { console.error('credits save failed:', e.message); } }

function acct(d, email) {
  const k = norm(email);
  if (!d.byEmail[k]) d.byEmail[k] = { balance: 0, freeGranted: false, history: [] };
  return d.byEmail[k];
}
function record(a, delta, reason) {
  a.history.unshift({ at: new Date().toISOString(), delta, reason, balanceAfter: a.balance });
  if (a.history.length > HISTORY_MAX) a.history.length = HISTORY_MAX;
}

function getBalance(email) { const a = load().byEmail[norm(email)]; return a ? a.balance : 0; }

// One-time free allowance so a new teacher can try before buying.
function ensureFreeGrant(email) {
  if (!email) return 0;
  const d = load(); const a = acct(d, email);
  if (!a.freeGranted) {
    a.freeGranted = true;
    if (FREE_CREDITS > 0) { a.balance += FREE_CREDITS; record(a, FREE_CREDITS, 'free-trial'); }
    save(d);
  }
  return a.balance;
}

function grant(email, amount, reason = 'purchase') {
  const d = load(); const a = acct(d, email);
  a.balance += Math.max(0, amount); record(a, Math.max(0, amount), reason);
  save(d); return a.balance;
}

// Idempotent grant for Stripe webhooks — a duplicate delivery (same id) is a no-op.
function grantOnce(idempotencyKey, email, amount, reason = 'purchase') {
  const d = load();
  if (d.processed[idempotencyKey]) return { credited: false, balance: acct(d, email).balance };
  const a = acct(d, email);
  a.balance += Math.max(0, amount); record(a, Math.max(0, amount), reason);
  d.processed[idempotencyKey] = true;
  save(d);
  return { credited: true, balance: a.balance };
}

// Spend credits. Returns { ok, balance } — ok:false when the balance is short.
function consume(email, amount = 1, reason = 'lesson') {
  const d = load(); const a = acct(d, email);
  if (a.balance < amount) return { ok: false, balance: a.balance };
  a.balance -= amount; record(a, -amount, reason);
  save(d); return { ok: true, balance: a.balance };
}

function getHistory(email) { const a = load().byEmail[norm(email)]; return a ? a.history : []; }

module.exports = { FREE_CREDITS, getBalance, ensureFreeGrant, grant, grantOnce, consume, getHistory };
