// Money-path tests for the local wallet ledger (reserve → capture → release).
//
// These are the guarantees a billing bug would violate, so they're worth
// locking down: capture is the ONLY real deduction, a released/failed
// generation never charges, holds prevent double-spend, and idempotency keys
// stop double-holds and double-grants. Runs against the real file-backed ledger
// in a throwaway dir — no mocks, no network, no DB.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate all wallet state and force LOCAL mode (no remote wallet) BEFORE the
// modules are required — they read DATA_DIR / the remote URL at load time.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-wallet-'));
delete process.env.EDUCSCOPE_WALLET_URL;
delete process.env.EDUCSCOPE_WALLET_API_URL;
delete process.env.WALLET_API_URL;

const wallet = require('../wallet.js');
const credits = require('../credits.js');

assert.equal(wallet.remoteConfigured(), false, 'tests must run against the local backend');

let n = 0;
// A fresh org per test = clean balance/ledger state without touching files.
function seed(startingBalance) {
  const org = `org-${Date.now()}-${n++}`;
  if (startingBalance > 0) credits.grant(org, startingBalance, 'test-seed');
  return org;
}
const balanceOf = (org) => credits.getBalance(org);
const availableOf = async (org) => (await wallet.getBalance(org)).available;

test('reserve holds but does not charge; capture deducts exactly once', async () => {
  const org = seed(10);
  const r = await wallet.reserveCredits({ organizationId: org, credits: 3, action: 'generate' });

  assert.equal(balanceOf(org), 10, 'reserve must NOT deduct — only holds');
  assert.equal(await availableOf(org), 7, 'available = balance − hold');

  await wallet.captureReservation({ reservationId: r.reservationId });
  assert.equal(balanceOf(org), 7, 'capture deducts the held amount');

  // Idempotent: capturing the same reservation again must not double-charge.
  await wallet.captureReservation({ reservationId: r.reservationId });
  assert.equal(balanceOf(org), 7, 'second capture is a no-op');
  assert.equal(await availableOf(org), 7);
});

test('release refunds fully — a failed generation never charges', async () => {
  const org = seed(10);
  const r = await wallet.reserveCredits({ organizationId: org, credits: 4, action: 'generate' });
  assert.equal(await availableOf(org), 6);

  await wallet.releaseReservation({ reservationId: r.reservationId, reason: 'ai_failed' });
  assert.equal(balanceOf(org), 10, 'nothing was ever consumed');
  assert.equal(await availableOf(org), 10, 'the hold is gone');
});

test('duplicate reserve with the same idempotency key does not double-hold', async () => {
  const org = seed(10);
  const key = 'idem-abc';
  const r1 = await wallet.reserveCredits({ organizationId: org, credits: 3, action: 'x', idempotencyKey: key });
  const r2 = await wallet.reserveCredits({ organizationId: org, credits: 3, action: 'x', idempotencyKey: key });

  assert.equal(r2.reservationId, r1.reservationId, 'same key returns the same reservation');
  assert.equal(r2.idempotent, true);
  assert.equal(await availableOf(org), 7, 'only ONE hold of 3, not two');
});

test('reserving more than available throws InsufficientCreditsError', async () => {
  const org = seed(2);
  await assert.rejects(
    () => wallet.reserveCredits({ organizationId: org, credits: 5, action: 'x' }),
    (err) => err instanceof wallet.InsufficientCreditsError,
  );
  assert.equal(balanceOf(org), 2, 'a rejected reserve changes nothing');
});

test('concurrent holds cannot oversell the balance', async () => {
  const org = seed(5);
  await wallet.reserveCredits({ organizationId: org, credits: 3, action: 'a' });
  assert.equal(await availableOf(org), 2);

  await assert.rejects(
    () => wallet.reserveCredits({ organizationId: org, credits: 3, action: 'b' }),
    (err) => err instanceof wallet.InsufficientCreditsError,
    'the outstanding hold must block a second reserve it cannot cover',
  );

  const ok = await wallet.reserveCredits({ organizationId: org, credits: 2, action: 'b' });
  assert.equal(ok.status, 'reserved');
  assert.equal(await availableOf(org), 0);
});

test('capturing an already-released reservation throws', async () => {
  const org = seed(10);
  const r = await wallet.reserveCredits({ organizationId: org, credits: 3, action: 'x' });
  await wallet.releaseReservation({ reservationId: r.reservationId });
  await assert.rejects(() => wallet.captureReservation({ reservationId: r.reservationId }), /released/);
  assert.equal(balanceOf(org), 10, 'a released reservation can never charge');
});

test('billing-off (0-credit) reserve/capture is free and never blocks', async () => {
  const org = seed(0); // no balance at all
  const r = await wallet.reserveCredits({ organizationId: org, credits: 0, action: 'free' });
  assert.equal(r.status, 'reserved');
  await wallet.captureReservation({ reservationId: r.reservationId });
  assert.equal(balanceOf(org), 0, 'a 0-credit action costs nothing');
});

test('grantOnce is idempotent — a replayed purchase webhook grants once', async () => {
  const org = seed(0);
  credits.grantOnce('evt-1', org, 80, 'purchase');
  credits.grantOnce('evt-1', org, 80, 'purchase'); // duplicate delivery
  assert.equal(balanceOf(org), 80, 'the same event id must not grant twice');

  credits.grantOnce('evt-2', org, 80, 'purchase'); // a different event does grant
  assert.equal(balanceOf(org), 160);
});
