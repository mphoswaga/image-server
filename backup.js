const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function filesUnder(root) {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.endsWith('.tmp')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  }
  visit(root);
  return files.sort();
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createBackup(source, destination) {
  const src = path.resolve(source);
  const dest = path.resolve(destination);
  if (!fs.existsSync(src)) throw new Error(`Source directory does not exist: ${src}`);
  if (isInside(src, dest)) throw new Error('Backup destination must be outside DATA_DIR.');
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error('Backup destination must be empty.');
  fs.mkdirSync(dest, { recursive: true });
  const dataDir = path.join(dest, 'data');
  fs.cpSync(src, dataDir, { recursive: true, filter: value => !value.endsWith('.tmp') });
  const files = filesUnder(dataDir).map(relative => ({
    path: relative.split(path.sep).join('/'),
    bytes: fs.statSync(path.join(dataDir, relative)).size,
    sha256: checksum(path.join(dataDir, relative)),
  }));
  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function verifyBackup(backupDir) {
  const root = path.resolve(backupDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const dataDir = path.join(root, 'data');
  const errors = [];
  for (const file of manifest.files || []) {
    const absolute = path.resolve(dataDir, file.path);
    if (!isInside(dataDir, absolute)) { errors.push(`${file.path}: unsafe path`); continue; }
    if (!fs.existsSync(absolute)) { errors.push(`${file.path}: missing`); continue; }
    if (fs.statSync(absolute).size !== file.bytes) errors.push(`${file.path}: size mismatch`);
    else if (checksum(absolute) !== file.sha256) errors.push(`${file.path}: checksum mismatch`);
  }
  const actual = filesUnder(dataDir).map(file => file.split(path.sep).join('/'));
  const expected = new Set((manifest.files || []).map(file => file.path));
  for (const file of actual) if (!expected.has(file)) errors.push(`${file}: not listed in manifest`);
  return { ok: errors.length === 0, errors, manifest };
}

function restoreBackup(backupDir, targetDir) {
  const verified = verifyBackup(backupDir);
  if (!verified.ok) throw new Error(`Backup verification failed: ${verified.errors[0]}`);
  const target = path.resolve(targetDir);
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('Restore target must be empty.');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(path.resolve(backupDir), 'data'), target, { recursive: true });
  return verified.manifest;
}

module.exports = { createBackup, restoreBackup, verifyBackup };
