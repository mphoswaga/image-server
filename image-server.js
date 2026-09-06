require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const { buildDeck, rebuildDeck, alternativeImage, findReusableImage, searchLibrary, getLibraryImage, listLibrary, addLibraryImages, libraryStats, getLibraryByTopic, recentLibraryImages, removeLibraryImage } = require('./generate');
const quota = require('./quota');
const { generateOneSlide } = require('./content');
const { extractText, extractPptxSlides, saveTemplate, listTemplates, getTemplate, renameTemplate, deleteTemplate, loadOriginalById, loadTemplate, loadOriginal, templatePromptText, TYPES } = require('./template');
const { TEMPLATE_PROMPT_LIMIT, generateLessonPlan, planToText } = require('./lesson-plan');
const { sequenceDetails, groupSectionsByLesson, assertLessonFields, combineOrderedLessons } = require('./lesson-sequence');
const { getTeachingModel, normalizeTeachingModelId, listTeachingModels } = require('./teaching-models');
const { fillDocx, fillXlsx } = require('./fill-template');
const { animateBuffer } = require('./animate-pptx');
const { addImages, fetchWikimediaImages } = require('./admin-images');
const { searchGifs, saveGif, giphyConfigured } = require('./giphy');
const { generateImage } = require('./ai-image');
const { parseFraction, detectLabelledDiagram } = require('./concept-diagram');
const { generateDiagram } = require('./svg-diagram');
const { generateStudyNotes, generateWorksheet, generateExitTicket, generateQuiz, generateHomework, generateActivities, generateGame } = require('./lesson-pack');
const { normalizeVideo, suggestVideos, thumbnailDataUrl } = require('./youtube');
const { studyNotesDocx, worksheetDocx, exitTicketDocx, quizDocx, homeworkDocx, activitiesDocx, lessonPackZip } = require('./docgen');
const unit = require('./unit');
const weekPlanner = require('./week-planner');
const { objectivesFromDeck, criteriaFromDeck } = require('./deck-fields');
const planningSource = require('./planning-source');
const games = require('./games');
const assignments = require('./assignments');
const gradebook = require('./gradebook');
const { gradeAnswer } = require('./auto-grade');
const roster = require('./roster');
const studentAccount = require('./student-account');
const apikeys = require('./apikeys');
const oauth = require('./oauth');
const audit = require('./audit');
const webhooks = require('./webhooks');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const { cookieOptions, createRateLimiter, securityHeaders } = require('./security');
const { requireUploads } = require('./upload-security');
const observability = require('./observability');

// Add transitions/animations; never let it break the download.
function safeAnimate(buffer, band) {
  if (process.env.POWERPOINT_ANIMATIONS === 'false') return buffer;
  try { return animateBuffer(buffer, band); }
  catch (err) { console.log('animation skipped:', err.message); return buffer; }
}
const { sessionSecret, signup, login, findOrCreateSocialUser, issueToken, verifyToken, getUserById, userHasEducScopeIdentity, verifyPassword, listAllUserIds, requireAuth, requireAdmin, COOKIE_NAME, createPasswordResetToken, resetPasswordWithToken, listPasskeys, deletePasskey } = require('./auth');
const { sendEmail } = require('./email');
const webauthn = require('./webauthn');
const socialAuth = require('./social-auth');
const googleDrive = require('./google-drive');
const credits = require('./credits');
const billing = require('./billing');
const wallet = require('./wallet');
const educscope = require('./educscope');
const prices = require('./credit-prices');
const lessonAssistant = require('./lesson-assistant');
const releaseManager = require('./release-manager');
const planningFramework = require('./planning-framework');
const lessonWorkspaces = require('./lesson-workspaces');
const practice = require('./practice');
const practiceLive = require('./practice-live');
const { createFishQuestLive } = require('./fishquest-live');
const colonyQuestCore = require('./public/colonyquest-core');
const { runWithUser, usageSnapshot, usageSince, declareAction } = require('./ai-client');
const usage = require('./usage');
const jwt = require('jsonwebtoken');

const { MEDIA_DIR, mediaWriteDir, resolveMedia } = require('./media');
const PUBLIC_DIR = path.join(__dirname, 'public');
const GAME_COOKIE = 'lc_game';
const JWT_SECRET = (() => {
  try { return require('fs').readFileSync(require('path').join(require('./storage').DATA_DIR, '.session-secret'), 'utf8').trim(); } catch { return process.env.JWT_SECRET || 'dev-secret'; }
})();

// Issue a student game/assignment session. `kind` is 'game' (default,
// unchanged) or 'assignment' — same cookie, same JWT infra. 30 days (matches
// the teacher's own session TTL) so a student is never timed out mid-task —
// a session was previously 8h, which silently expired students who kept a
// tab open across a school day or worked on a take-home assignment overnight.
function issueGameToken(payload, kind = 'game') {
  return jwt.sign({ type: kind, ...payload }, JWT_SECRET, { expiresIn: '30d' });
}

// Accepts either lc_game (student) or lc_token (teacher).
// Student path: sets req.gameSession = { studentId, name, gameId } for a game
// session, or { studentId, name, assignmentId } for an assignment session —
// only the relevant id is populated, so existing game routes' `gameId` checks
// are unaffected by assignment tokens (assignmentId is simply undefined there).
// Teacher path: sets req.userId (existing behaviour).
function requireGameAccess(req, res, next) {
  // A teacher may also have an old learner cookie from previewing another
  // game. Their signed-in teacher session must win, otherwise that stale
  // learner cookie makes a perfectly valid preview look like the wrong game.
  const teacherTok = req.cookies && req.cookies[COOKIE_NAME];
  if (teacherTok) {
    try {
      const p = verifyToken(teacherTok);
      if (p) { req.userId = p; req.user = getUserById(p) || {}; return next(); }
    } catch {}
  }
  const gameTok = req.cookies && req.cookies[GAME_COOKIE];
  if (gameTok) {
    try {
      const p = jwt.verify(gameTok, JWT_SECRET);
      if (p.type === 'game') { req.gameSession = { studentId: p.studentId, gameId: p.gameId, name: p.name }; return next(); }
      if (p.type === 'assignment') { req.gameSession = { studentId: p.studentId, assignmentId: p.assignmentId, name: p.name }; return next(); }
    } catch {}
  }
  res.status(401).json({ error: 'Not authenticated.' });
}

// Assignment pages can recover from a missing assignment-scoped lc_game cookie
// by verifying the longer-lived student identity cookie and reissuing lc_game.
// Keep this separate from requireGameAccess so game routes still require a
// session scoped to the current game.
function requireAssignmentAccess(req, res, next) {
  const gameTok = req.cookies && req.cookies[GAME_COOKIE];
  if (gameTok) {
    try {
      const p = jwt.verify(gameTok, JWT_SECRET);
      if (p.type === 'assignment') { req.gameSession = { studentId: p.studentId, assignmentId: p.assignmentId, name: p.name }; return next(); }
      if (p.type === 'game') { req.gameSession = { studentId: p.studentId, gameId: p.gameId, name: p.name }; return next(); }
    } catch {}
  }
  const student = optionalStudentSession(req);
  if (student) { req.studentSession = student; return next(); }
  const tok = req.cookies && req.cookies[COOKIE_NAME];
  if (tok) {
    try {
      const p = verifyToken(tok);
      if (p) { req.userId = p; req.user = getUserById(p) || {}; return next(); }
    } catch {}
  }
  res.status(401).json({ error: 'Not authenticated.' });
}

// General student identity — NOT scoped to one game/assignment, unlike
// lc_game above. Established once via /api/student/login (Student ID + PIN),
// then reused to browse "my work" and join new games/assignments by Room
// Code without re-entering credentials each time. Separate cookie so an
// active game/assignment session (lc_game) is never clobbered by browsing.
const STUDENT_COOKIE = 'lc_student';
function issueStudentToken(studentId, name) {
  return jwt.sign({ type: 'student', studentId, name }, JWT_SECRET, { expiresIn: '30d' });
}
function requireStudentAccess(req, res, next) {
  const tok = req.cookies && req.cookies[STUDENT_COOKIE];
  if (tok) {
    try {
      const p = jwt.verify(tok, JWT_SECRET);
      if (p.type === 'student') { req.studentSession = { studentId: p.studentId, name: p.name }; return next(); }
    } catch {}
  }
  res.status(401).json({ error: 'Not signed in.' });
}

function optionalStudentSession(req) {
  const tok = req.cookies && req.cookies[STUDENT_COOKIE];
  if (!tok) return null;
  try {
    const p = jwt.verify(tok, JWT_SECRET);
    return p.type === 'student' ? { studentId: p.studentId, name: p.name } : null;
  } catch {
    return null;
  }
}

function requirePracticeEnabled(req, res, next) {
  if (!practice.enabled()) return res.status(404).json({ error: 'LessonScope Practice is not enabled.' });
  next();
}

function assignmentStudentSession(req, res, a) {
  if (req.gameSession && req.gameSession.assignmentId === a.id) return req.gameSession;
  if (req.gameSession && req.gameSession.assignmentId && req.gameSession.assignmentId !== a.id) return null;

  const student = optionalStudentSession(req);
  if (!student || !student.studentId) return null;

  let displayName = student.name || student.studentId;
  if (a.rosterId) {
    const s = roster.findStudentInRoster(a.teacherId, a.rosterId, student.studentId);
    if (!s) return null;
    displayName = s.name;
  }

  const recovered = { studentId: student.studentId, assignmentId: a.id, name: displayName };
  res.cookie(GAME_COOKIE, issueGameToken(recovered, 'assignment'), cookieOptions(30 * 24 * 60 * 60 * 1000));
  return recovered;
}

const app = express();
app.disable('x-powered-by');
// Behind Railway's TLS-terminating proxy: honour X-Forwarded-Proto/For so
// req.protocol is 'https' (needed to build correct OAuth/passkey redirect
// URIs) and req.ip is the real client address for audit logs.
app.set('trust proxy', true);
const PORT = process.env.PORT || 4000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Stripe webhook needs the raw body for signature verification, so its parser
// must run BEFORE express.json (which would otherwise consume the stream).
app.use('/api/billing/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(securityHeaders);

const authLimiter = createRateLimiter({ name: 'auth', windowMs: 15 * 60_000, max: Number(process.env.AUTH_RATE_LIMIT || 40) });
const joinLimiter = createRateLimiter({ name: 'student-join', windowMs: 5 * 60_000, max: Number(process.env.JOIN_RATE_LIMIT || 80) });
const checkpointLimiter = createRateLimiter({ name: 'practice-checkpoint', windowMs: 60_000, max: Number(process.env.CHECKPOINT_RATE_LIMIT || 300) });
const generationLimiter = createRateLimiter({ name: 'generation', windowMs: 5 * 60_000, max: Number(process.env.GENERATION_RATE_LIMIT || 40) });
const uploadLimiter = createRateLimiter({ name: 'upload', windowMs: 5 * 60_000, max: Number(process.env.UPLOAD_RATE_LIMIT || 30) });

app.use(['/api/signup', '/api/student/signup', '/api/login', '/api/password-reset/request', '/api/password-reset/confirm', '/api/webauthn/login/options', '/api/webauthn/login/verify'], authLimiter);
app.use(['/api/student/login', '/api/student/join-room', '/api/student/pin/reset-request', '/api/practice/live-sessions/:code/join', '/api/assignment/:id/enter', '/api/assignment/:id/pin/reset-request', '/api/game/:id/enter', '/api/game/:id/pin/reset-request'], joinLimiter);
app.use('/api/practice/live-sessions/:code/checkpoints', checkpointLimiter);
app.use(['/api/assistant', '/api/lesson-plan', '/api/generate', '/api/pack', '/api/slide'], generationLimiter);
app.use(['/api/templates', '/api/planning-frameworks', '/api/units', '/api/planning-sources', '/api/source-materials', '/api/import', '/api/game/from-pptx', '/api/roster/preview'], uploadLimiter);

// Attribute every AI call in this request to the signed-in user (for cost
// tracking). Reads the auth cookie once; AsyncLocalStorage carries it through
// all the awaited generator calls. Unauthenticated requests → no owner.
app.use((req, res, next) => {
  let uid = null;
  try { const tok = req.cookies && req.cookies[COOKIE_NAME]; uid = (tok && verifyToken(tok)) || null; } catch {}
  runWithUser(uid, () => next());
});

// Runtime images (Unsplash/AI/materials) live on the persistent volume and are
// served first; committed starter images fall through to public/. Both map the
// same root-relative relpaths, so an image URL resolves from whichever has it.
app.use(express.static(MEDIA_DIR));
app.get('/fishquest-client.js', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(__dirname, 'public', 'fishquest-client.js'));
});
app.get('/colonyquest-core.js', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Cloudflare-CDN-Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'colonyquest-core.js'));
});
app.get('/colonyquest.js', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('CDN-Cache-Control', 'no-store');
  res.set('Cloudflare-CDN-Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'colonyquest.js'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(observability.requestMiddleware);

// Guided curriculum advice only. This endpoint cannot mutate plans, generate
// paid artefacts, or access student records. Any future action-taking tool must
// go through the existing reserve -> capture/release lifecycle instead.
app.post('/api/assistant/message', requireAuth, async (req, res) => {
  try {
    declareFree('lessonscope.assistant_advice');
    const reply = await lessonAssistant.answer({
      message: req.body && req.body.message,
      context: req.body && req.body.context,
      history: req.body && req.body.history,
    });
    res.json(reply);
  } catch (err) {
    console.error('LessonScope assistant failed:', err.message);
    res.status(400).json({ error: err.message || 'The assistant could not answer just now.' });
  }
});

app.post('/api/assistant/edit', requireAuth, async (req, res) => {
  try {
    declareFree('lessonscope.assistant_advice');
    const proposal = await lessonAssistant.proposeEdit({
      instruction: req.body && req.body.instruction,
      target: req.body && req.body.target,
      context: req.body && req.body.context,
    });
    res.json(proposal);
  } catch (err) {
    console.error('LessonScope assistant edit failed:', err.message);
    res.status(400).json({ error: err.message || 'The assistant could not prepare that edit.' });
  }
});

// Health check for the host (Railway): confirms the process booted and the
// port is bound. Must not depend on any API keys or external services.
// Which commit is actually serving this request.
//
// Pushed is not deployed. Work has sat unshipped here while it was looked for
// in the browser, and there was no way to tell from outside — so the running
// commit is now something you can read, and scripts/deployed.js compares it
// against local main.
//
// Railway sets RAILWAY_GIT_COMMIT_SHA on every build. The git fallback is for
// running locally, where the working tree is the answer.
const RUNNING_COMMIT = (() => {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 40);
  try {
    return require('child_process').execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
  } catch { return 'unknown'; }
})();

app.get('/healthz', (req, res) => res.json({
  ok: true,
  uptime: process.uptime(),
  commit: RUNNING_COMMIT,
  commitShort: RUNNING_COMMIT.slice(0, 7),
  // Which optional integrations this instance can actually use. Whether a key
  // is present is not a secret, and without it "I cannot see the button" is a
  // guessing game between a stale browser cache and a missing variable.
  integrations: {
    gifs: giphyConfigured(),
    youtube: !!process.env.YOUTUBE_API_KEY,
    images: !!process.env.UNSPLASH_ACCESS_KEY,
  },
}));

app.get('/readyz', (req, res) => {
  const ready = observability.readiness();
  res.status(ready.ok ? 200 : 503).json({
    ...ready,
    commit: RUNNING_COMMIT,
    commitShort: RUNNING_COMMIT.slice(0, 7),
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────
const setSession = (res, userId) => res.cookie(COOKIE_NAME, issueToken(userId), cookieOptions(30 * 24 * 60 * 60 * 1000));

function educscopeOnlyAuthEnabled() {
  return educscope.configured() && process.env.LESSONSCOPE_LOCAL_AUTH_ENABLED !== 'true';
}

function educscopeOnlyResponse(res) {
  return res.status(403).json({
    error: 'Use your EducScope account to sign in.',
    educscopeRequired: true,
    loginUrl: educscope.loginUrl(),
  });
}

app.post('/api/signup', async (req, res) => {
  if (educscopeOnlyAuthEnabled()) return educscopeOnlyResponse(res);
  try {
    const { email, password, name } = req.body || {};
    const user = await signup(email, password, name);
    setSession(res, user.id);
    res.json({ user });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Students sign up from a game link — always the 'student' role.
app.post('/api/student/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    const user = await signup(email, password, name, 'student');
    setSession(res, user.id);
    res.json({ user });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  if (educscopeOnlyAuthEnabled()) return educscopeOnlyResponse(res);
  const { email, password } = req.body || {};
  const user = await login(email, password);
  if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });
  setSession(res, user.id);
  res.json({ user });
});

app.get('/api/educscope/session', async (req, res) => {
  if (!educscope.configured()) {
    return res.json({ authenticated: false, loginUrl: educscope.loginUrl(), reason: 'educscope_not_configured' });
  }
  try {
    const account = await educscope.fetchAccount(req);
    if (!account.authenticated) {
      return res.json({ authenticated: false, loginUrl: account.loginUrl || educscope.loginUrl() });
    }
    const { profile } = account;
    const user = await findOrCreateSocialUser({
      provider: 'educscope',
      providerUserId: profile.userId,
      email: profile.email,
      name: profile.name,
    });
    setSession(res, user.id);
    audit.log('educscope.session', {
      userId: user.id,
      email: user.email,
      educscopeUserId: profile.userId,
      organizationId: profile.organizationId,
      ip: req.ip,
    });
    res.json({ authenticated: true, loginUrl: account.loginUrl || educscope.loginUrl(), user });
  } catch (err) {
    console.error('EducScope session bridge failed:', err.message);
    res.status(502).json({ authenticated: false, loginUrl: educscope.loginUrl(), error: 'EducScope sign-in is not available right now.' });
  }
});

app.post('/api/educscope/token', async (req, res) => {
  if (!educscope.configured()) {
    return res.json({ authenticated: false, loginUrl: educscope.loginUrl(), reason: 'educscope_not_configured' });
  }
  try {
    const account = await educscope.verifyBridgeToken(req.body && req.body.token);
    if (!account.authenticated) {
      return res.status(401).json({ authenticated: false, loginUrl: account.loginUrl || educscope.loginUrl() });
    }
    const { profile } = account;
    const user = await findOrCreateSocialUser({
      provider: 'educscope',
      providerUserId: profile.userId,
      email: profile.email,
      name: profile.name,
    });
    setSession(res, user.id);
    audit.log('educscope.token_session', {
      userId: user.id,
      email: user.email,
      educscopeUserId: profile.userId,
      organizationId: profile.organizationId,
      ip: req.ip,
    });
    res.json({ authenticated: true, loginUrl: account.loginUrl || educscope.loginUrl(), user });
  } catch (err) {
    console.error('EducScope token bridge failed:', err.message);
    res.status(502).json({ authenticated: false, loginUrl: educscope.loginUrl(), error: 'EducScope sign-in is not available right now.' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  // Also end the shared EducScope session — without this the session bridge
  // re-signs the teacher in on the very next page load ("sign out doesn't work").
  educscope.clearSharedSession(res);
  educscope.bust(req.userId);
  res.json({ ok: true });
});

// Always responds the same way whether or not the email has an account —
// otherwise this endpoint could be used to test which emails are registered.
app.post('/api/password-reset/request', async (req, res) => {
  if (educscopeOnlyAuthEnabled()) {
    return res.json({
      ok: true,
      message: 'EducScope manages password reset for the whole suite.',
      educscopeRequired: true,
      loginUrl: educscope.loginUrl(),
    });
  }
  const email = String(req.body && req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Enter your email address.' });
  try {
    const token = await createPasswordResetToken(email);
    if (token) {
      const base = `${req.protocol}://${req.get('host')}`;
      const link = `${base}/?resetToken=${encodeURIComponent(token)}`;
      await sendEmail({
        to: email, subject: 'Reset your LessonScope password',
        html: `<p>Click the link below to set a new password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (err) {
    console.error('Password reset request failed:', err.message);
    res.status(500).json({ error: 'Could not send the reset email — try again shortly.' });
  }
});

app.post('/api/password-reset/confirm', async (req, res) => {
  if (educscopeOnlyAuthEnabled()) {
    return res.status(403).json({
      error: 'EducScope handles password reset for LessonScope.',
      educscopeRequired: true,
      loginUrl: educscope.loginUrl(),
    });
  }
  const { token, password } = req.body || {};
  try {
    await resetPasswordWithToken(token, password);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/me', requireAuth, async (req, res) => {
  // Suite-wide sign-out propagation: if this account signs in via EducScope
  // and the shared EducScope session has ended (signed out in another app),
  // end the local session too. EducScope being unreachable is NOT a sign-out —
  // fail open and keep the local session.
  if (educscope.configured() && userHasEducScopeIdentity(req.userId)) {
    try {
      const account = await educscope.fetchAccount(req);
      if (!account.authenticated) {
        res.clearCookie(COOKIE_NAME);
        educscope.clearSharedSession(res);
        educscope.bust(req.userId);
        return res.status(401).json({ error: 'Signed out of EducScope.', needLogin: true, loginUrl: account.loginUrl || educscope.loginUrl() });
      }
    } catch {}
  }
  res.json({ user: req.user });
});

// ── Passkeys (WebAuthn) ──────────────────────────────────────────────────
// The app is reachable on more than one domain (a railway.app URL and a
// custom domain), and WebAuthn's rpID/origin must exactly match whichever
// domain actually served the page — so these are computed per-request
// rather than hardcoded to one domain.
const rpIDFor = req => req.hostname;
const originFor = req => `${req.protocol}://${req.get('host')}`;

// Teacher: list their own passkeys (never the public key itself, just what's
// needed to show "MacBook Touch ID · added 2 Jul" with a delete button).
app.get('/api/webauthn/passkeys', requireAuth, (req, res) => res.json({ passkeys: listPasskeys(req.userId) }));

app.delete('/api/webauthn/passkeys/:id', requireAuth, (req, res) => {
  const ok = deletePasskey(req.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Passkey not found.' });
  res.json({ ok: true });
});

// Add a passkey to the CURRENTLY signed-in teacher's account — requires
// being logged in already (via password), same as adding a second factor.
app.get('/api/webauthn/register/options', requireAuth, async (req, res) => {
  try {
    const options = await webauthn.getRegistrationOptions(req.userId, req.user.email, rpIDFor(req));
    res.json(options);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/webauthn/register/verify', requireAuth, async (req, res) => {
  try {
    const label = String((req.body && req.body.label) || 'Passkey').slice(0, 60);
    await webauthn.verifyRegistration(req.userId, req.body && req.body.response, rpIDFor(req), originFor(req), label);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Sign in with a passkey — public, no prior auth. Discoverable/usernameless:
// the browser shows the teacher which of their passkeys to use, so no email
// needs to be typed first.
app.get('/api/webauthn/login/options', async (req, res) => {
  if (educscopeOnlyAuthEnabled()) return educscopeOnlyResponse(res);
  try {
    const { options, requestId } = await webauthn.getLoginOptions(rpIDFor(req));
    res.json({ options, requestId });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/webauthn/login/verify', async (req, res) => {
  if (educscopeOnlyAuthEnabled()) return educscopeOnlyResponse(res);
  try {
    const userId = await webauthn.verifyLogin(req.body && req.body.requestId, req.body && req.body.response, rpIDFor(req), originFor(req));
    setSession(res, userId);
    res.json({ user: getUserById(userId) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Social login (Sign in with Google / Microsoft) ─────────────────────────
// Which providers are configured (frontend shows only these buttons).
app.get('/api/auth/providers', (req, res) => {
  if (educscopeOnlyAuthEnabled()) return res.json({ providers: [] });
  res.json({ providers: socialAuth.enabledProviders() });
});

const OAUTH_STATE_COOKIE = 'lc_social_state';
const socialRedirectUri = (req, provider) => `${originFor(req)}/auth/${provider}/callback`;
const DRIVE_STATE_COOKIE = 'lc_drive_state';
const DRIVE_RETURN_COOKIE = 'lc_drive_return';
function publicOriginFor(req) {
  const configured = process.env.GOOGLE_REDIRECT_ORIGIN;
  if (configured) return String(configured).replace(/\/+$/, '');
  const host = String(req.get('host') || req.hostname || '').toLowerCase();
  if (host.includes('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]')) return originFor(req);
  return 'https://lesson.educscope.com';
}
const driveRedirectUri = req => `${publicOriginFor(req)}/integrations/google-drive/callback`;

// ── Google Drive export integration ────────────────────────────────────────
app.get('/api/google-drive/status', requireAuth, (req, res) => {
  res.json({
    configured: googleDrive.configured(),
    connected: googleDrive.configured() && googleDrive.connected(req.userId),
    connectUrl: '/integrations/google-drive/connect',
    redirectUri: driveRedirectUri(req),
  });
});

app.get('/integrations/google-drive/connect', requireAuth, (req, res) => {
  if (!googleDrive.configured()) return res.redirect('/?driveError=' + encodeURIComponent('Google Drive export is not configured yet.'));
  const state = googleDrive.randomState();
  res.cookie(DRIVE_STATE_COOKIE, state, cookieOptions(10 * 60 * 1000));
  const deckId = String(req.query.deckId || '').trim().slice(0, 96);
  const exportTarget = req.query.export === 'slides' ? 'slides' : req.query.export === 'drive' ? 'drive' : '';
  if (deckId && exportTarget) {
    res.cookie(DRIVE_RETURN_COOKIE, JSON.stringify({ deckId, exportTarget }), cookieOptions(10 * 60 * 1000));
  }
  res.redirect(googleDrive.buildAuthUrl({ redirectUri: driveRedirectUri(req), state }));
});

app.get('/integrations/google-drive/callback', requireAuth, async (req, res) => {
  const fail = msg => {
    res.clearCookie(DRIVE_STATE_COOKIE);
    res.clearCookie(DRIVE_RETURN_COOKIE);
    return res.redirect('/?driveError=' + encodeURIComponent(msg || 'Google Drive connection failed.'));
  };
  try {
    if (req.query.error) return fail('Google Drive connection was cancelled.');
    const cookie = req.cookies && req.cookies[DRIVE_STATE_COOKIE];
    res.clearCookie(DRIVE_STATE_COOKIE);
    if (!cookie || cookie !== req.query.state) return fail('Google Drive connection expired. Please try again.');
    if (!req.query.code) return fail('No authorization code returned from Google.');
    const tokens = await googleDrive.exchangeCode({ code: req.query.code, redirectUri: driveRedirectUri(req) });
    googleDrive.saveConnection(req.userId, tokens);
    audit.log('google_drive.connect', { userId: req.userId, ip: req.ip });
    let returnTo = '/?drive=connected';
    const rawReturn = req.cookies && req.cookies[DRIVE_RETURN_COOKIE];
    res.clearCookie(DRIVE_RETURN_COOKIE);
    try {
      const parsed = JSON.parse(rawReturn || '{}');
      if (parsed && parsed.deckId && (parsed.exportTarget === 'drive' || parsed.exportTarget === 'slides')) {
        returnTo += `&deckId=${encodeURIComponent(String(parsed.deckId))}&export=${encodeURIComponent(parsed.exportTarget)}`;
      }
    } catch {}
    res.redirect(returnTo);
  } catch (err) {
    console.error('Google Drive connect failed:', err.message);
    fail(err.message);
  }
});

app.post('/api/google-drive/disconnect', requireAuth, (req, res) => {
  const disconnected = googleDrive.deleteConnection(req.userId);
  if (disconnected) audit.log('google_drive.disconnect', { userId: req.userId, ip: req.ip });
  res.json({ ok: true, connected: false });
});

// Start sign-in: set a short-lived CSRF-state cookie and bounce to the provider.
app.get('/auth/:provider', (req, res) => {
  if (educscopeOnlyAuthEnabled()) return res.redirect(educscope.loginUrl() || '/');
  const provider = req.params.provider;
  if (!socialAuth.isEnabled(provider)) return res.redirect('/?authError=' + encodeURIComponent('That sign-in method is not available.'));
  const state = socialAuth.randomState();
  res.cookie(OAUTH_STATE_COOKIE, `${provider}:${state}`, cookieOptions(10 * 60 * 1000));
  res.redirect(socialAuth.buildAuthUrl(provider, { redirectUri: socialRedirectUri(req, provider), state }));
});

// Provider redirects back here with ?code&state. Verify state, exchange the
// code, find-or-create the teacher, set the session, and land them in the app.
app.get('/auth/:provider/callback', async (req, res) => {
  if (educscopeOnlyAuthEnabled()) return res.redirect(educscope.loginUrl() || '/');
  const provider = req.params.provider;
  const fail = msg => res.redirect('/?authError=' + encodeURIComponent(msg));
  try {
    if (req.query.error) return fail(`${provider} sign-in was cancelled.`);
    const cookie = req.cookies && req.cookies[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE);
    if (!cookie || cookie !== `${provider}:${req.query.state}`) return fail('Sign-in session expired — please try again.');
    if (!socialAuth.isEnabled(provider)) return fail('That sign-in method is not available.');
    if (!req.query.code) return fail('No authorization code returned.');

    const profile = await socialAuth.fetchProfile(provider, { code: req.query.code, redirectUri: socialRedirectUri(req, provider) });
    const user = await findOrCreateSocialUser(profile);
    setSession(res, user.id);
    audit.log('social.login', { provider, userId: user.id, email: user.email, ip: req.ip });
    res.redirect('/');
  } catch (err) {
    console.error('Social login failed:', err.message);
    fail(err.message || 'Sign-in failed. Please try again.');
  }
});

// ── Credits & billing (shared wallet across LessonScope + TeacherScope) ─────
// Enforcement is OFF unless BILLING_ENABLED=true, so turning this on is a
// deliberate switch — deploying the code changes nothing for live teachers.
const billingOn = () => process.env.BILLING_ENABLED === 'true';

// Credit lifecycle — every paid AI action is reserve → run → capture (success)
// or release (failure), routed through the EducScope wallet (wallet.js). The
// app never deducts credits directly; it only names an `action` and lets the
// wallet price/hold/settle it. A failed generation is always released, so it
// never costs a teacher a credit.

// The organization a teacher's credits belong to. In remote (production) mode
// this is the TRUSTED EducScope organization.id resolved server-side and stashed
// on the request by reserve(); in local/beta mode it falls back to the teacher's
// email (the identity the local wallet keys on).
function orgIdFallback(req) { return String(req.user.email || '').trim().toLowerCase(); }
function orgId(req) { return req._orgId || orgIdFallback(req); }

function optionalLocalAuth(req, _res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    const uid = token && verifyToken(token);
    const user = uid && getUserById(uid);
    if (user) {
      req.userId = uid;
      req.user = user;
    }
  } catch {}
  next();
}

function requireCreditsPanelAccess(req, res, next) {
  if (educscope.configured()) return optionalLocalAuth(req, res, next);
  return requireAuth(req, res, next);
}

// A stable idempotency key so a retried request never reserves twice. A client
// may supply its own Idempotency-Key header (the UI will send a fresh one per
// click, so a network retry of that click dedupes). Otherwise we derive one:
// from an explicit `seed` when the caller has a natural per-attempt identity
// (e.g. deck+slide+regen-count), else from the user + action + request body.
function idemKey(req, action, seed) {
  const supplied = req.get('Idempotency-Key');
  if (supplied) return String(supplied).slice(0, 100);
  const basis = seed != null ? String(seed) : JSON.stringify(req.body || {});
  const h = crypto.createHash('sha256').update(`${req.userId}:${action}:${basis}`).digest('hex');
  return `${action}:${h.slice(0, 32)}`;
}

// Credits an action costs THIS request: nothing when billing is off or for
// admins (so live teachers stay free until EducScope flips billing on),
// otherwise the published price.
function costOf(req, action) { return (billingOn() && req.user.role !== 'admin') ? prices.priceFor(action) : 0; }

// Reserve before doing the work. Returns { reservation, block } — if `block` is
// set, the route should `res.status(402).json(block)` and do nothing else.
// opts.credits sets an explicit price (used by fair-use regeneration); omit it
// to use the published price. opts.idemSeed gives the reservation a natural
// per-attempt identity so intentional repeats stay distinct (see idemKey).
// Name a deliberately-free AI action, so the ai-client guard can tell "free on
// purpose" apart from "nobody thought about billing". Throws via assertKnown if
// the action isn't catalogued.
function declareFree(action) { declareAction(prices.assertKnown(action)); }

async function reserve(req, action, opts = {}) {
  // Record what this request is doing before any AI call happens, so an
  // undeclared call downstream is detectable (see ai-client assertDeclared).
  declareAction(prices.assertKnown(action));
  // Local free-trial grant is a local-wallet concept; no-op in remote mode.
  if (!educscope.configured() && req.user.role !== 'admin') credits.ensureFreeGrant(req.user.email);

  const amount = opts.credits != null
    ? ((billingOn() && req.user.role !== 'admin') ? Math.max(0, opts.credits) : 0)
    : costOf(req, action);

  // Nothing to charge (billing OFF, admin, or a free action) → skip the wallet
  // AND the EducScope session check entirely; generation proceeds freely. This
  // is what keeps a billing-OFF deploy completely non-blocking — the login /
  // session behaviour is still verifiable via the read-only Credits panel.
  if (amount === 0) return { reservation: null, block: null };

  // Paid action (billing on): resolve the TRUSTED EducScope org id server-side.
  // A teacher not signed into EducScope is prompted to log in.
  let organizationId, educscopeUserId = null;
  try {
    const ident = await educscope.resolveIdentity(req);
    if (ident.unauthenticated) {
      return { reservation: null, block: { error: 'Sign in to EducScope to keep generating.', needLogin: true, loginUrl: ident.loginUrl } };
    }
    organizationId = ident.local ? orgIdFallback(req) : ident.organizationId;
    educscopeUserId = ident.userId || null;
  } catch (e) {
    observability.recordFailure('wallet', { requestId: req.requestId, operation: 'identity', error: e.message });
    // Can't resolve the org: fail closed in remote mode, open in local/beta.
    if (wallet.failClosed()) return { reservation: null, block: { error: 'Credits are temporarily unavailable — please try again in a moment.', walletUnavailable: true } };
    organizationId = orgIdFallback(req);
  }
  req._orgId = organizationId;
  try {
    const reservation = await wallet.reserveCredits({
      organizationId, product: 'lessonscope', action,
      credits: amount, idempotencyKey: idemKey(req, action, opts.idemSeed),
      metadata: { userId: req.userId, educscopeUserId, email: req.user.email },
    });
    reservation._before = usageSnapshot();   // baseline to diff this action's AI usage against
    return { reservation, block: null };
  } catch (e) {
    if (e.needCredits) return { reservation: null, block: { error: 'You are out of credits. Top up to keep generating.', needCredits: true, balance: e.balance, action, cost: prices.priceFor(action) } };
    observability.recordFailure('wallet', { requestId: req.requestId, operation: 'reserve', error: e.message });
    // A wallet OUTAGE: fail open in local/beta, fail closed once the remote
    // EducScope wallet is live (never give paid AI away when the ledger is down).
    if (wallet.failClosed()) return { reservation: null, block: { error: 'Credits are temporarily unavailable — please try again in a moment.', walletUnavailable: true } };
    return { reservation: null, block: null };
  }
}

// Capture after the work succeeds — attaches the model/token/cost this action
// actually incurred and logs the full metadata record.
async function capture(req, reservation, action, resultRef) {
  if (!reservation) return;
  const u = usageSince(reservation._before) || {};
  const meta = {
    provider: 'openai',
    model: (u.models && u.models[0]) || null,
    inputTokens: u.promptTokens || 0,
    outputTokens: u.completionTokens || 0,
    estimatedCostCents: Math.round((u.costUSD || 0) * 100),
    resultRef: resultRef || null,
  };
  try { await wallet.captureReservation({ reservationId: reservation.reservationId, ...meta }); }
  catch (e) { observability.recordFailure('wallet', { requestId: req.requestId, operation: 'capture', error: e.message }); }
  educscope.bust(req.userId);   // balance changed → next read re-fetches from EducScope
  audit.log('credits.capture', {
    userId: req.userId, organizationId: orgId(req), product: 'lessonscope', action,
    reservationId: reservation.reservationId, credits: reservation.credits, ...meta, status: 'success',
  });
}

// Release when the work fails — the teacher keeps their credit.
async function release(req, reservation, action, reason) {
  if (!reservation) return;
  try { await wallet.releaseReservation({ reservationId: reservation.reservationId, reason: reason || 'failed' }); }
  catch (e) { observability.recordFailure('wallet', { requestId: req.requestId, operation: 'release', error: e.message }); }
  educscope.bust(req.userId);   // hold released → next read re-fetches from EducScope
  audit.log('credits.release', {
    userId: req.userId, organizationId: orgId(req), product: 'lessonscope', action,
    reservationId: reservation.reservationId, credits: reservation.credits,
    status: 'failed', errorReason: String(reason || '').slice(0, 300),
  });
}

// This teacher's balance + history (drives the Credits panel). In remote mode
// the balance is EducScope's wallet.available (resolved server-side from the
// shared session); a missing/expired EducScope session returns { needLogin }.
app.get('/api/credits', requireCreditsPanelAccess, async (req, res) => {
  const admin = req.user && req.user.role === 'admin';
  if (educscope.configured()) {
    try {
      const ident = await educscope.resolveIdentity(req, { fresh: true });
      if (ident.unauthenticated) return res.json({ needLogin: true, loginUrl: ident.loginUrl, billingEnabled: billingOn(), source: 'educscope' });
      return res.json({
        balance: admin ? null : ident.available,
        wallet: admin ? null : ident.wallet,
        subscription: admin ? null : ident.wallet?.subscription || null,
        included: admin ? null : ident.wallet?.included || null,
        purchased: admin ? null : ident.wallet?.purchased || null,
        unlimited: admin,
        billingEnabled: billingOn(),
        source: 'educscope',
        organizationId: ident.organizationId,
        accountUrl: process.env.EDUCSCOPE_ACCOUNT_URL || '',
        history: [],
      });
    } catch (e) {
      observability.recordFailure('wallet', { requestId: req.requestId, operation: 'balance', error: e.message });
      return res.json({ walletUnavailable: true, billingEnabled: billingOn(), source: 'educscope' });
    }
  }
  // Local/beta wallet (unchanged).
  if (!admin) credits.ensureFreeGrant(req.user.email);
  res.json({
    balance: admin ? null : credits.getBalance(req.user.email),
    unlimited: admin,
    billingEnabled: billingOn(),
    purchasable: billing.isConfigured(),
    freeCredits: credits.FREE_CREDITS,
    source: 'local',
    history: admin ? [] : credits.getHistory(req.user.email),
  });
});

// The credit price table (single source of truth) so the UI can show a cost
// badge next to each generation button. billingEnabled tells the UI whether
// those costs actually apply yet.
app.get('/api/credit-prices', requireCreditsPanelAccess, (req, res) => {
  res.json({
    ...prices.publicTable(),
    billingEnabled: billingOn(),
    unlimited: !!(req.user && req.user.role === 'admin'),
    // Where "top up" sends teachers. EducScope owns purchasing; until its wallet
    // is live this is a placeholder the local Credits page still backs up.
    accountUrl: process.env.EDUCSCOPE_ACCOUNT_URL || '',
  });
});

// Which packs are on sale (only when Stripe is configured).
app.get('/api/billing/packs', requireAuth, (req, res) => {
  res.json({ configured: billing.isConfigured(), enabled: billingOn(), currency: billing.CURRENCY, packs: billing.getPacks() });
});

// Start a hosted Stripe Checkout for a pack; returns the URL to redirect to.
app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  if (!billing.isConfigured()) return res.status(400).json({ error: 'Payments are not set up yet.' });
  try {
    const origin = originFor(req);
    const url = await billing.createCheckoutSession({ packId: req.body && req.body.packId, email: req.user.email, successUrl: origin + '/', cancelUrl: origin + '/' });
    res.json({ url });
  } catch (err) { console.error('Checkout failed:', err.message); res.status(400).json({ error: err.message }); }
});

// Payment webhook — the source of truth for completed purchases. Verifies the
// signature, then credits the buyer (idempotent on the transaction reference).
app.post('/api/billing/webhook', (req, res) => {
  let event;
  try { event = billing.constructEvent(req.body, req.headers['x-signature']); }
  catch (err) { console.error('Webhook signature check failed:', err.message); return res.status(400).send(`Webhook Error: ${err.message}`); }
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const email = (s.metadata && s.metadata.email) || (s.customer_details && s.customer_details.email) || '';
      const amount = parseInt((s.metadata && s.metadata.credits) || '0', 10);
      if (email && amount > 0) {
        const { credited, balance } = credits.grantOnce(event.id, email, amount, 'purchase');
        audit.log('credits.purchase', { email, amount, credited, balance, ref: s.id, via: 'webhook' });
      }
    }
    res.json({ received: true });
  } catch (err) { console.error('Webhook handling failed:', err.message); res.status(500).json({ error: 'handler failed' }); }
});

// Return-redirect balance check. When the processor supports server-side
// verification (some do), confirm + credit here too (idempotent); otherwise
// this just reports the current balance while the webhook does the crediting.
app.get('/api/billing/verify', requireAuth, async (req, res) => {
  const reference = req.query.reference;
  try {
    if (reference && typeof billing.verifyTransaction === 'function') {
      const t = await billing.verifyTransaction(String(reference));
      if (t.success && t.email && t.credits > 0) {
        const { credited, balance } = credits.grantOnce(t.reference, t.email, t.credits, 'purchase');
        if (credited) audit.log('credits.purchase', { email: t.email, amount: t.credits, balance, ref: t.reference, via: 'verify' });
      }
      return res.json({ status: t.success ? 'success' : 'pending', balance: credits.getBalance(req.user.email) });
    }
    res.json({ status: 'unknown', balance: credits.getBalance(req.user.email) });
  } catch (err) { console.error('Verify failed:', err.message); res.status(400).json({ error: err.message }); }
});

app.get('/api/config/apps', requireAuth, (req, res) => {
  res.json({
    teacherScopeUrl: process.env.TEACHERSCOPE_APP_URL || 'https://curriculum-comment-generator-production-801b.up.railway.app',
    // The picker hides its GIFs button without a key, rather than offering a
    // search that can only fail.
    gifs: giphyConfigured(),
  });
});

app.get('/api/presets', requireAuth, (req, res) => {
  const { PRESETS } = require('./slide-presets');
  res.json({ presets: PRESETS.map(p => ({ id: p.id, name: p.name, group: p.group, layout: p.layout, dark: p.dark, bg: p.bg, primary: p.primary, accent: p.accent, soft: p.soft, text: p.text })) });
});

app.get('/api/teaching-models', requireAuth, (req, res) => {
  res.json({ models: listTeachingModels(), defaultModelId: 'standard' });
});

// In-memory deck state so the editable preview can mutate before download.
// Snapshotted to DATA_DIR periodically so an in-progress deck survives a
// server restart/redeploy, not just the TTL below — a teacher mid-edit
// shouldn't have to regenerate (and re-spend AI calls) because we shipped
// a deploy while they were working.
const decks = new Map(); // id -> { subject, topic, grade, tone, focus, slides, images, createdAt }
const DECK_TTL = 6 * 60 * 60 * 1000; // 6 hours — covers a full teaching day of prep/interruptions
// Fair-use counter for plan rewrites. A plan is iterated on BEFORE any deck
// exists, so there is no deck to hang the count on — key it on the lesson the
// teacher is working on instead. Purged on the same schedule as decks.
const planRegens = new Map(); // `${userId}:${subject}:${topic}` -> { n, at }
const planRegenKey = (userId, subject, topic) => `${userId}:${String(subject).toLowerCase()}:${String(topic).toLowerCase()}`;
const DECKS_PATH = path.join(DATA_DIR, 'decks.json');

function loadDecks() {
  try {
    const raw = JSON.parse(fs.readFileSync(DECKS_PATH, 'utf8'));
    const now = Date.now();
    let restored = 0;
    for (const [id, d] of Object.entries(raw)) {
      const lastTouched = d && (Number(d.touchedAt) || Number(d.createdAt));
      if (d && lastTouched && now - lastTouched <= DECK_TTL) { decks.set(id, d); restored++; }
    }
    if (restored) console.log(`Restored ${restored} in-progress deck(s) from disk.`);
  } catch { /* no snapshot yet, or unreadable — start empty, same as before this change */ }
}
loadDecks();

function persistDecks() {
  try { writeJsonAtomic(DECKS_PATH, Object.fromEntries(decks)); }
  catch (e) { console.error('Deck snapshot failed:', e.message); }
}

function purgeOldDecks() {
  const now = Date.now();
  let purged = false;
  for (const [id, d] of decks) if (now - (Number(d.touchedAt) || Number(d.createdAt)) > DECK_TTL) { decks.delete(id); purged = true; }
  for (const [k, v] of planRegens) if (now - v.at > DECK_TTL) planRegens.delete(k);
  if (purged) persistDecks();
}
setInterval(purgeOldDecks, 12 * 60 * 1000).unref();
// Snapshot regularly so a crash loses at most this window of edits, not
// the whole in-progress deck (every mutation site would be more precise
// but far more invasive — this covers the same ground with one call site).
setInterval(persistDecks, 30 * 1000).unref();

// Build a preview entry the frontend can render + edit.
function previewEntry(slide, image) {
  return {
    type: slide.type,
    modelStage: slide.modelStage || null,
    modelStageLabel: slide.modelStageLabel || null,
    modelLabel: slide.modelLabel || null,
    title: slide.title,
    subtitle: slide.subtitle || null,
    bullets: slide.bullets || [],
    example: slide.example || null,
    imageQuery: slide.imageQuery || null,
    image: image ? '/' + image.relpath : null,
    imageSource: image ? (image.source || 'library') : null,
    // an animated concept diagram replaces the photo for fraction slides
    fraction: parseFraction(slide.example) || parseFraction(slide.title) || parseFraction(slide.imageQuery) || null,
    // a step/cycle process diagram (any subject)
    visual: (slide.visual && (slide.visual.type === 'steps' || slide.visual.type === 'cycle') && Array.isArray(slide.visual.items) && slide.visual.items.length >= 2) ? slide.visual : null,
    youtube: slide.youtube || null,
    differentiation: slide.differentiation || null,
    shortcuts: (Array.isArray(slide.shortcuts) && slide.shortcuts.length) ? slide.shortcuts : null,
    worked: (slide.worked && slide.worked.task && Array.isArray(slide.worked.steps) && slide.worked.steps.length) ? slide.worked : null,
    labelled: detectLabelledDiagram(`${slide.title || ''} ${slide.imageQuery || ''} ${slide.example || ''}`),
  };
}

function makeVideoSlide(video, sourceSlide = {}) {
  return {
    type: 'video',
    title: video.title || 'Lesson video',
    bullets: [],
    example: '',
    imageQuery: '',
    youtube: video,
    modelStage: sourceSlide.modelStage || null,
    modelStageLabel: sourceSlide.modelStageLabel || null,
    modelLabel: sourceSlide.modelLabel || null,
    speakerNotes: `Teacher-reviewed video for: ${sourceSlide.title || 'this lesson slide'}`,
  };
}

function deckPreviewPayload(id, deck) {
  return {
    deckId: id,
    filename: deckFilename(deck),
    band: deck.band || null,
    slideCount: deck.slides.length,
    teachingModelId: deck.teachingModelId || null,
    sourceText: deck.lessonPlanText || deck.sourceText || '',
    slides: deck.slides.map((s, i) => previewEntry(s, deck.images[i])),
  };
}

app.get('/api/library', (req, res) => res.json(listLibrary()));

// Teacher-reviewed YouTube suggestions. Search is metadata-only: LessonScope
// never downloads or proxies a YouTube video.
app.get('/api/youtube/suggestions', requireAuth, async (req, res) => {
  try {
    // Search on what the slide actually teaches. The topic can be a themed
    // lesson name ("data-cafe") that means nothing on YouTube, whereas the
    // slide's own title and bullets name the real concepts.
    const deck = decks.get(String(req.query.deckId || ''));
    const slide = deck && deck.slides ? deck.slides[Number(req.query.index)] : null;
    const result = await suggestVideos({
      subject: clip(req.query.subject, LIMITS.subject),
      topic: clip(req.query.topic, LIMITS.topic),
      grade: clip(req.query.grade, 80),
      title: clip(slide && slide.title, 200),
      bullets: slide && Array.isArray(slide.bullets) ? slide.bullets.slice(0, 8).map(b => clip(b, 300)) : [],
      objectives: clip(deck && deck.objectives, LIMITS.objectives),
      limit: req.query.limit,
    });
    res.json(result);
  } catch (err) {
    console.error('YouTube suggestion failed:', err.message);
    res.status(502).json({ error: 'YouTube suggestions are temporarily unavailable.' });
  }
});

// ── Admin: grow the image library ─────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => res.json(libraryStats()));

app.get('/api/admin/operations', requireAdmin, (req, res) => {
  res.json({ operations: observability.snapshot(), readiness: observability.readiness(), commit: RUNNING_COMMIT });
});

// Browse images for a specific topic (admin only).
app.get('/api/admin/images', requireAdmin, (req, res) => {
  const { subject, topic } = req.query;
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required.' });
  const images = getLibraryByTopic(subject, topic).map(i => ({
    relpath: i.relpath, image: '/' + i.relpath,
    caption: i.caption || '', source: i.source || '', addedAt: i.addedAt || null,
  }));
  res.json({ images });
});

// Images added in the last N days (default 7), newest first.
app.get('/api/admin/images/recent', requireAdmin, (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7));
  const images = recentLibraryImages(days).map(i => ({
    relpath: i.relpath, image: '/' + i.relpath,
    caption: i.caption || '', source: i.source || '', addedAt: i.addedAt,
    subject: i.subject, topic: i.topic,
  }));
  res.json({ images, days });
});

// Delete one image from the library and from disk.
app.delete('/api/admin/images', requireAdmin, (req, res) => {
  const { relpath } = req.body || {};
  if (!relpath || typeof relpath !== 'string' || relpath.includes('..') || relpath.startsWith('/')) {
    return res.status(400).json({ error: 'Invalid relpath.' });
  }
  const found = removeLibraryImage(relpath);
  if (!found) return res.status(404).json({ error: 'Image not found in library.' });
  // Remove the actual file wherever it lives (persistent volume or committed seed).
  const onDisk = resolveMedia(relpath);
  if (onDisk) { try { fs.unlinkSync(onDisk); } catch { /* already gone */ } }
  res.json({ ok: true });
});

// AI cost: totals, per-user (with emails), and per-model — so the admin can
// see what the app is costing and price it.
app.get('/api/admin/usage', requireAdmin, (req, res) => {
  const u = usage.summary();
  const byUser = Object.entries(u.byUser || {}).map(([uid, b]) => {
    const who = uid === 'system' ? { email: '(system / CLI)', name: 'System' } : (getUserById(uid) || {});
    return { userId: uid, email: who.email || uid, name: who.name || '', ...b };
  }).sort((a, b) => b.costUSD - a.costUSD);
  res.json({ totals: u.totals, byUser, byModel: u.byModel || {}, pricing: usage.PRICING, updatedAt: u.updatedAt });
});

// Application release history and protected code rollback. This restores only
// repository code; persistent teacher data and the Railway volume are never
// modified by these endpoints.
app.get('/api/admin/releases', requireAdmin, async (req, res) => {
  try { res.json({ releaseManager: await releaseManager.status() }); }
  catch (err) {
    console.error('Release history failed:', err.message);
    res.status(500).json({ error: 'Could not load release history.' });
  }
});

const rollbackAttempts = new Map();
app.post('/api/admin/rollback', requireAdmin, async (req, res) => {
  const now = Date.now();
  const attempts = (rollbackAttempts.get(req.userId) || []).filter(at => now - at < 15 * 60 * 1000);
  if (attempts.length >= 5) return res.status(429).json({ error: 'Too many rollback attempts. Try again in 15 minutes.' });
  try {
    const result = await releaseManager.rollback({
      targetSha: req.body && req.body.targetSha,
      verificationCode: req.body && req.body.verificationCode,
      requestedBy: req.user && req.user.email,
    });
    rollbackAttempts.delete(req.userId);
    audit.log('admin.code_rollback', {
      userId: req.userId,
      targetSha: result.target && result.target.sha,
      rollbackCommitSha: result.rollbackCommitSha || null,
      skipped: !!result.skipped,
      ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    attempts.push(now);
    rollbackAttempts.set(req.userId, attempts);
    audit.log('admin.code_rollback_failed', { userId: req.userId, error: err.message, ip: req.ip });
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/add-images', requireAdmin, async (req, res) => {
  declareFree('lessonscope.caption_image');
  const { subject, topic, count } = req.body || {};
  if (!subject || !topic) return res.status(400).json({ error: 'Subject and topic are required.' });
  try {
    const added = await addImages({ subject, topic, count });
    if (added.length) addLibraryImages(added);
    res.json({
      added: added.length,
      captioned: added.filter(a => a.caption).length,
      subject, topic,
      sample: added.slice(0, 3).map(a => ({ filename: a.filename, caption: a.caption })),
    });
  } catch (err) {
    console.error('Add images failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Lesson-plan template packs (save many; pick one per lesson) ────────────
const publicTemplate = t => ({ id: t.id, name: t.name, type: t.type, grade: t.grade || '', filename: t.filename, ext: t.ext, uploadedAt: t.uploadedAt, hasOriginal: !!t.hasOriginal });

app.get('/api/templates', requireAuth, (req, res) => {
  res.json({ templates: listTemplates(req.userId).map(publicTemplate), types: TYPES });
});

app.post('/api/templates', requireAuth, upload.single('file'), requireUploads('template'), async (req, res) => {
  try {
    let text, filename, buffer = null;
    if (req.file) {
      filename = req.file.originalname;
      buffer = req.file.buffer;
      text = await extractText(buffer, filename);
    } else if (req.body && req.body.text) {
      filename = 'pasted-template.txt';
      text = String(req.body.text);
    } else {
      return res.status(400).json({ error: 'Upload a file or paste template text.' });
    }
    // A week-tracker workbook is a different thing entirely: a living file with
    // a tab per week that we append lessons to, rather than a document whose
    // headings we mirror. Detect it here so the teacher just uploads their
    // lesson plan and the app works out which kind it is.
    if (buffer && /\.xlsx?$/i.test(filename || '')) {
      try {
        const installed = await weekPlanner.installPlanner(req.userId, buffer, filename, {
          name: req.body && req.body.name,
          grade: req.body && req.body.grade,
        });
        if (installed.ok) {
          return res.json({
            weekPlanner: {
              id: installed.id,
              name: installed.name,
              grade: installed.grade || '',
              filename,
              templateSheet: installed.templateSheet,
              weeks: installed.weeks,
              fieldCount: (installed.fields || []).length,
            },
          });
        }
      } catch (err) {
        console.error('Week-planner detection failed:', err.message);  // fall through to a normal template
      }
    }

    if (!text || !text.trim()) return res.status(400).json({ error: 'Could not read any text from that file.' });
    const rec = saveTemplate(req.userId, { name: req.body && req.body.name, type: req.body && req.body.type, grade: req.body && req.body.grade, filename, text, buffer });
    // Only the first TEMPLATE_PROMPT_LIMIT characters reach the generator. Say
    // so at upload: silently dropping the end of a long template means the
    // teacher's later sections quietly stop appearing and nothing explains why.
    const truncatedBy = Math.max(0, text.trim().length - TEMPLATE_PROMPT_LIMIT);
    res.json({
      template: publicTemplate(rec),
      ...(truncatedBy ? {
        warning: `This template is long, so only its first ${TEMPLATE_PROMPT_LIMIT.toLocaleString()} characters guide the lesson plan — about ${truncatedBy.toLocaleString()} characters at the end won't be used. Trim it to the sections you want mirrored for the best result.`,
      } : {}),
    });
  } catch (err) {
    console.error('Template upload failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/templates/:id', requireAuth, (req, res) => {
  const rec = renameTemplate(req.userId, req.params.id, { name: req.body && req.body.name, type: req.body && req.body.type, grade: req.body && req.body.grade });
  if (!rec) return res.status(404).json({ error: 'Template not found.' });
  res.json({ template: publicTemplate(rec) });
});

app.delete('/api/templates/:id', requireAuth, (req, res) => {
  const ok = deleteTemplate(req.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Template not found.' });
  res.json({ ok: true });
});

// ── Personal planning frameworks ──────────────────────────────────────────
// Frameworks shape pedagogy; templates shape the exported document and source
// materials provide lesson facts. Keeping these separate prevents a school
// rubric from being mistaken for either a blank form or textbook content.
const publicFramework = f => ({
  id: f.id, ownerType: 'personal', name: f.name, type: f.type,
  appliesTo: f.appliesTo, filename: f.filename, status: f.status,
  active: !!f.active, summary: f.summary || '', requirements: f.requirements || [],
  avoidances: f.avoidances || [], version: f.version || 1,
  versionCount: 1 + ((f.versions || []).length), createdAt: f.createdAt, updatedAt: f.updatedAt,
});

app.get('/api/planning-frameworks', requireAuth, (req, res) => {
  res.json({
    frameworks: planningFramework.list(req.userId).map(publicFramework),
    types: planningFramework.TYPES,
    appliesTo: planningFramework.APPLIES_TO,
    scope: 'personal',
  });
});

app.post('/api/planning-frameworks', requireAuth, upload.single('file'), requireUploads('template'), async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a framework file.' });
    declareFree('lessonscope.parse_planning_framework');
    const filename = req.file.originalname || 'planning-framework';
    const text = String(await extractText(req.file.buffer, filename) || '').trim();
    if (!text) return res.status(400).json({ error: 'Could not read any text from that file.' });
    const draft = await planningFramework.analyze(text);
    const rec = planningFramework.create(req.userId, {
      name: req.body && req.body.name,
      type: req.body && req.body.type,
      appliesTo: req.body && req.body.appliesTo,
      filename, sourceText: text, buffer: req.file.buffer, draft,
    });
    audit.log('planning_framework.created', { userId: req.userId, frameworkId: rec.id, type: rec.type });
    res.json({ framework: publicFramework(rec), needsReview: true });
  } catch (err) {
    console.error('Planning framework upload failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/planning-frameworks/:id', requireAuth, (req, res) => {
  try {
    const rec = planningFramework.update(req.userId, req.params.id, req.body || {});
    if (!rec) return res.status(404).json({ error: 'Planning framework not found.' });
    audit.log('planning_framework.updated', { userId: req.userId, frameworkId: rec.id, active: rec.active, version: rec.version });
    res.json({ framework: publicFramework(rec) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/planning-frameworks/:id', requireAuth, (req, res) => {
  const ok = planningFramework.remove(req.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Planning framework not found.' });
  audit.log('planning_framework.deleted', { userId: req.userId, frameworkId: req.params.id });
  res.json({ ok: true });
});

// ── Week-tracker lesson plan ───────────────────────────────────────────────
// The teacher's living workbook: a tab per week, a column per lesson. Uploaded
// through /api/templates (detected there), appended to as lessons are
// generated, and downloadable at any point with every week to date.
app.get('/api/week-planner', requireAuth, async (req, res) => {
  const planners = weekPlanner.listPlanners(req.userId);
  const activeId = weekPlanner.activePlannerId(req.userId);
  const present = weekPlanner.hasPlanner(req.userId);
  let meta = weekPlanner.readPlannerMeta(req.userId);
  // Workbooks installed before the app recorded how many lessons a week holds
  // have no shape in their meta. Read it back off the workbook once, so those
  // teachers get the lesson selector without re-uploading.
  if (present && meta && !meta.shape) {
    try { meta = { ...meta, ...(await weekPlanner.refreshMeta(req.userId)) }; } catch {}
  }
  res.json({ present, activeId, planners, ...(meta || {}) });
});

app.post('/api/week-planner/:id/select', requireAuth, async (req, res) => {
  const planner = weekPlanner.selectPlanner(req.userId, req.params.id);
  if (!planner) return res.status(404).json({ error: 'Lesson-plan template not found.' });
  let meta = weekPlanner.readPlannerMeta(req.userId, planner.id);
  if (meta && !meta.shape) {
    try { meta = { ...meta, ...(await weekPlanner.refreshMeta(req.userId, planner.id)) }; } catch {}
  }
  res.json({ ok: true, planner: meta });
});

app.patch('/api/week-planner/:id', requireAuth, (req, res) => {
  const planner = weekPlanner.updatePlanner(req.userId, req.params.id, {
    name: req.body && req.body.name,
    grade: req.body && req.body.grade,
  });
  if (!planner) return res.status(404).json({ error: 'Lesson-plan template not found.' });
  res.json({ planner });
});

app.get('/api/week-planner/download', requireAuth, async (req, res) => {
  const id = req.query && req.query.id;
  const buffer = await weekPlanner.plannerBuffer(req.userId, id);
  if (!buffer) return res.status(404).json({ error: 'No week-by-week lesson plan uploaded yet.' });
  const meta = weekPlanner.readPlannerMeta(req.userId, id) || {};
  const name = String(meta.filename || 'lesson-plan.xlsx').replace(/[^a-z0-9.\-_ ]/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buffer);
});

app.delete('/api/week-planner', requireAuth, (req, res) => {
  if (!weekPlanner.hasPlanner(req.userId)) return res.status(404).json({ error: 'Nothing to remove.' });
  weekPlanner.deletePlanner(req.userId);
  res.json({ ok: true });
});

app.delete('/api/week-planner/:id', requireAuth, (req, res) => {
  if (!weekPlanner.deletePlanner(req.userId, req.params.id)) return res.status(404).json({ error: 'Lesson-plan template not found.' });
  res.json({ ok: true, activeId: weekPlanner.activePlannerId(req.userId) });
});

// Download the lesson plan filled into the ORIGINAL template (exact layout).
app.post('/api/lesson-plan/download', requireAuth, async (req, res) => {
  let sections = (req.body && req.body.sections) || [];
  const templateId = req.body && req.body.templateId;

  // No plan on screen but a deck in hand — which is exactly where a teacher who
  // started from their slides ends up. The deck already carries the lesson:
  // titles, the points taught, examples, vocabulary and speaker notes. Write the
  // plan from that rather than telling them to go back and make one.
  let generatedFromDeck = null;
  // Set when the plan could not be shaped to the teacher's own form. The body
  // of this route is a file, so it travels as a header the client reads.
  let planWarning = null;
  if (!sections.length && req.body && req.body.deckId) {
    const deck = decks.get(String(req.body.deckId));
    if (!deck) return res.status(404).json({ error: 'That lesson has expired — generate it again.' });
    const source = deckAsPlanSource(deck);
    if (!source.trim()) return res.status(400).json({ error: 'These slides have no text to build a plan from.' });

    const { reservation, block } = await reserve(req, 'lessonscope.generate_lesson_plan');
    if (block) return res.status(402).json(block);
    try {
      const tpl = (templateId && getTemplate(req.userId, templateId)) || loadTemplate(req.userId);
      let outline = null, plannerText = '';
      let plannerUnreadable = false;
      if (!tpl) {
        // Swallowing this produced a plan in a shape the teacher never asked
        // for — generic headings instead of their workbook's rows — with
        // nothing to explain it. They still get a plan for their credit, but
        // the response says the format could not be matched.
        try {
          const wb = await weekPlanner.loadPlanner(req.userId);
          if (wb) { outline = weekPlanner.fieldOutline(wb); plannerText = weekPlanner.templateTextFromWorkbook(wb); }
        } catch (err) {
          plannerUnreadable = weekPlanner.hasPlanner(req.userId);
          console.error('Week planner could not be read for the plan prompt:', err.message);
        }
      }
      const plan = await generateLessonPlan({
        subject: String(deck.subject || '').toLowerCase(),
        topic: String(deck.topic || '').toLowerCase(),
        grade: deck.grade, tone: deck.tone,
        // The deck IS the lesson, so it grounds the plan. Real objectives are
        // used when the deck has them; otherwise the slides speak for themselves.
        objectives: String(deck.objectives || '').trim() || objectivesFromDeck(deck) || source,
        successCriteria: criteriaFromDeck(deck).split('\n').filter(Boolean),
        templateText: tpl ? templatePromptText(req.userId, tpl) : plannerText,
        sourceMaterialText: source,
        teachingModel: deck.teachingModelId,
        sequence: deck.lessonSequence || null,
        structuredSequence: !!(outline && deck.lessonSequence && deck.lessonSequence.enabled),
      });
      sections = outline
        ? ((deck.lessonSequence && deck.lessonSequence.enabled) ? orderSequenceSectionsByOutline : orderSectionsByOutline)(plan.sections, outline, {
            objectives: String(deck.objectives || '').trim() || objectivesFromDeck(deck),
            successCriteria: plan.successCriteria,
            subject: deck.subject, topic: deck.topic,
          }, deck.lessonSequence)
        : plan.sections;
      await capture(req, reservation, 'lessonscope.generate_lesson_plan', `${deck.subject}-${deck.topic}`);
      generatedFromDeck = true;
      if (plannerUnreadable) planWarning = 'Your week-by-week plan could not be read, so this plan uses a standard structure rather than your own fields.';
    } catch (err) {
      await release(req, reservation, 'lessonscope.generate_lesson_plan', err.message);
      console.error('Plan-from-deck failed:', err.message);
      return res.status(400).json({ error: err.message });
    }
  }

  if (!sections.length) return res.status(400).json({ error: 'No lesson plan to download.' });
  const orig = templateId ? loadOriginalById(req.userId, templateId) : loadOriginal(req.userId);
  if (!orig) {
    // A teacher on the week-by-week workbook has no single-document template to
    // fill — their plan IS the workbook. File THIS lesson into it first: asking
    // for the plan at the review stage should hand back a workbook containing
    // the plan on screen, not the empty file they uploaded. Filing is keyed on
    // week + topic, so doing it here and again when the slides are generated
    // updates the same column instead of leaving a duplicate.
    if (weekPlanner.hasPlanner(req.userId)) {
      // When the plan came from a deck, the deck is the source of truth for what
      // the lesson is — req.body carries only what the page happened to know.
      const deck = req.body && req.body.deckId ? decks.get(String(req.body.deckId)) : null;
      await addLessonToWeekPlanner(req, {
        subject: clip((deck && deck.subject) || req.body.subject, LIMITS.subject),
        topic: clip((deck && deck.topic) || req.body.topic, LIMITS.topic),
        objectives: clip((deck && deck.objectives) || req.body.objectives || (deck && objectivesFromDeck(deck)), LIMITS.objectives),
        successCriteria: (Array.isArray(req.body.successCriteria) && req.body.successCriteria.length)
          ? req.body.successCriteria
          : (deck ? criteriaFromDeck(deck).split('\n').filter(Boolean) : []),
        lessonPlan: { sections },
        slides: (deck && deck.slides) || [],
        sequence: (deck && deck.lessonSequence) || lessonSequenceFromBody(req.body),
      });
      let plannerBuf = null;
      try {
        plannerBuf = await weekPlanner.plannerBuffer(req.userId);
      } catch (err) {
        // Distinguished from "nothing uploaded": telling someone to re-upload
        // a template they can see in the app is worse than saying nothing.
        console.error('Week planner could not be read for download:', err.message);
        return res.status(500).json({
          error: 'Your week-by-week plan is stored but could not be opened. Re-upload it to repair the file — your lessons so far are in the copy you last downloaded.',
        });
      }
      if (plannerBuf) {
        const meta = weekPlanner.readPlannerMeta(req.userId) || {};
        const name = String(meta.filename || 'lesson-plan.xlsx').replace(/[^a-z0-9.\-_ ]/gi, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        if (planWarning) res.setHeader('X-Plan-Warning', planWarning);
        return res.send(plannerBuf);
      }
    }
    return res.status(400).json({ error: 'No original template file is stored. Please re-upload your template — the app now keeps the original so it can fill it.' });
  }
  try {
    let out, mime, name;
    const base = orig.filename.replace(/\.[^.]+$/, '');
    if (orig.ext === '.docx') {
      out = fillDocx(orig.buffer, sections);
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      name = `${base} (lesson plan).docx`;
    } else if (orig.ext === '.xlsx' || orig.ext === '.xls') {
      out = fillXlsx(orig.buffer, sections);
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      name = `${base} (lesson plan).xlsx`;
    } else {
      return res.status(400).json({ error: `Exact-template download supports Word (.docx) and Excel (.xlsx). Your template is "${orig.ext}", which can't be refilled in place.` });
    }
    console.log(`Lesson plan filled ${out.filled}/${out.total} sections into ${orig.filename}`);
    // Nothing matched: the file would come back byte-for-byte as uploaded, which
    // reads as the app ignoring the lesson. Say so instead of shipping it — the
    // plan itself is safe on screen, and a Word download still gets them their
    // lesson while they sort the template out.
    if (!out.filled) {
      return res.status(422).json({
        error: `None of the headings in "${orig.filename}" matched this lesson plan, so nothing could be filled in. `
          + `The plan uses: ${sections.slice(0, 6).map(s => s.heading).filter(Boolean).join(', ')}. `
          + `Rename your template's headings to match, or re-upload the template and rewrite the plan so it follows your form.`,
        filled: 0,
        total: out.total,
        skipped: out.skipped,
      });
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('X-Sections-Filled', `${out.filled}/${out.total}`);
    if (planWarning) res.setHeader('X-Plan-Warning', planWarning);
    res.send(out.buffer);
  } catch (err) {
    console.error('Lesson plan download failed:', err.message);
    res.status(400).json({ error: 'Could not fill the template: ' + err.message });
  }
});

// ── Scheme of work / unit management ──────────────────────────────────────
// Upload a scheme of work → LLM parses it into a structured unit.
// The unit is then available as context for lesson plans and decks.

app.post('/api/units', requireAuth, upload.single('file'), requireUploads('template'), async (req, res) => {
  declareFree('lessonscope.parse_unit');
  try {
    let text, filename;
    if (req.file) {
      filename = req.file.originalname;
      text = await extractText(req.file.buffer, filename);
    } else if (req.body && req.body.text) {
      filename = 'pasted-scheme.txt';
      text = String(req.body.text);
    } else {
      return res.status(400).json({ error: 'Upload a scheme of work file or paste text.' });
    }
    if (!text || !text.trim()) return res.status(400).json({ error: 'Could not read any text from that file.' });
    const parsed = await unit.parseUnit(text);
    const rec = await unit.saveUnit(req.userId, parsed, filename);
    res.json({ unit: { id: rec.id, name: rec.name, subject: rec.subject, grade: rec.grade, lessonCount: rec.lessons.length, createdAt: rec.createdAt } });
  } catch (err) {
    console.error('Unit parse failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/units', requireAuth, (req, res) => {
  res.json({ units: unit.listUnits(req.userId) });
});

app.get('/api/units/:id', requireAuth, (req, res) => {
  const u = unit.getUnit(req.userId, req.params.id);
  if (!u) return res.status(404).json({ error: 'Unit not found.' });
  res.json({ unit: u });
});

app.delete('/api/units/:id', requireAuth, (req, res) => {
  unit.deleteUnit(req.userId, req.params.id);
  res.json({ ok: true });
});

// ── Planning sources (pacing guides / year plans / weekly plans) ─────────────
app.post('/api/planning-sources', requireAuth, upload.single('file'), requireUploads('planning'), async (req, res) => {
  declareFree('lessonscope.parse_pacing_guide');
  if (!req.file) return res.status(400).json({ error: 'Upload an Excel file (.xlsx).' });
  const { originalname, buffer } = req.file;
  const ext = path.extname(originalname).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls') return res.status(400).json({ error: 'Only Excel files (.xlsx / .xls) are supported for planning sources.' });
  try {
    const { items, gradesFound, subject, extractionMode, warnings } = await planningSource.parseExcelSourceWithAi(buffer, originalname);
    if (!items.length) return res.status(400).json({ error: 'No weekly data could be extracted. Check that your file has weekly/unit planning information or try a clearer export from Excel.' });
    const rec = await planningSource.savePlanningSource(req.userId, { fileName: originalname, items, gradesFound, subject, sourceType: req.body.sourceType || 'pacing_guide' });
    res.json({ source: { id: rec.id, fileName: rec.fileName, sourceType: rec.sourceType, subject: rec.subject, gradesFound: rec.gradesFound, uploadedAt: rec.uploadedAt, itemCount: items.length, extractionMode, warnings: warnings || [] } });
  } catch (err) {
    console.error('Planning source parse failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/planning-sources', requireAuth, (req, res) => {
  res.json({ sources: planningSource.listPlanningSources(req.userId) });
});

app.get('/api/planning-sources/:id', requireAuth, (req, res) => {
  const src = planningSource.getPlanningSource(req.userId, req.params.id);
  if (!src) return res.status(404).json({ error: 'Not found.' });
  // Return without the full items array (can be large)
  const { items: _, ...meta } = src;
  res.json({ source: { ...meta, itemCount: (src.items || []).length } });
});

app.get('/api/planning-sources/:id/items', requireAuth, (req, res) => {
  const { grade, week } = req.query;
  const items = planningSource.queryItems(req.userId, req.params.id, { grade, week });
  // Also return list of all available weeks for this source+grade (for carousel)
  const allForGrade = planningSource.queryItems(req.userId, req.params.id, { grade });
  const weeks = [...new Set(allForGrade.map(i => i.weekNumber))].sort((a, b) => a - b);
  res.json({ items, availableWeeks: weeks, grade, week: week ? parseInt(week, 10) : null });
});

app.delete('/api/planning-sources/:id', requireAuth, (req, res) => {
  planningSource.deletePlanningSource(req.userId, req.params.id);
  res.json({ ok: true });
});

// Hard truncation limits — enforce here as a server-side backstop so malformed
// or oversized requests can't inflate token budgets even if the UI is bypassed.
const LIMITS = { subject: 60, topic: 80, objectives: 1500, focus: 400, source: 24000 };
function clip(val, max) { return String(val || '').slice(0, max); }
function lessonSequenceFromBody(body) {
  const enabled = body && (body.sequenceEnabled === true || body.sequenceEnabled === 'true' || body.sequenceEnabled === 'on');
  if (!enabled) return null;
  const lessonCount = Math.min(5, Math.max(2, parseInt(body.sequenceLessonCount, 10) || 3));
  const periodMinutes = Math.min(180, Math.max(5, parseInt(body.periodMinutes, 10) || 35));
  return { enabled: true, lessonCount, periodMinutes };
}
const MATERIAL_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MATERIAL_DOC_EXTS = new Set(['.docx', '.pdf', '.xlsx', '.xls', '.csv', '.txt', '.md', '.pptx', '.ppt']);
const MATERIAL_DIR = path.join(MEDIA_DIR, 'lesson-materials');
function safeBaseName(name) {
  return String(name || 'material').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'material';
}
function sourceMaterialText(body) {
  return clip(body && body.sourceMaterialText, LIMITS.source);
}
function sourceMaterialImages(body) {
  const arr = Array.isArray(body && body.sourceMaterialImages) ? body.sourceMaterialImages : [];
  return arr.filter(img => {
    const rel = String(img && img.relpath || '');
    return rel.startsWith('lesson-materials/') && !rel.includes('..');
  }).map(img => ({
    relpath: String(img.relpath),
    filename: clip(img.filename, 120),
    caption: clip(img.caption || img.filename || 'Teacher uploaded source material', 220),
    keywords: Array.isArray(img.keywords) ? img.keywords.slice(0, 20).map(k => clip(k, 40)) : [],
    source: 'teacher-upload',
  }));
}
function mergeSourceIntoPlanText(planText, materialText) {
  const plan = clip(planText, LIMITS.source);
  const material = clip(materialText, 6000);
  if (!material) return plan;
  return clip(`${plan}\n\n--- OPTIONAL TEACHER SOURCE MATERIALS ---\n${material}\n--- END SOURCE MATERIALS ---`, LIMITS.source);
}
// A raw lesson-plan / source-text block (from an uploaded plan or slides) can
// ground generation instead of a structured {sections} plan. Prefer the
// structured plan when present; otherwise fall back to the raw text.
function resolvePlanText(body) {
  const sections = body && body.lessonPlan && body.lessonPlan.sections;
  if (Array.isArray(sections) && sections.length) return planToText(body.lessonPlan);
  return clip(body && body.lessonPlanText, LIMITS.source);
}

app.post('/api/source-materials/preview', requireAuth, upload.array('files', 8), requireUploads('source', { maxTotalBytes: 30 * 1024 * 1024 }), async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose at least one file.' });
  const textParts = [];
  const images = [];
  const skipped = [];
  fs.mkdirSync(MATERIAL_DIR, { recursive: true });
  for (const file of files) {
    const filename = file.originalname || 'material';
    const ext = path.extname(filename).toLowerCase();
    try {
      if (MATERIAL_IMAGE_EXTS.has(ext)) {
        const id = crypto.randomUUID();
        const savedName = `${safeBaseName(req.userId)}-${id}-${safeBaseName(filename)}${ext === '.jpeg' ? '.jpg' : ext}`;
        const relpath = path.posix.join('lesson-materials', savedName);
        fs.writeFileSync(path.join(MEDIA_DIR, relpath), file.buffer);
        images.push({
          relpath,
          filename,
          caption: `${safeBaseName(filename).replace(/-/g, ' ')} teacher uploaded source image`,
          keywords: safeBaseName(filename).split('-').filter(Boolean).slice(0, 12),
          source: 'teacher-upload',
        });
      } else if (MATERIAL_DOC_EXTS.has(ext)) {
        const text = (await extractText(file.buffer, filename) || '').trim();
        if (text) textParts.push(`# ${filename}\n${text.slice(0, 7000)}`);
        else skipped.push(`${filename}: no readable text found`);
      } else {
        skipped.push(`${filename}: unsupported file type`);
      }
    } catch (err) {
      skipped.push(`${filename}: ${err.message}`);
    }
  }
  if (!textParts.length && !images.length) {
    return res.status(400).json({ error: skipped[0] || 'No readable material found.' });
  }
  res.json({
    ok: true,
    fileCount: files.length,
    text: clip(textParts.join('\n\n'), LIMITS.source),
    images,
    skipped,
  });
});

// ── Lesson plan generation (objectives + stored template → plan) ──────────
app.post('/api/lesson-plan', requireAuth, async (req, res) => {
  const { grade, tone, templateId, unitId, lessonIndex, regenerate } = req.body || {};
  const teachingModelId = normalizeTeachingModelId(req.body && req.body.teachingModelId);
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  const objectives = clip(req.body.objectives, LIMITS.objectives);
  const lessonSequence = lessonSequenceFromBody(req.body);
  const sequenceLessonNumber = lessonSequence
    ? Math.min(lessonSequence.lessonCount, Math.max(1, parseInt(req.body.sequenceLessonNumber, 10) || 1))
    : null;
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  if (!objectives.trim()) return res.status(400).json({ error: 'Please paste the lesson objectives.' });
  // Writing the plan costs a credit; rewriting it is free within fair-use, the
  // same deal slides get — landing on a plan that matches the school's format
  // usually takes a pass or two, and that shouldn't cost a credit each time.
  const isRewrite = !!regenerate;
  const regenKey = planRegenKey(req.userId, subject, topic);
  const used = isRewrite ? ((planRegens.get(regenKey) || {}).n || 0) : 0;
  const action = isRewrite ? 'lessonscope.regenerate_lesson_plan' : 'lessonscope.generate_lesson_plan';
  const opts = isRewrite
    ? { credits: used < prices.FREE_REGENS ? 0 : prices.REGEN_BATCH_COST, idemSeed: `${regenKey}:${used}` }
    : {};
  const { reservation, block } = await reserve(req, action, opts);
  if (block) return res.status(402).json(block);
  try {
    const tpl = (templateId && getTemplate(req.userId, templateId)) || loadTemplate(req.userId);
    const framework = req.body.planningFrameworkId
      ? planningFramework.get(req.userId, req.body.planningFrameworkId)
      : null;
    const u = unitId ? unit.getUnit(req.userId, unitId) : null;
    const unitBlock = u ? unit.buildUnitBlock(u, lessonIndex) : '';

    // If the teacher keeps a week-by-week workbook, the plan they review must
    // use THEIR row labels ("Intro (10m)", "SC", "Assessment"), not a generic
    // structure — otherwise they are editing headings that never appear in the
    // file they actually keep. Their own template wins if they picked one.
    let plannerOutline = null;
    let plannerTemplateText = '';
    if (!tpl) {
      try {
        const wb = await weekPlanner.loadPlanner(req.userId);
        if (wb) {
          plannerOutline = weekPlanner.fieldOutline(wb);
          plannerTemplateText = weekPlanner.templateTextFromWorkbook(wb);
        }
      } catch (err) { console.error('Week-planner outline failed:', err.message); }
    }

    const plan = await generateLessonPlan({
      subject: subject.toLowerCase(), topic: topic.toLowerCase(),
      grade, tone, objectives,
      successCriteria: Array.isArray(req.body.successCriteria) ? req.body.successCriteria : [],
      templateText: tpl ? templatePromptText(req.userId, tpl) : plannerTemplateText, unitBlock,
      sourceMaterialText: sourceMaterialText(req.body), planningFrameworkText: planningFramework.promptText(framework),
      teachingModel: teachingModelId, sequence: lessonSequence, structuredSequence: false,
      sequenceLessonNumber, previousLessonPlanText: clip(req.body.previousLessonPlanText, 8000), regenerate: !!regenerate,
    });

    // Show the workbook's fields in their own order, with the objectives and
    // success criteria the school actually set — read-only, because they are
    // copied from the pacing guide and must never be reworded.
    const sections = plannerOutline
      ? orderSectionsByOutline(plan.sections, plannerOutline, {
          objectives,
          successCriteria: plan.successCriteria,
          subject, topic,
          unit: clip(req.body.unitName || req.body.unit, 200),
          period: clip(req.body.period, 120),
        })
      : plan.sections;

    await capture(req, reservation, action, `${subject}-${topic}`);
    if (isRewrite) planRegens.set(regenKey, { n: used + 1, at: Date.now() });

    res.json({
      sections, successCriteria: plan.successCriteria, teachingModelId, model: getTeachingModel(teachingModelId),
      sequence: lessonSequence, sequenceLessonNumber,
      weekPlannerFields: plannerOutline ? plannerOutline.map(f => f.label) : null,
      usedTemplate: !!tpl, templateName: tpl ? tpl.name : null, templateId: tpl ? tpl.id : null,
      planningFramework: framework && framework.active ? { id: framework.id, name: framework.name, version: framework.version } : null,
      rewritesUsed: isRewrite ? used + 1 : 0, freeRewrites: prices.FREE_REGENS,
    });
  } catch (err) {
    await release(req, reservation, action, err.message);
    console.error('Lesson plan failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Import flows: teacher already has a lesson plan or slides ───────────────
// Path A — "I have a lesson plan": upload it (Word/PDF/text), skip objectives,
// and go straight to slides. The extracted plan text grounds the slides (and
// the lesson pack afterwards) exactly like an accepted in-app plan would.
app.post('/api/import/lesson-plan', requireAuth, upload.single('file'), requireUploads('template'), async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  if (!req.file) return res.status(400).json({ error: 'Please choose your lesson-plan file.' });
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  if (!subject || !topic) return res.status(400).json({ error: 'Enter the subject and topic for this lesson.' });
  const { reservation, block } = await reserve(req, 'lessonscope.import_plan_to_slides');
  if (block) return res.status(402).json(block);
  try {
    const planText = (await extractText(req.file.buffer, req.file.originalname) || '').trim();
    if (!planText) { await release(req, reservation, 'lessonscope.import_plan_to_slides', 'unreadable file'); return res.status(400).json({ error: "Couldn't read any text from that file — try a Word, PDF, or text export." }); }
    const { slideCount, grade, tone, presetId } = req.body || {};
    const teachingModelId = normalizeTeachingModelId(req.body && req.body.teachingModelId);
    const focus = clip(req.body.focus, LIMITS.focus);
    const materialText = sourceMaterialText(req.body);
    const materialImages = sourceMaterialImages(req.body);
    const groundedPlanText = mergeSourceIntoPlanText(planText, materialText);
    const built = await buildDeck({ subject, topic, slideCount, grade, tone, focus, objectives: '', lessonPlanText: groundedPlanText, sourceMaterialText: materialText, sourceImages: materialImages, teachingModelId, skipAssemble: true, presetId: presetId || null });
    const id = crypto.randomUUID();
    decks.set(id, {
      ownerId: req.userId,
      subject: String(subject).toLowerCase(), topic: String(topic).toLowerCase(),
      grade: grade || 'middle school', tone, focus, band: built.band,
      slides: built.slides, images: built.images, createdAt: Date.now(), touchedAt: Date.now(),
      objectives: '', lessonPlanText: groundedPlanText, sourceMaterialText: materialText, sourceMaterialImages: materialImages, teachingModelId, presetId: presetId || null,
    });
    await capture(req, reservation, 'lessonscope.import_plan_to_slides', id);
    const filename = `${subject}-${topic}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');
    res.json({
      deckId: id, filename, band: built.band, slideCount: built.slides.length, teachingModelId, sourceText: groundedPlanText,
      slides: built.slides.map((s, i) => previewEntry(s, built.images[i])),
    });
  } catch (err) {
    await release(req, reservation, 'lessonscope.import_plan_to_slides', err.message);
    console.error('Import lesson plan failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Path B — "I have slides": upload a .pptx. We parse it into a real deck the
// teacher can see and edit on the system, and keep the slide text so the
// lesson pack (worksheet/quiz/exit ticket) and games are grounded in exactly
// what they uploaded. They can then optionally generate a lesson plan from it,
// or go straight to the pack. No AI visuals are fetched (fast + no library
// pollution); the teacher swaps in images per-slide if they want.
app.post('/api/import/slides', requireAuth, upload.single('file'), requireUploads('slides'), async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  if (!req.file) return res.status(400).json({ error: 'Please choose your slides (.pptx) file.' });
  const ext = (req.file.originalname || '').toLowerCase();
  if (!ext.endsWith('.pptx')) return res.status(400).json({ error: 'Please upload PowerPoint slides (.pptx).' });
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  if (!subject || !topic) return res.status(400).json({ error: 'Enter the subject and topic for these slides.' });
  try {
    const parsed = await extractPptxSlides(req.file.buffer);
    if (!parsed.length) return res.status(400).json({ error: "Couldn't read any slides from that file." });
    // Map the parsed slides into the deck shape the UI + downloader expect.
    const slides = parsed.map((p, i) => ({
      type: i === 0 ? 'title' : (i === parsed.length - 1 ? 'recap' : 'content'),
      title: p.title,
      subtitle: i === 0 ? (p.bullets[0] || null) : null,
      bullets: i === 0 ? [] : p.bullets.slice(0, 6),
      example: null,
      imageQuery: `${topic} ${p.title}`.slice(0, 80),
    }));
    const images = slides.map(() => null); // no image fetched on import
    const sourceText = parsed.map(p => [p.title, ...p.bullets].join('\n')).join('\n\n').slice(0, LIMITS.source);
    // Keep the wording found in the teacher's own slides for every resource
    // generated later from this restored lesson.
    const liftedObjectives = objectivesFromDeck({ slides });
    const liftedCriteria = criteriaFromDeck({ slides }).split('\n').filter(Boolean);
    const id = crypto.randomUUID();
    decks.set(id, {
      ownerId: req.userId,
      subject: String(subject).toLowerCase(), topic: String(topic).toLowerCase(),
      grade: req.body.grade || 'middle school', tone: req.body.tone || 'clear and engaging',
      focus: '', band: null, slides, images, createdAt: Date.now(),
      touchedAt: Date.now(),
      objectives: liftedObjectives, lessonPlanText: sourceText, imported: true, presetId: null,
    });
    const filename = `${subject}-${topic}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');
    res.json({
      deckId: id, filename, band: null, slideCount: slides.length, sourceText,
      objectives: liftedObjectives, successCriteria: liftedCriteria,
      slides: slides.map((s, i) => previewEntry(s, images[i])),
    });
  } catch (err) {
    console.error('Import slides failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Lesson pack (worksheet, exit ticket, quiz) from the approved plan ───────
const PACK_GEN    = { notes: generateStudyNotes, worksheet: generateWorksheet, 'exit-ticket': generateExitTicket, quiz: generateQuiz, homework: generateHomework, activities: generateActivities };
// Only question-based items become student-submittable online assignments;
// homework and differentiated sheets are print-only (no question shape).
const PACK_SUBMITTABLE = new Set(['worksheet', 'exit-ticket', 'quiz']);
const PACK_RENDER = { notes: studyNotesDocx, worksheet: worksheetDocx, 'exit-ticket': exitTicketDocx, quiz: quizDocx, homework: homeworkDocx, activities: activitiesDocx };

// Full lesson pack: all three artifacts in parallel → zip download.
// Registered BEFORE '/api/pack/:type' — Express matches routes in
// registration order, and ':type' would otherwise swallow this literal
// path (req.params.type === 'full', which isn't a PACK_GEN key) before
// this handler is ever reached.
app.post('/api/pack/full', requireAuth, async (req, res) => {
  const { grade, tone, lessonPlan, unitId, lessonIndex } = req.body || {};
  const teachingModelId = normalizeTeachingModelId(req.body && req.body.teachingModelId);
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  const objectives = clip(req.body.objectives, LIMITS.objectives);
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  const { reservation, block } = await reserve(req, 'lessonscope.generate_lesson_pack');
  if (block) return res.status(402).json(block);
  try {
    const u = unitId ? unit.getUnit(req.userId, unitId) : null;
    const unitBlock = u ? unit.buildUnitBlock(u, lessonIndex) : '';
    const lessonPlanText = resolvePlanText(req.body);
    const ctx = { subject: subject.toLowerCase(), topic: topic.toLowerCase(), grade, tone, objectives, lessonPlanText, unitBlock, teachingModelId };
    const meta = { subject, topic, grade };

    const [nData, wData, etData, qData, hwData, acData] = await Promise.all([
      generateStudyNotes(ctx), generateWorksheet(ctx), generateExitTicket(ctx), generateQuiz(ctx), generateHomework(ctx), generateActivities(ctx),
    ]);
    const [nBuf, wBuf, etBuf, qBuf, hwBuf, acBuf] = await Promise.all([
      studyNotesDocx(nData, meta), worksheetDocx(wData, meta), exitTicketDocx(etData, meta), quizDocx(qData, meta), homeworkDocx(hwData, meta), activitiesDocx(acData, meta),
    ]);

    const base = String(topic).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'lesson';
    const zipBuf = lessonPackZip(base, {
      studyNotes: nBuf, worksheet: wBuf, exitTicket: etBuf, quiz: qBuf, homework: hwBuf, activities: acBuf,
    });

    await capture(req, reservation, 'lessonscope.generate_lesson_pack', base);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-lesson-pack.zip"`);
    res.send(zipBuf);
  } catch (err) {
    await release(req, reservation, 'lessonscope.generate_lesson_pack', err.message);
    console.error('Full pack failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/pack/:type', requireAuth, async (req, res) => {
  const gen = PACK_GEN[req.params.type];
  if (!gen) return res.status(404).json({ error: 'Unknown lesson-pack item.' });
  const { grade, tone, lessonPlan, unitId, lessonIndex, regenerate } = req.body || {};
  const teachingModelId = normalizeTeachingModelId(req.body && req.body.teachingModelId);
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  const objectives = clip(req.body.objectives, LIMITS.objectives);
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  const { reservation, block } = await reserve(req, 'lessonscope.generate_pack_item');
  if (block) return res.status(402).json(block);
  try {
    const u = unitId ? unit.getUnit(req.userId, unitId) : null;
    const unitBlock = u ? unit.buildUnitBlock(u, lessonIndex) : '';
    const lessonPlanText = resolvePlanText(req.body);
    const data = await gen({ subject: subject.toLowerCase(), topic: topic.toLowerCase(), grade, tone, objectives, lessonPlanText, unitBlock, teachingModelId, regenerate: !!regenerate });
    await capture(req, reservation, 'lessonscope.generate_pack_item', req.params.type);
    res.json({ type: req.params.type, data });
  } catch (err) {
    await release(req, reservation, 'lessonscope.generate_pack_item', err.message);
    console.error('Pack generation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/pack/:type/download', requireAuth, async (req, res) => {
  const render = PACK_RENDER[req.params.type];
  if (!render) return res.status(404).json({ error: 'Unknown lesson-pack item.' });
  const { data, subject, topic, grade } = req.body || {};
  if (!data) return res.status(400).json({ error: 'Nothing to download.' });
  try {
    const buffer = await render(data, { subject, topic, grade });
    const base = String(topic || req.params.type).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'lesson';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-${req.params.type}.docx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Pack download failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Online assignments (worksheet/exit-ticket/quiz, student-submittable) ────
// Publishes already-generated pack data (from /api/pack/:type) as a live,
// joinable assignment — same room-code/roster/cutoff pattern as games.
app.post('/api/pack/:type/publish', requireAuth, (req, res) => {
  if (!PACK_GEN[req.params.type]) return res.status(404).json({ error: 'Unknown lesson-pack item.' });
  if (!PACK_SUBMITTABLE.has(req.params.type)) return res.status(400).json({ error: 'This item is print-only — download it as a Word document instead.' });
  const { data, subject, topic, grade, rosterId, cutoffAt } = req.body || {};
  if (!data) return res.status(400).json({ error: 'Nothing to publish — generate the pack first.' });
  try {
    const rec = assignments.createAssignment({
      teacherId: req.userId, teacherName: req.user.name, type: req.params.type,
      subject, topic, grade, data, rosterId: rosterId || null, cutoffAt: cutoffAt || null,
    });
    res.json({ assignmentId: rec.id, path: `/assignment/${rec.id}`, roomCode: rec.roomCode, questionCount: rec.content.questions.length });
  } catch (err) {
    console.error('Publish assignment failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/assignments', requireAuth, (req, res) => res.json({ assignments: assignments.listTeacherAssignments(req.userId) }));

// Teacher: update the cutoff date for an assignment they own.
app.patch('/api/assignment/:id/cutoff', requireAuth, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  if (a.teacherId !== req.userId) return res.status(403).json({ error: 'Not your assignment.' });
  const updated = assignments.updateAssignmentCutoff(req.params.id, (req.body && req.body.cutoffAt) || null);
  res.json({ ok: true, cutoffAt: updated.cutoffAt });
});

// Public: resolve a Room Code to EITHER a game or an assignment (shared join flow).
app.get('/api/join', (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Enter a Room Code.' });
  const gameId = games.getRoomCode(code);
  if (gameId) return res.json({ type: 'game', id: gameId });
  const assignmentId = assignments.getRoomCode(code);
  if (assignmentId) return res.json({ type: 'assignment', id: assignmentId });
  res.status(404).json({ error: 'Room not found. Check the code and try again.' });
});

// Public, no-login "my work": a student types their Student ID once and sees
// every game/assignment they've submitted, across every roster that ID
// appears in — same accepted trust model as joining a single game/assignment
// (Student ID is the credential throughout this app), just aggregated.
// Only rostered games/assignments are included — a free-form typed name on a
// no-roster activity can't be reliably tied back to this ID.
// Pure data gather, no auth/response concerns — shared by the legacy
// query-string endpoint and the session-based /api/student/my-work so
// they can never drift out of sync.
function gatherWork(studentId, includeFreeform) {
  studentId = roster.normalizeStudentId(studentId);
  const matches = roster.findStudentAcrossAllTeachers(studentId);
  const work = [];
  let name = null;

  for (const m of matches) {
    const teacher = getUserById(m.teacherId) || {};
    name = name || m.name;
    for (const g of games.listTeacherGames(m.teacherId)) {
      if (g.rosterId !== m.rosterId) continue;
      const mine = games.getResults(g.id).find(r => roster.normalizeStudentId(r.studentId) === studentId);
      if (mine) work.push({ kind: 'game', id: g.id, title: g.lessonTitle, subject: g.subject, topic: g.topic, teacherName: teacher.name || '', score: mine.score, total: mine.total, at: mine.at, path: '/play/' + g.id, verified: true });
    }
    for (const a of assignments.listTeacherAssignments(m.teacherId)) {
      if (a.rosterId !== m.rosterId) continue;
      const sub = assignments.getSubmission(a.id, studentId);
      if (sub) {
        const rec = assignments.getAssignment(a.id);
        const released = assignments.isReleased(rec);
        work.push({ kind: 'assignment', id: a.id, title: a.title, subject: a.subject, topic: a.topic, type: a.type, teacherName: teacher.name || '', released, totalMarks: released ? sub.totalMarks : null, maxMarks: sub.maxMarks, at: sub.submittedAt, path: '/assignment/' + a.id, verified: true });
      }
    }
  }

  // Opt-in only — a no-roster activity stores whatever raw text the student
  // typed as their "name", with no verification at all. Matching on that
  // text can collide across different real students (two "John"s), so these
  // results are flagged verified:false and only searched when explicitly
  // asked for. Scans every teacher's every no-roster activity — unindexed,
  // matches this app's small-scale file model.
  if (includeFreeform) {
    const norm = s => String(s || '').trim().toLowerCase();
    const target = norm(studentId);
    const seen = new Set(work.map(w => w.kind + ':' + w.id));
    for (const teacherId of listAllUserIds()) {
      const teacher = getUserById(teacherId) || {};
      for (const g of games.listTeacherGames(teacherId)) {
        if (g.rosterId || seen.has('game:' + g.id)) continue;
        const mine = games.getResults(g.id).find(r => norm(r.studentId) === target || norm(r.name) === target);
        if (mine) { work.push({ kind: 'game', id: g.id, title: g.lessonTitle, subject: g.subject, topic: g.topic, teacherName: teacher.name || '', score: mine.score, total: mine.total, at: mine.at, path: '/play/' + g.id, verified: false }); seen.add('game:' + g.id); }
      }
      for (const a of assignments.listTeacherAssignments(teacherId)) {
        if (a.rosterId || seen.has('assignment:' + a.id)) continue;
        const mine = assignments.getSubmissions(a.id).find(s => norm(s.studentId) === target || norm(s.name) === target);
        if (mine) {
          const released = assignments.isReleased(assignments.getAssignment(a.id));
          work.push({ kind: 'assignment', id: a.id, title: a.title, subject: a.subject, topic: a.topic, type: a.type, teacherName: teacher.name || '', released, totalMarks: released ? mine.totalMarks : null, maxMarks: mine.maxMarks, at: mine.submittedAt, path: '/assignment/' + a.id, verified: false });
          seen.add('assignment:' + a.id);
        }
      }
    }
  }

  work.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
  return { name, work };
}

app.get('/api/my-work', (req, res) => {
  const studentId = roster.normalizeStudentId(req.query.studentId);
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  const pin = req.query.pin ? String(req.query.pin).trim() : '';
  const includeFreeform = req.query.includeFreeform === '1' || req.query.includeFreeform === 'true';

  const matches = roster.findStudentAcrossAllTeachers(studentId);
  // PIN is a single global account per Student ID (student-account.js) —
  // one check covers every roster this ID appears in. 'unset' stays open
  // (same as before this feature existed — protection only starts once the
  // student actually sets a PIN via /enter or /api/student/login).
  const pinState = studentAccount.getAccountState(studentId);
  if (pinState === 'set') {
    if (!pin) return res.status(428).json({ needsPin: true, name: matches[0] && matches[0].name, error: 'Enter your PIN to continue.' });
    if (!studentAccount.verifyPin(studentId, pin)) return res.status(403).json({ error: 'Incorrect PIN.' });
  }

  const { name, work } = gatherWork(studentId, includeFreeform);
  if (!work.length) return res.status(404).json({ error: 'Student ID not found. Check with your teacher.' });
  res.json({ name: name || studentId, work });
});

// ── Unified student entry point (one link: Student ID -> PIN setup/verify
// -> browse "my work" + join by Room Code, no re-entering credentials) ─────

// Single endpoint for both first-time setup and returning verification —
// same pattern as /api/assignment/:id/enter, just not scoped to one activity.
app.post('/api/student/login', (req, res) => {
  const studentId = roster.normalizeStudentId(req.body && req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  const pin = req.body && req.body.pin ? String(req.body.pin).trim() : '';

  const matches = roster.findStudentAcrossAllTeachers(studentId);
  if (!matches.length) return res.status(404).json({ error: 'Student ID not found. Check with your teacher.' });
  const displayName = matches[0].name;

  const pinState = studentAccount.getAccountState(studentId);
  if (pinState === 'unset') {
    if (!pin) return res.status(428).json({ needsPinSetup: true, name: displayName, error: 'Set up a 4-digit PIN to continue.' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
    if (!studentAccount.setPin(studentId, pin)) return res.status(409).json({ error: 'A PIN was just set for this ID — enter it instead.' });
  } else {
    if (!pin) return res.status(428).json({ needsPin: true, name: displayName, error: 'Enter your PIN to continue.' });
    if (!studentAccount.verifyPin(studentId, pin)) return res.status(403).json({ error: 'Incorrect PIN.' });
  }

  res.cookie(STUDENT_COOKIE, issueStudentToken(studentId, displayName), cookieOptions(30 * 24 * 60 * 60 * 1000));
  res.json({ name: displayName });
});

app.post('/api/student/pin/reset-request', (req, res) => {
  const studentId = roster.normalizeStudentId(req.body && req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  const ok = studentAccount.requestPinReset(studentId);
  if (!ok) return res.status(404).json({ error: 'No account found for this ID yet.' });
  res.json({ ok: true });
});

// Already-logged-in check — lets /start skip straight to the dashboard on repeat visits.
app.get('/api/student/me', requireStudentAccess, (req, res) => res.json({ studentId: req.studentSession.studentId, name: req.studentSession.name }));

app.post('/api/student/logout', (req, res) => { res.clearCookie(STUDENT_COOKIE); res.json({ ok: true }); });

// Same data as /api/my-work, but identity comes from the verified session —
// no PIN passed in a URL query string.
app.get('/api/student/my-work', requireStudentAccess, (req, res) => {
  const includeFreeform = req.query.includeFreeform === '1' || req.query.includeFreeform === 'true';
  const { work } = gatherWork(req.studentSession.studentId, includeFreeform);
  res.json({ name: req.studentSession.name, work });
});

// Join a game/assignment by Room Code using the already-verified identity —
// no re-entering Student ID/PIN. Issues the same scoped lc_game session the
// old per-activity /enter flow does, so the target page just works.
app.post('/api/student/join-room', requireStudentAccess, (req, res) => {
  const code = String(req.body && req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Enter a Room Code.' });
  const { studentId, name } = req.studentSession || {};
  if (!studentId) return res.status(401).json({ error: 'Not signed in.' });

  const gameId = games.getRoomCode(code);
  const assignmentId = !gameId && assignments.getRoomCode(code);
  if (!gameId && !assignmentId) return res.status(404).json({ error: 'Room not found. Check the code and try again.' });

  if (gameId) {
    const g = games.getGame(gameId);
    let displayName = name;
    if (g.rosterId) {
      const s = roster.findStudentInRoster(g.teacherId, g.rosterId, studentId);
      if (!s) return res.status(403).json({ error: "You're not on the roster for this game." });
      displayName = s.name;
    }
    const token = issueGameToken({ gameId, studentId, name: displayName });
    res.cookie(GAME_COOKIE, token, cookieOptions(30 * 24 * 60 * 60 * 1000));
    return res.json({ type: 'game', id: gameId, path: '/play/' + gameId });
  }
  const a = assignments.getAssignment(assignmentId);
  let displayName = name;
  if (a.rosterId) {
    const s = roster.findStudentInRoster(a.teacherId, a.rosterId, studentId);
    if (!s) return res.status(403).json({ error: "You're not on the roster for this assignment." });
    displayName = s.name;
  }
  const token = issueGameToken({ assignmentId, studentId, name: displayName }, 'assignment');
  res.cookie(GAME_COOKIE, token, cookieOptions(30 * 24 * 60 * 60 * 1000));
  res.json({ type: 'assignment', id: assignmentId, path: '/assignment/' + assignmentId });
});

// LessonScope Practice is an isolated, feature-flagged student experience.
// It reuses the verified roster Student ID/PIN session but keeps its evidence
// model separate from knowledge games and graded assignments.
app.get('/api/practice/status', (req, res) => {
  res.json({
    enabled: practice.enabled(),
    studentPath: '/student/practice',
    guestPath: '/student/practice/guest',
    teacherPath: '/practice',
  });
});

app.get('/api/practice/catalog', requirePracticeEnabled, (req, res) => {
  res.json({ activities: practice.listActivities() });
});

app.get('/api/practice/live-sessions', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  res.json({ rooms: practiceLive.teacherRooms(req.userId) });
});

app.post('/api/practice/live-sessions', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  try {
    const rosterId = String(req.body && req.body.rosterId || '').trim();
    const classRoster = rosterId ? roster.getRoster(req.userId, rosterId) : null;
    if (rosterId && !classRoster) return res.status(404).json({ error: 'That saved class could not be found.', code: 'roster_not_found' });
    const room = practiceLive.createRoom({
      teacherId: req.userId,
      activityId: req.body && req.body.activityId,
      mode: req.body && req.body.mode || 'classwork',
      roster: classRoster,
      audioPolicy: req.body && req.body.audioPolicy,
      durationMinutes: req.body && req.body.durationMinutes,
      availabilityDays: req.body && req.body.availabilityDays,
    });
    const activityId = room.activity && room.activity.id;
    const world = activityId === 'typing-academy' ? '&world=typing' : activityId === 'g3-keyboard-kingdom' ? '&world=g3' : '';
    res.status(201).json({ room, joinPath: `/student/practice/guest?session=${room.code}${world}` });
  } catch (err) {
    res.status(err.code === 'activity_not_found' ? 404 : 400).json({ error: err.message, code: err.code || 'room_create_failed' });
  }
});

app.post('/api/practice/live-sessions/:code/start', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  try {
    res.json({ room: practiceLive.startRoom(req.params.code, req.userId) });
  } catch (err) {
    const status = err.code === 'forbidden' ? 403
      : err.code === 'room_not_found' ? 404
        : err.code === 'room_closed' ? 410
          : 400;
    res.status(status).json({ error: err.message, code: err.code || 'room_start_failed' });
  }
});

app.patch('/api/practice/live-sessions/:code/pause', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  try {
    res.json({ room: practiceLive.setRoomPaused(req.params.code, req.userId, req.body && req.body.paused !== false) });
  } catch (err) {
    const status = err.code === 'forbidden' ? 403
      : err.code === 'room_not_found' ? 404
        : err.code === 'room_closed' ? 410
          : 400;
    res.status(status).json({ error: err.message, code: err.code || 'room_pause_failed' });
  }
});

app.patch('/api/practice/live-sessions/:code/audio', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  try {
    res.json({ room: practiceLive.updateRoomAudio(req.params.code, req.userId, req.body || {}) });
  } catch (err) {
    const status = err.code === 'forbidden' ? 403
      : err.code === 'room_not_found' ? 404
        : err.code === 'room_closed' ? 410
          : 400;
    res.status(status).json({ error: err.message, code: err.code || 'room_audio_failed' });
  }
});

app.delete('/api/practice/live-sessions/:code', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  try {
    res.json({ room: practiceLive.closeRoom(req.params.code, req.userId) });
  } catch (err) {
    const status = err.code === 'forbidden' ? 403 : err.code === 'room_not_found' ? 404 : 400;
    res.status(status).json({ error: err.message, code: err.code || 'room_close_failed' });
  }
});

app.get('/api/practice/live-sessions/:code', requirePracticeEnabled, (req, res) => {
  try {
    const token = req.get('X-Practice-Participant') || '';
    res.json(practiceLive.getRoomForParticipant(req.params.code, token));
  } catch (err) {
    const status = err.code === 'room_not_found' ? 404 : err.code === 'room_closed' ? 410 : 400;
    res.status(status).json({ error: err.message, code: err.code || 'room_unavailable' });
  }
});

app.post('/api/practice/live-sessions/:code/join', requirePracticeEnabled, (req, res) => {
  try {
    res.status(201).json(practiceLive.joinRoom(req.params.code, req.body || {}));
  } catch (err) {
    const status = err.code === 'room_not_found' ? 404 : err.code === 'room_closed' ? 410 : 400;
    res.status(status).json({ error: err.message, code: err.code || 'room_join_failed' });
  }
});

app.post('/api/practice/live-sessions/:code/checkpoints', requirePracticeEnabled, (req, res) => {
  try {
    const token = req.get('X-Practice-Participant') || '';
    res.json(practiceLive.checkpointRoom(req.params.code, token, req.body || {}));
  } catch (err) {
    const status = err.code === 'participant_not_found' ? 401
      : err.code === 'room_not_found' ? 404
        : err.code === 'room_closed' ? 410
          : err.code === 'step_out_of_order' || err.code === 'attempt_complete' || err.code === 'room_not_started' ? 409
            : 400;
    res.status(status).json({ error: err.message, code: err.code || 'invalid_checkpoint' });
  }
});

app.get('/api/practice/preview', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  res.json({
    preview: true,
    teacher: {
      id: req.userId,
      name: req.user.name || req.user.displayName || req.user.email || 'Teacher',
    },
    activities: practice.listActivities(),
  });
});

app.get('/api/practice/student/home', requirePracticeEnabled, requireStudentAccess, (req, res) => {
  res.json({
    student: { studentId: req.studentSession.studentId, name: req.studentSession.name },
    activities: practice.listActivities(),
    attempts: practice.studentSummary(req.studentSession.studentId),
  });
});

app.post('/api/practice/attempts', requirePracticeEnabled, requireStudentAccess, (req, res) => {
  try {
    const result = practice.createAttempt({
      studentId: req.studentSession.studentId,
      studentName: req.studentSession.name,
      activityId: req.body && req.body.activityId,
    });
    res.status(result.resumed ? 200 : 201).json(result);
  } catch (err) {
    res.status(err.code === 'activity_not_found' ? 404 : 400).json({ error: err.message });
  }
});

app.post('/api/practice/attempts/:id/checkpoints', requirePracticeEnabled, requireStudentAccess, (req, res) => {
  try {
    const result = practice.checkpointAttempt(req.params.id, req.studentSession.studentId, req.body || {});
    res.json(result);
  } catch (err) {
    const status = err.code === 'forbidden' ? 403
      : err.code === 'attempt_not_found' ? 404
        : err.code === 'step_out_of_order' || err.code === 'attempt_complete' ? 409
          : 400;
    res.status(status).json({ error: err.message, code: err.code || 'invalid_checkpoint' });
  }
});

app.get('/api/practice/results', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  const rosterRecords = roster.listRosters(req.userId)
    .map((summary) => roster.getRoster(req.userId, summary.id))
    .filter(Boolean);
  const students = new Map();
  for (const classRoster of rosterRecords) {
    for (const student of classRoster.students || []) {
      const id = roster.normalizeStudentId(student.id);
      if (!students.has(id)) students.set(id, { id, name: student.name, rosters: [] });
      students.get(id).rosters.push({ id: classRoster.id, name: classRoster.name });
    }
  }
  const results = practice.teacherResults([...students.keys()]).map((result) => ({
    ...result,
    studentName: (students.get(result.studentId) || {}).name || result.studentName,
    rosters: (students.get(result.studentId) || {}).rosters || [],
  }));
  res.json({ activities: practice.listActivities(), students: [...students.values()], results });
});

// Student: enter an assignment with their Student ID — issues a short-lived session.
// A PIN protects one identity. Which identity depends on where the name came
// from, and the difference matters:
//
//   ROSTER — the key is the school's own student ID, which is unique to a
//   child across every class they are in, so one PIN follows them everywhere.
//
//   OPEN LINK — the key is a name someone typed, and names are not unique.
//   Keyed globally, the first "Ama Okafor" anywhere would own that name for
//   every teacher on the platform, and a child in another school could not
//   join under their own name. So an open game's claims are scoped to that
//   game and expire with it.
function pinKeyFor(activityId, studentId, hasRoster) {
  return hasRoster ? studentId : `open:${activityId}:${studentId}`;
}

// Names shown on a join screen belong to children, and a game link is
// shareable by definition. First name and last initial is enough for a child
// to find themselves in their own class and not enough to be a class list.
// A handle standing in for a student ID on a public page.
//
// The join screen has to name the children so a child can find themselves,
// but it must not publish the school's own identifiers — those are often
// admission numbers, and the endpoint is reachable by anyone holding the game
// link. So the list carries a handle that means nothing outside this activity,
// and the server turns it back into the real ID on entry.
//
// Derived rather than stored: an HMAC of the activity and the student ID under
// the session secret, so it is stable for one activity, different for every
// other, and not reversible by whoever is holding the link.
function studentHandle(activityId, studentId) {
  return crypto.createHmac('sha256', sessionSecret())
    .update(`${activityId}:${roster.normalizeStudentId(studentId)}`)
    .digest('hex').slice(0, 16);
}

// Resolve a handle from the join screen back to the student it stands for.
// Returns null for anything that is not a handle for a child in THIS class,
// so a guessed or copied handle from another game resolves to nobody.
function studentFromHandle(teacherId, rosterId, activityId, handle) {
  const r = roster.getRoster(teacherId, rosterId);
  if (!r || !Array.isArray(r.students)) return null;
  const wanted = String(handle || '');
  if (!wanted) return null;
  return r.students.find((student) => studentHandle(activityId, student.id) === wanted) || null;
}

function classListFor(teacherId, rosterId, activityId) {
  const r = roster.getRoster(teacherId, rosterId);
  if (!r || !Array.isArray(r.students)) return [];
  return r.students.map((student) => {
    const parts = String(student.name || '').trim().split(/\s+/).filter(Boolean);
    // Falling back to the ID here would put it on the page after all.
    const first = parts[0] || 'Student';
    const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : '';
    return { handle: studentHandle(activityId, student.id), label: `${first}${initial}` };
  });
}

// What the join screen needs, and nothing else.
//
// The full meta routes sit behind a session, which a student does not have
// until they have joined — so the join screen could not find out whether a
// class list existed and guessed "Student ID" for everyone. This carries the
// class list and nothing that could be used to answer the questions.
//
// Deliberately public: the join screen is the one page that must work before
// any session exists. Names are first-name-and-initial for that reason, and
// no answers, questions or marks are included.
app.get('/api/assignment/:id/join', (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  res.json({
    title: a.title, teacherName: a.teacherName || null,
    hasRoster: !!a.rosterId,
    students: a.rosterId ? classListFor(a.teacherId, a.rosterId, a.id) : [],
  });
});

app.get('/api/game/:id/join', (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  res.json({
    lessonTitle: g.lessonTitle, teacherName: g.teacherName || null,
    hasRoster: !!g.rosterId,
    students: g.rosterId ? classListFor(g.teacherId, g.rosterId, g.id) : [],
  });
});

app.post('/api/assignment/:id/enter', async (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  // The join screen sends a handle, not the school's own ID — see studentHandle.
  // A typed entry (no roster, or a child not on the list) still arrives as text.
  const fromList = a.rosterId
    ? studentFromHandle(a.teacherId, a.rosterId, a.id, req.body && req.body.handle)
    : null;
  const studentId = fromList
    ? roster.normalizeStudentId(fromList.id)
    : roster.normalizeStudentId(req.body && req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  const pin = req.body && req.body.pin ? String(req.body.pin).trim() : '';
  let displayName = roster.displayNameFrom(req.body && req.body.name, studentId);
  if (a.rosterId) {
    const s = roster.findStudentInRoster(a.teacherId, a.rosterId, studentId);
    if (!s) return res.status(403).json({ error: 'Student ID not found. Check with your teacher.' });
    displayName = s.name;
    const pinState = studentAccount.getAccountState(studentId);
    if (pinState === 'unset') {
      if (!pin) return res.status(428).json({ needsPinSetup: true, name: displayName, error: 'Set up a 4-digit PIN to continue.' });
      if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
      if (!studentAccount.setPin(studentId, pin)) return res.status(409).json({ error: 'A PIN was just set for this ID — enter it instead.' });
    } else {
      if (!pin) return res.status(428).json({ needsPin: true, name: displayName, error: 'Enter your PIN to continue.' });
      if (!studentAccount.verifyPin(studentId, pin)) return res.status(403).json({ error: 'Incorrect PIN.' });
    }
  } else {
    // No roster: the name is a claim, so the first person to use it in this
    // game sets its PIN and anyone using it afterwards has to know it. It stops
    // a classmate typing your name; it cannot stop one who watched you type.
    const key = pinKeyFor(a.id, studentId, false);
    const pinState = studentAccount.getAccountState(key);
    if (pinState === 'unset') {
      if (!pin) return res.status(428).json({ needsPinSetup: true, name: displayName, error: 'Choose a 4-digit PIN. You will need it to come back.' });
      if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
      if (!studentAccount.setPin(key, pin)) return res.status(409).json({ error: 'That name was just taken — pick another, or ask your teacher.' });
    } else {
      if (!pin) return res.status(428).json({ needsPin: true, name: displayName, error: 'Enter your PIN to continue.' });
      if (!studentAccount.verifyPin(key, pin)) return res.status(403).json({ error: 'Incorrect PIN. Ask your teacher if you have forgotten it.' });
    }
  }
  const token = issueGameToken({ assignmentId: a.id, studentId, name: displayName }, 'assignment');
  res.cookie(GAME_COOKIE, token, cookieOptions(30 * 24 * 60 * 60 * 1000));
  res.cookie(STUDENT_COOKIE, issueStudentToken(studentId, displayName), cookieOptions(30 * 24 * 60 * 60 * 1000));
  res.json({ name: displayName });
});

// Student: forgot their PIN — flags it for the teacher; does NOT unlock
// anything by itself (see roster.js's requestPinReset).
app.post('/api/assignment/:id/pin/reset-request', (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a || !a.rosterId) return res.status(404).json({ error: 'Assignment not found.' });
  const studentId = roster.normalizeStudentId(req.body && req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  const ok = studentAccount.requestPinReset(studentId);
  if (!ok) return res.status(404).json({ error: 'No account found for this ID yet.' });
  res.json({ ok: true });
});

// Student: assignment meta (no answer keys).
app.get('/api/assignment/:id', requireAssignmentAccess, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  const session = assignmentStudentSession(req, res, a);
  if (req.gameSession && req.gameSession.assignmentId && !session) return res.status(401).json({ code:'ASSIGNMENT_REJOIN_REQUIRED', error: 'Join this assignment to continue. Your other assignment is still saved.' });
  res.json({ id: a.id, type: a.type, title: a.title, subject: a.subject, topic: a.topic, grade: a.grade, teacherName: a.teacherName, hasRoster: !!a.rosterId, students: a.rosterId ? classListFor(a.teacherId, a.rosterId, a.id) : [], instructions: a.content.instructions, questionCount: a.content.questions.length });
});

// Student: the questions, WITHOUT answer keys/correctIndex.
app.get('/api/assignment/:id/take', requireAssignmentAccess, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  const session = assignmentStudentSession(req, res, a);
  if (req.gameSession && req.gameSession.assignmentId && !session) return res.status(401).json({ code:'ASSIGNMENT_REJOIN_REQUIRED', error: 'Join this assignment to continue. Your other assignment is still saved.' });
  const already = session && assignments.getSubmission(a.id, session.studentId);
  res.json({
    title: a.title, instructions: a.content.instructions,
    questions: a.content.questions.map(q => ({ id: q.id, question: q.question, kind: q.kind, options: q.options || null, marks: q.marks })),
    alreadySubmitted: !!already,
  });
});

// Student: submit answers — MCQ grades instantly; free-text checks the
// teacher-confirmed verdict cache first, only calling AI on a genuine miss.
app.post('/api/assignment/:id/submit', requireAssignmentAccess, async (req, res) => {
  declareFree('lessonscope.auto_grade');
  // requireAssignmentAccess also accepts a teacher's own login as a fallback for
  // read-only routes, WITHOUT setting req.gameSession — submitting needs a
  // real student session, so reject explicitly instead of crashing below.
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  const session = assignmentStudentSession(req, res, a);
  if (!session) return res.status(401).json({ error: 'Your session could not be confirmed — rejoin using the Room Code or link, then try again.' });
  if (session.assignmentId !== a.id) return res.status(403).json({ error: 'Session is for a different assignment.' });
  const answers = (req.body && req.body.answers) || {};
  const studentId = session.studentId;
  const name = session.name || studentId;

  const grades = {};
  let totalMarks = 0, maxMarks = 0;
  try {
    for (const q of a.content.questions) {
      maxMarks += q.marks;
      const given = answers[q.id];
      if (q.kind === 'mcq') {
        const correct = Number.isInteger(given) && given === q.correctIndex;
        grades[q.id] = { marksAwarded: correct ? q.marks : 0, verdict: correct ? 'correct' : 'incorrect', rationale: correct ? 'Correct option selected.' : 'Not the correct option.', source: 'auto' };
      } else {
        const cached = assignments.findConfirmedVerdict(a.id, q.id, given);
        if (cached) {
          grades[q.id] = { marksAwarded: cached.marksAwarded, verdict: cached.verdict, rationale: cached.rationale, source: 'ai-confirmed' };
        } else {
          const verdict = await gradeAnswer({ question: q.question, answerKey: q.answerKey, studentAnswer: given, maxMarks: q.marks, grade: a.grade });
          assignments.recordVerdict(a.id, q.id, { answerText: given, ...verdict, confirmed: false, source: 'ai' });
          grades[q.id] = { ...verdict, source: 'ai' };
        }
      }
      totalMarks += grades[q.id].marksAwarded;
    }
  } catch (err) {
    console.error('Grading failed:', err.message);
    return res.status(400).json({ error: 'Grading failed: ' + err.message });
  }

  assignments.saveSubmission(a.id, { studentId, name, answers, grades, totalMarks, maxMarks, submittedAt: new Date().toISOString() });
  // Grading always runs (the teacher needs it ready to review), but the
  // student only sees marks/verdicts once released or the due date has
  // passed — their own answers are always visible, just not the scoring yet.
  const released = assignments.isReleased(a);
  res.json(released ? { released, totalMarks, maxMarks, grades } : { released, totalMarks: null, maxMarks, grades: null });
});

// Teacher: release (or un-release) results to students for this assignment.
app.patch('/api/assignment/:id/release', requireAuth, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  if (a.teacherId !== req.userId) return res.status(403).json({ error: 'Not your assignment.' });
  const released = !!(req.body && req.body.released);
  const updated = assignments.releaseResults(req.params.id, released);
  res.json({ ok: true, resultsReleased: updated.resultsReleased });
});

// Student: their own past submission — answers always visible, marks/
// verdicts only once released or overdue. This is what a student hits when
// they return to an assignment they've already submitted.
app.get('/api/assignment/:id/my-results', requireAssignmentAccess, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  const session = assignmentStudentSession(req, res, a);
  if (!session) return res.status(401).json({ error: 'Your session could not be confirmed — rejoin using the Room Code or link.' });
  if (session.assignmentId !== a.id) return res.status(403).json({ error: 'Session is for a different assignment.' });
  const sub = assignments.getSubmission(a.id, session.studentId);
  if (!sub) return res.status(404).json({ error: 'No submission found.' });
  const released = assignments.isReleased(a);
  res.json({
    title: a.title,
    questions: a.content.questions.map(q => ({ id: q.id, question: q.question, kind: q.kind, options: q.options || null, marks: q.marks })),
    answers: sub.answers,
    submittedAt: sub.submittedAt,
    released,
    totalMarks: released ? sub.totalMarks : null,
    maxMarks: sub.maxMarks,
    grades: released ? sub.grades : null,
  });
});

// Teacher: results for one of their assignments (owner only) — per student,
// per question: their answer, the grade, the AI's rationale, and whether that
// grading has been teacher-confirmed yet.
app.get('/api/assignment/:id/results', requireAuth, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  if (a.teacherId !== req.userId) return res.status(403).json({ error: 'Not your assignment.' });
  const rosterData = a.rosterId ? roster.getRoster(req.userId, a.rosterId) : null;
  const rosterMap = rosterData ? Object.fromEntries(rosterData.students.map(s => [s.id, s.name])) : {};
  const submissions = assignments.getSubmissions(a.id).map(s => ({ ...s, name: rosterMap[s.studentId] || s.name }));
  res.json({ questions: a.content.questions, submissions, resultsReleased: a.resultsReleased, cutoffAt: a.cutoffAt, effectivelyReleased: assignments.isReleased(a) });
});

// Teacher: override a student's grade for one question. This both corrects
// that submission AND promotes/overwrites the verdict cache entry for that
// exact answer text — the only way an AI verdict becomes reusable.
app.patch('/api/assignment/:id/grade', requireAuth, (req, res) => {
  const a = assignments.getAssignment(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  if (a.teacherId !== req.userId) return res.status(403).json({ error: 'Not your assignment.' });
  const { questionId, marksAwarded, verdict, rationale } = req.body || {};
  const studentId = roster.normalizeStudentId(req.body && req.body.studentId);
  const sub = assignments.getSubmission(a.id, studentId);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });
  const q = a.content.questions.find(q => q.id === questionId);
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  const marks = Math.max(0, Math.min(q.marks, parseInt(marksAwarded, 10) || 0));
  const v = verdict || (marks === q.marks ? 'correct' : marks === 0 ? 'incorrect' : 'partial');
  const answerText = sub.answers[questionId];

  assignments.recordVerdict(a.id, questionId, { answerText, marksAwarded: marks, verdict: v, rationale: rationale || (sub.grades[questionId] || {}).rationale || '', confirmed: true, source: 'teacher' });

  sub.grades[questionId] = { marksAwarded: marks, verdict: v, rationale: rationale || (sub.grades[questionId] || {}).rationale || '', source: 'teacher' };
  sub.totalMarks = Object.values(sub.grades).reduce((s, g) => s + g.marksAwarded, 0);
  assignments.saveSubmission(a.id, sub);
  res.json({ ok: true, submission: sub });
});

// Everything a generated (or uploaded) deck already knows about the lesson,
// laid out for the plan generator. A deck carries the whole lesson — titles,
// the points taught, worked examples, vocabulary with definitions and the
// teacher's speaker notes — so a plan written from it needs no second guess at
// what the lesson is about.
function deckAsPlanSource(deck) {
  const parts = [];
  for (const [i, s] of (deck.slides || []).entries()) {
    if (!s || s.type === 'video') continue;
    const bits = [];
    if (s.title) bits.push(String(s.title));
    if (Array.isArray(s.bullets) && s.bullets.length) bits.push(s.bullets.filter(Boolean).join('\n'));
    if (s.example) bits.push(`Example: ${s.example}`);
    if (Array.isArray(s.vocab) && s.vocab.length) {
      bits.push(`Vocabulary: ${s.vocab.map(v => (v && v.term ? `${v.term}${v.definition ? ` — ${v.definition}` : ''}` : '')).filter(Boolean).join('; ')}`);
    }
    if (s.worked && Array.isArray(s.worked.steps) && s.worked.steps.length) {
      bits.push(`Worked example: ${s.worked.task || ''} ${s.worked.steps.join(' ')}`.trim());
    }
    if (s.speakerNotes) bits.push(`Teacher notes: ${s.speakerNotes}`);
    if (bits.length) parts.push(`Slide ${i + 1} — ${bits.join('\n')}`);
  }
  return parts.join('\n\n');
}

// Rebuild the plan's sections so the teacher reviews their OWN workbook fields,
// in their own order and under their own labels.
//
// Objectives and success criteria come straight from the pacing guide and are
// marked readOnly: they are the school's words and must not be reworded, so the
// teacher sees them for context but cannot edit them into something else here.
// Metadata rows (Subject, Unit, Topic, Period) are omitted — they're already
// entered above — and Post lesson Reflection is omitted because it is written
// after teaching.
// Nothing is omitted: the review is the teacher's own form, so every row of
// their workbook appears, in order, under its own label. Rows the app fills
// from context (Subject, Unit, Topic, Period) are shown so they can see the
// whole plan; rows only they can write (Post lesson Reflection) appear empty
// and editable, in case they want to note something before printing.
const CONTEXT_FIELDS = { subject: 'subject', unit: 'unit', topic: 'topic', periodAndLength: 'period' };

function orderSectionsByOutline(generated, outline, verbatim = {}) {
  const list = Array.isArray(generated) ? generated : [];
  const norm = s => String(s || '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const taken = new Set();
  const findGenerated = (label) => {
    const want = norm(label);
    let i = list.findIndex((s, idx) => !taken.has(idx) && norm(s.heading) === want);
    if (i < 0) i = list.findIndex((s, idx) => !taken.has(idx) && (norm(s.heading).includes(want) || want.includes(norm(s.heading))));
    if (i < 0) return null;
    taken.add(i);
    return list[i];
  };

  const out = [];
  for (const field of outline) {
    // Rows the app already knows — echoed back so the teacher sees the whole
    // form, read-only because they are set higher up the page.
    if (field.key && CONTEXT_FIELDS[field.key]) {
      const value = String(verbatim[CONTEXT_FIELDS[field.key]] || '').trim();
      out.push({
        heading: field.label,
        content: value,
        stageId: 'launch',
        fieldKey: field.key,
        note: value ? 'From the lesson details you entered — edit if this lesson differs.' : 'Not set — type it here if your form needs it.',
      });
      continue;
    }

    // The teacher's own row — left for them to write after teaching.
    if (field.key === 'postLessonReflection') {
      out.push({
        heading: field.label,
        content: '',
        stageId: 'reflect',
        fieldKey: field.key,
        note: 'Left blank on purpose — yours to complete after you have taught. Anything you type here is kept.',
      });
      continue;
    }

    if (field.key === 'objectives' || field.key === 'successCriteria') {
      const value = field.key === 'objectives'
        ? String(verbatim.objectives || '').trim()
        : (Array.isArray(verbatim.successCriteria) ? verbatim.successCriteria : []).filter(Boolean).join('\n');
      out.push({
        heading: field.label,
        content: value,
        stageId: 'launch',
        fieldKey: field.key,
        note: value
          ? 'Your own words, copied exactly — never rewritten by the app.'
          : 'Not found in your pacing guide or slides — paste them here and they are kept word for word.',
      });
      continue;
    }

    const match = findGenerated(field.label);
    // A row the model wrote nothing for (commonly Phonics on a non-phonics
    // subject) still appears — it is part of the teacher's form, and an empty
    // box they can fill or ignore is more honest than quietly dropping a row
    // they expect to see.
    out.push({
      heading: field.label,
      content: (match && match.content) || '',
      stageId: (match && match.stageId) || 'teach',
      fieldKey: field.key || null,
      ...(match ? {} : { note: 'Not generated for this lesson — fill it in if your school needs it.' }),
    });
  }

  // Anything the model produced that didn't map to a row still gets shown, so
  // nothing it wrote is silently thrown away.
  list.forEach((s, idx) => { if (!taken.has(idx) && String(s.content || '').trim()) out.push(s); });
  return out.length ? out : list;
}

function orderSequenceSectionsByOutline(generated, outline, verbatim, sequence) {
  const groups = groupSectionsByLesson(generated, sequence);
  assertLessonFields(groups, outline);
  const { periodMinutes } = sequenceDetails(sequence);
  const sequenceVerbatim = {
    ...verbatim,
    period: String(verbatim && verbatim.period || '').trim() || `${periodMinutes} minutes`,
  };
  const orderedLessons = groups.map(group => orderSectionsByOutline(group, outline, sequenceVerbatim));
  return combineOrderedLessons(orderedLessons, outline, sequence);
}

// File a generated lesson into the teacher's week-by-week workbook, if they
// keep one. Returns a small status the UI can show, or null when there's no
// planner — never throws, because a bookkeeping failure must not fail a
// generation the teacher has already been charged for.
//
// The week comes from the pacing-guide flow the teacher already uses to choose
// what they're teaching; without one we don't guess, we just say so.
async function addLessonToWeekPlanner(req, { subject, topic, objectives, lessonPlan, slides, successCriteria, sequence }) {
  try {
    if (req.body && req.body.useWeekPlanner === false) return null;
    if (!weekPlanner.hasPlanner(req.userId)) return null;

    const body = req.body || {};
    const week = parseInt(body.weekNumber ?? body.selWeekNum ?? body.week, 10);
    if (!Number.isFinite(week) || week < 1) return { ok: false, reason: 'no_week' };

    // Learning objectives and success criteria are the SCHOOL'S words, taken
    // from the pacing guide. They are passed through untouched — never the
    // generated "Learning Objectives" section, which rephrases for prose.
    const derived = weekPlanner.lessonValuesFrom({
      subject,
      topic,
      unit: clip(body.unitName || body.unit, 200),
      period: clip(body.period, 120),
      objectives,                                   // verbatim
      successCriteria: Array.isArray(successCriteria) && successCriteria.length
        ? successCriteria
        : (Array.isArray(body.successCriteria) ? body.successCriteria : []),
      guideResources: Array.isArray(body.resources) ? body.resources : [],
      planSections: (lessonPlan && Array.isArray(lessonPlan.sections)) ? lessonPlan.sections : [],
      vocab: (Array.isArray(slides) ? slides : []).flatMap(s => (Array.isArray(s.vocab) ? s.vocab : [])),
      redThread: clip(body.redThread, 500),
    });

    // Anything the teacher edited on the review screen wins over what the app
    // derived, including a row they deliberately cleared. Rows they never saw
    // keep their derived value.
    const edited = weekPlanner.reviewedValues((lessonPlan && lessonPlan.sections) || []);
    const values = { ...derived, ...edited };
    // Their own reflection is kept; the model's would still be refused.
    const allow = new Set(Object.keys(edited).filter(k => weekPlanner.NEVER_WRITE.has(k) && edited[k]));

    // Which lesson of the week — the teacher's call when their form holds
    // several; omitted means take the slot this lesson already has, else next free.
    const lessonNumber = parseInt(body.lessonNumber, 10);
    const slot = Number.isFinite(lessonNumber) ? lessonNumber : undefined;

    // A weekly sequence is several lessons written as one document, because
    // that is all a single-document template can hold. This workbook has a
    // column per lesson, so they go in one per column — stacked in the first
    // one they would waste the form and leave the teacher separating them by
    // hand. Only when the form is actually wide enough; a one-lesson-a-week
    // subject keeps the whole sequence together as before.
    const seq = sequence || body.sequence || body.lessonSequence || null;
    const meta = weekPlanner.readPlannerMeta(req.userId) || {};
    if (seq && seq.enabled && meta.shape === 'weekly-multi') {
      const perLesson = weekPlanner.splitSequence(values, seq.lessonCount);
      if (perLesson) {
        const filed = await weekPlanner.recordSequence(req.userId, week, perLesson, slot || 1, { allow });
        if (filed.ok) {
          audit.log('week_planner.sequence_added', {
            userId: req.userId, week, sheet: filed.sheetName, columns: filed.columns,
            filed: filed.lessonsFiled, requested: filed.requested, ip: req.ip,
          });
        }
        return filed;
      }
    }

    const result = await weekPlanner.recordLesson(req.userId, week, values, slot, { allow });
    if (result.ok) {
      audit.log('week_planner.lesson_added', {
        userId: req.userId, week, sheet: result.sheetName, column: result.column, ip: req.ip,
      });
    }
    return result;
  } catch (err) {
    console.error('Week planner update failed:', err.message);
    return { ok: false, reason: 'error' };
  }
}

// Generate a deck; store state; return preview metadata + download id.
app.post('/api/generate', requireAuth, async (req, res) => {
  const { slideCount, grade, tone, lessonPlan, unitId, lessonIndex, regenerate, presetId } = req.body || {};
  const teachingModelId = normalizeTeachingModelId(req.body && req.body.teachingModelId);
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  const objectives = clip(req.body.objectives, LIMITS.objectives);
  const focus = clip(req.body.focus, LIMITS.focus);
  const lessonSequence = lessonSequenceFromBody(req.body);
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  const { reservation, block } = await reserve(req, 'lessonscope.generate_slide_deck');
  if (block) return res.status(402).json(block);
  try {
    const u = unitId ? unit.getUnit(req.userId, unitId) : null;
    const unitBlock = u ? unit.buildUnitBlock(u, lessonIndex) : '';
    // If an accepted lesson plan (structured) or a raw plan/source text (from an
    // uploaded plan or slides) was passed, the slides follow it; unit context
    // falls back into lessonPlanText so it still reaches the content generator.
    const materialText = sourceMaterialText(req.body);
    const materialImages = sourceMaterialImages(req.body);
    const lessonPlanText = mergeSourceIntoPlanText(resolvePlanText(req.body) || (unitBlock || ''), materialText);
    const built = await buildDeck({ subject, topic, slideCount, grade, tone, focus, objectives, lessonPlanText, sourceMaterialText: materialText, sourceImages: materialImages, teachingModelId, extras: { regenerate: !!regenerate, lessonSequence }, skipAssemble: true, presetId: presetId || null });
    const id = crypto.randomUUID();
    decks.set(id, {
      ownerId: req.userId,
      subject: String(subject).toLowerCase(), topic: String(topic).toLowerCase(),
      grade: grade || 'middle school', tone, focus, band: built.band,
      slides: built.slides, images: built.images, createdAt: Date.now(), touchedAt: Date.now(),
      objectives: objectives || '', lessonPlanText, sourceMaterialText: materialText, sourceMaterialImages: materialImages, // kept so follow-up resources are grounded in this lesson
      lessonSequence,
      teachingModelId,
      presetId: presetId || null,
    });
    await capture(req, reservation, 'lessonscope.generate_slide_deck', id);   // 1 credit per lesson (no-op unless billing on)

    // If this teacher keeps a week-by-week workbook, file the lesson into it.
    // Never let a bookkeeping problem fail a generation the teacher has paid
    // for — the deck is returned either way, with a note about what happened.
    const weekPlannerResult = await addLessonToWeekPlanner(req, {
      subject, topic, objectives, lessonPlan: req.body && req.body.lessonPlan,
      slides: built.slides,
      sequence: lessonSequence,
    });

    const filename = `${subject}-${topic}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');
    res.json({
      deckId: id, filename, band: built.band, slideCount: built.slides.length, teachingModelId, lessonSequence,
      weekPlanner: weekPlannerResult,
      slides: built.slides.map((s, i) => previewEntry(s, built.images[i])),
    });
  } catch (err) {
    await release(req, reservation, 'lessonscope.generate_slide_deck', err.message);
    console.error('Generate failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Swap a slide's image for a different library image.
app.post('/api/slide/:id/swap-image', requireAuth, (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck expired — generate again.' });
  const i = Number(req.body.index);
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) return res.status(400).json({ error: 'bad index' });

  const exclude = deck.images.map(im => im.relpath); // avoid every image already in the deck
  const alt = alternativeImage({ subject: deck.subject, topic: deck.topic, imageQuery: deck.slides[i].imageQuery, exclude });
  if (!alt) return res.status(409).json({ error: 'No other image available for this topic.' });
  deck.images[i] = alt;
  res.json({ image: '/' + alt.relpath, imageSource: alt.source || 'library' });
});

// Attach one teacher-approved YouTube video to a slide. This is free and
// stores only the validated video metadata, not a downloaded media file.
app.post('/api/slide/:id/youtube', requireAuth, async (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck expired — generate again.' });
  const i = Number(req.body.index);
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) return res.status(400).json({ error: 'bad index' });
  if (deck.slides[i].type === 'video') return res.status(400).json({ error: 'Choose a lesson-content slide, then add the video after it.' });
  const video = normalizeVideo(req.body.url || req.body.videoId, {
    title: clip(req.body.title, 180),
    channelTitle: clip(req.body.channelTitle, 120),
    reason: clip(req.body.reason, 180),
    startSeconds: req.body.startSeconds,
  });
  if (!video) return res.status(400).json({ error: 'Enter a valid YouTube video link.' });
  try {
    video.thumbnailData = await thumbnailDataUrl(video);
  } catch (err) {
    console.log('YouTube thumbnail not embedded:', err.message);
  }
  const existingNext = deck.slides[i + 1];
  if (existingNext && existingNext.type === 'video' && existingNext.youtube) {
    deck.slides[i + 1] = makeVideoSlide(video, deck.slides[i]);
    deck.images[i + 1] = null;
  } else {
    deck.slides.splice(i + 1, 0, makeVideoSlide(video, deck.slides[i]));
    deck.images.splice(i + 1, 0, null);
  }
  delete deck.slides[i].youtube;
  persistDecks();
  res.json(deckPreviewPayload(req.params.id, deck));
});

app.delete('/api/slide/:id/youtube', requireAuth, (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck expired — generate again.' });
  const i = Number(req.body.index);
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) return res.status(400).json({ error: 'bad index' });
  if (deck.slides[i].type === 'video') {
    deck.slides.splice(i, 1);
    deck.images.splice(i, 1);
  } else {
    delete deck.slides[i].youtube;
    if (deck.slides[i + 1] && deck.slides[i + 1].type === 'video' && deck.slides[i + 1].youtube) {
      deck.slides.splice(i + 1, 1);
      deck.images.splice(i + 1, 1);
    }
  }
  persistDecks();
  res.json(deckPreviewPayload(req.params.id, deck));
});

// Remaining AI-visual budget for this month (for the UI to show + gate buttons).
app.get('/api/quota', requireAuth, (req, res) => res.json(quota.status(req.userId, req.user.role === 'admin')));

// Stock-first image search: look through the curated library.
app.get('/api/images/search', requireAuth, (req, res) => {
  const { q, subject, topic } = req.query || {};
  res.json({ images: searchLibrary({ q, subject, topic, limit: 24 }) });
});

const { rewriteImageQuery } = require('./query-rewrite');

// Fallback: fetch fresh images from Unsplash for a query (free; captioned +
// added to the library so they're reusable). Not an AI visual — not capped.
app.post('/api/images/fetch', requireAuth, async (req, res) => {
  declareFree('lessonscope.image_search');
  const { q, subject, topic, grade } = req.body || {};
  if (!q || !String(q).trim()) return res.status(400).json({ error: 'Type what you are looking for.' });
  try {
    const searchQ = await rewriteImageQuery(String(q).trim(), { grade: grade || '' });
    const sub = subject || 'search', top = topic || 'general';
    // Fetch from Unsplash + Wikimedia Commons simultaneously
    const [unsplash, wikimedia] = await Promise.all([
      addImages({ subject: sub, topic: top, count: 6, query: searchQ }).catch(e => { console.error('Unsplash:', e.message); return []; }),
      fetchWikimediaImages({ subject: sub, topic: top, count: 6, query: searchQ }).catch(e => { console.error('Wikimedia:', e.message); return []; }),
    ]);
    // Interleave so both sources appear together in the grid
    const combined = [];
    for (let i = 0; i < Math.max(unsplash.length, wikimedia.length); i++) {
      if (i < unsplash.length)  combined.push(unsplash[i]);
      if (i < wikimedia.length) combined.push(wikimedia[i]);
    }
    if (!combined.length) return res.status(400).json({ error: 'No images found — try different search terms.' });
    addLibraryImages(combined);
    res.json({ images: combined.map(e => ({ relpath: e.relpath, image: '/' + e.relpath, caption: e.caption || '', source: e.source || 'unsplash' })) });
  } catch (err) {
    console.error('Image fetch failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Subject and topic become folder names under the media volume, so they get
// the same slug treatment the deck builder gives them.
const slugForMedia = v => String(v || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ── GIFs ───────────────────────────────────────────────────────────────────
// Search returns candidates only — nothing is downloaded until the teacher
// picks one, because downloading twelve GIFs so they can look at them would
// fill the volume with animations nobody chose.
app.get('/api/gifs/search', requireAuth, async (req, res) => {
  // A GIF is a picture for a deck they have already paid for, so it is the
  // same free action as any other image search rather than a new price.
  declareFree('lessonscope.image_search');
  if (!giphyConfigured()) return res.json({ gifs: [], configured: false });
  const q = String((req.query && req.query.q) || '').trim();
  if (!q) return res.json({ gifs: [], configured: true });
  const { gifs, status } = await searchGifs({ query: q, limit: 12 });
  res.json({ gifs, configured: true, status });
});

// Download the chosen GIF into the media library. It comes back as a library
// entry like any other image, so the existing set-image call places it.
app.post('/api/gifs/pick', requireAuth, async (req, res) => {
  declareFree('lessonscope.image_search');
  if (!giphyConfigured()) return res.status(400).json({ error: 'GIF search is not configured.' });
  const body = req.body || {};
  if (!body.url) return res.status(400).json({ error: 'That GIF is missing its address.' });
  try {
    const entry = await saveGif({
      gif: {
        id: clip(body.id, 80),
        title: clip(body.title, 120),
        url: String(body.url),
        credit: body.credit && typeof body.credit === 'object'
          ? { name: clip(body.credit.name, 80), link: clip(body.credit.link, 300) }
          : undefined,
      },
      query: clip(body.q, 120),
      subject: slugForMedia(body.subject) || 'search',
      topic: slugForMedia(body.topic) || 'gifs',
      publicDir: mediaWriteDir(),
    });
    if (!entry) return res.status(400).json({ error: 'That GIF could not be downloaded. Try another.' });
    addLibraryImages([entry]);
    res.json({ relpath: entry.relpath, image: '/' + entry.relpath, caption: entry.caption || '', source: 'giphy' });
  } catch (err) {
    console.error('GIF pick failed:', err.message);
    res.status(400).json({ error: 'That GIF could not be saved. Try another.' });
  }
});

// Set a chosen library image onto a slide (from the picker).
app.post('/api/slide/:id/set-image', requireAuth, (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck expired — generate again.' });
  const i = Number(req.body.index);
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) return res.status(400).json({ error: 'bad index' });
  const entry = getLibraryImage(String(req.body.relpath || ''));
  if (!entry) return res.status(404).json({ error: 'Image not found.' });
  deck.images[i] = entry;
  if (deck.slides[i].visual) deck.slides[i].visual = { type: 'none', items: [] }; // a chosen photo replaces any diagram/visual
  res.json({ image: '/' + entry.relpath, imageSource: entry.source || 'library' });
});

// Generate an accurate AI illustration for a slide's example/task.
app.post('/api/slide/:id/ai-image', requireAuth, async (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck expired — generate again.' });
  const i = Number(req.body.index);
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) return res.status(400).json({ error: 'bad index' });
  const slide = deck.slides[i];
  const concept = (slide.example || slide.imageQuery || slide.title || '').trim();
  let reservation = null;
  try {
    // Reuse a previously AI-generated image for this concept instead of paying
    // to regenerate it (unless it's the one already on this slide). Reuse is
    // free — no AI call, so no credits.
    const reuse = findReusableImage({
      subject: deck.subject, topic: deck.topic, query: concept,
      minScore: 3, source: 'ai-generated',
      exclude: [deck.images[i] && deck.images[i].relpath].filter(Boolean),
    });
    if (reuse) {
      deck.images[i] = reuse;
      return res.json({ image: '/' + reuse.relpath, imageSource: 'ai-generated', reused: true });
    }
    // Paid generation — enforce the monthly AI-visual cap (abuse guard, admins
    // exempt) AND reserve credits (2). NOTE: Wikimedia is NOT tried here — the
    // teacher clicked "AI image" and expects a generated illustration.
    const isAdmin = req.user.role === 'admin';
    const q = quota.status(req.userId, isAdmin);
    if (!q.unlimited && q.remaining <= 0) {
      return res.status(403).json({ error: `You've used all ${q.limit} AI visuals this month — search the stock library instead, or they reset next month.`, limitReached: true, remaining: 0, limit: q.limit });
    }
    const r = await reserve(req, 'lessonscope.generate_ai_image');
    if (r.block) return res.status(402).json(r.block);
    reservation = r.reservation;
    const entry = await generateImage({ subject: deck.subject, topic: deck.topic, concept, grade: deck.grade });
    addLibraryImages([entry]);   // cache for reuse + matching
    deck.images[i] = entry;
    quota.consume(req.userId);
    await capture(req, reservation, 'lessonscope.generate_ai_image', entry.relpath);
    const after = quota.status(req.userId, isAdmin);
    res.json({ image: '/' + entry.relpath, imageSource: 'ai-generated', reused: false, remaining: after.remaining, limit: after.limit });
  } catch (err) {
    await release(req, reservation, 'lessonscope.generate_ai_image', err.message);
    console.error('AI image failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Force a labelled diagram onto a slide (curated if one fits, else generated).
app.post('/api/slide/:id/diagram', requireAuth, async (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck expired — generate again.' });
  const i = Number(req.body.index);
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) return res.status(400).json({ error: 'bad index' });
  const slide = deck.slides[i];
  let reservation = null;
  try {
    // Curated diagram available for this topic? Render the animated vector one
    // (local, free — no AI, no credits).
    const curated = detectLabelledDiagram(`${slide.title} ${slide.imageQuery || ''} ${slide.example || ''}`);
    if (curated) {
      slide.visual = { type: 'none', items: [] }; // let the title-based curated detection drive it
      return res.json({ labelled: curated });
    }
    const concept = `${slide.title}${slide.imageQuery ? ' — ' + slide.imageQuery : ''}`.trim();
    const reuse = findReusableImage({ subject: deck.subject, topic: deck.topic, query: concept, minScore: 3, source: 'svg-diagram', exclude: deck.images.map(im => im.relpath) });
    let entry = reuse, remaining, limit;
    if (!entry) {
      // Generating a new diagram is a paid AI visual — enforce the cap (abuse
      // guard) AND reserve credits (1).
      const isAdmin = req.user.role === 'admin';
      const q = quota.status(req.userId, isAdmin);
      if (!q.unlimited && q.remaining <= 0) {
        return res.status(403).json({ error: `You've used all ${q.limit} AI visuals this month — search the stock library instead, or they reset next month.`, limitReached: true, remaining: 0, limit: q.limit });
      }
      const r = await reserve(req, 'lessonscope.generate_diagram');
      if (r.block) return res.status(402).json(r.block);
      reservation = r.reservation;
      entry = await generateDiagram({ subject: deck.subject, topic: deck.topic, concept });
      addLibraryImages([entry]);
      quota.consume(req.userId);
      await capture(req, reservation, 'lessonscope.generate_diagram', entry.relpath);
      const after = quota.status(req.userId, isAdmin);
      remaining = after.remaining; limit = after.limit;
    }
    slide.visual = { type: 'diagram', items: [concept] };
    deck.images[i] = entry;
    const src = entry.source === 'wikimedia' ? 'wikimedia' : 'svg-diagram';
    res.json({ image: '/' + entry.relpath, imageSource: src, remaining, limit });
  } catch (err) {
    await release(req, reservation, 'lessonscope.generate_diagram', err.message);
    console.error('Diagram failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Regenerate a single content slide's text (and refresh its image).
app.post('/api/slide/:id/regenerate', requireAuth, async (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck expired — generate again.' });
  const i = Number(req.body.index);
  if (!Number.isInteger(i) || i < 0 || i >= deck.slides.length) return res.status(400).json({ error: 'bad index' });
  if (deck.slides[i].type !== 'content') return res.status(400).json({ error: 'Only content slides can be regenerated.' });

  // Fair-use: the first FREE_REGENS regenerations of a lesson are free; after
  // that another small batch costs REGEN_BATCH_COST. The counter is per-deck.
  const used = deck.regenCount || 0;
  const cost = used < prices.FREE_REGENS ? 0 : prices.REGEN_BATCH_COST;
  const { reservation, block } = await reserve(req, 'lessonscope.regenerate_slide', { credits: cost, idemSeed: `${req.params.id}:${i}:${used}` });
  if (block) return res.status(402).json(block);
  try {
    const avoidTitles = deck.slides.filter((s, j) => s.type === 'content' && j !== i).map(s => s.title);
    const fresh = await generateOneSlide({
      subject: deck.subject,
      topic: deck.topic,
      grade: deck.grade,
      tone: deck.tone,
      focus: deck.focus,
      teachingModelId: deck.teachingModelId,
      preferredStage: deck.slides[i].modelStage,
      avoidTitles,
    });
    fresh.side = deck.slides[i].side; // keep the image side for layout rhythm
    deck.slides[i] = fresh;
    const alt = alternativeImage({ subject: deck.subject, topic: deck.topic, imageQuery: fresh.imageQuery, exclude: deck.images.map(im => im.relpath) });
    if (alt) deck.images[i] = alt;
    deck.regenCount = used + 1;
    await capture(req, reservation, 'lessonscope.regenerate_slide', `${req.params.id}:${i}`);
    res.json({ slide: previewEntry(deck.slides[i], deck.images[i]), regensUsed: deck.regenCount, freeRegens: prices.FREE_REGENS, charged: cost });
  } catch (err) {
    await release(req, reservation, 'lessonscope.regenerate_slide', err.message);
    console.error('Regenerate failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

function applyDeckEdits(deck, edits) {
  for (const edit of (edits || [])) {
    const s = deck.slides[edit.index];
    if (!s) continue;
    if (typeof edit.title === 'string') s.title = edit.title;
    if (Array.isArray(edit.bullets)) s.bullets = edit.bullets.filter(b => b.trim());
    if (typeof edit.example === 'string') s.example = edit.example;
    if (typeof edit.subtitle === 'string') s.subtitle = edit.subtitle;
  }
}

async function deckPptxBuffer(deck, edits) {
  applyDeckEdits(deck, edits);
  const pptx = rebuildDeck({ slides: deck.slides, images: deck.images, grade: deck.grade, presetId: deck.presetId || null });
  return safeAnimate(await pptx.write({ outputType: 'nodebuffer' }), deck.band);
}

function deckFilename(deck) {
  return `${deck.subject}-${deck.topic}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');
}

// Download — merges any text edits from the client, rebuilds, streams the file.
app.post('/api/download/:id', requireAuth, async (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found or expired — generate it again.' });
  try {
    const buffer = await deckPptxBuffer(deck, req.body.edits);
    const filename = deckFilename(deck);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Download/rebuild failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/deck/:id', requireAuth, (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found or expired — generate it again.' });
  res.json({
    deckId: req.params.id,
    filename: deckFilename(deck),
    band: deck.band || null,
    slideCount: deck.slides.length,
    teachingModelId: deck.teachingModelId || null,
    sourceText: deck.lessonPlanText || deck.sourceText || '',
    slides: deck.slides.map((s, i) => previewEntry(s, deck.images[i])),
  });
});

// ── Persistent lesson workspaces ─────────────────────────────────────────
// A deck is still kept in the fast in-memory editing map while the teacher is
// working. A workspace also snapshots it on disk, alongside the approved plan
// and generated resources, so returning tomorrow does not require regeneration.
function cloneWorkspaceValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyWorkspaceDeckEdits(deck, edits) {
  const byIndex = new Map((Array.isArray(edits) ? edits : []).slice(0, 100).map(edit => [Number(edit.index), edit]));
  deck.slides = (deck.slides || []).map((slide, index) => {
    const edit = byIndex.get(index);
    if (!edit) return slide;
    const updated = { ...slide };
    if (edit.title !== undefined) updated.title = clip(edit.title, 500);
    if (edit.subtitle !== undefined) updated.subtitle = clip(edit.subtitle, 1000);
    if (edit.example !== undefined) updated.example = clip(edit.example, 2000);
    if (Array.isArray(edit.bullets)) updated.bullets = edit.bullets.slice(0, 20).map(item => clip(item, 1000));
    return updated;
  });
  return deck;
}

function workspaceDeckSnapshots(req, existing) {
  const refs = req.body && req.body.deckRefs;
  if (!Array.isArray(refs)) return undefined;
  const previous = new Map(((existing && existing.deckSnapshots) || []).map(item => [item.deckId, item]));
  return refs.slice(0, 12).map(ref => {
    const deckId = clip(ref && ref.deckId, 120);
    if (!deckId) return null;
    const liveDeck = decks.get(deckId);
    if (!liveDeck) return previous.get(deckId) || null;
    if (liveDeck.ownerId && liveDeck.ownerId !== req.userId) return null;
    liveDeck.ownerId = req.userId;
    liveDeck.touchedAt = Date.now();
    const snapshot = applyWorkspaceDeckEdits(cloneWorkspaceValue(liveDeck), ref.edits);
    return { deckId, deck: snapshot };
  }).filter(Boolean);
}

function workspaceUpdateFrom(req, existing) {
  const body = req.body || {};
  const update = {
    title: body.title,
    subject: body.subject,
    topic: body.topic,
    grade: body.grade,
    stage: body.stage,
    context: body.context,
    plan: body.plan,
    sequencePlans: body.sequencePlans,
    activeSequencePlanIndex: body.activeSequencePlanIndex,
    activeDeckId: body.activeDeckId,
    packs: body.packs,
    activePackType: body.activePackType,
    assignmentIds: body.assignmentIds,
    gameIds: body.gameIds,
    archived: body.archived,
  };
  const snapshots = workspaceDeckSnapshots(req, existing);
  if (snapshots !== undefined) update.deckSnapshots = snapshots;
  return update;
}

app.get('/api/lesson-workspaces', requireAuth, (req, res) => {
  res.json({ lessons: lessonWorkspaces.list(req.userId) });
});

app.post('/api/lesson-workspaces', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  try {
    const record = lessonWorkspaces.create(req.userId, workspaceUpdateFrom(req, null));
    persistDecks();
    audit.log('lesson_workspace.created', { userId: req.userId, workspaceId: record.id, stage: record.stage });
    res.status(201).json({ workspace: lessonWorkspaces.withoutDeckSnapshots(record) });
  } catch (err) {
    console.error('Lesson workspace create failed:', err.message);
    res.status(400).json({ error: 'Could not save this lesson. Try again.' });
  }
});

app.patch('/api/lesson-workspaces/:id', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });
  const existing = lessonWorkspaces.get(req.userId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lesson workspace not found.' });
  try {
    const record = lessonWorkspaces.update(req.userId, req.params.id, workspaceUpdateFrom(req, existing));
    persistDecks();
    audit.log('lesson_workspace.updated', { userId: req.userId, workspaceId: record.id, stage: record.stage, archived: record.archived });
    res.json({ workspace: lessonWorkspaces.withoutDeckSnapshots(record) });
  } catch (err) {
    console.error('Lesson workspace update failed:', err.message);
    res.status(400).json({ error: 'Could not save this lesson. Try again.' });
  }
});

app.get('/api/lesson-workspaces/:id/resume', requireAuth, (req, res) => {
  const record = lessonWorkspaces.get(req.userId, req.params.id);
  if (!record) return res.status(404).json({ error: 'Lesson workspace not found.' });
  const restoredDecks = [];
  for (const item of record.deckSnapshots || []) {
    if (!item || !item.deckId || !item.deck || !Array.isArray(item.deck.slides)) continue;
    const deck = cloneWorkspaceValue(item.deck);
    deck.ownerId = req.userId;
    deck.touchedAt = Date.now();
    decks.set(item.deckId, deck);
    restoredDecks.push(deckPreviewPayload(item.deckId, deck));
  }
  if (restoredDecks.length) persistDecks();
  res.json({ workspace: lessonWorkspaces.withoutDeckSnapshots(record), decks: restoredDecks });
});

async function exportDeckToGoogle(req, res, { convertToSlides = false } = {}) {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found or expired — generate it again.' });
  if (!googleDrive.configured()) {
    return res.status(501).json({
      error: 'Google export is not configured yet.',
      setupRequired: true,
    });
  }
  if (!googleDrive.connected(req.userId)) {
    return res.status(409).json({
      error: 'Connect Google Drive before exporting.',
      needsConnection: true,
      connectUrl: '/integrations/google-drive/connect',
    });
  }
  try {
    const filename = deckFilename(deck);
    const buffer = await deckPptxBuffer(deck, req.body.edits);
    const file = await googleDrive.uploadPptx(req.userId, { filename, buffer, convertToSlides });
    audit.log(convertToSlides ? 'google_slides.export' : 'google_drive.export', { userId: req.userId, deckId: req.params.id, fileId: file.id, filename, ip: req.ip });
    res.json({
      ok: true,
      kind: convertToSlides ? 'slides' : 'pptx',
      file: {
        id: file.id,
        name: file.name || filename,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        webContentLink: file.webContentLink,
      },
    });
  } catch (err) {
    observability.recordFailure('export', { requestId: req.requestId, operation: convertToSlides ? 'google_slides' : 'google_drive', error: err.message });
    res.status(400).json({ error: err.message });
  }
}

// Google Drive export — same rebuilt .pptx, uploaded to the teacher's Drive.
app.post('/api/google-drive/export/:id', requireAuth, async (req, res) => {
  return exportDeckToGoogle(req, res, { convertToSlides: false });
});

// Google Slides export — uploads the rebuilt .pptx and converts it into a
// native Google Slides presentation in the teacher's Drive.
app.post('/api/google-slides/export/:id', requireAuth, async (req, res) => {
  return exportDeckToGoogle(req, res, { convertToSlides: true });
});

// ── Student game: create from a deck, play, store results ──────────────────
const fishQuestLive = createFishQuestLive({ app, games, roster, requireAuth, requireGameAccess, jwtSecret: JWT_SECRET });

function requestedGameMode(body) {
  if (body && body.mode === 'fishquest') return 'fishquest';
  if (body && body.mode === 'colonyquest') return 'colonyquest';
  return 'arcade';
}

function gameLaunchPath(game) {
  return game.mode === 'colonyquest' ? `/colonyquest/${game.id}` : `/play/${game.id}`;
}

// Teacher: turn the current deck into a shareable, persistent student game.
app.post('/api/game', requireAuth, generationLimiter, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teachers only.' });
  const deck = decks.get(req.body && req.body.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck expired — regenerate the deck, then create the game.' });
  const questionCount = Math.min(20, Math.max(4, parseInt(req.body && req.body.questionCount, 10) || 6));
  const { reservation, block } = await reserve(req, 'lessonscope.generate_game');
  if (block) return res.status(402).json(block);
  try {
    const game = await generateGame({ subject: deck.subject, topic: deck.topic, grade: deck.grade, tone: deck.tone, objectives: deck.objectives || '', lessonPlanText: deck.lessonPlanText || '', questionCount });
    const lessonTitle = (deck.slides.find(s => s.type === 'title') || {}).title || deck.topic;
    const rosterId = (req.body && req.body.rosterId) || null;
    const cutoffAt = (req.body && req.body.cutoffAt) || null;
    const mode = requestedGameMode(req.body);
    const rec = games.createGame({ teacherId: req.userId, teacherName: req.user.name, lessonTitle, subject: deck.subject, topic: deck.topic, grade: deck.grade, game, rosterId, cutoffAt, mode });
    await capture(req, reservation, 'lessonscope.generate_game', rec.id);
    res.json({ gameId: rec.id, path: gameLaunchPath(rec), questionCount: rec.questions.length, roomCode: rec.roomCode, mode: rec.mode });
  } catch (err) {
    await release(req, reservation, 'lessonscope.generate_game', err.message);
    console.error('Game creation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Create a game from the teacher's own uploaded PowerPoint (no deck generation needed).
app.post('/api/game/from-pptx', requireAuth, generationLimiter, upload.single('file'), requireUploads('slides'), async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teachers only.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const subject = String(req.body && req.body.subject || '').trim().toLowerCase();
  const topic   = String(req.body && req.body.topic   || '').trim().toLowerCase();
  const grade   = String(req.body && req.body.grade   || 'Grade 5').trim();
  if (!subject || !topic) return res.status(400).json({ error: 'Subject and topic are required.' });
  const questionCount = Math.min(20, Math.max(4, parseInt(req.body && req.body.questionCount, 10) || 6));
  const rosterId = (req.body && req.body.rosterId) || null;
  const cutoffAt = (req.body && req.body.cutoffAt) || null;
  const { reservation, block } = await reserve(req, 'lessonscope.generate_game');
  if (block) return res.status(402).json(block);
  try {
    const lessonPlanText = await extractText(req.file.buffer, req.file.originalname);
    const game = await generateGame({ subject, topic, grade, objectives: '', lessonPlanText, questionCount });
    const mode = requestedGameMode(req.body);
    const rec = games.createGame({ teacherId: req.userId, teacherName: req.user.name, lessonTitle: topic, subject, topic, grade, game, rosterId, cutoffAt, mode });
    await capture(req, reservation, 'lessonscope.generate_game', rec.id);
    res.json({ gameId: rec.id, path: gameLaunchPath(rec), questionCount: rec.questions.length, roomCode: rec.roomCode, mode: rec.mode });
  } catch (err) {
    await release(req, reservation, 'lessonscope.generate_game', err.message);
    console.error('Game from pptx failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Teacher: update the cutoff date for a game they own.
app.patch('/api/game/:id/cutoff', requireAuth, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (g.teacherId !== req.userId) return res.status(403).json({ error: 'Not your game.' });
  const cutoffAt = (req.body && req.body.cutoffAt) || null;
  const updated = games.updateGameCutoff(req.params.id, cutoffAt);
  res.json({ ok: true, cutoffAt: updated.cutoffAt });
});

function ownedColonyQuest(req, res) {
  const game = games.getGame(req.params.id);
  if (!game) {
    res.status(404).json({ error: 'ColonyQuest game not found.' });
    return null;
  }
  if (game.teacherId !== req.userId) {
    res.status(403).json({ error: 'Not your game.' });
    return null;
  }
  if (game.colonyquest) return game;
  try {
    return games.updateColonyQuest(game.id, {});
  } catch (err) {
    res.status(409).json({ error: err.message || 'This lesson cannot start ColonyQuest yet.' });
    return null;
  }
}

// ColonyQuest is operated entirely from the teacher's authenticated screen.
// These endpoints persist configuration and turn snapshots; animation and the
// continuous ant simulation stay on the classroom computer.
app.get('/api/game/:id/colonyquest', requireAuth, (req, res) => {
  const game = ownedColonyQuest(req, res);
  if (!game) return;
  const classRoster = game.rosterId ? roster.getRoster(req.userId, game.rosterId) : null;
  res.json({
    game: {
      id: game.id,
      lessonTitle: game.lessonTitle,
      subject: game.subject,
      topic: game.topic,
      grade: game.grade,
      questions: game.questions,
      colonyquest: game.colonyquest,
    },
    roster: classRoster ? {
      id: classRoster.id,
      name: classRoster.name,
      students: classRoster.students.map(student => ({ id: student.id, name: student.name })),
    } : null,
    session: games.getColonyQuestSession(game.id),
  });
});

app.patch('/api/game/:id/colonyquest', requireAuth, (req, res) => {
  const game = ownedColonyQuest(req, res);
  if (!game) return;
  const session = games.getColonyQuestSession(game.id);
  if (session && !['setup', 'ended'].includes(session.phase)) {
    return res.status(409).json({ error: 'End or reset the current match before changing its setup.' });
  }
  try {
    const updated = games.updateColonyQuest(game.id, req.body || {});
    res.json({ ok: true, colonyquest: updated.colonyquest, questions: updated.questions });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save ColonyQuest settings.' });
  }
});

app.put('/api/game/:id/colonyquest/session', requireAuth, (req, res) => {
  const game = ownedColonyQuest(req, res);
  if (!game) return;
  try {
    const session = games.saveColonyQuestSession(game.id, req.body && req.body.session);
    res.json({ ok: true, updatedAt: session.updatedAt, summary: session.summary });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save this ColonyQuest match.' });
  }
});

app.delete('/api/game/:id/colonyquest/session', requireAuth, (req, res) => {
  const game = ownedColonyQuest(req, res);
  if (!game) return;
  games.clearColonyQuestSession(game.id);
  res.json({ ok: true });
});

// Student: enter a game with their Student ID — issues a short-lived game session.
// If the game has an attached roster, the studentId is verified against it.
// If no roster, any non-empty string is accepted as a free-form name.
app.post('/api/game/:id/enter', async (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  // The join screen sends a handle, not the school's own ID — see studentHandle.
  // A typed entry (no roster, or a child not on the list) still arrives as text.
  const fromList = g.rosterId
    ? studentFromHandle(g.teacherId, g.rosterId, g.id, req.body && req.body.handle)
    : null;
  const studentId = fromList
    ? roster.normalizeStudentId(fromList.id)
    : roster.normalizeStudentId(req.body && req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  const pin = req.body && req.body.pin ? String(req.body.pin).trim() : '';
  let displayName = roster.displayNameFrom(req.body && req.body.name, studentId);
  if (g.rosterId) {
    const teacher = getUserById(g.teacherId);
    const s = teacher ? roster.findStudentInRoster(g.teacherId, g.rosterId, studentId) : null;
    if (!s) return res.status(403).json({ error: 'Student ID not found. Check with your teacher.' });
    displayName = s.name;
    const pinState = studentAccount.getAccountState(studentId);
    if (pinState === 'unset') {
      if (!pin) return res.status(428).json({ needsPinSetup: true, name: displayName, error: 'Set up a 4-digit PIN to continue.' });
      if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
      if (!studentAccount.setPin(studentId, pin)) return res.status(409).json({ error: 'A PIN was just set for this ID — enter it instead.' });
    } else {
      if (!pin) return res.status(428).json({ needsPin: true, name: displayName, error: 'Enter your PIN to continue.' });
      if (!studentAccount.verifyPin(studentId, pin)) return res.status(403).json({ error: 'Incorrect PIN.' });
    }
  } else {
    // No roster: the name is a claim, so the first person to use it in this
    // game sets its PIN and anyone using it afterwards has to know it. It stops
    // a classmate typing your name; it cannot stop one who watched you type.
    const key = pinKeyFor(g.id, studentId, false);
    const pinState = studentAccount.getAccountState(key);
    if (pinState === 'unset') {
      if (!pin) return res.status(428).json({ needsPinSetup: true, name: displayName, error: 'Choose a 4-digit PIN. You will need it to come back.' });
      if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
      if (!studentAccount.setPin(key, pin)) return res.status(409).json({ error: 'That name was just taken — pick another, or ask your teacher.' });
    } else {
      if (!pin) return res.status(428).json({ needsPin: true, name: displayName, error: 'Enter your PIN to continue.' });
      if (!studentAccount.verifyPin(key, pin)) return res.status(403).json({ error: 'Incorrect PIN. Ask your teacher if you have forgotten it.' });
    }
  }
  const token = issueGameToken({ gameId: g.id, studentId, name: displayName });
  res.cookie(GAME_COOKIE, token, cookieOptions(30 * 24 * 60 * 60 * 1000));
  res.cookie(STUDENT_COOKIE, issueStudentToken(studentId, displayName), cookieOptions(30 * 24 * 60 * 60 * 1000));
  res.json({ name: displayName });
});

// Student: forgot their PIN — flags it for the teacher; does NOT unlock
// anything by itself.
app.post('/api/game/:id/pin/reset-request', (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g || !g.rosterId) return res.status(404).json({ error: 'Game not found.' });
  const studentId = roster.normalizeStudentId(req.body && req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  const ok = studentAccount.requestPinReset(studentId);
  if (!ok) return res.status(404).json({ error: 'No account found for this ID yet.' });
  res.json({ ok: true });
});

// Student: lesson summary + meta (NO correct answers).
app.get('/api/game/:id', requireGameAccess, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  // Students must hold a session for THIS game.
  if (req.gameSession && req.gameSession.gameId !== g.id) return res.status(403).json({ error: 'Session is for a different game.' });
  const hasRoster = !!g.rosterId;
  res.json({ id: g.id, lessonTitle: g.lessonTitle, subject: g.subject, topic: g.topic, grade: g.grade, mode: g.mode || 'arcade', summary: g.summary, questionCount: (g.questions || []).length, teacherName: g.teacherName, hasRoster, students: hasRoster ? classListFor(g.teacherId, g.rosterId, g.id) : [], highScores: games.getHighScores(g.id), canManageColonyQuest: !!req.userId && g.teacherId === req.userId });
});

// Student: the questions, WITHOUT the correct answers.
app.get('/api/game/:id/play', requireGameAccess, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (req.gameSession && req.gameSession.gameId !== g.id) return res.status(403).json({ error: 'Session is for a different game.' });
  res.json({ questions: g.questions.map((q, i) => ({ i, question: q.question, options: q.options })) });
});

// Student: check one answer (instant feedback).
app.post('/api/game/:id/answer', requireGameAccess, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (req.gameSession && req.gameSession.gameId !== g.id) return res.status(403).json({ error: 'Session is for a different game.' });
  const q = g.questions[Number(req.body.questionIndex)];
  if (!q) return res.status(400).json({ error: 'bad question' });
  res.json({ correct: Number(req.body.choice) === q.correctIndex, correctIndex: q.correctIndex, explanation: q.explanation });
});

// Student: finish — server re-scores authoritatively + stores the attempt.
app.post('/api/game/:id/finish', requireGameAccess, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (req.gameSession && req.gameSession.gameId !== g.id) return res.status(403).json({ error: 'Session is for a different game.' });
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  let score = 0;
  g.questions.forEach((q, i) => { if (Number(answers[i]) === q.correctIndex) score++; });
  // Use student session identity (ID + display name); teacher fallback for legacy.
  const studentId = (req.gameSession && req.gameSession.studentId) || req.userId || 'unknown';
  const name = (req.gameSession && req.gameSession.name) || (req.user && (req.user.name || req.user.email)) || studentId;
  const arcadeScore = Math.max(0, parseInt(req.body.arcadeScore, 10) || 0);
  const gameType = ['car', 'space', 'runner', 'balloon', 'target'].includes(req.body.gameType) ? req.body.gameType : null;
  const prevHigh = gameType ? games.getHighScores(g.id)[gameType] : 0;
  games.recordResult(g.id, { studentId, name, score, total: g.questions.length, answers, arcadeScore, gameType });
  if (g.rosterId) {
    setImmediate(() => webhooks.dispatch('result.created', { gameId: g.id, rosterId: g.rosterId, studentId, score, total: g.questions.length, at: new Date().toISOString() }).catch(() => {}));
  }
  const newHighScores = games.getHighScores(g.id);
  const isNewHigh = gameType && arcadeScore > 0 && arcadeScore > prevHigh;
  res.json({ score, total: g.questions.length, arcadeScore, gameType, highScores: newHighScores, isNewHigh });
});

// Teacher: results for one of their games (owner only).
// If the game has a roster, join real names from it.
app.get('/api/game/:id/results', requireAuth, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (g.teacherId !== req.userId) return res.status(403).json({ error: 'Not your game.' });
  const rosterData = g.rosterId ? roster.getRoster(req.userId, g.rosterId) : null;
  if (g.mode === 'colonyquest') {
    const session = games.getColonyQuestSession(g.id);
    const answers = session && Array.isArray(session.answers) ? session.answers : [];
    const summary = session ? (session.summary || colonyQuestCore.sessionSummary(session)) : null;
    const questionStats = g.questions.map((q, index) => {
      const attempts = answers.filter(answer => answer.questionIndex === index);
      return {
        index,
        question: q.question,
        correct: attempts.filter(answer => answer.correct).length,
        answered: attempts.length,
        correctIndex: q.correctIndex,
        options: q.options || null,
      };
    });
    const participated = new Set(answers.map(answer => roster.normalizeStudentId(answer.studentId)).filter(Boolean));
    const notPlayed = rosterData
      ? rosterData.students.filter(student => !participated.has(roster.normalizeStudentId(student.id))).map(student => ({ studentId: student.id, name: student.name }))
      : [];
    return res.json({
      mode: 'colonyquest',
      lessonTitle: g.lessonTitle,
      questionCount: g.questions.length,
      results: [],
      questionStats,
      notPlayed,
      rosterCount: rosterData ? rosterData.students.length : null,
      colonyquest: summary,
    });
  }
  const rosterMap = rosterData ? Object.fromEntries(rosterData.students.map(s => [roster.normalizeStudentId(s.id), s.name])) : {};
  const raw = games.getResults(g.id);
  const results = raw
    .map(r => ({
      studentId: r.studentId,
      name: rosterMap[roster.normalizeStudentId(r.studentId)] || r.name,
      score: r.score, total: r.total, at: r.at, attempts: r.attempts, arcadeScore: r.arcadeScores && r.arcadeScores.fishquest, fishquest: r.fishquest || null,
    }))
    .sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : 1));
  // Per-question breakdown: how many players got each question right (games
  // carry real quiz questions, so surface what students missed — not just the
  // leaderboard). A player's answers[i] is their chosen option index.
  const questionStats = g.questions.map((q, i) => {
    let correct = 0, answered = 0;
    for (const r of raw) {
      const a = (r.answers || [])[i];
      if (a == null || a === -1) continue;
      answered++;
      if (a === q.correctIndex) correct++;
    }
    return { index: i, question: q.question, correct, answered, correctIndex: q.correctIndex, options: q.options || null };
  });
  // Who's on the roster but hasn't played yet, so the teacher can chase them.
  const played = new Set(raw.map(r => roster.normalizeStudentId(r.studentId)));
  const notPlayed = rosterData ? rosterData.students.filter(s => !played.has(roster.normalizeStudentId(s.id))).map(s => ({ studentId: s.id, name: s.name })) : [];
  res.json({ lessonTitle: g.lessonTitle, questionCount: g.questions.length, roomCode: g.roomCode, results, questionStats, notPlayed, rosterCount: rosterData ? rosterData.students.length : null });
});

// ── Gradebook: all a class's marks in one place (assignments + games) ───────
app.get('/api/gradebook', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teachers only.' });
  res.json({ classes: gradebook.listClasses(req.userId) });
});

app.get('/api/gradebook/:rosterId', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teachers only.' });
  const gb = gradebook.buildGradebook(req.userId, req.params.rosterId);
  if (!gb) return res.status(404).json({ error: 'Class not found.' });
  res.json(gb);
});

app.get('/api/gradebook/:rosterId/export', requireAuth, (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teachers only.' });
  const gb = gradebook.buildGradebook(req.userId, req.params.rosterId);
  if (!gb) return res.status(404).json({ error: 'Class not found.' });
  const buf = gradebook.toWorkbook(gb);
  const base = String(gb.name || 'marks').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'marks';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${base}-marks.xlsx"`);
  res.send(buf);
});

// Teacher: list my games.
app.get('/api/games', requireAuth, (req, res) => res.json({ games: games.listTeacherGames(req.userId) }));

// ── Class rosters ──────────────────────────────────────────────────────────────

// Parse a file (CSV, Excel) and return headers + preview rows for UI verification.
// Does NOT save anything — the teacher must confirm the column mapping first.
app.post('/api/roster/preview', requireAuth, upload.single('file'), requireUploads('roster'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const result = roster.parseRosterFile(req.file.buffer, req.file.originalname);
    res.json({
      headers: result.headers,
      preview: result.rows.slice(0, 12),
      totalRows: result.totalRows,
      detectedIdCol: result.detectedIdCol,
      detectedNameCol: result.detectedNameCol,
      detectedGenderCol: result.detectedGenderCol,
      allRows: result.rows,          // sent back by client on confirm
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Save a roster. Accepts two body formats:
//   • JSON  { name, rows:[{col:val}], idCol, nameCol }  — from verified file upload
//   • plain text CSV  (legacy path — still works for backwards compat)
app.post('/api/roster', requireAuth, (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) return express.json({ limit: '2mb' })(req, res, next);
  return express.text({ type: '*/*', limit: '500kb' })(req, res, next);
}, (req, res) => {
  const name = String(req.query.name || req.headers['x-roster-name'] || (req.body && req.body.name) || 'Class roster').slice(0, 60).trim();
  try {
    let r;
    if (req.body && typeof req.body === 'object' && req.body.rows) {
      // Verified file-upload path
      const { rows, idCol, nameCol, genderCol } = req.body;
      if (!idCol) return res.status(400).json({ error: 'idCol is required.' });
      const students = roster.buildStudentsFromMapping(rows, idCol, nameCol, genderCol);
      if (!students.length) return res.status(400).json({ error: 'No valid students found in the selected columns.' });
      r = roster.saveRoster(req.userId, { name, students });
    } else {
      // Legacy CSV text path
      const csvText = String(req.body || '').trim();
      if (!csvText) return res.status(400).json({ error: 'CSV is empty.' });
      r = roster.saveRoster(req.userId, { name, csvText });
    }
    setImmediate(() => webhooks.dispatch('roster.updated', { rosterId: r.id, teacherId: req.userId, studentCount: r.students.length, action: 'created' }).catch(() => {}));
    res.json({ id: r.id, name: r.name, count: r.students.length });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/rosters', requireAuth, (req, res) => res.json({ rosters: roster.listRosters(req.userId) }));

// Teacher: full roster detail with per-student PIN status (never the hash
// itself) — powers the roster panel's per-student PIN column.
app.get('/api/roster/:id', requireAuth, (req, res) => {
  const r = roster.getRoster(req.userId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Roster not found.' });
  res.json({
    id: r.id, name: r.name, createdAt: r.createdAt,
    // PIN state now lives in a global per-Student-ID account (student-account.js),
    // not per-roster — a student's PIN is the same across every class they're in.
    // `pin` is present only for a PIN THIS teacher issued. One the student
    // chose is hash-only and comes back null — resettable, never readable.
    students: r.students.map(s => ({
      id: s.id, name: s.name, gender: s.gender || '',
      pinState: studentAccount.getAccountState(s.id),
      pin: studentAccount.revealPin(s.id),
      pinResetRequested: studentAccount.getResetRequest(s.id),
    })),
  });
});

// Teacher: issue PINs for a whole class in one go.
//
// The teacher is the authority here: they generate the codes, keep the list,
// and hand them out. `all=true` re-issues everyone (start of term, or a list
// that went missing); the default only fills in students who have none, so
// running it twice does not lock out a class that is already using theirs.
app.post('/api/roster/:rosterId/pins', requireAuth, (req, res) => {
  const r = roster.getRoster(req.userId, req.params.rosterId);
  if (!r) return res.status(404).json({ error: 'Roster not found.' });
  const all = !!(req.body && req.body.all);
  const issued = [];
  for (const student of r.students || []) {
    // "Has a PIN" is not the question — "do I have their PIN" is. A student who
    // set their own is invisible to the teacher, so leaving them out would mean
    // the class list is incomplete exactly where it matters. Issuing replaces it,
    // which is the point: the teacher is the authority for these codes now.
    const readable = studentAccount.revealPin(student.id);
    if (readable && !all) {
      issued.push({ id: student.id, name: student.name, pin: readable, changed: false });
      continue;
    }
    issued.push({ id: student.id, name: student.name, pin: studentAccount.issuePin(student.id), changed: true });
  }
  audit.log('roster.pins_issued', { userId: req.userId, rosterId: r.id, count: issued.filter(i => i.changed).length, all, ip: req.ip });
  res.json({ students: issued });
});

// Teacher: give one student a new PIN and show it. This IS the reset — a
// teacher standing in front of a class should not need a two-step approval
// to help a child who has forgotten theirs back into the lesson.
app.post('/api/roster/:rosterId/student/:studentId/pin', requireAuth, (req, res) => {
  const studentId = roster.normalizeStudentId(req.params.studentId);
  const student = roster.findStudentInRoster(req.userId, req.params.rosterId, studentId);
  if (!student) return res.status(404).json({ error: 'Student not found in this roster.' });
  const pin = studentAccount.issuePin(studentId);
  if (!pin) return res.status(500).json({ error: 'Could not set a PIN. Try again.' });
  audit.log('roster.pin_reset', { userId: req.userId, rosterId: req.params.rosterId, studentId, ip: req.ip });
  res.json({ id: studentId, name: student.name, pin });
});

// Teacher: approve a student's PIN reset request — clears the PIN so their
// next join attempt falls back into the setup flow. Ownership check: the
// student must actually be in one of THIS teacher's rosters (even though the
// account itself is global, a teacher can only act on students they teach).
app.patch('/api/roster/:rosterId/student/:studentId/pin-reset', requireAuth, (req, res) => {
  const studentId = roster.normalizeStudentId(req.params.studentId);
  const s = roster.findStudentInRoster(req.userId, req.params.rosterId, studentId);
  if (!s) return res.status(404).json({ error: 'Student not found in this roster.' });
  studentAccount.approvePinReset(studentId);
  res.json({ ok: true });
});

// Rename a class. Deliberately not a re-upload: the students, their PINs and
// every result already recorded against this roster stay exactly as they are.
app.patch('/api/roster/:id', requireAuth, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Give the class a name.' });
  const updated = roster.renameRoster(req.userId, req.params.id, name);
  if (!updated) return res.status(404).json({ error: 'Roster not found.' });
  audit.log('roster.renamed', { userId: req.userId, rosterId: req.params.id, name, ip: req.ip });
  res.json({ id: updated.id, name: updated.name, count: (updated.students || []).length });
});

app.delete('/api/roster/:id', requireAuth, async (req, res) => {
  const r = roster.getRoster(req.userId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Roster not found.' });
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required to delete a roster.' });
  const ok = await verifyPassword(req.userId, password);
  if (!ok) return res.status(403).json({ error: 'Incorrect password.' });
  roster.deleteRoster(req.userId, req.params.id);
  setImmediate(() => webhooks.dispatch('roster.updated', { rosterId: req.params.id, teacherId: req.userId, action: 'deleted' }).catch(() => {}));
  res.json({ ok: true });
});

// Student progress: aggregates every game result for each student in a roster.
// Returns roster summary + per-student { gamesPlayed, avgPct, bestSubject, lastAt, results[] }.
app.get('/api/roster/:id/progress', requireAuth, (req, res) => {
  const r = roster.getRoster(req.userId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Roster not found.' });

  const rosterMap = new Map(r.students.map(s => [roster.normalizeStudentId(s.id), s.name]));
  const allGames  = games.listTeacherGames(req.userId);

  // Collect results keyed by studentId.
  const byStudent = new Map();
  for (const g of allGames) {
    for (const result of games.getResults(g.id)) {
      const studentId = roster.normalizeStudentId(result.studentId);
      if (!rosterMap.has(studentId)) continue;
      if (!byStudent.has(studentId)) byStudent.set(studentId, []);
      byStudent.get(studentId).push({
        gameId: g.id,
        lessonTitle: g.lessonTitle || g.topic,
        topic: g.topic,
        subject: g.subject,
        score: result.score,
        total: result.total,
        pct: result.total > 0 ? Math.round((result.score / result.total) * 100) : 0,
        at: result.at,
        attempts: result.attempts || 1,
      });
    }
  }

  const students = r.students.map(s => {
    const results = (byStudent.get(roster.normalizeStudentId(s.id)) || []).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const gamesPlayed = results.length;
    const avgPct = gamesPlayed ? Math.round(results.reduce((sum, r) => sum + r.pct, 0) / gamesPlayed) : null;
    const lastAt = results.length ? results[0].at : null;
    // Subject with highest average score.
    const subjTotals = {};
    for (const r of results) {
      if (!subjTotals[r.subject]) subjTotals[r.subject] = { sum: 0, n: 0 };
      subjTotals[r.subject].sum += r.pct; subjTotals[r.subject].n++;
    }
    const bestSubject = Object.entries(subjTotals)
      .sort((a, b) => (b[1].sum / b[1].n) - (a[1].sum / a[1].n))[0]?.[0] || null;

    return { id: s.id, name: s.name, gamesPlayed, avgPct, lastAt, bestSubject, results };
  });

  res.json({ roster: { id: r.id, name: r.name }, students });
});

// Teacher: printable QR card sheet for a game's attached roster.
app.get('/api/game/:id/qr-sheet', requireAuth, async (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (g.teacherId !== req.userId) return res.status(403).json({ error: 'Not your game.' });
  if (!g.rosterId) return res.status(400).json({ error: 'This game has no roster attached.' });
  const r = roster.getRoster(req.userId, g.rosterId);
  if (!r) return res.status(404).json({ error: 'Roster not found.' });
  const qrcode = require('qrcode');
  const baseUrl = `${req.protocol}://${req.get('host')}/join`;
  const cards = await Promise.all(r.students.map(async s => {
    const url = `${baseUrl}?sid=${encodeURIComponent(s.id)}`;
    const svg = await qrcode.toString(url, { type: 'svg', margin: 1, width: 150 });
    return `<div class="card"><div class="qr">${svg}</div><div class="sid">${esc(s.id)}</div><div class="sname">${esc(s.name)}</div></div>`;
  }));
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>QR Cards — ${esc(g.lessonTitle)}</title>
<style>body{font-family:sans-serif;margin:0;padding:20px;background:#fff}
.header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #333}
.header h1{margin:0;font-size:22px}.header .code{font-size:36px;font-weight:900;letter-spacing:4px;color:#1a56a0;background:#e8f0fb;display:inline-block;padding:8px 20px;border-radius:8px;margin-top:8px}
.grid{display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-start}
.card{border:1px dashed #999;border-radius:8px;padding:10px;text-align:center;width:170px;break-inside:avoid}
.card .qr svg{width:140px;height:140px}.card .sid{font-size:11px;color:#666;margin:4px 0 2px;font-family:monospace}
.card .sname{font-size:13px;font-weight:600}
@media print{.no-print{display:none}body{padding:0}.header{margin-bottom:12px}}</style></head>
<body><div class="header no-print"><h1>${esc(g.lessonTitle)} — Student QR Cards</h1>
<p style="margin:4px 0">Lesson Room Code: <span class="code">${esc(g.roomCode || '')}</span></p>
<p style="color:#666;font-size:13px">Cut out each card and hand it to the matching student. They scan it to join any game — the Room Code is entered separately.</p>
<button onclick="window.print()" style="margin-top:10px;padding:8px 18px;font-size:14px;cursor:pointer">Print</button></div>
<div class="header" style="display:none" class="print-only"><h1>${esc(g.lessonTitle)}</h1><div class="code">${esc(g.roomCode || '')}</div></div>
<div class="grid">${cards.join('')}</div></body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Student join page (Room Code entry).
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public', 'join.html')));

// Student "my work" page (Student ID lookup — no login).
app.get('/my-work', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-work.html')));

// The ONE link to hand students: Student ID -> PIN setup/verify -> browse
// past work + join new games/assignments by Room Code, all on one page.
app.get('/start', (req, res) => res.sendFile(path.join(__dirname, 'public', 'start.html')));

// Practical digital-skills player and teacher evidence view. The HTML lives
// outside public/ so the feature flag cannot be bypassed with a direct file URL.
app.get('/student/practice', requirePracticeEnabled, (req, res) => res.sendFile(path.join(__dirname, 'practice.html')));
app.get('/student/practice/guest', requirePracticeEnabled, (req, res) => res.sendFile(path.join(__dirname, 'practice.html')));
app.get('/practice/preview', requirePracticeEnabled, requireAuth, (req, res) => {
  if (req.user && req.user.role === 'student') return res.status(403).send('Teacher account required.');
  res.sendFile(path.join(__dirname, 'practice.html'));
});
app.get('/practice', requirePracticeEnabled, (req, res) => res.sendFile(path.join(__dirname, 'practice-teacher.html')));

// Student play page (the shareable link target).
app.get('/play/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/fishquest-play/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'fishquest.html')));
app.get('/fishquest/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'fishquest-teacher.html')));
app.get('/colonyquest/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'colonyquest.html')));

// Student assignment page (worksheet/exit-ticket/quiz online submission).
app.get('/assignment/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assignment.html')));

// ── Pagination helper ──────────────────────────────────────────────────────────────
function parsePagination(query) {
  const page  = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

// ── Admin API Key Management ────────────────────────────────────────────────────────
// Only the admin can create / list / revoke API keys used by external apps.
app.post('/api/admin/apikeys', requireAdmin, (req, res) => {
  const label = String(req.body?.label || 'Admin API Key').slice(0, 50);
  try {
    const { key, hash, createdAt } = apikeys.createAdminKey(label);
    res.json({ key, hash, createdAt, label });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/admin/apikeys', requireAdmin, (req, res) => {
  const keys = apikeys.listAdminKeys();
  res.json({ keys: keys.map(k => ({ hash: k.hash, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })) });
});

app.delete('/api/admin/apikeys/:hash', requireAdmin, (req, res) => {
  apikeys.deleteAdminKey(req.params.hash);
  res.json({ ok: true });
});

// ── OAuth 2.0 endpoints ─────────────────────────────────────────────────────────────

// Serve the consent page (static HTML; client JS reads query params and calls /oauth/client-info).
app.get('/oauth/authorize', (req, res) => res.sendFile(path.join(__dirname, 'public', 'oauth-consent.html')));

// Client info: validate params and return safe display data for the consent page.
app.get('/oauth/client-info', (req, res) => {
  const { client_id, redirect_uri, scope } = req.query;
  const client = client_id && oauth.getClient(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id.' });
  if (!redirect_uri || !client.redirectUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'redirect_uri not registered for this client.' });
  }
  const requestedScopes = String(scope || '').split(/\s+/).filter(Boolean);
  const invalid = requestedScopes.filter(s => !client.allowedScopes.includes(s));
  if (invalid.length) return res.status(400).json({ error: `Scope not permitted: ${invalid.join(', ')}` });
  const scopes = requestedScopes.length ? requestedScopes : client.allowedScopes;
  audit.log('auth.consent_shown', { clientId: client.clientId, ip: req.ip });
  res.json({ clientName: client.name, scopes });
});

// Approve or deny: requires a live teacher session (lc_token cookie).
app.post('/oauth/authorize', requireAuth, (req, res) => {
  const { client_id, redirect_uri, scope, state, action } = req.body || {};
  const client = client_id && oauth.getClient(client_id);
  if (!client) return res.status(400).json({ error: 'Unknown client_id.' });
  if (!redirect_uri || !client.redirectUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'redirect_uri not registered.' });
  }

  if (action === 'deny') {
    audit.log('auth.denied', { clientId: client.clientId, teacherId: req.userId, ip: req.ip });
    const url = new URL(redirect_uri);
    url.searchParams.set('error', 'access_denied');
    if (state) url.searchParams.set('state', state);
    return res.json({ redirectTo: url.toString() });
  }

  if (action !== 'approve') return res.status(400).json({ error: 'action must be approve or deny.' });
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teacher account required.' });

  const requestedScopes = String(scope || '').split(/\s+/).filter(s => client.allowedScopes.includes(s));
  const finalScopes = requestedScopes.length ? requestedScopes : client.allowedScopes;

  const code = oauth.createAuthCode({ clientId: client.clientId, teacherId: req.userId, scopes: finalScopes, redirectUri: redirect_uri });
  audit.log('auth.code_issued', { clientId: client.clientId, teacherId: req.userId, ip: req.ip });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.json({ redirectTo: url.toString() });
});

// Token endpoint: exchange an authorization code for an access token.
app.post('/oauth/token', async (req, res) => {
  const { grant_type, code, redirect_uri, client_id, client_secret } = req.body || {};
  if (grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
  if (!client_id || !client_secret || !code || !redirect_uri) {
    return res.status(400).json({ error: 'missing_parameters' });
  }
  const client = oauth.getClient(client_id);
  if (!client) return res.status(401).json({ error: 'invalid_client' });
  const secretOk = await oauth.verifyClientSecret(client_id, client_secret);
  if (!secretOk) {
    audit.log('auth.bad_secret', { clientId: client_id, ip: req.ip });
    return res.status(401).json({ error: 'invalid_client' });
  }
  const entry = oauth.consumeAuthCode(code, client_id, redirect_uri);
  if (!entry) return res.status(400).json({ error: 'invalid_grant' });

  const tokenData = oauth.createAccessToken({ clientId: client_id, teacherId: entry.teacherId, scopes: entry.scopes });
  audit.log('token.issued', { clientId: client_id, teacherId: entry.teacherId, scopes: entry.scopes, ip: req.ip });
  res.json({ access_token: tokenData.accessToken, token_type: tokenData.tokenType, expires_in: tokenData.expiresIn, scope: tokenData.scope });
});

// Revoke endpoint: invalidate an access token.
app.post('/oauth/revoke', (req, res) => {
  const token = (req.body || {}).token;
  if (!token) return res.status(400).json({ error: 'token required' });
  const rec = oauth.verifyAccessToken(token);
  if (rec) {
    oauth.revokeAccessToken(token);
    audit.log('token.revoked', { clientId: rec.clientId, teacherId: rec.teacherId, ip: req.ip });
  }
  res.json({ ok: true }); // always 200 per OAuth spec
});

// Teacher: list + revoke their own OAuth connections.
app.get('/api/oauth/connections', requireAuth, (req, res) => {
  res.json({ connections: oauth.listConnectionsForTeacher(req.userId) });
});

app.delete('/api/oauth/connections/:clientId', requireAuth, (req, res) => {
  const n = oauth.revokeConnection(req.userId, req.params.clientId);
  audit.log('token.revoked_connection', { teacherId: req.userId, clientId: req.params.clientId, count: n });
  res.json({ ok: true, revoked: n });
});

// ── Admin: OAuth client management ──────────────────────────────────────────────────

app.post('/api/admin/oauth/clients', requireAdmin, async (req, res) => {
  const { name, redirectUris, allowedScopes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required.' });
  if (!Array.isArray(redirectUris) || !redirectUris.length) return res.status(400).json({ error: 'redirectUris must be a non-empty array.' });
  try {
    const result = await oauth.registerClient({ name, redirectUris, allowedScopes });
    audit.log('client.registered', { clientId: result.clientId, name, adminId: req.userId });
    res.json(result); // clientSecret shown once — never stored in plaintext
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/admin/oauth/clients', requireAdmin, (req, res) => {
  res.json({ clients: oauth.listClients() });
});

app.patch('/api/admin/oauth/clients/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'status must be active or suspended.' });
  const ok = oauth.setClientStatus(req.params.id, status);
  if (!ok) return res.status(404).json({ error: 'Client not found.' });
  audit.log('client.status_changed', { clientId: req.params.id, status, adminId: req.userId });
  res.json({ ok: true });
});

// ── Admin: Webhook management ────────────────────────────────────────────────────────

app.post('/api/admin/oauth/webhooks', requireAdmin, (req, res) => {
  const { clientId, url, secret, events } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId required.' });
  if (!oauth.getClient(clientId)) return res.status(404).json({ error: 'Client not found.' });
  try {
    const w = webhooks.setWebhook(clientId, { url, secret, events });
    res.json(w);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/admin/oauth/webhooks', requireAdmin, (req, res) => {
  res.json({ webhooks: webhooks.listWebhooks() });
});

app.delete('/api/admin/oauth/webhooks/:clientId', requireAdmin, (req, res) => {
  webhooks.deleteWebhook(req.params.clientId);
  res.json({ ok: true });
});

// Admin: recent audit log.
app.get('/api/admin/oauth/audit', requireAdmin, (req, res) => {
  res.json({ entries: audit.recent(200) });
});

// ── External API (v1) ───────────────────────────────────────────────────────────────
// Authenticated by either:
//   • OAuth Bearer token  (lc_at_…) — teacher-scoped, requires the matching scope
//   • Admin API key        (lc_…)    — all-data access; legacy / developer use only

function requireApiAccess(req, res, next) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(\S+)$/);
  if (!match) return res.status(401).json({ error: 'Missing Authorization: Bearer header.' });
  const bearer = match[1];

  if (bearer.startsWith('lc_at_')) {
    const token = oauth.verifyAccessToken(bearer);
    if (!token) return res.status(401).json({ error: 'OAuth token invalid, expired, or revoked.' });
    req.oauthToken   = token;
    req.oauthTeacherId = token.teacherId;
    req.oauthScopes  = token.scopes;
    setImmediate(() => audit.log('token.used', { clientId: token.clientId, teacherId: token.teacherId, path: req.path }));
    return next();
  }

  const result = apikeys.verifyKey(bearer);
  if (!result) return res.status(401).json({ error: 'Invalid Bearer token.' });
  req.apiIsAdmin = result.isAdmin;
  next();
}

function requireScope(scope) {
  return (req, res, next) => {
    if (req.apiIsAdmin) return next();
    if (!req.oauthScopes || !req.oauthScopes.includes(scope)) {
      return res.status(403).json({ error: `Token missing scope: ${scope}` });
    }
    next();
  };
}

// Teacher identity — OAuth only (admin keys have no single teacher identity).
app.get('/api/v1/me', requireApiAccess, requireScope('profile:read'), (req, res) => {
  if (!req.oauthTeacherId) return res.status(400).json({ error: 'Admin keys have no /me identity. Use an OAuth token.' });
  const user = getUserById(req.oauthTeacherId);
  if (!user) return res.status(404).json({ error: 'Teacher not found.' });
  res.json({ id: user.id, email: user.email, name: user.name });
});

// ── Shared credit wallet for TeacherScope ──────────────────────────────────
// The teacher is identified by the OAuth token; the wallet is keyed by their
// email so it's the same balance they see in LessonScope.
function oauthTeacherEmail(req) {
  const u = req.oauthTeacherId && getUserById(req.oauthTeacherId);
  return u ? u.email : null;
}
app.get('/api/v1/credits', requireApiAccess, requireScope('credits:read'), (req, res) => {
  const email = oauthTeacherEmail(req);
  if (!email) return res.status(400).json({ error: 'Use an OAuth token (admin keys have no teacher identity).' });
  credits.ensureFreeGrant(email);
  res.json({ balance: credits.getBalance(email), billingEnabled: process.env.BILLING_ENABLED === 'true' });
});
// TeacherScope deducts here when it generates for this teacher. When billing is
// off it succeeds without deducting, so TeacherScope needs no special-casing.
app.post('/api/v1/credits/consume', requireApiAccess, requireScope('credits:write'), (req, res) => {
  const email = oauthTeacherEmail(req);
  if (!email) return res.status(400).json({ error: 'Use an OAuth token (admin keys have no teacher identity).' });
  const amount = Math.max(1, Math.min(50, parseInt((req.body && req.body.amount), 10) || 1));
  const reason = (req.body && String(req.body.reason || 'teacherscope')).slice(0, 40);
  if (process.env.BILLING_ENABLED !== 'true') return res.json({ ok: true, charged: 0, balance: credits.getBalance(email), billingEnabled: false });
  credits.ensureFreeGrant(email);
  const result = credits.consume(email, amount, reason);
  if (!result.ok) return res.status(402).json({ ok: false, error: 'Insufficient credits.', balance: result.balance, needCredits: true });
  res.json({ ok: true, charged: amount, balance: result.balance, billingEnabled: true });
});

// Rosters: OAuth returns this teacher's only; admin key returns all.
app.get('/api/v1/rosters', requireApiAccess, requireScope('rosters:read'), (req, res) => {
  const updatedSince = req.query.updated_since || null;
  const teacherIds = req.oauthTeacherId ? [req.oauthTeacherId] : listAllUserIds();
  const all = [];
  for (const tid of teacherIds) {
    for (const r of roster.listRosters(tid)) {
      if (updatedSince && r.createdAt < updatedSince) continue;
      all.push({ id: r.id, teacherId: tid, name: r.name, studentCount: r.count, createdAt: r.createdAt, updatedAt: r.createdAt });
    }
  }
  res.json({ rosters: all });
});

// Students in a specific roster — teacher-isolated.
app.get('/api/v1/roster/:id/students', requireApiAccess, requireScope('rosters:read'), (req, res) => {
  let found = null, foundTeacherId = null;
  const teacherIds = req.oauthTeacherId ? [req.oauthTeacherId] : listAllUserIds();
  for (const tid of teacherIds) {
    const r = roster.getRoster(tid, req.params.id);
    if (r) { found = r; foundTeacherId = tid; break; }
  }
  if (!found) return res.status(404).json({ error: 'Roster not found.' });
  res.json({
    roster: { id: found.id, name: found.name, teacherId: foundTeacherId, createdAt: found.createdAt },
    students: found.students.map(s => ({ id: s.id, name: s.name })),
  });
});

// Student progress for a roster — teacher-isolated.
app.get('/api/v1/roster/:id/progress', requireApiAccess, requireScope('results:read'), (req, res) => {
  let foundRoster = null, foundTeacherId = null;
  const teacherIds = req.oauthTeacherId ? [req.oauthTeacherId] : listAllUserIds();
  for (const tid of teacherIds) {
    const r = roster.getRoster(tid, req.params.id);
    if (r) { foundRoster = r; foundTeacherId = tid; break; }
  }
  if (!foundRoster) return res.status(404).json({ error: 'Roster not found.' });

  const inRoster = id => foundRoster.students.find(s => roster.normalizeStudentId(s.id) === roster.normalizeStudentId(id));
  const byStudent = new Map();
  const push = (studentId, row) => {
    const sid = roster.normalizeStudentId(studentId);
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    byStudent.get(sid).push(row);
  };
  for (const g of games.listTeacherGames(foundTeacherId)) {
    for (const result of games.getResults(g.id)) {
      if (!inRoster(result.studentId)) continue;
      push(result.studentId, { kind: 'game', gameId: g.id, topic: g.topic, subject: g.subject,
        score: result.score, total: result.total,
        percentage: result.total > 0 ? Math.round((result.score / result.total) * 100) : 0,
        at: result.at, updatedAt: result.at });
    }
  }
  for (const a of gradebook.assignmentResultRows(foundTeacherId)) {
    if (!inRoster(a.studentId)) continue;
    push(a.studentId, { kind: 'assignment', type: a.type, assignmentId: a.assignmentId, topic: a.topic, subject: a.subject,
      score: a.score, total: a.total, percentage: a.percentage, at: a.at, updatedAt: a.at });
  }

  const students = foundRoster.students.map(s => {
    const results = (byStudent.get(roster.normalizeStudentId(s.id)) || []).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    const avgPct = results.length ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / results.length) : null;
    const updatedAt = results.length ? results[0].at : foundRoster.createdAt;
    return { id: s.id, name: s.name,
      assessmentsCompleted: results.length,
      gamesPlayed: results.filter(r => r.kind === 'game').length,
      assignmentsCompleted: results.filter(r => r.kind === 'assignment').length,
      averagePercentage: avgPct, updatedAt, results };
  });

  res.json({
    roster: { id: foundRoster.id, name: foundRoster.name, teacherId: foundTeacherId, createdAt: foundRoster.createdAt },
    students,
  });
});

// All activities (games) that used a specific roster.
app.get('/api/v1/roster/:id/activities', requireApiAccess, requireScope('results:read'), (req, res) => {
  let foundRoster = null, foundTeacherId = null;
  const teacherIds = req.oauthTeacherId ? [req.oauthTeacherId] : listAllUserIds();
  for (const tid of teacherIds) {
    const r = roster.getRoster(tid, req.params.id);
    if (r) { foundRoster = r; foundTeacherId = tid; break; }
  }
  if (!foundRoster) return res.status(404).json({ error: 'Roster not found.' });

  const gameActivities = games.listTeacherGames(foundTeacherId)
    .filter(g => g.rosterId === foundRoster.id)
    .map(g => ({ kind: 'game', id: g.id, title: g.lessonTitle, subject: g.subject, topic: g.topic, grade: g.grade, questionCount: (g.questions || []).length, createdAt: g.createdAt, roomCode: g.roomCode }));
  const assignmentActivities = assignments.listTeacherAssignments(foundTeacherId)
    .filter(a => a.rosterId === foundRoster.id)
    .map(a => ({ kind: 'assignment', type: a.type, id: a.id, title: a.title, subject: a.subject, topic: a.topic, grade: a.grade, submissions: a.submissions, createdAt: a.createdAt, roomCode: a.roomCode }));
  const activities = [...gameActivities, ...assignmentActivities].sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));

  res.json({ roster: { id: foundRoster.id, name: foundRoster.name }, activities });
});

// Per-student performance summary across games + assignments — purpose-built
// for TeacherScope's report-comment generation: overall average plus per-
// subject strengths and weaknesses. OAuth scopes it to the token's teacher;
// admin keys summarize across all teachers.
app.get('/api/v1/student/:studentId/summary', requireApiAccess, requireScope('results:read'), (req, res) => {
  const teacherIds = req.oauthTeacherId ? [req.oauthTeacherId] : listAllUserIds();
  const studentId = roster.normalizeStudentId(req.params.studentId);
  const { name, rows } = gradebook.gatherStudentResults(teacherIds, studentId);
  if (!rows.length && !name) return res.status(404).json({ error: 'No data for that student.' });
  const summary = gradebook.summarizeStudent(rows);
  res.json({
    student: { id: studentId, name: name || null },
    overall: summary.overall,
    bySubject: summary.bySubject,
    recent: rows.slice(0, 10),
  });
});

// Incremental results sync with pagination — all game results for this teacher.
// ?updated_since=<ISO>  &page=1  &limit=50
app.get('/api/v1/results', requireApiAccess, requireScope('results:read'), (req, res) => {
  const updatedSince = req.query.updated_since || null;
  const { page, limit, offset } = parsePagination(req.query);
  const teacherIds = req.oauthTeacherId ? [req.oauthTeacherId] : listAllUserIds();

  const all = [];
  for (const tid of teacherIds) {
    for (const g of games.listTeacherGames(tid)) {
      for (const r of games.getResults(g.id)) {
        if (updatedSince && r.at < updatedSince) continue;
        all.push({
          id: `${g.id}_${r.studentId}_${r.at}`,
          kind: 'game', gameId: g.id, rosterId: g.rosterId || null,
          studentId: r.studentId,
          subject: g.subject, topic: g.topic,
          score: r.score, total: r.total,
          percentage: r.total > 0 ? Math.round((r.score / r.total) * 100) : 0,
          at: r.at, updatedAt: r.at,
        });
      }
    }
    // Assignments (worksheets / exit tickets / quizzes) carry marks too — fold
    // them into the same results feed so TeacherScope sees the full picture.
    for (const a of gradebook.assignmentResultRows(tid)) {
      if (updatedSince && a.at < updatedSince) continue;
      all.push({ id: `${a.assignmentId}_${a.studentId}_${a.at}`, updatedAt: a.at, ...a });
    }
  }

  all.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const total = all.length;
  res.json({
    results: all.slice(offset, offset + limit),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// Legacy: all students across all teachers (admin key only — existing behaviour).
app.get('/api/v1/students', requireApiAccess, requireScope('rosters:read'), (req, res) => {
  const filterRosterId = req.query.rosterId || null;
  const teacherIds = req.oauthTeacherId ? [req.oauthTeacherId] : listAllUserIds();
  const out = [];

  for (const tid of teacherIds) {
    const rosters = filterRosterId
      ? [roster.getRoster(tid, filterRosterId)].filter(Boolean)
      : roster.listRosters(tid).map(r => roster.getRoster(tid, r.id)).filter(Boolean);
    if (!rosters.length) continue;

    const byStudent = new Map();
    const push = (studentId, row) => {
      const sid = roster.normalizeStudentId(studentId);
      if (!byStudent.has(sid)) byStudent.set(sid, []);
      byStudent.get(sid).push(row);
    };
    for (const g of games.listTeacherGames(tid)) {
      for (const result of games.getResults(g.id)) {
        push(result.studentId, { kind: 'game', topic: g.topic, subject: g.subject,
          score: result.score, total: result.total,
          percentage: result.total > 0 ? Math.round((result.score / result.total) * 100) : 0, at: result.at });
      }
    }
    for (const a of gradebook.assignmentResultRows(tid)) {
      push(a.studentId, { kind: 'assignment', type: a.type, topic: a.topic, subject: a.subject,
        score: a.score, total: a.total, percentage: a.percentage, at: a.at });
    }

    for (const r of rosters) {
      for (const s of r.students) {
        out.push({ id: s.id, name: s.name, rosterId: r.id, rosterName: r.name, teacherId: tid, results: byStudent.get(roster.normalizeStudentId(s.id)) || [] });
      }
    }
  }

  res.json({ students: out });
});

app.use((err, req, res, next) => {
  if (!(err instanceof multer.MulterError)) {
    observability.recordFailure('other', { requestId: req.requestId, operation: 'unhandled_request', error: err.message || err.name || 'Unknown error' });
    return res.status(500).json({ error: 'Something went wrong. Try again.', requestId: req.requestId });
  }
  const tooLarge = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT';
  observability.recordFailure('upload', { requestId: req.requestId, operation: 'multer', error: err.code });
  res.status(tooLarge ? 413 : 400).json({
    error: tooLarge ? 'The upload is too large. Use fewer or smaller files.' : 'The upload could not be accepted.',
    uploadError: err.code,
  });
});

const httpServer = app.listen(PORT, () => console.log(`LessonCope running at http://localhost:${PORT}`));
fishQuestLive.attach(httpServer);
