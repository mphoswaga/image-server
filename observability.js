const crypto = require('crypto');
const fs = require('fs');
const { DATA_DIR } = require('./storage');

const startedAt = Date.now();
const state = {
  requests: 0,
  inFlight: 0,
  status: { success: 0, redirect: 0, clientError: 0, serverError: 0 },
  failures: { ai: 0, export: 0, upload: 0, wallet: 0, other: 0 },
  latencyMs: { total: 0, max: 0 },
};

function safeRequestId(value) {
  const candidate = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function routeLabel(req) {
  const route = req.route && req.route.path;
  const base = req.baseUrl || '';
  if (route) return `${base}${route}`;
  return req.path === '/' ? '/' : 'static-or-unmatched';
}

function failureKind(pathname) {
  const value = String(pathname || '');
  if (/wallet|credits|billing/.test(value)) return 'wallet';
  if (/google-drive|google-slides|\/download/.test(value)) return 'export';
  if (/templates|planning-frameworks|planning-sources|source-materials|\/import|from-pptx|roster\/preview/.test(value)) return 'upload';
  if (/assistant|lesson-plan|\/generate|\/pack|\/slide|\/game/.test(value)) return 'ai';
  return 'other';
}

function redactText(value) {
  return String(value || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password|api[_-]?key)=?[^\s&]*/gi, '$1=[redacted]')
    .slice(0, 500);
}

function safeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return [key, value];
    return [key, redactText(value)];
  }));
}

function write(event, fields = {}, level = 'info') {
  const record = { ts: new Date().toISOString(), level, service: 'lessonscope', event, ...safeFields(fields) };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function requestMiddleware(req, res, next) {
  const requestId = safeRequestId(req.get && req.get('x-request-id'));
  const started = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  state.requests += 1;
  state.inFlight += 1;
  let finished = false;

  const complete = () => {
    if (finished) return;
    finished = true;
    state.inFlight = Math.max(0, state.inFlight - 1);
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    state.latencyMs.total += durationMs;
    state.latencyMs.max = Math.max(state.latencyMs.max, durationMs);
    if (res.statusCode >= 500) state.status.serverError += 1;
    else if (res.statusCode >= 400) state.status.clientError += 1;
    else if (res.statusCode >= 300) state.status.redirect += 1;
    else state.status.success += 1;
    const route = routeLabel(req);
    if (res.statusCode >= 400) state.failures[failureKind(`${req.path || ''} ${route}`)] += 1;
    write('http.request', {
      requestId,
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      responseBytes: Number(res.getHeader('content-length')) || undefined,
    }, res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info');
  };

  res.once('finish', complete);
  res.once('close', complete);
  next();
}

function recordFailure(kind, fields = {}) {
  const category = Object.hasOwn(state.failures, kind) ? kind : 'other';
  state.failures[category] += 1;
  write('operation.failed', { category, ...fields }, 'error');
}

function snapshot() {
  const completed = Math.max(0, state.requests - state.inFlight);
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: state.requests,
    inFlight: state.inFlight,
    status: { ...state.status },
    failures: { ...state.failures },
    latencyMs: {
      average: completed ? Math.round((state.latencyMs.total / completed) * 10) / 10 : 0,
      max: Math.round(state.latencyMs.max * 10) / 10,
    },
  };
}

function readiness() {
  const checks = {};
  try {
    fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
    checks.dataDirectory = { ok: true };
  } catch (err) {
    checks.dataDirectory = { ok: false, error: 'DATA_DIR is not readable and writable.' };
  }
  try {
    if (typeof fs.statfsSync === 'function') {
      const disk = fs.statfsSync(DATA_DIR);
      const availableBytes = Number(disk.bavail) * Number(disk.bsize);
      const minimumBytes = Math.max(1, Number(process.env.MIN_FREE_STORAGE_BYTES) || 100 * 1024 * 1024);
      checks.storage = { ok: availableBytes >= minimumBytes, availableBytes, minimumBytes };
    } else checks.storage = { ok: true, availableBytes: null };
  } catch {
    checks.storage = { ok: false, error: 'Storage availability could not be checked.' };
  }
  const ok = Object.values(checks).every(check => check.ok);
  return { ok, checks };
}

function resetForTests() {
  state.requests = 0;
  state.inFlight = 0;
  for (const key of Object.keys(state.status)) state.status[key] = 0;
  for (const key of Object.keys(state.failures)) state.failures[key] = 0;
  state.latencyMs.total = 0;
  state.latencyMs.max = 0;
}

module.exports = { readiness, recordFailure, requestMiddleware, resetForTests, safeRequestId, snapshot, write };
