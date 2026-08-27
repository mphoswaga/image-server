const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const observability = require('../observability');

class Response extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 200;
  }
  setHeader(name, value) { this.headers[name] = value; }
  getHeader(name) { return this.headers[name]; }
}

test('request IDs accept safe caller correlation and reject unsafe values', () => {
  assert.equal(observability.safeRequestId('request_12345678'), 'request_12345678');
  assert.match(observability.safeRequestId('bad value with spaces'), /^[0-9a-f-]{36}$/);
});

test('request middleware records status and latency without request bodies', () => {
  observability.resetForTests();
  const req = { method: 'POST', path: '/api/login', ip: '127.0.0.1', get: () => 'trace_12345678', route: { path: '/api/login' }, baseUrl: '' };
  const res = new Response();
  let continued = false;
  const oldLog = console.warn;
  console.warn = () => {};
  observability.requestMiddleware(req, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(req.requestId, 'trace_12345678');
  assert.equal(res.headers['X-Request-ID'], 'trace_12345678');
  res.statusCode = 401;
  res.emit('finish');
  console.warn = oldLog;
  const snapshot = observability.snapshot();
  assert.equal(snapshot.requests, 1);
  assert.equal(snapshot.inFlight, 0);
  assert.equal(snapshot.status.clientError, 1);
  assert.equal(snapshot.failures.other, 1);
});

test('readiness confirms the configured data directory can be used', () => {
  const result = observability.readiness();
  assert.equal(result.checks.dataDirectory.ok, true);
  assert.equal(typeof result.checks.storage.ok, 'boolean');
});
