// EducScope shared-session identity (server-side, trusted).
//
// LessonScope runs on lesson.educscope.com; EducScope sets its session cookie on
// COOKIE_DOMAIN=.educscope.com, so that cookie reaches us. We resolve the
// signed-in teacher by FORWARDING that cookie to EducScope's account API and
// reading back the trusted user.id + organization.id. The organization.id
// returned here is the ONLY id used for wallet reserve/capture/release — never
// an org id supplied by the browser (which a user could spoof to spend another
// org's credits). The browser may still call /api/account/me itself for display.
//
// Active only when the remote wallet is configured (EDUCSCOPE_WALLET_URL). With
// it unset (local/beta), resolveIdentity returns { local:true } and callers fall
// back to the local per-email wallet, exactly as before.

const walletBase = () => (process.env.EDUCSCOPE_WALLET_URL || process.env.EDUCSCOPE_WALLET_API_URL || '').replace(/\/$/, '');
function configured() { return !!walletBase(); }

// EducScope account API. Derived from the wallet URL's origin unless overridden.
// e.g. https://educscope.com/api/wallet  ->  https://educscope.com/api/account/me
function accountMeUrl() {
  if (process.env.EDUCSCOPE_ACCOUNT_API_URL) return process.env.EDUCSCOPE_ACCOUNT_API_URL;
  try { return new URL(walletBase()).origin + '/api/account/me'; } catch { return ''; }
}

// Where an unauthenticated teacher is sent to sign in.
function loginUrl() {
  const base = process.env.EDUCSCOPE_ACCOUNT_URL || '';
  return base ? `${base}${base.includes('?') ? '&' : '?'}mode=login` : '';
}

// Short per-session cache so we don't call account/me on every action. Keyed by
// the LessonScope session user id; busted after a capture/release so the next
// balance read is fresh.
const TTL_MS = 20 * 1000;
const _cache = new Map(); // key -> { at, identity }
function bust(key) { if (key) _cache.delete(key); }

// Resolve the trusted identity for this request. Returns one of:
//   { local:true }                          remote wallet not configured (beta)
//   { unauthenticated:true, loginUrl }       no / invalid EducScope session (401)
//   { organizationId, userId, available }    signed in
// Throws on a transport/parse error — callers fail closed in remote mode.
async function resolveIdentity(req, { fresh = false } = {}) {
  if (!configured()) return { local: true };
  const key = req.userId || (req.ip || 'anon');
  if (!fresh) { const c = _cache.get(key); if (c && Date.now() - c.at < TTL_MS) return c.identity; }
  const url = accountMeUrl();
  if (!url) return { local: true };
  const res = await fetch(url, { headers: { Cookie: req.headers.cookie || '', Accept: 'application/json' }, redirect: 'manual' });
  if (res.status === 401 || res.status === 403) return { unauthenticated: true, loginUrl: loginUrl() };
  if (!res.ok) throw new Error(`account/me ${res.status}`);
  const d = await res.json().catch(() => ({}));
  const organizationId = d && d.organization && d.organization.id;
  if (!organizationId) throw new Error('account/me missing organization.id');
  const identity = {
    organizationId: String(organizationId),
    userId: (d.user && d.user.id != null) ? String(d.user.id) : null,
    available: (d.wallet && typeof d.wallet.available === 'number') ? d.wallet.available : null,
  };
  _cache.set(key, { at: Date.now(), identity });
  return identity;
}

module.exports = { configured, resolveIdentity, loginUrl, accountMeUrl, bust };
