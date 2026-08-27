const crypto = require('crypto');

function envBool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return value === 'true';
}

function productionCookies() {
  return envBool('COOKIE_SECURE', process.env.NODE_ENV === 'production');
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: productionCookies(),
    ...(maxAge ? { maxAge } : {}),
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function requestKey(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
}

function createRateLimiter({ name, windowMs, max, enabled } = {}) {
  const hits = new Map();
  const limiterEnabled = enabled == null
    ? envBool('SECURITY_RATE_LIMITS_ENABLED', process.env.NODE_ENV !== 'test')
    : Boolean(enabled);
  const safeWindow = Math.max(1000, Number(windowMs) || 60_000);
  const safeMax = Math.max(1, Number(max) || 60);

  function prune(now) {
    if (hits.size < 5000) return;
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  function limiter(req, res, next) {
    if (!limiterEnabled) return next();
    const now = Date.now();
    prune(now);
    const key = `${name || 'request'}:${requestKey(req)}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + safeWindow };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, safeMax - entry.count);
    res.setHeader('RateLimit-Limit', String(safeMax));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count <= safeMax) return next();
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many requests. Wait a moment and try again.',
      retryAfter,
      rateLimited: true,
    });
  }

  limiter.clear = () => hits.clear();
  return limiter;
}

module.exports = { cookieOptions, createRateLimiter, productionCookies, securityHeaders };
