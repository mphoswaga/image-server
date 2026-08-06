// Shared, instrumented OpenAI client. Every chat/image call made through this
// wrapper auto-records its token/image usage (usage.js) against the user who
// triggered the request, tracked via AsyncLocalStorage. All generator modules
// use client() instead of `new OpenAI()` so nothing escapes cost tracking.
const OpenAI = require('openai');
const { AsyncLocalStorage } = require('async_hooks');
const usage = require('./usage');

const als = new AsyncLocalStorage();
let _raw = null;
const raw = () => (_raw || (_raw = new OpenAI({ maxRetries: 6 })));

// A per-request accumulator of everything the AI cost, so a caller can read the
// exact tokens/cost a single action incurred (snapshot before, snapshot after,
// diff) — used to attach model/token/cost metadata when capturing credits.
const newAcc = () => ({ calls: 0, promptTokens: 0, completionTokens: 0, images: 0, costUSD: 0, models: {} });

// Run fn (and everything it awaits) with the given user as the usage owner.
function runWithUser(userId, fn) { return als.run({ userId: userId || null, usage: newAcc(), action: null }, fn); }
const currentUser = () => (als.getStore() && als.getStore().userId) || null;
const currentAcc = () => (als.getStore() && als.getStore().usage) || null;

// ── Billing declaration ────────────────────────────────────────────────────
// Catalogue guards only catch a *wrong* action name. The failure that actually
// costs money is an endpoint that calls the AI having never declared an action
// at all — exactly what /api/lesson-plan did. Every request that reaches the AI
// must name the action it is doing, priced or deliberately free, and this is the
// one place every call passes through.
function declareAction(action) {
  const store = als.getStore();
  if (store) store.action = action;
  return action;
}
const currentAction = () => (als.getStore() && als.getStore().action) || null;

function assertDeclared(kind) {
  // Outside a request (CLI tools, the offline captioner, tests exercising a
  // generator directly) there is no wallet context to speak of, so nothing to
  // enforce.
  if (!als.getStore()) return;
  if (currentAction()) return;
  const msg = `Unbilled AI call: a ${kind} request ran without declaring a credit action. `
    + `Call reserve(req, '<action>') for a paid feature, or declareFree('<action>') for a `
    + `deliberately free one (see credit-prices.js).`;
  // Fail loudly where it is cheap to fix; never break a teacher mid-lesson over
  // a billing-policy slip in production.
  if (process.env.NODE_ENV === 'test') throw new Error(msg);
  console.error(msg);
}

// A copy of the request's cumulative AI usage so far (null outside a request).
function usageSnapshot() {
  const a = currentAcc();
  if (!a) return null;
  return { calls: a.calls, promptTokens: a.promptTokens, completionTokens: a.completionTokens, images: a.images, costUSD: +a.costUSD.toFixed(6), models: Object.keys(a.models) };
}
// The delta between an earlier snapshot and now — i.e. one action's own usage.
function usageSince(before) {
  const now = usageSnapshot();
  if (!now) return null;
  const b = before || { calls: 0, promptTokens: 0, completionTokens: 0, images: 0, costUSD: 0, models: [] };
  return {
    calls: now.calls - b.calls,
    promptTokens: now.promptTokens - b.promptTokens,
    completionTokens: now.completionTokens - b.completionTokens,
    images: now.images - b.images,
    costUSD: +(now.costUSD - b.costUSD).toFixed(6),
    models: now.models.filter(m => !b.models.includes(m)),
  };
}
function accrue(model, cost, pt, ct, img) {
  const a = currentAcc();
  if (!a) return;
  a.calls += 1; a.promptTokens += pt; a.completionTokens += ct; a.images += img;
  a.costUSD += cost || 0; if (model) a.models[model] = true;
}

// Thin wrapper exposing only the two surfaces the app uses, with recording.
// The underlying SDK is built lazily inside each call, not here: constructing it
// eagerly made client() throw on a missing API key before the billing guard
// could run, which masked a billing mistake behind a credentials error.
function client() {
  return {
    chat: { completions: { create: async (args) => {
      assertDeclared('chat');
      const res = await raw().chat.completions.create(args);
      try {
        const u = res && res.usage;
        if (u) {
          const pt = u.prompt_tokens || 0, ct = u.completion_tokens || 0, model = args && args.model;
          const cost = usage.record({ userId: currentUser(), model, promptTokens: pt, completionTokens: ct });
          accrue(model, cost, pt, ct, 0);
        }
      } catch {}
      return res;
    } } },
    images: { generate: async (args) => {
      assertDeclared('image');
      const res = await raw().images.generate(args);
      try {
        const n = (res && res.data && res.data.length) || (args && args.n) || 1;
        const model = (args && args.model) || 'gpt-image-1';
        const cost = usage.record({ userId: currentUser(), model, images: n });
        accrue(model, cost, 0, 0, n);
      } catch {}
      return res;
    } },
  };
}

module.exports = { client, runWithUser, currentUser, declareAction, currentAction, usageSnapshot, usageSince };
