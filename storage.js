// Central location for all mutable, per-deployment data (accounts, templates,
// session secret). Locally this is ./data; in production set DATA_DIR to a
// mounted persistent volume (e.g. /data on Railway) so this data survives
// redeploys — the container filesystem itself is ephemeral and wiped each deploy.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Write via temp-file + rename so a crash mid-write can never leave a
// half-written (corrupt) file behind — the rename is atomic on the same volume.
function writeFileAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

function writeJsonAtomic(filePath, data) {
  writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}

module.exports = { DATA_DIR, writeFileAtomic, writeJsonAtomic };
