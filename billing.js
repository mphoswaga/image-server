// Billing adapter — Paystack (South Africa / Africa). LessonScope is the
// billing hub; credits.js holds the shared balance. Kept behind the SAME small
// interface the server expects (isConfigured / getPacks / createCheckoutSession
// / verifyTransaction / constructEvent), so switching processors later is a
// one-file change.
//
// Paystack is plain REST + an HMAC-signed webhook, so there's no SDK: we use
// fetch + crypto. Crediting is doubly safe — the webhook (charge.success) AND
// the verify-on-return both call credits.grantOnce, which is idempotent, so a
// teacher is credited exactly once even if the webhook is delayed or unset.
//
// Credential-gated: with no PAYSTACK_SECRET_KEY the app just doesn't offer
// purchasing.
const crypto = require('crypto');

// Editable pack catalogue. amount is in the currency's subunit (cents for ZAR).
const CURRENCY = (process.env.BILLING_CURRENCY || 'zar').toLowerCase();
const PACKS = [
  { id: 'credits-10',  credits: 10,  amount: 9000  },  // R90
  { id: 'credits-30',  credits: 30,  amount: 24000 },  // R240
  { id: 'credits-100', credits: 100, amount: 75000 },  // R750
];

const API = 'https://api.paystack.co';
const secret = () => process.env.PAYSTACK_SECRET_KEY;
function isConfigured() { return !!secret(); }

async function paystack(method, pathname, body) {
  if (!secret()) throw new Error('Payments are not set up yet.');
  const res = await fetch(API + pathname, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(data.message || `Paystack error (${res.status})`);
  return data;
}

function getPack(id) { return PACKS.find(p => p.id === id) || null; }
function fmtPrice(amount) {
  if (CURRENCY === 'zar') return `R${(amount / 100).toFixed(2)}`;
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: CURRENCY.toUpperCase() }).format(amount / 100); }
  catch { return `${(amount / 100).toFixed(2)} ${CURRENCY.toUpperCase()}`; }
}
function getPacks() {
  return PACKS.map(p => ({ id: p.id, credits: p.credits, amount: p.amount, currency: CURRENCY, priceLabel: fmtPrice(p.amount) }));
}

// Start a hosted Paystack checkout; returns the URL to redirect the teacher to.
// The teacher's email + credit amount ride in metadata so the webhook/verify
// know who to credit.
async function createCheckoutSession({ packId, email, successUrl }) {
  const pack = getPack(packId);
  if (!pack) throw new Error('Unknown credit pack.');
  if (!email) throw new Error('An email is required to check out.');
  const data = await paystack('POST', '/transaction/initialize', {
    email,
    amount: pack.amount,
    currency: CURRENCY.toUpperCase(),
    callback_url: `${successUrl}?billing=return`,
    metadata: { email: email.toLowerCase(), credits: String(pack.credits), packId: pack.id },
  });
  return data.data.authorization_url;
}

// Confirm a transaction server-side (used on the return redirect). Returns the
// purchase details when paid, so the caller can (idempotently) grant credits.
async function verifyTransaction(reference) {
  const data = await paystack('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  const t = data.data || {};
  const meta = t.metadata || {};
  return {
    success: t.status === 'success',
    reference: t.reference || reference,
    email: (meta.email || (t.customer && t.customer.email) || '').toLowerCase(),
    credits: parseInt(meta.credits || '0', 10),
  };
}

// Verify a webhook came from Paystack (HMAC-SHA512 of the raw body with the
// secret key) and normalise it to the shape the server's handler expects.
function constructEvent(rawBody, signature) {
  if (!secret()) throw new Error('Payments are not set up yet.');
  const hash = crypto.createHmac('sha512', secret()).update(rawBody).digest('hex');
  if (!signature || hash !== signature) throw new Error('Invalid webhook signature.');
  const evt = JSON.parse(rawBody.toString('utf8'));
  const t = evt.data || {};
  const meta = t.metadata || {};
  return {
    id: t.reference || evt.id,
    type: evt.event === 'charge.success' ? 'checkout.session.completed' : evt.event,
    data: { object: {
      id: t.reference,
      metadata: { email: (meta.email || '').toLowerCase(), credits: meta.credits },
      customer_details: { email: t.customer && t.customer.email },
    } },
  };
}

module.exports = { CURRENCY, PACKS, isConfigured, getPack, getPacks, createCheckoutSession, verifyTransaction, constructEvent };
