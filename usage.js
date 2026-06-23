// AI cost tracking. Every OpenAI call (see ai-client.js) records its token /
// image usage here, attributed to the user who triggered it. The admin panel
// reads summary() to see cost per user and overall — so you can price the app.
//
// Persisted to DATA_DIR/usage.json (on the volume → survives redeploys).
const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const USAGE_PATH = path.join(DATA_DIR, 'usage.json');

// ── PRICING (USD) — EDIT THESE when OpenAI's prices change. ─────────────────
// Token models: cost per 1,000,000 tokens (input / output).
// Image models: cost per generated image (a rough average — gpt-image-1 varies
// by size/quality; adjust to match what you actually see on your OpenAI bill).
// Override any value at runtime with an env var, e.g. PRICE_GPT_4O_MINI_IN.
const PRICING = {
  'gpt-4o-mini': { inPerM: numEnv('PRICE_GPT_4O_MINI_IN', 0.15), outPerM: numEnv('PRICE_GPT_4O_MINI_OUT', 0.60) },
  'gpt-4o':      { inPerM: numEnv('PRICE_GPT_4O_IN', 2.50), outPerM: numEnv('PRICE_GPT_4O_OUT', 10.00) },
  'gpt-image-1': { perImage: numEnv('PRICE_GPT_IMAGE_1', 0.04) },
  'dall-e-3':    { perImage: numEnv('PRICE_DALL_E_3', 0.04) },
};
const FALLBACK = { inPerM: 0.15, outPerM: 0.60 }; // unknown chat model → assume mini-rate

function numEnv(name, dflt) { const v = parseFloat(process.env[name]); return Number.isFinite(v) ? v : dflt; }

function costFor(model, { promptTokens = 0, completionTokens = 0, images = 0 } = {}) {
  const p = PRICING[model];
  if (p && p.perImage != null) return images * p.perImage;
  const rate = (p && p.inPerM != null) ? p : FALLBACK;
  return (promptTokens / 1e6) * rate.inPerM + (completionTokens / 1e6) * rate.outPerM;
}

const emptyBucket = () => ({ calls: 0, promptTokens: 0, completionTokens: 0, images: 0, costUSD: 0 });
function bump(b, pt, ct, img, cost) {
  b.calls += 1; b.promptTokens += pt; b.completionTokens += ct; b.images += img;
  b.costUSD = +(b.costUSD + cost).toFixed(6);
}

function load() {
  try { return JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8')); }
  catch { return { totals: emptyBucket(), byUser: {}, byModel: {}, updatedAt: null }; }
}

// Record one AI call. Read-modify-write with an atomic save (fine at MVP
// concurrency; move to a DB if many calls land in the same instant).
function record({ userId, model, promptTokens = 0, completionTokens = 0, images = 0 } = {}) {
  if (!model) return 0;
  const cost = costFor(model, { promptTokens, completionTokens, images });
  const u = load();
  bump(u.totals, promptTokens, completionTokens, images, cost);
  const uid = userId || 'system';
  (u.byUser[uid] || (u.byUser[uid] = emptyBucket()));
  bump(u.byUser[uid], promptTokens, completionTokens, images, cost);
  (u.byModel[model] || (u.byModel[model] = emptyBucket()));
  bump(u.byModel[model], promptTokens, completionTokens, images, cost);
  u.updatedAt = new Date().toISOString();
  try { writeJsonAtomic(USAGE_PATH, u); } catch (e) { console.error('usage save failed:', e.message); }
  return cost;
}

function summary() { return load(); }

module.exports = { record, summary, costFor, PRICING };
