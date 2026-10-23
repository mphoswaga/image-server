// Admin-owned policy. Never grants a general student/account session.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const file = path.join(DATA_DIR, 'game-join-policy.json');
function read() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }
function enabled(teacherId) { return read()[teacherId]?.enabled === true; }
function set(teacherId, value, adminId) {
  if (typeof value !== 'boolean') throw new Error('Choose whether PIN-free game joining is enabled.');
  const data = read();
  data[teacherId] = { enabled: value, updatedBy: adminId, updatedAt: new Date().toISOString() };
  writeJsonAtomic(file, data);
  return value;
}
module.exports = { enabled, set };
