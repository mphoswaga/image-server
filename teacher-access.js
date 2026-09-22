// Invitation grants are persisted separately from identity: upgrading never moves data.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const file = path.join(DATA_DIR, 'teacher-access.json');
function read() {
  if (!fs.existsSync(file)) return { invites: {}, accounts: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function accessFor(id) { return read().accounts[id]?.mode || 'full'; }
function createInvite(mode, createdBy) {
  if (!['games', 'full'].includes(mode)) throw new Error('Choose games or full access.');
  const data = read();
  const code = crypto.randomBytes(24).toString('hex');
  const invite = { code, mode, createdBy, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), claimedBy: null };
  data.invites[code] = invite;
  writeJsonAtomic(file, data);
  return invite;
}
function validInvite(data, code, userId) {
  const invite = data.invites[String(code || '')];
  if (!invite || Date.parse(invite.expiresAt) <= Date.now()) throw new Error('This invitation has expired or is invalid. Ask for a new invitation.');
  if (invite.revoked || (invite.claimedBy && invite.claimedBy !== userId)) throw new Error('This invitation has already been used or withdrawn. Ask for a new invitation.');
  return invite;
}
function previewInvite(code) {
  const invite = validInvite(read(), code);
  return { mode: invite.mode, expiresAt: invite.expiresAt };
}
function claimInvite(code, user) {
  if (user.role === 'student') throw new Error('This invitation is for a teacher account.');
  const data = read();
  const invite = validInvite(data, code, user.id);
  if (invite.claimedBy === user.id) return accessFor(user.id);
  // An invite cannot downgrade an existing full account or an administrator.
  const prior = data.accounts[user.id];
  const establishedFull = !prior && Date.parse(user.createdAt || 0) < Date.parse(invite.createdAt);
  const mode = user.role === 'admin' || prior?.mode === 'full' || establishedFull ? 'full' : invite.mode;
  data.accounts[user.id] = { mode, updatedAt: new Date().toISOString() };
  invite.claimedBy = user.id;
  writeJsonAtomic(file, data);
  return mode;
}
function upgrade(id) {
  const data = read();
  data.accounts[id] = { mode: 'full', updatedAt: new Date().toISOString() };
  writeJsonAtomic(file, data);
}
function removeAccount(id) {
  const userId = String(id || '');
  if (!userId) return false;
  const data = read();
  let changed = false;
  if (data.accounts[userId]) {
    delete data.accounts[userId];
    changed = true;
  }
  for (const invite of Object.values(data.invites)) {
    if (invite.claimedBy === userId) {
      invite.claimedBy = null;
      invite.revoked = true;
      invite.revokedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(file, data);
  return changed;
}
function listInvites() { return Object.values(read().invites); }
function revoke(code) {
  const data = read();
  if (!data.invites[code]) throw new Error('Invitation not found.');
  data.invites[code].revoked = true;
  writeJsonAtomic(file, data);
}
function gamesRouteAllowed(url) {
  const p = String(url).split('?')[0];
  return /^\/api\/(?:me$|teacher-access(?:\/|$)|game(?:s)?(?:\/|$)|rosters?(?:\/|$)|student(?:s)?(?:\/|$)|billing(?:\/|$)|credits(?:\/|$)|config\/apps$|webauthn(?:\/|$)|logout$)/.test(p);
}
module.exports = { accessFor, createInvite, previewInvite, claimInvite, upgrade, removeAccount, listInvites, revoke, gamesRouteAllowed };
