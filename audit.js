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
    const fd=fs.openSync(AUDIT_PATH,'r');
    let text;
    try {
      const size=fs.fstatSync(fd).size, start=Math.max(0,size-4*1024*1024);
      const buffer=Buffer.alloc(size-start);fs.readSync(fd,buffer,0,buffer.length,start);
      text=buffer.toString('utf8');if(start)text=text.slice(text.indexOf('\n')+1);
    } finally {fs.closeSync(fd);}
    return text
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch { return []; }
}

module.exports = { log, recent };
