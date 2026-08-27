#!/usr/bin/env node
const path = require('path');
const { restoreBackup } = require('../backup');

const backup = process.argv[2];
const target = process.argv[3];
if (!backup || !target) {
  console.error('Usage: node scripts/restore-data.js <backup-directory> <empty-restore-directory>');
  process.exit(2);
}
try {
  const manifest = restoreBackup(path.resolve(backup), path.resolve(target));
  console.log(`Restored ${manifest.fileCount} verified files into ${path.resolve(target)}.`);
} catch (err) {
  console.error(`Restore failed: ${err.message}`);
  process.exit(1);
}
