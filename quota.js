// Per-teacher monthly cap on PAID "AI visuals" (generated images + generated
// diagrams) — the app's main cost lever. Free library/Unsplash images and text
// are NOT capped. Admins are exempt. The number is configurable so it can
// become a plan tier later.
//
// Persisted to DATA_DIR/quota.json: { <userId>: { "YYYY-MM": count } }.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const QUOTA_PATH = path.join(DATA_DIR, 'quota.json');
const LIMIT = (() => { const v = parseInt(process.env.AI_VISUAL_LIMIT, 10); return Number.isFinite(v) && v >= 0 ? v : 50; })();

function monthKey() { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
function load() { try { return JSON.parse(fs.readFileSync(QUOTA_PATH, 'utf8')); } catch { return {}; } }

function used(userId) {
  const q = load();
  return (q[userId] && q[userId][monthKey()]) || 0;
}

// What the UI/endpoints need: how many are left this month.
function status(userId, isAdmin) {
  const u = used(userId);
  if (isAdmin) return { used: u, limit: null, remaining: null, unlimited: true };
  return { used: u, limit: LIMIT, remaining: Math.max(0, LIMIT - u), unlimited: false };
}

// Call only AFTER a real paid generation succeeds.
function consume(userId) {
  const q = load();
  const m = monthKey();
  q[userId] = q[userId] || {};
  q[userId][m] = (q[userId][m] || 0) + 1;
  try { writeJsonAtomic(QUOTA_PATH, q); } catch (e) { console.error('quota save failed:', e.message); }
  return q[userId][m];
}

module.exports = { LIMIT, monthKey, used, status, consume };
