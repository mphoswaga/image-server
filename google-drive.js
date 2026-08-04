const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const TOKEN_PATH = path.join(DATA_DIR, 'google-drive-tokens.json');
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';

function configured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')); } catch { return {}; }
}

function saveTokens(tokens) {
  writeJsonAtomic(TOKEN_PATH, tokens);
}

function getConnection(userId) {
  const rec = loadTokens()[userId];
  if (!rec || !rec.refreshToken) return null;
  return rec;
}

function connected(userId) {
  return !!getConnection(userId);
}

function randomState() {
  return crypto.randomBytes(24).toString('hex');
}

function buildAuthUrl({ redirectUri, state }) {
  if (!configured()) throw new Error('Google Drive export is not configured yet.');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    state,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode({ code, redirectUri }) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Google authorization failed (${res.status}).`);
  return data;
}

function saveConnection(userId, tokenData) {
  if (!userId) throw new Error('Missing user for Google Drive connection.');
  const tokens = loadTokens();
  const previous = tokens[userId] || {};
  const refreshToken = tokenData.refresh_token || previous.refreshToken;
  if (!refreshToken) throw new Error('Google did not return Drive access. Please reconnect and approve Drive permission.');
  tokens[userId] = {
    refreshToken,
    accessToken: tokenData.access_token || previous.accessToken || null,
    expiresAt: tokenData.expires_in ? Date.now() + (Number(tokenData.expires_in) * 1000) - 60_000 : previous.expiresAt || null,
    scope: tokenData.scope || previous.scope || DRIVE_SCOPE,
    connectedAt: previous.connectedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveTokens(tokens);
  return tokens[userId];
}

function deleteConnection(userId) {
  const tokens = loadTokens();
  if (!tokens[userId]) return false;
  delete tokens[userId];
  saveTokens(tokens);
  return true;
}

async function refreshAccessToken(userId) {
  const rec = getConnection(userId);
  if (!rec) throw new Error('Google Drive is not connected.');
  if (rec.accessToken && rec.expiresAt && rec.expiresAt > Date.now()) return rec.accessToken;

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: rec.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'invalid_grant') deleteConnection(userId);
    throw new Error(data.error_description || data.error || `Could not refresh Google Drive access (${res.status}).`);
  }
  saveConnection(userId, { ...data, refresh_token: rec.refreshToken });
  return data.access_token;
}

function multipartBody(metadata, buffer, mediaMime = PPTX_MIME) {
  const boundary = `ls_drive_${crypto.randomBytes(12).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mediaMime}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { boundary, body: Buffer.concat([head, Buffer.from(buffer), tail]) };
}

async function uploadPptx(userId, { filename, buffer, convertToSlides = false }) {
  if (!configured()) throw new Error('Google Drive export is not configured yet.');
  const accessToken = await refreshAccessToken(userId);
  const cleanName = String(filename || 'LessonScope deck.pptx').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 160);
  const metadata = convertToSlides
    ? { name: cleanName.replace(/\.pptx$/i, ''), mimeType: GOOGLE_SLIDES_MIME }
    : { name: cleanName.endsWith('.pptx') ? cleanName : `${cleanName}.pptx`, mimeType: PPTX_MIME };
  const { boundary, body } = multipartBody(metadata, buffer, PPTX_MIME);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
      Accept: 'application/json',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error && data.error.message ? data.error.message : `Google Drive upload failed (${res.status}).`);
  return data;
}

module.exports = {
  DRIVE_SCOPE,
  PPTX_MIME,
  GOOGLE_SLIDES_MIME,
  configured,
  connected,
  randomState,
  buildAuthUrl,
  exchangeCode,
  saveConnection,
  deleteConnection,
  uploadPptx,
  multipartBody,
};
