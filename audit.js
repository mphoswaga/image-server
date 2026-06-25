// Append-only audit log for security-sensitive OAuth events.
// One JSON line per event at DATA_DIR/audit.log.
// NEVER log token values, passwords, or student result payloads.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const AUDIT_PATH = path.join(DATA_DIR, 'audit.log');

function log(event, fields = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  try { fs.appendFileSync(AUDIT_PATH, entry + '\n'); } catch {}
}

// Read the most recent entries for the admin panel.
function recent(limit = 200) {
  try {
    return fs.readFileSync(AUDIT_PATH, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch { return []; }
}

module.exports = { log, recent };
