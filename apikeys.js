// API key management for external app access.
// Admin keys: stored as hashes at DATA_DIR/admin-apikeys.json — grant read access to ALL data.
// (Per-teacher keys were removed; only admin keys are used by the external report-card app.)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const ADMIN_KEYS_PATH = path.join(DATA_DIR, 'admin-apikeys.json');

function loadAdminKeys() {
  try { return JSON.parse(fs.readFileSync(ADMIN_KEYS_PATH, 'utf8')); }
  catch { return []; }
}

// Generate a new API key: 32 random bytes → base64url "lc_xxxxxxx" format.
function generateKey() {
  const bytes = crypto.randomBytes(32);
  return 'lc_' + bytes.toString('base64').slice(0, 48).replace(/[+/=]/g, x => ({ '+': '-', '/': '_', '=': '' }[x]));
}

// SHA-256 hash a key for storage (never store plaintext).
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Create a new admin-scoped API key. Returns { key (plaintext, shown once), hash, createdAt, label }.
function createAdminKey(label) {
  const key = generateKey();
  const hash = hashKey(key);
  const keys = loadAdminKeys();
  const record = { hash, label: String(label || 'Admin API Key').slice(0, 50), createdAt: new Date().toISOString(), lastUsedAt: null };
  keys.push(record);
  writeJsonAtomic(ADMIN_KEYS_PATH, keys);
  return { key, ...record };
}

// List all admin keys (hashes only — no plaintext).
function listAdminKeys() {
  return loadAdminKeys();
}

// Delete an admin key by hash.
function deleteAdminKey(hash) {
  const keys = loadAdminKeys().filter(k => k.hash !== hash);
  writeJsonAtomic(ADMIN_KEYS_PATH, keys);
}

// Verify a plaintext Bearer key.
// Returns { isAdmin: true } if it matches an admin key, or null if invalid.
// On match, records lastUsedAt.
function verifyKey(plainKey) {
  const hash = hashKey(plainKey);

  // Check admin keys first.
  const adminKeys = loadAdminKeys();
  const adminMatch = adminKeys.find(k => k.hash === hash);
  if (adminMatch) {
    adminMatch.lastUsedAt = new Date().toISOString();
    writeJsonAtomic(ADMIN_KEYS_PATH, adminKeys);
    return { isAdmin: true };
  }

  return null;
}

module.exports = { generateKey, createAdminKey, listAdminKeys, deleteAdminKey, verifyKey };
