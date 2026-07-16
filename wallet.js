// EducScope wallet client — the ONE seam through which LessonScope touches
// credits. Nothing else in the app deducts credits directly; a route names an
// `action`, and this module reserves → captures (on success) or releases (on
// failure) against the shared wallet. That lifecycle means a failed generation
// never costs a teacher a credit, and retries are idempotent.
//
// Two interchangeable backends behind the SAME interface (the WalletClient
// contract from the EducScope handoff):
//
//   • remote  — when EDUCSCOPE_WALLET_URL is set, calls EducScope's wallet API
//               (EducScope owns billing + the ledger). This is the destination.
//   • local   — the fallback used until EducScope's API is live: the existing
//               per-email credits.js wallet plus a small reservations ledger so
//               reserve/capture/release behave correctly (holds prevent
//               double-spend). Swapping to remote is a config change, not code.
//
// Contract:
//   getBalance(organizationId)                              -> { organizationId, balance, currency }
//   reserveCredits({ organizationId, product, action,
//                    credits, idempotencyKey, metadata })   -> { reservationId, credits, balance, status }
//   captureReservation({ reservationId, provider, model,
//                        inputTokens, outputTokens,
//                        estimatedCostCents, resultRef })   -> void
//   releaseReservation({ reservationId, reason })           -> void
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const credits = require('./credits');

// Thrown when a reservation can't be covered — the server maps this to HTTP 402.
class InsufficientCreditsError extends Error {
  constructor(balance) { super('Insufficient credits.'); this.name = 'InsufficientCreditsError'; this.needCredits = true; this.balance = balance; }
}

// ── Remote backend (EducScope wallet API) ───────────────────────────────────
// Assumed REST shape — EducScope implements these to the same contract:
//   GET  {base}/balance?organizationId=…
//   POST {base}/reservations                 (reserve)
//   POST {base}/reservations/{id}/capture
//   POST {base}/reservations/{id}/release
const remoteBase = () => (process.env.EDUCSCOPE_WALLET_URL || '').replace(/\/$/, '');
const remoteKey = () => process.env.EDUCSCOPE_WALLET_KEY || '';
function remoteConfigured() { return !!remoteBase(); }

// Whether a wallet OUTAGE (not "out of credits" — an actual error reaching the
// wallet) should block generation. In local/beta mode we fail OPEN so a hiccup
// never stops a teacher. Once EducScope's remote wallet is live we fail CLOSED,
// so we never give paid AI away free when the ledger is unreachable. Force it
// either way with WALLET_FAIL_CLOSED=true|false.
function failClosed() {
  const f = process.env.WALLET_FAIL_CLOSED;
  if (f === 'true') return true;
  if (f === 'false') return false;
  return remoteConfigured();
}

async function remoteCall(method, suffix, body, idempotencyKey) {
  const headers = { Accept: 'application/json' };
  if (remoteKey()) headers.Authorization = `Bearer ${remoteKey()}`;
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(remoteBase() + suffix, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 402) throw new InsufficientCreditsError(data && typeof data.balance === 'number' ? data.balance : 0);
  if (!res.ok) throw new Error((data && data.error) || `Wallet error (${res.status})`);
  return data;
}

const remoteBackend = {
  getBalance: (organizationId) => remoteCall('GET', `/balance?organizationId=${encodeURIComponent(organizationId)}`),
  reserveCredits: (input) => remoteCall('POST', '/reservations', input, input.idempotencyKey),
  captureReservation: ({ reservationId, ...rest }) => remoteCall('POST', `/reservations/${encodeURIComponent(reservationId)}/capture`, rest).then(() => {}),
  releaseReservation: ({ reservationId, reason }) => remoteCall('POST', `/reservations/${encodeURIComponent(reservationId)}/release`, { reason }).then(() => {}),
};

// ── Local backend (fallback until EducScope's API is live) ──────────────────
// Reservations ledger persisted next to the other wallet state. A "hold" is a
// reservation in status 'reserved'; available balance = wallet balance minus
// active holds, so two concurrent reservations can't spend the same credit.
const LEDGER_PATH = path.join(DATA_DIR, 'reservations.json');
const norm = e => String(e || '').trim().toLowerCase();

function loadLedger() {
  try { const d = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')); d.byId = d.byId || {}; d.byIdem = d.byIdem || {}; return d; }
  catch { return { byId: {}, byIdem: {} }; }
}
function saveLedger(d) { try { writeJsonAtomic(LEDGER_PATH, d); } catch (e) { console.error('reservations save failed:', e.message); } }

function heldFor(d, org) {
  let held = 0;
  for (const r of Object.values(d.byId)) if (r.status === 'reserved' && norm(r.organizationId) === norm(org)) held += r.credits || 0;
  return held;
}

const localBackend = {
  async getBalance(organizationId) {
    const balance = credits.getBalance(organizationId);
    const held = heldFor(loadLedger(), organizationId);
    return { organizationId: norm(organizationId), balance, available: Math.max(0, balance - held), currency: 'credit' };
  },

  async reserveCredits({ organizationId, product, action, credits: amount, idempotencyKey, metadata }) {
    amount = Math.max(0, parseInt(amount, 10) || 0);
    const d = loadLedger();

    // Idempotency: an in-flight or already-captured reservation for this key is
    // returned as-is (never double-held). A released one means a prior attempt
    // failed, so a retry legitimately gets a fresh reservation.
    if (idempotencyKey && d.byIdem[idempotencyKey]) {
      const prev = d.byId[d.byIdem[idempotencyKey]];
      if (prev && (prev.status === 'reserved' || prev.status === 'captured')) {
        return { reservationId: prev.reservationId, credits: prev.credits, balance: credits.getBalance(organizationId), status: prev.status, idempotent: true };
      }
    }

    if (amount > 0) {
      const balance = credits.getBalance(organizationId);
      const available = balance - heldFor(d, organizationId);
      if (available < amount) throw new InsufficientCreditsError(balance);
    }

    const reservationId = 'rsv_' + crypto.randomUUID();
    d.byId[reservationId] = {
      reservationId, organizationId: norm(organizationId), product: product || 'lessonscope',
      action, credits: amount, status: 'reserved', idempotencyKey: idempotencyKey || null,
      metadata: metadata || {}, createdAt: new Date().toISOString(),
    };
    if (idempotencyKey) d.byIdem[idempotencyKey] = reservationId;
    saveLedger(d);
    return { reservationId, credits: amount, balance: credits.getBalance(organizationId), status: 'reserved' };
  },

  async captureReservation({ reservationId, provider, model, inputTokens, outputTokens, estimatedCostCents, resultRef }) {
    const d = loadLedger();
    const r = d.byId[reservationId];
    if (!r) throw new Error('Unknown reservation.');
    if (r.status === 'captured') return;                       // idempotent
    if (r.status === 'released') throw new Error('Reservation already released.');
    if (r.credits > 0) credits.consume(r.organizationId, r.credits, r.action);   // the only real deduction
    r.status = 'captured';
    r.capturedAt = new Date().toISOString();
    r.usage = { provider: provider || null, model: model || null, inputTokens: inputTokens || 0, outputTokens: outputTokens || 0, estimatedCostCents: estimatedCostCents || 0, resultRef: resultRef || null };
    saveLedger(d);
  },

  async releaseReservation({ reservationId, reason }) {
    const d = loadLedger();
    const r = d.byId[reservationId];
    if (!r || r.status !== 'reserved') return;                 // nothing held → no-op
    r.status = 'released';
    r.releasedAt = new Date().toISOString();
    r.releaseReason = String(reason || 'released').slice(0, 200);
    saveLedger(d);
  },
};

// Prune settled (captured/released) reservations older than a day so the ledger
// stays bounded; active holds are always kept.
setInterval(() => {
  const d = loadLedger();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [id, r] of Object.entries(d.byId)) {
    if (r.status === 'reserved') continue;
    const at = new Date(r.capturedAt || r.releasedAt || r.createdAt).getTime();
    if (at < cutoff) { delete d.byId[id]; if (r.idempotencyKey && d.byIdem[r.idempotencyKey] === id) delete d.byIdem[r.idempotencyKey]; changed = true; }
  }
  if (changed) saveLedger(d);
}, 60 * 60 * 1000).unref();

// ── Dispatch ────────────────────────────────────────────────────────────────
function backend() { return remoteConfigured() ? remoteBackend : localBackend; }

module.exports = {
  InsufficientCreditsError,
  remoteConfigured,
  failClosed,
  getBalance: (organizationId) => backend().getBalance(organizationId),
  reserveCredits: (input) => backend().reserveCredits(input),
  captureReservation: (input) => backend().captureReservation(input),
  releaseReservation: (input) => backend().releaseReservation(input),
};
