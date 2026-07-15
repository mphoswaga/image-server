// Lightweight teacher accounts: email + password (bcrypt-hashed), stored in
// <DATA_DIR>/users.json. Sessions are stateless JWTs in an httpOnly cookie,
// signed with a persisted secret. DATA_DIR lives on a persistent volume in
// production (see storage.js) so accounts survive redeploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DATA_DIR, writeFileAtomic, writeJsonAtomic } = require('./storage');

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SECRET_PATH = path.join(DATA_DIR, '.session-secret');
const TOKEN_TTL = '30d';
const COOKIE_NAME = 'lc_token';

function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, 'utf8');
  const secret = crypto.randomBytes(48).toString('hex');
  writeFileAtomic(SECRET_PATH, secret);
  return secret;
}
const SECRET = getSecret();

function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); } catch { return {}; }
}
function saveUsers(users) { writeJsonAtomic(USERS_PATH, users); }

function findByEmail(email) {
  const users = loadUsers();
  const key = String(email).trim().toLowerCase();
  return Object.values(users).find(u => u.email === key) || null;
}

async function signup(email, password, name, forceRole) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please enter a valid email address.');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');
  if (findByEmail(email)) throw new Error('An account with that email already exists.');
  const users = loadUsers();
  // Students (signing up from a game link) are always 'student'. Otherwise the
  // first teacher to sign up (or the configured ADMIN_EMAIL) becomes admin.
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const role = forceRole === 'student' ? 'student'
    : (Object.keys(users).length === 0 || (adminEmail && email === adminEmail)) ? 'admin' : 'teacher';
  const id = crypto.randomUUID();
  users[id] = { id, email, name: (name || '').trim() || email.split('@')[0], passwordHash: await bcrypt.hash(password, 10), role, createdAt: new Date().toISOString() };
  saveUsers(users);
  return publicUser(users[id]);
}

async function login(email, password) {
  const u = findByEmail(email);
  if (!u) return null;
  if (!u.passwordHash) return null; // social-only account — must use its provider
  const ok = await bcrypt.compare(String(password || ''), u.passwordHash);
  return ok ? publicUser(u) : null;
}

// Sign in (or register) a teacher via a social provider (Google/Microsoft).
// Resolution order:
//   1. an account already linked to this exact provider identity
//   2. an existing account with the same email → link this identity to it
//      (the provider vouches for the email, so this safely unifies a teacher
//       who first signed up with a password and later uses "Continue with …")
//   3. otherwise create a new, password-less account
function findByIdentity(users, key) {
  return Object.values(users).find(u => u.identities && u.identities[key]) || null;
}
async function findOrCreateSocialUser({ provider, providerUserId, email, name }) {
  email = String(email || '').trim().toLowerCase();
  if (!provider || !providerUserId || !email) throw new Error('Incomplete profile from provider.');
  const key = `${provider}:${providerUserId}`;
  const users = loadUsers();

  let u = findByIdentity(users, key) || (findByEmail(email) && users[findByEmail(email).id]);
  if (u) {
    u.identities = u.identities || {};
    if (!u.identities[key]) u.identities[key] = { email, linkedAt: new Date().toISOString() };
    if (!u.name && name) u.name = name;
    saveUsers(users);
    return publicUser(u);
  }

  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const role = (Object.keys(users).length === 0 || (adminEmail && email === adminEmail)) ? 'admin' : 'teacher';
  const id = crypto.randomUUID();
  users[id] = {
    id, email, name: (name || '').trim() || email.split('@')[0], role,
    identities: { [key]: { email, linkedAt: new Date().toISOString() } },
    createdAt: new Date().toISOString(),
  };
  saveUsers(users);
  return publicUser(users[id]);
}

function publicUser(u) { return { id: u.id, email: u.email, name: u.name, role: u.role || 'teacher' }; }

function issueToken(userId) { return jwt.sign({ uid: userId }, SECRET, { expiresIn: TOKEN_TTL }); }
function verifyToken(token) {
  try { return jwt.verify(token, SECRET).uid; } catch { return null; }
}
function getUserById(id) {
  const u = loadUsers()[id];
  return u ? publicUser(u) : null;
}

async function verifyPassword(userId, password) {
  const u = loadUsers()[userId];
  if (!u || !u.passwordHash) return false;
  return bcrypt.compare(String(password || ''), u.passwordHash);
}

// ── Passkeys (WebAuthn) — alongside password login, not replacing it ───────
// Each user may have several passkeys (one per device). Only the public key
// is ever stored; the private key never leaves the authenticator. The
// cryptographic verification itself lives in webauthn.js via
// @simplewebauthn/server — these are just the storage primitives.

function addPasskey(userId, { id, publicKey, counter, transports, deviceType, backedUp, label }) {
  const users = loadUsers();
  const u = users[userId];
  if (!u) return false;
  u.passkeys = u.passkeys || [];
  u.passkeys.push({
    id, publicKey: Buffer.from(publicKey).toString('base64'), counter,
    transports: transports || [], deviceType, backedUp,
    label: String(label || 'Passkey').slice(0, 60),
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);
  return true;
}

// Public-safe view — never exposes the public key itself.
function listPasskeys(userId) {
  const u = loadUsers()[userId];
  return ((u && u.passkeys) || []).map(p => ({ id: p.id, label: p.label, createdAt: p.createdAt }));
}

function deletePasskey(userId, credentialId) {
  const users = loadUsers();
  const u = users[userId];
  if (!u || !u.passkeys) return false;
  const before = u.passkeys.length;
  u.passkeys = u.passkeys.filter(p => p.id !== credentialId);
  if (u.passkeys.length === before) return false;
  saveUsers(users);
  return true;
}

// Login (discoverable credentials) doesn't know which user is authenticating
// until the browser reports which credential ID it used — so this scans
// every user's passkeys. Fine at this app's scale (same pattern as the
// password-reset token scan).
function findByCredentialId(credentialId) {
  const users = loadUsers();
  for (const u of Object.values(users)) {
    const cred = (u.passkeys || []).find(p => p.id === credentialId);
    if (cred) return { userId: u.id, credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, 'base64'), counter: cred.counter, transports: cred.transports } };
  }
  return null;
}

// Authenticators report an incrementing counter on each use — persisting it
// lets a future login detect a cloned/replayed credential (its counter would
// go backward or repeat instead of increasing).
function updatePasskeyCounter(userId, credentialId, newCounter) {
  const users = loadUsers();
  const u = users[userId];
  if (!u || !u.passkeys) return;
  const cred = u.passkeys.find(p => p.id === credentialId);
  if (cred) { cred.counter = newCounter; saveUsers(users); }
}

// ── Password reset ───────────────────────────────────────────────────────
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

// Returns the raw token to email the user (never stored in plain form — only
// its hash is persisted, same principle as the password itself) or null if
// no account matches. Callers must respond the same way either way, so this
// endpoint can't be used to test which emails have accounts.
async function createPasswordResetToken(email) {
  const u = findByEmail(email);
  if (!u) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const users = loadUsers();
  users[u.id].resetTokenHash = await bcrypt.hash(token, 10);
  users[u.id].resetTokenExpires = Date.now() + RESET_TTL_MS;
  saveUsers(users);
  return token;
}

// Verifies the token against every user with a pending reset (there's no
// direct token->user index since only the hash is stored) and, if valid,
// sets the new password and invalidates the token immediately.
async function resetPasswordWithToken(token, newPassword) {
  if (!token) throw new Error('Invalid or expired reset link.');
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters.');
  const users = loadUsers();
  const now = Date.now();
  for (const u of Object.values(users)) {
    if (!u.resetTokenHash || !u.resetTokenExpires) continue;
    if (u.resetTokenExpires < now) continue;
    if (await bcrypt.compare(token, u.resetTokenHash)) {
      u.passwordHash = await bcrypt.hash(newPassword, 10);
      u.resetTokenHash = null;
      u.resetTokenExpires = null;
      saveUsers(users);
      return true;
    }
  }
  throw new Error('Invalid or expired reset link.');
}

function listAllUserIds() {
  return Object.keys(loadUsers());
}

// Express middleware: require a logged-in teacher (sets req.userId + req.user).
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  const uid = token && verifyToken(token);
  const user = uid && getUserById(uid);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  req.userId = uid;
  req.user = user;
  next();
}

// Require an admin (chains through requireAuth first).
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
    next();
  });
}

module.exports = { signup, login, findOrCreateSocialUser, issueToken, verifyToken, getUserById, verifyPassword, listAllUserIds, requireAuth, requireAdmin, COOKIE_NAME, createPasswordResetToken, resetPasswordWithToken, addPasskey, listPasskeys, deletePasskey, findByCredentialId, updatePasskeyCounter };
