// Passkey (WebAuthn) support for teacher accounts — alongside password
// login, not replacing it. Registration requires an already-authenticated
// teacher (adds a passkey to their own account); sign-in uses discoverable
// ("usernameless") credentials, so a teacher can sign in with just a
// biometric prompt — no email typed first, the browser itself shows which
// passkey to use.
//
// All the actual cryptographic verification is delegated to
// @simplewebauthn/server — WebAuthn's protocol (challenge/signature
// verification, attestation, replay protection via credential counters) is
// exactly the kind of thing not worth hand-rolling.
const crypto = require('crypto');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const auth = require('./auth');

const RP_NAME = 'LessonScope';
const TTL_MS = 5 * 60 * 1000; // WebAuthn ceremonies complete in seconds in practice

// Short-lived challenge stores. Registration is keyed by the already-known
// userId (teacher is authenticated); login is keyed by a random requestId
// since we don't know which user is signing in until the browser reports
// which credential it used.
const regChallenges = new Map();   // userId -> { challenge, expires }
const loginChallenges = new Map(); // requestId -> { challenge, expires }

function prune(map) { const now = Date.now(); for (const [k, v] of map) if (v.expires < now) map.delete(k); }

async function getRegistrationOptions(userId, userEmail, rpID) {
  prune(regChallenges);
  const existing = auth.listPasskeys(userId).map(p => ({ id: p.id }));
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID, userName: userEmail,
    attestationType: 'none', // we don't need to know the authenticator's make/model, just that it's real
    excludeCredentials: existing, // stops a teacher re-registering the same device as a "new" passkey
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }, // residentKey:required = discoverable, needed for usernameless sign-in
  });
  regChallenges.set(userId, { challenge: options.challenge, expires: Date.now() + TTL_MS });
  return options;
}

async function verifyRegistration(userId, response, rpID, origin, label) {
  const entry = regChallenges.get(userId);
  if (!entry) throw new Error('Registration expired — try again.');
  regChallenges.delete(userId); // one-shot, same principle as password-reset tokens

  const verification = await verifyRegistrationResponse({
    response, expectedChallenge: entry.challenge, expectedOrigin: origin, expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error('Could not verify passkey.');

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  auth.addPasskey(userId, {
    id: credential.id, publicKey: credential.publicKey, counter: credential.counter,
    transports: credential.transports, deviceType: credentialDeviceType, backedUp: credentialBackedUp, label,
  });
}

async function getLoginOptions(rpID) {
  prune(loginChallenges);
  // No allowCredentials — that's what makes this "usernameless": the browser
  // itself shows the user which of their discoverable passkeys for this site
  // to use, rather than us telling it which credential ID to expect.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  const requestId = crypto.randomUUID();
  loginChallenges.set(requestId, { challenge: options.challenge, expires: Date.now() + TTL_MS });
  return { options, requestId };
}

async function verifyLogin(requestId, response, rpID, origin) {
  const entry = loginChallenges.get(requestId);
  if (!entry) throw new Error('Sign-in request expired — try again.');
  loginChallenges.delete(requestId);

  const found = auth.findByCredentialId(response.id);
  if (!found) throw new Error('Passkey not recognized.');

  const verification = await verifyAuthenticationResponse({
    response, expectedChallenge: entry.challenge, expectedOrigin: origin, expectedRPID: rpID,
    credential: found.credential,
  });
  if (!verification.verified) throw new Error('Could not verify passkey.');

  auth.updatePasskeyCounter(found.userId, response.id, verification.authenticationInfo.newCounter);
  return found.userId;
}

module.exports = { getRegistrationOptions, verifyRegistration, getLoginOptions, verifyLogin };
