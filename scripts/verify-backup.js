#!/usr/bin/env node
const path = require('path');
const { verifyBackup } = require('../backup');

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/verify-backup.js <backup-directory>');
  process.exit(2);
}
try {
  const result = verifyBackup(path.resolve(input));
  if (!result.ok) throw new Error(result.errors.join('; '));
  console.log(`Backup is valid: ${result.manifest.fileCount} files, ${result.manifest.totalBytes} bytes.`);
} catch (err) {
  console.error(`Backup verification failed: ${err.message}`);
  process.exit(1);
}
