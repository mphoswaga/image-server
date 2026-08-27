const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { cookieOptions, createRateLimiter, productionCookies, securityHeaders } = require('../security');
const { validateUpload, zipExpansion } = require('../upload-security');

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('production cookies are secure while local cookies remain usable', () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldOverride = process.env.COOKIE_SECURE;
  delete process.env.COOKIE_SECURE;
  process.env.NODE_ENV = 'production';
  assert.equal(productionCookies(), true);
  assert.deepEqual(cookieOptions(1000), { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 1000 });
  process.env.NODE_ENV = 'development';
  assert.equal(productionCookies(), false);
  if (oldNodeEnv == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
  if (oldOverride == null) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = oldOverride;
});

test('security headers protect ordinary responses without blocking auth popups', () => {
  const res = response();
  let continued = false;
  securityHeaders({}, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(res.headers['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
});

test('rate limiter returns a structured retry response after its allowance', () => {
  const limiter = createRateLimiter({ name: 'test', windowMs: 60_000, max: 2, enabled: true });
  const req = { ip: '203.0.113.9' };
  for (let i = 0; i < 2; i += 1) {
    const res = response();
    let continued = false;
    limiter(req, res, () => { continued = true; });
    assert.equal(continued, true);
  }
  const blocked = response();
  limiter(req, blocked, () => assert.fail('blocked request continued'));
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.rateLimited, true);
  assert.ok(blocked.body.retryAfter >= 1);
});

test('an Office upload must be a real, bounded zip archive', () => {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('xl/workbook.xml', '<workbook/>');
  const buffer = zip.generate({ type: 'nodebuffer' });
  const info = validateUpload({ originalname: 'plan.xlsx', buffer }, 'planning');
  assert.equal(info.ext, '.xlsx');
  assert.equal(zipExpansion(buffer).files, 2);
  assert.throws(
    () => validateUpload({ originalname: 'fake.xlsx', buffer: Buffer.from('not an office file') }, 'planning'),
    /do not match its file type/
  );
});

test('upload groups reject renamed and unsupported content', () => {
  const pdf = Buffer.from('%PDF-1.7\n');
  assert.equal(validateUpload({ originalname: 'guide.pdf', buffer: pdf }, 'template').ext, '.pdf');
  assert.throws(() => validateUpload({ originalname: 'guide.exe', buffer: pdf }, 'template'), /not supported/);
  assert.throws(() => validateUpload({ originalname: 'photo.jpg', buffer: pdf }, 'source'), /do not match/);
  assert.throws(() => validateUpload({ originalname: 'empty.csv', buffer: Buffer.alloc(0) }, 'roster'), /empty/);
});
