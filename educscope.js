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

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function extractProfile(d = {}) {
  const account = d.user || d.account || d.profile || d;
  const organization = d.organization || d.org || d.currentOrganization || account.organization || {};
  const userId = cleanText(
    account.id || account.user_id || account.userId || account.sub || d.user_id || d.userId || d.educscope_user_id
  );
  const organizationId = cleanText(
    organization.id || organization.organization_id || organization.organizationId || account.organization_id || account.organizationId || d.organization_id || d.organizationId || d.educscope_organization_id
  );
  const email = cleanEmail(account.email || d.email);
  const name = cleanText(account.display_name || account.displayName || account.name || d.display_name || d.displayName || d.name);
  if (!userId || !email) return null;
  return {
    userId,
    organizationId,
    email,
    name: name || email.split('@')[0],
    available: (d.wallet && typeof d.wallet.available === 'number') ? d.wallet.available : null,
  };
}

async function fetchAccount(req) {
  const url = accountMeUrl();
  if (!url) return { authenticated: false, loginUrl: loginUrl() };
  const res = await fetch(url, { headers: { Cookie: req.headers.cookie || '', Accept: 'application/json' }, redirect: 'manual' });
  if (res.status === 401 || res.status === 403) return { authenticated: false, loginUrl: loginUrl() };
  if (!res.ok) throw new Error(`account/me ${res.status}`);
  const d = await res.json().catch(() => ({}));
  const profile = extractProfile(d);
  if (!profile) throw new Error('account/me missing user profile');
  return { authenticated: true, loginUrl: loginUrl(), profile };
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
  const account = await fetchAccount(req);
  if (!account.authenticated) return { unauthenticated: true, loginUrl: account.loginUrl };
  const { profile } = account;
  if (!profile.organizationId) throw new Error('account/me missing organization.id');
  const identity = {
    organizationId: profile.organizationId,
    userId: profile.userId,
    available: profile.available,
  };
  _cache.set(key, { at: Date.now(), identity });
  return identity;
}

module.exports = { configured, resolveIdentity, fetchAccount, loginUrl, accountMeUrl, bust };
