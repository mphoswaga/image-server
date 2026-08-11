#!/usr/bin/env node
// Is what I pushed actually running?
//
// Both apps are deployed from Railway, but only LessonScope rebuilds on push.
// The website has to be deployed by hand, which has meant finished work sitting
// invisible while it was hunted for in the browser — and nothing on either side
// said so.
//
// This asks each service which commit it is serving and compares that with the
// local repository. Run it after pushing, or any time the app is not behaving
// the way the code says it should.
//
//   node scripts/deployed.js
//
// Exits non-zero when anything is stale, so it can gate a release step later.

const { execSync } = require('child_process');
const path = require('path');

const SERVICES = [
  {
    name: 'LessonScope',
    url: 'https://lesson.educscope.com/healthz',
    repo: path.join(__dirname, '..'),
    autoDeploys: true,
  },
  {
    name: 'EducScope',
    url: 'https://educscope.com/api/health',
    repo: path.join(__dirname, '..', '..', 'website'),
    autoDeploys: false,
  },
];

function localHead(repo) {
  try {
    return execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function unpushed(repo) {
  try {
    execSync('git fetch --quiet origin', { cwd: repo });
    const ahead = execSync('git rev-list --count origin/main..HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    return Number(ahead) || 0;
  } catch {
    return 0;
  }
}

async function running(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    return { commit: body.commit || 'unknown' };
  } catch (err) {
    return { error: err.message };
  }
}

(async () => {
  let stale = 0;
  console.log('');
  for (const service of SERVICES) {
    const head = localHead(service.repo);
    const ahead = unpushed(service.repo);
    const live = await running(service.url);
    const short = c => (c && c !== 'unknown' ? c.slice(0, 7) : c);

    let verdict;
    if (live.error) {
      verdict = `could not reach it (${live.error})`;
      stale++;
    } else if (live.commit === 'unknown') {
      // An older build, from before the service reported its commit.
      verdict = 'running a build from before this check existed — deploy once to fix';
      stale++;
    } else if (live.commit === head) {
      verdict = 'up to date';
    } else {
      verdict = `STALE — running ${short(live.commit)}, local is ${short(head)}`;
      stale++;
    }

    console.log(`  ${service.name.padEnd(12)} ${verdict}`);
    if (ahead) console.log(`  ${''.padEnd(12)} ${ahead} commit${ahead === 1 ? '' : 's'} not pushed yet`);
    if (!service.autoDeploys && live.commit !== head) {
      console.log(`  ${''.padEnd(12)} this service does NOT deploy on push — run: cd ${service.repo} && railway up`);
    }
  }
  console.log('');
  process.exit(stale ? 1 : 0);
})();
