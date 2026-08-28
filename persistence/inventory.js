const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOMAIN_RULES = Object.freeze([
  ['users', /^users\.json$/],
  ['rosters', /^users\/[^/]+\/rosters\/[^/]+\.json$/],
  ['templates', /^users\/[^/]+\/templates\//],
  ['planning_sources', /^users\/[^/]+\/planning-sources\/[^/]+\.json$/],
  ['assignments', /^assignments\/[^/]+\.json$/],
  ['games', /^games\/[^/]+\.json$/],
  ['practice_attempts', /^practice\/attempts\/[^/]+\.json$/],
  ['live_rooms', /^practice\/live-sessions\/[^/]+\.json$/],
  ['decks', /^decks\.json$/],
  ['media', /^media\//],
  ['other', /.*/],
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function classify(relativePath) {
  return DOMAIN_RULES.find(([, pattern]) => pattern.test(relativePath))[0];
}

function inventoryData(root) {
  const base = path.resolve(root);
  const files = [];
  const visit = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const relativePath = path.relative(base, absolute).split(path.sep).join('/');
        const stat = fs.statSync(absolute);
        files.push({ relativePath, domain: classify(relativePath), bytes: stat.size, sha256: sha256(absolute) });
      }
    }
  };
  visit(base);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const domains = {};
  for (const file of files) {
    const summary = domains[file.domain] || (domains[file.domain] = { files: 0, bytes: 0 });
    summary.files += 1;
    summary.bytes += file.bytes;
  }
  return { version: 1, generatedAt: new Date().toISOString(), root: base, totals: { files: files.length, bytes: files.reduce((n, file) => n + file.bytes, 0) }, domains, files };
}

module.exports = { DOMAIN_RULES, classify, inventoryData };
