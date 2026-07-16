// Stripe billing for credit packs. LessonScope is the billing hub — it runs
// the checkout and receives the webhook; credits.js holds the shared balance.
//
// Google Pay / Apple Pay / cards all come for free: we use Stripe's hosted
// Checkout, which shows the wallet buttons automatically for eligible devices
// (no direct Google Pay API work needed). Packs are priced ad-hoc via
// price_data, so there are no Products to pre-create in the dashboard.
//
// Everything is credential-gated: with no STRIPE_SECRET_KEY the module reports
// "not configured" and the app just doesn't offer purchasing.

// Editable pack catalogue. unit_amount is in the smallest currency unit (cents).
const CURRENCY = (process.env.BILLING_CURRENCY || 'usd').toLowerCase();
const PACKS = [
  { id: 'credits-10',  credits: 10,  amount: 500  },
  { id: 'credits-30',  credits: 30,  amount: 1200 },
  { id: 'credits-100', credits: 100, amount: 3500 },
];

let _stripe = null;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  if (!_stripe) _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}
function isConfigured() { return !!process.env.STRIPE_SECRET_KEY; }

function getPack(id) { return PACKS.find(p => p.id === id) || null; }
function fmtPrice(amount) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: CURRENCY.toUpperCase() }).format(amount / 100); }
  catch { return `${(amount / 100).toFixed(2)} ${CURRENCY.toUpperCase()}`; }
}
function getPacks() {
  return PACKS.map(p => ({ id: p.id, credits: p.credits, amount: p.amount, currency: CURRENCY, priceLabel: fmtPrice(p.amount) }));
}

// Create a hosted Checkout session for a pack. The teacher's email + the credit
// amount ride along in metadata so the webhook knows who to credit.
async function createCheckoutSession({ packId, email, successUrl, cancelUrl }) {
  const pack = getPack(packId);
  if (!pack) throw new Error('Unknown credit pack.');
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        product_data: { name: `${pack.credits} LessonScope + TeacherScope credits` },
        unit_amount: pack.amount,
      },
    }],
    metadata: { email: (email || '').toLowerCase(), credits: String(pack.credits), packId: pack.id },
    success_url: `${successUrl}?billing=success`,
    cancel_url: `${cancelUrl}?billing=cancel`,
  });
  return session.url;
}

// Verify a webhook payload came from Stripe (HMAC signature) and return the event.
function constructEvent(rawBody, signature) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook secret is not configured.');
  return stripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { CURRENCY, PACKS, isConfigured, getPack, getPacks, createCheckoutSession, constructEvent };
