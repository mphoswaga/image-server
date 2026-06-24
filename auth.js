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
  const ok = await bcrypt.compare(String(password || ''), u.passwordHash);
  return ok ? publicUser(u) : null;
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

module.exports = { signup, login, issueToken, verifyToken, getUserById, listAllUserIds, requireAuth, requireAdmin, COOKIE_NAME };
