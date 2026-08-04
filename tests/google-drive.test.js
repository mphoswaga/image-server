const test = require('node:test');
const assert = require('node:assert/strict');
const { multipartBody, PPTX_MIME, configured, buildAuthUrl } = require('../google-drive');

test('Google Drive config is off unless both OAuth credentials are present', () => {
  const oldId = process.env.GOOGLE_CLIENT_ID;
  const oldSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    assert.equal(configured(), false);
    process.env.GOOGLE_CLIENT_ID = 'client.example';
    assert.equal(configured(), false);
    process.env.GOOGLE_CLIENT_SECRET = 'secret.example';
    assert.equal(configured(), true);
  } finally {
    if (oldId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = oldSecret;
  }
});

test('Drive auth URL requests only file-level Drive access', () => {
  const oldId = process.env.GOOGLE_CLIENT_ID;
  const oldSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = 'client.example';
  process.env.GOOGLE_CLIENT_SECRET = 'secret.example';
  try {
    const url = new URL(buildAuthUrl({ redirectUri: 'https://lesson.educscope.com/integrations/google-drive/callback', state: 'abc' }));
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('state'), 'abc');
  } finally {
    if (oldId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = oldSecret;
  }
});

test('multipart upload body contains metadata and pptx bytes', () => {
  const pptxBytes = Buffer.from('pptx-binary');
  const { boundary, body } = multipartBody({ name: 'Lesson.pptx', mimeType: PPTX_MIME }, pptxBytes);
  const text = body.toString('utf8');
  assert.match(boundary, /^ls_drive_[a-f0-9]+$/);
  assert.match(text, /Content-Type: application\/json; charset=UTF-8/);
  assert.match(text, /"name":"Lesson\.pptx"/);
  assert.match(text, new RegExp(`Content-Type: ${PPTX_MIME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(text, /pptx-binary/);
  assert.match(text, new RegExp(`--${boundary}--`));
});
