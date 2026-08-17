const test = require('node:test');
const assert = require('node:assert/strict');

const manager = require('../release-manager');

const ENV_KEYS = [
  'ROLLBACK_GITHUB_REPO', 'GITHUB_REPOSITORY', 'GITHUB_ROLLBACK_TOKEN',
  'ROLLBACK_GITHUB_TOKEN', 'ROLLBACK_VERIFICATION_CODE', 'ROLLBACK_ADMIN_CODE',
  'ROLLBACK_GITHUB_BRANCH', 'RAILWAY_GIT_BRANCH',
];

function withRollbackEnv() {
  const old = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  process.env.ROLLBACK_GITHUB_REPO = 'school/lessonscope';
  process.env.GITHUB_ROLLBACK_TOKEN = 'github-secret';
  process.env.ROLLBACK_VERIFICATION_CODE = 'private-code-123';
  process.env.ROLLBACK_GITHUB_BRANCH = 'main';
  return () => ENV_KEYS.forEach(key => old[key] == null ? delete process.env[key] : process.env[key] = old[key]);
}

test('repository values are normalized without accepting URL decoration', () => {
  assert.equal(manager.normalizeRepo('https://github.com/mphoswaga/image-server.git'), 'mphoswaga/image-server');
  assert.equal(manager.normalizeRepo('git@github.com:mphoswaga/image-server.git'), 'mphoswaga/image-server');
  assert.equal(manager.normalizeRepo('mphoswaga/image-server'), 'mphoswaga/image-server');
});
test('rollback verification requires an exact secret of at least eight characters', () => {
  assert.equal(manager.safeEqual('private-code-123', 'private-code-123'), true);
  assert.equal(manager.safeEqual('wrong-code', 'private-code-123'), false);
  assert.equal(manager.safeEqual('1234567', '1234567'), false);
});

test('a valid rollback creates a new non-force commit from an approved target', async () => {
  const restoreEnv = withRollbackEnv();
  const oldFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const endpoint = String(url).replace('https://api.github.com/repos/school/lessonscope', '');
    let body;
    if (endpoint.startsWith('/commits?')) body = [
      { sha: 'target-sha', commit: { message: 'Stable release\nDetails', author: { date: '2026-08-01T00:00:00Z' } } },
      { sha: 'older-sha', commit: { message: 'Older release', author: { date: '2026-07-31T00:00:00Z' } } },
    ];
    else if (endpoint === '/git/ref/heads/main') body = { object: { sha: 'current-sha' } };
    else if (endpoint === '/git/commits/target-sha') body = { tree: { sha: 'target-tree' } };
    else if (endpoint === '/git/commits' && options.method === 'POST') body = { sha: 'rollback-sha' };
    else if (endpoint === '/git/refs/heads/main' && options.method === 'PATCH') body = { object: { sha: 'rollback-sha' } };
    else return new Response(JSON.stringify({ message: 'Unexpected request' }), { status: 500 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await manager.rollback({ targetSha: 'target-sha', verificationCode: 'private-code-123', requestedBy: 'admin@example.com' });
    assert.equal(result.rollbackCommitSha, 'rollback-sha');
    const create = calls.find(call => call.url.endsWith('/git/commits') && call.options.method === 'POST');
    assert.deepEqual(JSON.parse(create.options.body).parents, ['current-sha']);
    assert.equal(JSON.parse(create.options.body).tree, 'target-tree');
    const update = calls.find(call => call.url.endsWith('/git/refs/heads/main') && call.options.method === 'PATCH');
    assert.deepEqual(JSON.parse(update.options.body), { sha: 'rollback-sha', force: false });
  } finally {
    global.fetch = oldFetch;
    restoreEnv();
  }
});

test('an incorrect code fails before GitHub is contacted', async () => {
  const restoreEnv = withRollbackEnv();
  const oldFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('must not run'); };
  try {
    await assert.rejects(
      manager.rollback({ targetSha: 'target-sha', verificationCode: 'wrong-code' }),
      /verification code is incorrect/i
    );
    assert.equal(called, false);
  } finally {
    global.fetch = oldFetch;
    restoreEnv();
  }
});
