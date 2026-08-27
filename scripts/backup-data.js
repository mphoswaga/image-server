#!/usr/bin/env node
const path = require('path');
const { DATA_DIR } = require('../storage');
const { createBackup } = require('../backup');

const outputArg = process.argv[2] || process.env.BACKUP_DIR;
if (!outputArg) {
  console.error('Usage: node scripts/backup-data.js <empty-backup-directory>');
  process.exit(2);
}
const output = path.resolve(outputArg);
try {
  const manifest = createBackup(DATA_DIR, output);
  console.log(`Backup verified at ${output}: ${manifest.fileCount} files, ${manifest.totalBytes} bytes.`);
} catch (err) {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
}
