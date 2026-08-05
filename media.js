// Runtime image storage that survives Railway redeploys/restarts.
//
// The container filesystem (/app) is rebuilt from git on every deploy and
// restart, so anything written into public/ at runtime — on-demand Unsplash
// photos, AI-generated illustrations, uploaded lesson materials — is wiped,
// while the referencing deck (persisted on the /data volume) survives. The
// result is a live deck pointing at a deleted image → ENOENT on download.
//
// Fix: write ALL runtime images under MEDIA_DIR on the persistent /data volume.
// Committed starter images stay in public/ as a read-only seed. Reads prefer
// the volume copy and fall back to the committed seed; a missing file resolves
// to null so callers can degrade gracefully instead of throwing.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const PUBLIC_DIR = path.join(__dirname, 'public'); // committed seed, read-only
const MEDIA_DIR = path.join(DATA_DIR, 'media');    // runtime writes, persistent
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Directory under the persistent volume for a new image write. Creates it.
function mediaWriteDir(...parts) {
  const dir = path.join(MEDIA_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Resolve a stored relpath to an absolute path that EXISTS on disk: the
// persistent volume copy first, then the committed seed in public/. Returns
// null when neither has it (image lost or never existed) so callers can fall
// back to a placeholder rather than passing a bad path downstream.
function resolveMedia(relpath) {
  if (!relpath || typeof relpath !== 'string') return null;
  const clean = relpath.replace(/^\/+/, '');
  if (clean.includes('..')) return null;
  const onVolume = path.join(MEDIA_DIR, clean);
  if (fs.existsSync(onVolume)) return onVolume;
  const committed = path.join(PUBLIC_DIR, clean);
  if (fs.existsSync(committed)) return committed;
  return null;
}

module.exports = { PUBLIC_DIR, MEDIA_DIR, mediaWriteDir, resolveMedia };
