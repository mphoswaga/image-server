#!/usr/bin/env node
// Syntax-guard for inline <script> blocks in HTML files.
//
// Why this exists: the app ships a large single HTML file with the whole
// front-end in one inline <script>. A single stray token or duplicated block
// makes the *entire* script fail to parse, so nothing runs and the page just
// freezes — with no error anywhere obvious. (That exact bug once cost hours.)
//
// This extracts every inline (non-src) <script> and compiles it with V8's
// parser WITHOUT running it. A syntax error fails the check, so CI / a
// pre-commit hook can block a broken build before it ever ships.
//
// Usage: node scripts/check-html-scripts.mjs <file.html> [more.html ...]

import fs from 'node:fs';
import vm from 'node:vm';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/check-html-scripts.mjs <file.html> [...]');
  process.exit(2);
}

// Match <script> ... </script> where the opening tag has no src= attribute.
const SCRIPT_RE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

let anyFailed = false;

for (const file of files) {
  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`✗ ${file}: cannot read (${err.message})`);
    anyFailed = true;
    continue;
  }

  let match;
  let count = 0;
  let fileFailed = false;
  SCRIPT_RE.lastIndex = 0;
  while ((match = SCRIPT_RE.exec(html)) !== null) {
    const code = match[1];
    if (!code.trim()) continue;
    count += 1;
    const line = html.slice(0, match.index).split('\n').length;
    try {
      // Compiles/parses as a classic script (the browser's mode for inline
      // <script>). Catches syntax errors, stray tokens, illegal returns, and
      // duplicate lexical declarations — without executing anything.
      new vm.Script(code, { filename: `${file}#script${count}` });
    } catch (err) {
      anyFailed = true;
      fileFailed = true;
      console.error(`✗ ${file}: inline <script> #${count} (opens ~line ${line}) — ${err.message}`);
    }
  }

  if (!fileFailed) {
    console.log(`✓ ${file}: ${count} inline script block(s) parse cleanly`);
  }
}

process.exit(anyFailed ? 1 : 0);
