// Billing adapter — Lemon Squeezy (Merchant of Record). Serves teachers
// worldwide: each buyer sees their own local currency and local payment methods
// (cards, Google Pay, PayPal, …), and Lemon Squeezy remits VAT/sales tax and
// pays you out (PayPal/Wise). Kept behind the SAME small interface the server
// expects, so the wallet / gating / UI / cross-app API are untouched and
// switching processor again is a one-file change.
//
// REST + an HMAC-SHA256 signed webhook, so there's no SDK. Crediting is
// webhook-driven (order_created); credits.grantOnce keeps it idempotent.
//
// Credential-gated: without the Lemon Squeezy keys the app just doesn't offer
// purchasing.
const crypto = require('crypto');

// Editable pack catalogue. amount is in the store-currency subunit (USD cents).
// Lemon Squeezy localises the displayed price/currency to each buyer.
const CURRENCY = (process.env.BILLING_CURRENCY || 'usd').toLowerCase();
const PACKS = [
  { id: 'credits-10',  credits: 10,  amount: 500  },  // $5
  { id: 'credits-30',  credits: 30,  amount: 1200 },  // $12
  { id: 'credits-100', credits: 100, amount: 3500 },  // $35
];

const API = 'https://api.lemonsqueezy.com/v1';
const key = () => process.env.LEMONSQUEEZY_API_KEY;
const storeId = () => process.env.LEMONSQUEEZY_STORE_ID;
const variantId = () => process.env.LEMONSQUEEZY_VARIANT_ID;     // one "Credits" product/variant
const webhookSecret = () => process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
function isConfigured() { return !!(key() && storeId() && variantId()); }

function getPack(id) { return PACKS.find(p => p.id === id) || null; }
function fmtPrice(amount) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: CURRENCY.toUpperCase() }).format(amount / 100); }
  catch { return `${(amount / 100).toFixed(2)} ${CURRENCY.toUpperCase()}`; }
}
function getPacks() {
  return PACKS.map(p => ({ id: p.id, credits: p.credits, amount: p.amount, currency: CURRENCY, priceLabel: fmtPrice(p.amount) }));
}

// Create a hosted Lemon Squeezy checkout for a pack (overriding the variant's
// price so one product serves every pack). Buyer email + credit amount ride in
// custom data so the webhook knows who to credit.
async function createCheckoutSession({ packId, email, successUrl }) {
  const pack = getPack(packId);
  if (!pack) throw new Error('Unknown credit pack.');
  if (!isConfigured()) throw new Error('Payments are not set up yet.');
  const res = await fetch(API + '/checkouts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          custom_price: pack.amount,
          product_options: { redirect_url: `${successUrl}?billing=return`, enabled_variants: [Number(variantId())] },
          checkout_data: { email: email || undefined, custom: { email: (email || '').toLowerCase(), credits: String(pack.credits), pack_id: pack.id } },
        },
        relationships: {
          store: { data: { type: 'stores', id: String(storeId()) } },
          variant: { data: { type: 'variants', id: String(variantId()) } },
        },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors && data.errors[0] && data.errors[0].detail) || `Lemon Squeezy error (${res.status})`);
  return data.data.attributes.url;
}

// Verify a webhook came from Lemon Squeezy (HMAC-SHA256 of the raw body with the
// signing secret) and normalise it to the shape the server's handler expects.
function constructEvent(rawBody, signature) {
  if (!webhookSecret()) throw new Error('Webhook secret not configured.');
  const hash = crypto.createHmac('sha256', webhookSecret()).update(rawBody).digest('hex');
  const a = Buffer.from(hash), b = Buffer.from(String(signature || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid webhook signature.');
  const evt = JSON.parse(rawBody.toString('utf8'));
  const meta = evt.meta || {}, custom = meta.custom_data || {};
  const attrs = (evt.data && evt.data.attributes) || {};
  return {
    id: (evt.data && evt.data.id) || meta.event_id,
    type: meta.event_name === 'order_created' ? 'checkout.session.completed' : meta.event_name,
    data: { object: {
      id: (evt.data && evt.data.id),
      metadata: { email: (custom.email || attrs.user_email || '').toLowerCase(), credits: custom.credits },
      customer_details: { email: attrs.user_email },
    } },
  };
}

module.exports = { CURRENCY, PACKS, isConfigured, getPack, getPacks, createCheckoutSession, constructEvent };
