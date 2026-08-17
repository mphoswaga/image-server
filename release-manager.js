// Protected application rollback for the LessonScope admin panel.
//
// A rollback never force-pushes and never rewrites history. It creates a new
// commit whose tree matches an approved earlier commit, with the current main
// commit as its parent. Railway then deploys that new commit normally.
// Persistent teacher data is deliberately outside this module: this is a code
// rollback, not a database or volume restore.
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const repoRoot = __dirname;

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return ''; }
}

function normalizeRepo(value = '') {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  const match = cleaned.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return (match ? match[1] : cleaned).replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

function repository() {
  return normalizeRepo(
    process.env.ROLLBACK_GITHUB_REPO
    || process.env.GITHUB_REPOSITORY
    || runGit(['config', '--get', 'remote.origin.url'])
  );
}

function token() {
  return process.env.GITHUB_ROLLBACK_TOKEN || process.env.ROLLBACK_GITHUB_TOKEN || '';
}

function verificationSecret() {
  return process.env.ROLLBACK_VERIFICATION_CODE || process.env.ROLLBACK_ADMIN_CODE || '';
}

function branch() {
  return process.env.ROLLBACK_GITHUB_BRANCH || process.env.RAILWAY_GIT_BRANCH || 'main';
}

function configured() {
  return Boolean(repository() && token() && verificationSecret());
}

function safeEqual(value, expected) {
  const supplied = Buffer.from(String(value || '').trim());
  const wanted = Buffer.from(String(expected || '').trim());
  return supplied.length === wanted.length && wanted.length >= 8 && crypto.timingSafeEqual(supplied, wanted);
}

async function githubRequest(endpoint, { method = 'GET', body, requireToken = false } = {}) {
  const repo = repository();
  const key = token();
  if (!repo) throw new Error('GitHub rollback repository is not configured.');
  if (requireToken && !key) throw new Error('GitHub rollback access is not configured.');
  const response = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
    method,
    body,
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    const detail = payload && payload.message ? payload.message : `GitHub returned HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload;
}

function localCommits(limit = 12) {
  const lines = runGit(['log', `-${limit}`, '--date=iso-strict', '--pretty=format:%H%x1f%ad%x1f%s']);
  return lines.split('\n').filter(Boolean).map(line => {
    const [sha, createdAt, subject] = line.split('\x1f');
    return { sha, shortSha: sha.slice(0, 7), subject, createdAt, source: 'local' };
  });
}

async function recentCommits(limit = 12) {
  try {
    const commits = await githubRequest(`/commits?sha=${encodeURIComponent(branch())}&per_page=${Math.min(30, limit)}`);
    return (Array.isArray(commits) ? commits : []).map(item => ({
      sha: item.sha,
      shortSha: String(item.sha || '').slice(0, 7),
      subject: String(item.commit && item.commit.message || '').split('\n')[0],
      createdAt: item.commit && item.commit.author && item.commit.author.date,
      source: 'github',
    })).filter(item => item.sha);
  } catch {
    return localCommits(limit);
  }
}

async function status() {
  const commits = await recentCommits(12);
  const currentSha = process.env.RAILWAY_GIT_COMMIT_SHA || runGit(['rev-parse', 'HEAD']);
  const repo = repository();
  return {
    configured: configured(),
    branch: branch(),
    repository: repo ? repo.replace(/^(.{2}).+(.{2})$/, '$1***$2') : '',
    currentSha,
    currentShortSha: String(currentSha || '').slice(0, 7),
    recentCommits: commits,
    historySource: commits.some(item => item.source === 'github') ? 'github' : 'local',
    diagnostics: {
      tokenPresent: Boolean(token()),
      repositoryPresent: Boolean(repo),
      verificationCodePresent: Boolean(verificationSecret()),
      verificationCodeStrong: verificationSecret().trim().length >= 8,
    },
  };
}

async function allowedTargets() {
  const commits = await recentCommits(30);
  return new Map(commits.map(item => [item.sha, item]));
}

async function rollback({ targetSha, verificationCode, requestedBy }) {
  if (!configured()) {
    throw new Error('Rollback is not configured. Add the GitHub token, repository, and private verification code in Railway.');
  }
  if (!safeEqual(verificationCode, verificationSecret())) {
    throw new Error('Rollback verification code is incorrect.');
  }

  const targets = await allowedTargets();
  const target = targets.get(String(targetSha || '').trim());
  if (!target) throw new Error('The selected version is not in the approved recent history.');

  const ref = await githubRequest(`/git/ref/heads/${encodeURIComponent(branch())}`, { requireToken: true });
  const currentSha = ref && ref.object && ref.object.sha;
  if (!currentSha) throw new Error('Could not read the current GitHub branch.');
  if (currentSha === target.sha) return { success: true, skipped: true, target, branch: branch() };

  const targetCommit = await githubRequest(`/git/commits/${target.sha}`, { requireToken: true });
  if (!targetCommit.tree || !targetCommit.tree.sha) throw new Error('Could not read the selected version tree.');

  const rollbackCommit = await githubRequest('/git/commits', {
    method: 'POST',
    requireToken: true,
    body: JSON.stringify({
      message: `Rollback LessonScope to ${target.shortSha}\n\nRequested by ${requestedBy || 'admin'} from the LessonScope admin panel.`,
      tree: targetCommit.tree.sha,
      parents: [currentSha],
    }),
  });
  if (!rollbackCommit.sha) throw new Error('GitHub did not create the rollback commit.');

  await githubRequest(`/git/refs/heads/${encodeURIComponent(branch())}`, {
    method: 'PATCH',
    requireToken: true,
    body: JSON.stringify({ sha: rollbackCommit.sha, force: false }),
  });

  return {
    success: true,
    skipped: false,
    branch: branch(),
    rollbackCommitSha: rollbackCommit.sha,
    target,
  };
}

module.exports = {
  normalizeRepo,
  safeEqual,
  configured,
  status,
  rollback,
  recentCommits,
};
