const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ACCOUNT_PORT = 4342;
const accountMock = http.createServer((req, res) => {
  if (req.url === '/api/account/me') {
    if (!String(req.headers.cookie || '').includes('es_session=e2e-valid')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not signed in' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      user: { id: 'educscope-e2e-user', email: 'shared-teacher@example.test', name: 'Shared Teacher' },
      organization: { id: 'educscope-e2e-school' },
      wallet: { available: 25, balance: 25, reserved: 0 },
    }));
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});
accountMock.listen(ACCOUNT_PORT, '127.0.0.1');

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lessonscope-e2e-'));
process.env.PRACTICE_ENABLED = 'true';
process.env.LESSONSCOPE_LOCAL_AUTH_ENABLED = 'true';
process.env.EDUCSCOPE_ACCOUNT_URL = `http://127.0.0.1:${ACCOUNT_PORT}/account`;
process.env.EDUCSCOPE_ACCOUNT_API_URL = `http://127.0.0.1:${ACCOUNT_PORT}/api/account/me`;
process.env.EDUCSCOPE_WALLET_URL = `http://127.0.0.1:${ACCOUNT_PORT}/api/wallet`;
process.env.BILLING_ENABLED = 'false';
process.env.SESSION_SECRET = 'lessonscope-e2e-session-secret-that-is-not-production';

require('../../image-server');
