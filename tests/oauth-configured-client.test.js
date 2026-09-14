const test = require('node:test');
const assert = require('node:assert/strict');

const oauth = require('../oauth');
const fs = require('node:fs');

test('the configured TeacherScope OAuth client survives without a volume record', async t => {
  const names = [
    'TEACHERSCOPE_OAUTH_CLIENT_ID',
    'TEACHERSCOPE_OAUTH_CLIENT_SECRET',
    'TEACHERSCOPE_OAUTH_REDIRECT_URI',
  ];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });

  process.env.TEACHERSCOPE_OAUTH_CLIENT_ID = 'lcs_configured_teacherscope';
  process.env.TEACHERSCOPE_OAUTH_CLIENT_SECRET = 'lcs_sec_configured_for_test_only';
  process.env.TEACHERSCOPE_OAUTH_REDIRECT_URI = 'https://teacher.example.com/integrations/lessonscope/callback';

  const client = oauth.getClient('lcs_configured_teacherscope');
  assert.equal(client.name, 'TeacherScope');
  assert.deepEqual(client.redirectUris, ['https://teacher.example.com/integrations/lessonscope/callback']);
  assert.deepEqual(client.allowedScopes, ['profile:read', 'rosters:read', 'results:read']);
  assert.equal(await oauth.verifyClientSecret(client.clientId, 'lcs_sec_configured_for_test_only'), true);
  assert.equal(await oauth.verifyClientSecret(client.clientId, 'wrong-secret'), false);
  assert.equal(JSON.stringify(oauth.listClients()).includes('lcs_sec_configured_for_test_only'), false);
});

test('the OAuth token and revoke endpoints accept standard form-encoded requests', () => {
  const server = fs.readFileSync(require.resolve('../image-server.js'), 'utf8');
  assert.match(server, /app\.post\('\/oauth\/token', express\.urlencoded\(\{ extended: false, limit: '20kb' \}\)/);
  assert.match(server, /app\.post\('\/oauth\/revoke', express\.urlencoded\(\{ extended: false, limit: '20kb' \}\)/);
});
