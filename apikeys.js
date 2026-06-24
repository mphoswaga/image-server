// API key management for external app access.
// Keys are stored as hashes (SHA-256); plaintext is returned only once on creation.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

function keysPath(teacherId) {
  return path.join(DATA_DIR, 'users', teacherId, 'apikeys.json');
}

// Load all keys for a teacher (hash form).
function loadKeys(teacherId) {
  try {
    return JSON.parse(fs.readFileSync(keysPath(teacherId), 'utf8'));
  } catch {
    return [];
  }
}

// Generate a new API key: 32 random bytes → base64 "lc_xxxxxxx" format.
function generateKey() {
  const bytes = crypto.randomBytes(32);
  return 'lc_' + bytes.toString('base64').slice(0, 48).replace(/[+/=]/g, x => ({ '+': '-', '/': '_', '=': '' }[x]));
}

// Hash a key for storage (never store plaintext).
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Create a new API key. Returns { key (plaintext, shown once), hash, createdAt, label }.
function createKey(teacherId, label = 'API Key') {
  const key = generateKey();
  const hash = hashKey(key);
  const keys = loadKeys(teacherId);
  const record = { hash, label, createdAt: new Date().toISOString(), lastUsedAt: null };
  keys.push(record);
  fs.mkdirSync(path.dirname(keysPath(teacherId)), { recursive: true });
  writeJsonAtomic(keysPath(teacherId), keys);
  return { key, ...record };  // Return plaintext key once
}

// List all keys for a teacher (hashes only, no plaintext).
function listKeys(teacherId) {
  return loadKeys(teacherId);
}

// Delete a key by hash.
function deleteKey(teacherId, hash) {
  const keys = loadKeys(teacherId).filter(k => k.hash !== hash);
  fs.mkdirSync(path.dirname(keysPath(teacherId)), { recursive: true });
  writeJsonAtomic(keysPath(teacherId), keys);
}

// Verify a plaintext key and return the teacher ID if valid.
// On success, also record lastUsedAt.
function verifyKey(plainKey) {
  const hash = hashKey(plainKey);
  // Scan all teachers' keys (slow but simple; optimize later with an index if needed).
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return null;
  for (const teacherId of fs.readdirSync(usersDir)) {
    const keys = loadKeys(teacherId);
    const found = keys.find(k => k.hash === hash);
    if (found) {
      // Update lastUsedAt
      found.lastUsedAt = new Date().toISOString();
      const allKeys = loadKeys(teacherId);
      writeJsonAtomic(keysPath(teacherId), allKeys);
      return teacherId;
    }
  }
  return null;
}

module.exports = { generateKey, createKey, listKeys, deleteKey, verifyKey };
