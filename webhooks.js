// Webhook delivery for OAuth clients.
// Registered per-client at DATA_DIR/oauth/webhooks.json.
// Payloads are HMAC-SHA256 signed; delivery is fire-and-forget with one retry.
// NEVER include student result details — only IDs and timestamps.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const audit = require('./audit');

const WEBHOOKS_PATH = path.join(DATA_DIR, 'oauth', 'webhooks.json');

const VALID_EVENTS = ['roster.updated', 'result.created'];

function loadWebhooks() {
  try { return JSON.parse(fs.readFileSync(WEBHOOKS_PATH, 'utf8')); } catch { return {}; }
}
function saveWebhooks(w) {
  fs.mkdirSync(path.dirname(WEBHOOKS_PATH), { recursive: true });
  writeJsonAtomic(WEBHOOKS_PATH, w);
}

// Register or replace a client's webhook.
function setWebhook(clientId, { url, secret, events }) {
  if (!url || !url.startsWith('https://')) throw new Error('Webhook URL must use HTTPS.');
  const w = loadWebhooks();
  w[clientId] = {
    clientId,
    url: String(url),
    secret: String(secret || crypto.randomBytes(20).toString('hex')),
    events: Array.isArray(events) ? events.filter(e => VALID_EVENTS.includes(e)) : [...VALID_EVENTS],
    createdAt: new Date().toISOString(),
  };
  saveWebhooks(w);
  return { clientId, url: w[clientId].url, events: w[clientId].events };
}

function getWebhook(clientId) { return loadWebhooks()[clientId] || null; }

function deleteWebhook(clientId) {
  const w = loadWebhooks();
  if (!w[clientId]) return false;
  delete w[clientId];
  saveWebhooks(w);
  return true;
}

function listWebhooks() {
  return Object.values(loadWebhooks()).map(w => ({
    clientId: w.clientId, url: w.url, events: w.events, createdAt: w.createdAt,
  }));
}

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function postOnce(url, body, sig, event) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LessonCope-Signature': sig,
        'X-LessonCope-Event': event,
        'User-Agent': 'LessonCope-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    });
    return { status: r.status };
  } catch { return { status: 0 }; }
  finally { clearTimeout(t); }
}

// Dispatch an event to all clients subscribed to it (or to a specific client).
// Fire-and-forget — caller does not await this.
async function dispatch(event, payload, { clientId: targetClientId } = {}) {
  const all = loadWebhooks();
  const targets = targetClientId
    ? [all[targetClientId]].filter(Boolean)
    : Object.values(all).filter(w => w.events.includes(event));

  for (const w of targets) {
    const body = JSON.stringify({ event, ...payload, deliveredAt: new Date().toISOString() });
    const sig = sign(w.secret, body);
    let result = await postOnce(w.url, body, sig, event);
    if (!result.status || result.status >= 500) {
      await new Promise(r => setTimeout(r, 5000));
      result = await postOnce(w.url, body, sig, event);
    }
    audit.log('webhook.dispatched', { event, clientId: w.clientId, status: result.status });
  }
}

module.exports = { setWebhook, getWebhook, deleteWebhook, listWebhooks, dispatch, VALID_EVENTS };
