// Social login (Sign in with Google / Microsoft) — LessonScope as an OpenID
// Connect *relying party*. This is the mirror image of oauth.js (where we are
// the provider for TeacherScope): here we consume the big providers so teachers
// can sign in with the account they already have.
//
// Standard authorization-code flow, confidential client:
//   1. /auth/<provider>  → redirect the teacher to the provider with a CSRF state
//   2. provider redirects back to /auth/<provider>/callback?code=…&state=…
//   3. we POST the code (+ our client secret) to the provider's token endpoint
//      over TLS and get back an id_token
//   4. we read the verified {sub, email, name} from the id_token
//
// The id_token is fetched server-to-server directly from the provider's HTTPS
// token endpoint (authenticated by our client secret), so its claims are
// trustworthy without a separate JWKS signature check — the standard trust
// model for a server-side confidential client. New providers (e.g. Apple) can
// be added by dropping another entry into PROVIDERS.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TENANT = process.env.MICROSOFT_TENANT || 'common';

const PROVIDERS = {
  google: {
    label: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    extraAuthParams: { access_type: 'online', prompt: 'select_account' },
  },
  microsoft: {
    label: 'Microsoft',
    authUrl: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    scope: 'openid email profile',
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
    extraAuthParams: { prompt: 'select_account' },
  },
};

function getProvider(name) { return PROVIDERS[name] || null; }
function isEnabled(name) {
  const p = getProvider(name);
  return !!(p && p.clientId() && p.clientSecret());
}
// Which providers the teacher can actually use (credentials configured).
function enabledProviders() {
  return Object.keys(PROVIDERS)
    .filter(isEnabled)
    .map(id => ({ id, label: PROVIDERS[id].label }));
}

function randomState() { return crypto.randomBytes(24).toString('hex'); }

// The URL to send the teacher to, to start sign-in.
function buildAuthUrl(name, { redirectUri, state }) {
  const p = getProvider(name);
  if (!p) throw new Error('Unknown provider.');
  const params = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    ...(p.extraAuthParams || {}),
  });
  return `${p.authUrl}?${params.toString()}`;
}

// Exchange the callback code for tokens and return the verified profile.
async function fetchProfile(name, { code, redirectUri }) {
  const p = getProvider(name);
  if (!p) throw new Error('Unknown provider.');
  const body = new URLSearchParams({
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${p.label} sign-in failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const tok = await res.json();
  const claims = tok.id_token ? jwt.decode(tok.id_token) : null;
  if (!claims || !claims.sub) throw new Error(`${p.label} did not return a valid identity.`);
  const email = (claims.email || claims.preferred_username || '').toLowerCase().trim();
  if (!email) throw new Error(`${p.label} did not share an email address — can't create an account.`);
  return {
    provider: name,
    providerUserId: String(claims.sub),
    email,
    emailVerified: claims.email_verified !== false, // Google sends true; MS work/school omit it
    name: (claims.name || '').trim(),
  };
}

module.exports = { getProvider, isEnabled, enabledProviders, randomState, buildAuthUrl, fetchProfile };
