// OAuth 2.0 authorization server state for LessonCope.
// Grant type: authorization_code only.
//
// Clients  — hashed at DATA_DIR/oauth/clients.json
// Auth codes — in-memory Map (10 min TTL, single-use); lost on restart,
//              which is intentional: auth codes are interactive and short-lived.
// Tokens   — SHA-256 hashed at DATA_DIR/oauth/tokens.json (1 hr TTL).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const OAUTH_DIR = path.join(DATA_DIR, 'oauth');
const CLIENTS_PATH = path.join(OAUTH_DIR, 'clients.json');
const TOKENS_PATH = path.join(OAUTH_DIR, 'tokens.json');

const CODE_TTL_MS  = 10 * 60 * 1000;  // 10 minutes
const TOKEN_TTL_S  = 3600;             // 1 hour
const TOKEN_TTL_MS = TOKEN_TTL_S * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDir() { fs.mkdirSync(OAUTH_DIR, { recursive: true }); }

function loadClients() {
  try { return JSON.parse(fs.readFileSync(CLIENTS_PATH, 'utf8')); } catch { return {}; }
}
function saveClients(c) { ensureDir(); writeJsonAtomic(CLIENTS_PATH, c); }

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')); } catch { return {}; }
}
function saveTokens(t) { ensureDir(); writeJsonAtomic(TOKENS_PATH, t); }

// ── Auth codes (in-memory) ─────────────────────────────────────────────────

const _codes = new Map(); // code → { clientId, teacherId, scopes, redirectUri, expiresAt }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _codes) if (v.expiresAt < now) _codes.delete(k);
}, 5 * 60 * 1000).unref();

// ── Client registry ────────────────────────────────────────────────────────

const ALL_SCOPES = ['profile:read', 'rosters:read', 'results:read'];

// Create a new OAuth client. Returns { clientId, clientSecret (plaintext, show once) }.
async function registerClient({ name, redirectUris, allowedScopes }) {
  ensureDir();
  const clientId = 'lcs_' + crypto.randomBytes(12).toString('hex');
  const plainSecret = 'lcs_sec_' + crypto.randomBytes(24).toString('hex');
  const secretHash = await bcrypt.hash(plainSecret, 10);
  const clients = loadClients();
  clients[clientId] = {
    clientId,
    secretHash,
    name: String(name || 'OAuth Client').slice(0, 80),
    redirectUris: Array.isArray(redirectUris) ? redirectUris.map(String) : [],
    allowedScopes: Array.isArray(allowedScopes)
      ? allowedScopes.filter(s => ALL_SCOPES.includes(s))
      : [...ALL_SCOPES],
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  saveClients(clients);
  return { clientId, clientSecret: plainSecret };
}

function getClient(clientId) {
  const c = loadClients()[clientId];
  return (c && c.status === 'active') ? c : null;
}

function listClients() {
  return Object.values(loadClients()).map(c => ({
    clientId: c.clientId, name: c.name,
    redirectUris: c.redirectUris, allowedScopes: c.allowedScopes,
    createdAt: c.createdAt, status: c.status,
  }));
}

function setClientStatus(clientId, status) {
  const clients = loadClients();
  if (!clients[clientId]) return false;
  clients[clientId].status = status;
  saveClients(clients);
  return true;
}

async function verifyClientSecret(clientId, plainSecret) {
  const c = loadClients()[clientId];
  if (!c || !c.secretHash) return false;
  return bcrypt.compare(String(plainSecret || ''), c.secretHash);
}

// ── Authorization codes ────────────────────────────────────────────────────

function createAuthCode({ clientId, teacherId, scopes, redirectUri }) {
  const code = crypto.randomBytes(24).toString('base64url');
  _codes.set(code, {
    clientId, teacherId,
    scopes: Array.isArray(scopes) ? scopes : [],
    redirectUri,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
}

// Consume: validates and deletes (single-use). Returns record or null.
function consumeAuthCode(code, clientId, redirectUri) {
  const entry = _codes.get(code);
  _codes.delete(code); // always delete — prevents timing side-channels
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  if (entry.clientId !== clientId) return null;
  if (entry.redirectUri !== redirectUri) return null;
  return entry;
}

// ── Access tokens ──────────────────────────────────────────────────────────

function hashToken(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function createAccessToken({ clientId, teacherId, scopes }) {
  const plain = 'lc_at_' + crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(plain);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const tokens = loadTokens();
  tokens[tokenHash] = { tokenHash, clientId, teacherId, scopes, issuedAt: now, expiresAt, revokedAt: null };
  saveTokens(tokens);
  return { accessToken: plain, tokenType: 'Bearer', expiresIn: TOKEN_TTL_S, scope: scopes.join(' ') };
}

// Returns the stored record, or null if invalid/expired/revoked.
function verifyAccessToken(plain) {
  if (!plain || !plain.startsWith('lc_at_')) return null;
  const rec = loadTokens()[hashToken(plain)];
  if (!rec) return null;
  if (rec.revokedAt) return null;
  if (new Date(rec.expiresAt).getTime() < Date.now()) return null;
  return rec;
}

function revokeAccessToken(plain) {
  const h = hashToken(plain);
  const tokens = loadTokens();
  if (!tokens[h]) return false;
  tokens[h].revokedAt = new Date().toISOString();
  saveTokens(tokens);
  return true;
}

// Revoke every active token for one teacher under a given client.
function revokeConnection(teacherId, clientId) {
  const tokens = loadTokens();
  let n = 0;
  for (const t of Object.values(tokens)) {
    if (t.teacherId === teacherId && t.clientId === clientId && !t.revokedAt) {
      t.revokedAt = new Date().toISOString();
      n++;
    }
  }
  if (n) saveTokens(tokens);
  return n;
}

// Active OAuth connections for a teacher (no plaintext tokens).
function listConnectionsForTeacher(teacherId) {
  const clients = loadClients();
  const tokens = loadTokens();
  const seen = new Set();
  const out = [];
  for (const t of Object.values(tokens)) {
    if (t.teacherId !== teacherId || t.revokedAt) continue;
    if (new Date(t.expiresAt).getTime() < Date.now()) continue;
    if (seen.has(t.clientId)) continue;
    seen.add(t.clientId);
    const c = clients[t.clientId];
    out.push({
      clientId: t.clientId,
      clientName: c ? c.name : t.clientId,
      scopes: t.scopes,
      issuedAt: t.issuedAt,
      expiresAt: t.expiresAt,
    });
  }
  return out;
}

// Periodic cleanup — keeps tokens.json from growing without bound.
setInterval(() => {
  const tokens = loadTokens();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [h, t] of Object.entries(tokens)) {
    if (new Date(t.expiresAt).getTime() < cutoff || (t.revokedAt && new Date(t.revokedAt).getTime() < cutoff)) {
      delete tokens[h]; changed = true;
    }
  }
  if (changed) saveTokens(tokens);
}, 60 * 60 * 1000).unref();

module.exports = {
  ALL_SCOPES,
  registerClient, getClient, listClients, setClientStatus, verifyClientSecret,
  createAuthCode, consumeAuthCode,
  createAccessToken, verifyAccessToken, revokeAccessToken,
  revokeConnection, listConnectionsForTeacher,
};
