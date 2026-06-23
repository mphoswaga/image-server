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

// Run fn (and everything it awaits) with the given user as the usage owner.
function runWithUser(userId, fn) { return als.run({ userId: userId || null }, fn); }
const currentUser = () => (als.getStore() && als.getStore().userId) || null;

// Thin wrapper exposing only the two surfaces the app uses, with recording.
function client() {
  const oc = raw();
  return {
    chat: { completions: { create: async (args) => {
      const res = await oc.chat.completions.create(args);
      try {
        const u = res && res.usage;
        if (u) usage.record({ userId: currentUser(), model: args && args.model, promptTokens: u.prompt_tokens || 0, completionTokens: u.completion_tokens || 0 });
      } catch {}
      return res;
    } } },
    images: { generate: async (args) => {
      const res = await oc.images.generate(args);
      try {
        const n = (res && res.data && res.data.length) || (args && args.n) || 1;
        usage.record({ userId: currentUser(), model: (args && args.model) || 'gpt-image-1', images: n });
      } catch {}
      return res;
    } },
  };
}

module.exports = { client, runWithUser, currentUser };
