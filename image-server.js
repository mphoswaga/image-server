require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const { buildDeck, rebuildDeck, alternativeImage, findReusableImage, searchLibrary, getLibraryImage, listLibrary, addLibraryImages, libraryStats } = require('./generate');
const quota = require('./quota');
const { generateOneSlide } = require('./content');
const { extractText, saveTemplate, listTemplates, getTemplate, renameTemplate, deleteTemplate, loadOriginalById, loadTemplate, loadOriginal, TYPES } = require('./template');
const { generateLessonPlan, planToText } = require('./lesson-plan');
const { fillDocx, fillXlsx } = require('./fill-template');
const { animateBuffer } = require('./animate-pptx');
const { addImages } = require('./admin-images');
const { generateImage } = require('./ai-image');
const { parseFraction, detectLabelledDiagram } = require('./concept-diagram');
const { generateDiagram } = require('./svg-diagram');
const { generateWorksheet, generateExitTicket, generateGame } = require('./lesson-pack');
const { worksheetDocx, exitTicketDocx } = require('./docgen');
const games = require('./games');
const roster = require('./roster');
const apikeys = require('./apikeys');

// Add transitions/animations; never let it break the download.
function safeAnimate(buffer, band) {
  try { return animateBuffer(buffer, band); }
  catch (err) { console.log('animation skipped:', err.message); return buffer; }
}
const { signup, login, issueToken, verifyToken, getUserById, listAllUserIds, requireAuth, requireAdmin, COOKIE_NAME } = require('./auth');
const { runWithUser } = require('./ai-client');
const usage = require('./usage');
const jwt = require('jsonwebtoken');

const GAME_COOKIE = 'lc_game';
const JWT_SECRET = (() => {
  try { return require('fs').readFileSync(require('path').join(require('./storage').DATA_DIR, '.session-secret'), 'utf8').trim(); } catch { return process.env.JWT_SECRET || 'dev-secret'; }
})();

// Issue a short-lived student game session (8 h).
function issueGameToken(payload) {
  return jwt.sign({ type: 'game', ...payload }, JWT_SECRET, { expiresIn: '8h' });
}

// Accepts either lc_game (student) or lc_token (teacher).
// Student path: sets req.gameSession = { studentId, gameId, name }.
// Teacher path: sets req.userId (existing behaviour).
function requireGameAccess(req, res, next) {
  const gameTok = req.cookies && req.cookies[GAME_COOKIE];
  if (gameTok) {
    try {
      const p = jwt.verify(gameTok, JWT_SECRET);
      if (p.type === 'game') { req.gameSession = { studentId: p.studentId, gameId: p.gameId, name: p.name }; return next(); }
    } catch {}
  }
  // Fall back to teacher token.
  const tok = req.cookies && req.cookies[COOKIE_NAME];
  if (tok) {
    try {
      const p = verifyToken(tok);
      if (p) { req.userId = p; req.user = getUserById(p) || {}; return next(); }
    } catch {}
  }
  res.status(401).json({ error: 'Not authenticated.' });
}

const app = express();
const PORT = process.env.PORT || 4000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Attribute every AI call in this request to the signed-in user (for cost
// tracking). Reads the auth cookie once; AsyncLocalStorage carries it through
// all the awaited generator calls. Unauthenticated requests → no owner.
app.use((req, res, next) => {
  let uid = null;
  try { const tok = req.cookies && req.cookies[COOKIE_NAME]; uid = (tok && verifyToken(tok)) || null; } catch {}
  runWithUser(uid, () => next());
});

app.use(express.static(path.join(__dirname, 'public')));

// Health check for the host (Railway): confirms the process booted and the
// port is bound. Must not depend on any API keys or external services.
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Auth ──────────────────────────────────────────────────────────────────
const setSession = (res, userId) => res.cookie(COOKIE_NAME, issueToken(userId), {
  httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000,
});

app.post('/api/signup', async (req, res) => {
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
  const { email, password } = req.body || {};
  const user = await login(email, password);
  if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });
  setSession(res, user.id);
  res.json({ user });
});

app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE_NAME); res.json({ ok: true }); });

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

// In-memory deck state so the editable preview can mutate before download.
const decks = new Map(); // id -> { subject, topic, grade, tone, focus, slides, images, createdAt }
const DECK_TTL = 60 * 60 * 1000; // 1 hour

function purgeOldDecks() {
  const now = Date.now();
  for (const [id, d] of decks) if (now - d.createdAt > DECK_TTL) decks.delete(id);
}

// Build a preview entry the frontend can render + edit.
function previewEntry(slide, image) {
  return {
    type: slide.type,
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
    differentiation: slide.differentiation || null,
    shortcuts: (Array.isArray(slide.shortcuts) && slide.shortcuts.length) ? slide.shortcuts : null,
    worked: (slide.worked && slide.worked.task && Array.isArray(slide.worked.steps) && slide.worked.steps.length) ? slide.worked : null,
    labelled: detectLabelledDiagram(`${slide.title || ''} ${slide.imageQuery || ''} ${slide.example || ''}`),
  };
}

app.get('/api/library', (req, res) => res.json(listLibrary()));

// ── Admin: grow the image library ─────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => res.json(libraryStats()));

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

app.post('/api/admin/add-images', requireAdmin, async (req, res) => {
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
const publicTemplate = t => ({ id: t.id, name: t.name, type: t.type, filename: t.filename, ext: t.ext, uploadedAt: t.uploadedAt, hasOriginal: !!t.hasOriginal });

app.get('/api/templates', requireAuth, (req, res) => {
  res.json({ templates: listTemplates(req.userId).map(publicTemplate), types: TYPES });
});

app.post('/api/templates', requireAuth, upload.single('file'), async (req, res) => {
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
    if (!text || !text.trim()) return res.status(400).json({ error: 'Could not read any text from that file.' });
    const rec = saveTemplate(req.userId, { name: req.body && req.body.name, type: req.body && req.body.type, filename, text, buffer });
    res.json({ template: publicTemplate(rec) });
  } catch (err) {
    console.error('Template upload failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/templates/:id', requireAuth, (req, res) => {
  const rec = renameTemplate(req.userId, req.params.id, { name: req.body && req.body.name, type: req.body && req.body.type });
  if (!rec) return res.status(404).json({ error: 'Template not found.' });
  res.json({ template: publicTemplate(rec) });
});

app.delete('/api/templates/:id', requireAuth, (req, res) => {
  const ok = deleteTemplate(req.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Template not found.' });
  res.json({ ok: true });
});

// Download the lesson plan filled into the ORIGINAL template (exact layout).
app.post('/api/lesson-plan/download', requireAuth, (req, res) => {
  const sections = (req.body && req.body.sections) || [];
  const templateId = req.body && req.body.templateId;
  if (!sections.length) return res.status(400).json({ error: 'No lesson plan to download.' });
  const orig = templateId ? loadOriginalById(req.userId, templateId) : loadOriginal(req.userId);
  if (!orig) {
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
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('X-Sections-Filled', `${out.filled}/${out.total}`);
    res.send(out.buffer);
  } catch (err) {
    console.error('Lesson plan download failed:', err.message);
    res.status(400).json({ error: 'Could not fill the template: ' + err.message });
  }
});

// Hard truncation limits — enforce here as a server-side backstop so malformed
// or oversized requests can't inflate token budgets even if the UI is bypassed.
const LIMITS = { subject: 60, topic: 80, objectives: 1500, focus: 400 };
function clip(val, max) { return String(val || '').slice(0, max); }

// ── Lesson plan generation (objectives + stored template → plan) ──────────
app.post('/api/lesson-plan', requireAuth, async (req, res) => {
  const { grade, tone, templateId, regenerate } = req.body || {};
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  const objectives = clip(req.body.objectives, LIMITS.objectives);
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  if (!objectives.trim()) return res.status(400).json({ error: 'Please paste the lesson objectives.' });
  try {
    const tpl = (templateId && getTemplate(req.userId, templateId)) || loadTemplate(req.userId);
    const plan = await generateLessonPlan({
      subject: subject.toLowerCase(), topic: topic.toLowerCase(),
      grade, tone, objectives, templateText: tpl ? tpl.text : '', regenerate: !!regenerate,
    });
    res.json({ sections: plan.sections, usedTemplate: !!tpl, templateName: tpl ? tpl.name : null, templateId: tpl ? tpl.id : null });
  } catch (err) {
    console.error('Lesson plan failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Lesson pack (worksheet, exit ticket) from the approved plan ────────────
const PACK_GEN = { worksheet: generateWorksheet, 'exit-ticket': generateExitTicket };
const PACK_RENDER = { worksheet: worksheetDocx, 'exit-ticket': exitTicketDocx };

app.post('/api/pack/:type', requireAuth, async (req, res) => {
  const gen = PACK_GEN[req.params.type];
  if (!gen) return res.status(404).json({ error: 'Unknown lesson-pack item.' });
  const { grade, tone, lessonPlan, regenerate } = req.body || {};
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  const objectives = clip(req.body.objectives, LIMITS.objectives);
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  try {
    const lessonPlanText = lessonPlan && lessonPlan.sections ? planToText(lessonPlan) : '';
    const data = await gen({ subject: subject.toLowerCase(), topic: topic.toLowerCase(), grade, tone, objectives, lessonPlanText, regenerate: !!regenerate });
    res.json({ type: req.params.type, data });
  } catch (err) {
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

// Generate a deck; store state; return preview metadata + download id.
app.post('/api/generate', requireAuth, async (req, res) => {
  const { slideCount, grade, tone, lessonPlan, regenerate } = req.body || {};
  const subject = clip(req.body.subject, LIMITS.subject);
  const topic = clip(req.body.topic, LIMITS.topic);
  const objectives = clip(req.body.objectives, LIMITS.objectives);
  const focus = clip(req.body.focus, LIMITS.focus);
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  try {
    purgeOldDecks();
    // If an accepted lesson plan was passed, the slides follow it.
    const lessonPlanText = lessonPlan && lessonPlan.sections ? planToText(lessonPlan) : '';
    const built = await buildDeck({ subject, topic, slideCount, grade, tone, focus, objectives, lessonPlanText, extras: { regenerate: !!regenerate } });
    const id = crypto.randomUUID();
    decks.set(id, {
      subject: String(subject).toLowerCase(), topic: String(topic).toLowerCase(),
      grade: grade || 'middle school', tone, focus, band: built.band,
      slides: built.slides, images: built.images, createdAt: Date.now(),
      objectives: objectives || '', lessonPlanText, // kept so the student game can be grounded in this lesson
    });
    const filename = `${subject}-${topic}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');
    res.json({
      deckId: id, filename, band: built.band, slideCount: built.slides.length,
      slides: built.slides.map((s, i) => previewEntry(s, built.images[i])),
    });
  } catch (err) {
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

// Remaining AI-visual budget for this month (for the UI to show + gate buttons).
app.get('/api/quota', requireAuth, (req, res) => res.json(quota.status(req.userId, req.user.role === 'admin')));

// Stock-first image search: look through the curated library.
app.get('/api/images/search', requireAuth, (req, res) => {
  const { q, subject, topic } = req.query || {};
  res.json({ images: searchLibrary({ q, subject, topic, limit: 24 }) });
});

// Fallback: fetch fresh images from Unsplash for a query (free; captioned +
// added to the library so they're reusable). Not an AI visual — not capped.
app.post('/api/images/fetch', requireAuth, async (req, res) => {
  const { q, subject, topic } = req.body || {};
  if (!q || !String(q).trim()) return res.status(400).json({ error: 'Type what you are looking for.' });
  try {
    const added = await addImages({ subject: subject || 'search', topic: topic || 'general', count: 8, query: String(q).trim() });
    if (added.length) addLibraryImages(added);
    res.json({ images: added.map(e => ({ relpath: e.relpath, image: '/' + e.relpath, caption: e.caption || '', source: e.source || 'unsplash' })) });
  } catch (err) {
    console.error('Image fetch failed:', err.message);
    res.status(400).json({ error: err.message });
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
  try {
    // Reuse a previously AI-generated image for this concept instead of paying
    // to regenerate it (unless it's the one already on this slide).
    const reuse = findReusableImage({
      subject: deck.subject, topic: deck.topic, query: concept,
      minScore: 3, source: 'ai-generated',
      exclude: [deck.images[i] && deck.images[i].relpath].filter(Boolean),
    });
    if (reuse) {
      deck.images[i] = reuse;
      return res.json({ image: '/' + reuse.relpath, imageSource: 'ai-generated', reused: true });
    }
    // Paid generation — enforce the monthly AI-visual cap (admins exempt).
    const isAdmin = req.user.role === 'admin';
    const q = quota.status(req.userId, isAdmin);
    if (!q.unlimited && q.remaining <= 0) {
      return res.status(403).json({ error: `You've used all ${q.limit} AI visuals this month — search the stock library instead, or they reset next month.`, limitReached: true, remaining: 0, limit: q.limit });
    }
    const entry = await generateImage({ subject: deck.subject, topic: deck.topic, concept, grade: deck.grade });
    addLibraryImages([entry]);   // cache for reuse + matching
    deck.images[i] = entry;
    quota.consume(req.userId);
    const after = quota.status(req.userId, isAdmin);
    res.json({ image: '/' + entry.relpath, imageSource: 'ai-generated', reused: false, remaining: after.remaining, limit: after.limit });
  } catch (err) {
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
  try {
    // Curated diagram available for this topic? Render the animated vector one.
    const curated = detectLabelledDiagram(`${slide.title} ${slide.imageQuery || ''} ${slide.example || ''}`);
    if (curated) {
      slide.visual = { type: 'none', items: [] }; // let the title-based curated detection drive it
      return res.json({ labelled: curated });
    }
    const concept = `${slide.title}${slide.imageQuery ? ' — ' + slide.imageQuery : ''}`.trim();
    const reuse = findReusableImage({ subject: deck.subject, topic: deck.topic, query: concept, minScore: 3, source: 'svg-diagram', exclude: deck.images.map(im => im.relpath) });
    let entry = reuse, remaining, limit;
    if (!entry) {
      // Generating a new diagram is a paid AI visual — enforce the cap.
      const isAdmin = req.user.role === 'admin';
      const q = quota.status(req.userId, isAdmin);
      if (!q.unlimited && q.remaining <= 0) {
        return res.status(403).json({ error: `You've used all ${q.limit} AI visuals this month — search the stock library instead, or they reset next month.`, limitReached: true, remaining: 0, limit: q.limit });
      }
      entry = await generateDiagram({ subject: deck.subject, topic: deck.topic, concept });
      addLibraryImages([entry]);
      quota.consume(req.userId);
      const after = quota.status(req.userId, isAdmin);
      remaining = after.remaining; limit = after.limit;
    }
    slide.visual = { type: 'diagram', items: [concept] };
    deck.images[i] = entry;
    res.json({ image: '/' + entry.relpath, imageSource: 'svg-diagram', remaining, limit });
  } catch (err) {
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

  try {
    const avoidTitles = deck.slides.filter((s, j) => s.type === 'content' && j !== i).map(s => s.title);
    const fresh = await generateOneSlide({ subject: deck.subject, topic: deck.topic, grade: deck.grade, tone: deck.tone, focus: deck.focus, avoidTitles });
    fresh.side = deck.slides[i].side; // keep the image side for layout rhythm
    deck.slides[i] = fresh;
    const alt = alternativeImage({ subject: deck.subject, topic: deck.topic, imageQuery: fresh.imageQuery, exclude: deck.images.map(im => im.relpath) });
    if (alt) deck.images[i] = alt;
    res.json({ slide: previewEntry(deck.slides[i], deck.images[i]) });
  } catch (err) {
    console.error('Regenerate failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Download — merges any text edits from the client, rebuilds, streams the file.
app.post('/api/download/:id', requireAuth, async (req, res) => {
  const deck = decks.get(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found or expired — generate it again.' });
  try {
    for (const edit of (req.body.edits || [])) {
      const s = deck.slides[edit.index];
      if (!s) continue;
      if (typeof edit.title === 'string') s.title = edit.title;
      if (Array.isArray(edit.bullets)) s.bullets = edit.bullets.filter(b => b.trim());
      if (typeof edit.example === 'string') s.example = edit.example;
      if (typeof edit.subtitle === 'string') s.subtitle = edit.subtitle;
    }
    const pptx = rebuildDeck({ slides: deck.slides, images: deck.images, grade: deck.grade });
    const buffer = safeAnimate(await pptx.write({ outputType: 'nodebuffer' }), deck.band);
    const filename = `${deck.subject}-${deck.topic}.pptx`.replace(/[^a-z0-9.\-]/gi, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Download/rebuild failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── Student game: create from a deck, play, store results ──────────────────
// Teacher: turn the current deck into a shareable, persistent student game.
app.post('/api/game', requireAuth, async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teachers only.' });
  const deck = decks.get(req.body && req.body.deckId);
  if (!deck) return res.status(404).json({ error: 'Deck expired — regenerate the deck, then create the game.' });
  const questionCount = Math.min(20, Math.max(4, parseInt(req.body && req.body.questionCount, 10) || 6));
  try {
    const game = await generateGame({ subject: deck.subject, topic: deck.topic, grade: deck.grade, tone: deck.tone, objectives: deck.objectives || '', lessonPlanText: deck.lessonPlanText || '', questionCount });
    const lessonTitle = (deck.slides.find(s => s.type === 'title') || {}).title || deck.topic;
    const rosterId = (req.body && req.body.rosterId) || null;
    const rec = games.createGame({ teacherId: req.userId, teacherName: req.user.name, lessonTitle, subject: deck.subject, topic: deck.topic, grade: deck.grade, game, rosterId });
    res.json({ gameId: rec.id, path: `/play/${rec.id}`, questionCount: rec.questions.length, roomCode: rec.roomCode });
  } catch (err) {
    console.error('Game creation failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Create a game from the teacher's own uploaded PowerPoint (no deck generation needed).
app.post('/api/game/from-pptx', requireAuth, upload.single('file'), async (req, res) => {
  if (req.user.role === 'student') return res.status(403).json({ error: 'Teachers only.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const subject = String(req.body && req.body.subject || '').trim().toLowerCase();
  const topic   = String(req.body && req.body.topic   || '').trim().toLowerCase();
  const grade   = String(req.body && req.body.grade   || 'Grade 5').trim();
  if (!subject || !topic) return res.status(400).json({ error: 'Subject and topic are required.' });
  const questionCount = Math.min(20, Math.max(4, parseInt(req.body && req.body.questionCount, 10) || 6));
  const rosterId = (req.body && req.body.rosterId) || null;
  try {
    const lessonPlanText = await extractText(req.file.buffer, req.file.originalname);
    const game = await generateGame({ subject, topic, grade, objectives: '', lessonPlanText, questionCount });
    const rec = games.createGame({ teacherId: req.userId, teacherName: req.user.name, lessonTitle: topic, subject, topic, grade, game, rosterId });
    res.json({ gameId: rec.id, path: `/play/${rec.id}`, questionCount: rec.questions.length, roomCode: rec.roomCode });
  } catch (err) {
    console.error('Game from pptx failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Student: enter a game with their Student ID — issues a short-lived game session.
// If the game has an attached roster, the studentId is verified against it.
// If no roster, any non-empty string is accepted as a free-form name.
app.post('/api/game/:id/enter', async (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  const studentId = String(req.body && req.body.studentId || '').trim();
  if (!studentId) return res.status(400).json({ error: 'Enter your Student ID.' });
  let displayName = studentId;
  if (g.rosterId) {
    const teacher = getUserById(g.teacherId);
    const s = teacher ? roster.findStudentInRoster(g.teacherId, g.rosterId, studentId) : null;
    if (!s) return res.status(403).json({ error: 'Student ID not found. Check with your teacher.' });
    displayName = s.name;
  }
  const token = issueGameToken({ gameId: g.id, studentId, name: displayName });
  res.cookie(GAME_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 });
  res.json({ name: displayName });
});

// Public: resolve a Room Code to a game ID (for the /join page).
app.get('/api/join', (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Enter a Room Code.' });
  const gameId = games.getRoomCode(code);
  if (!gameId) return res.status(404).json({ error: 'Room not found. Check the code and try again.' });
  res.json({ gameId });
});

// Student: lesson summary + meta (NO correct answers).
app.get('/api/game/:id', requireGameAccess, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  // Students must hold a session for THIS game.
  if (req.gameSession && req.gameSession.gameId !== g.id) return res.status(403).json({ error: 'Session is for a different game.' });
  const hasRoster = !!g.rosterId;
  res.json({ id: g.id, lessonTitle: g.lessonTitle, subject: g.subject, topic: g.topic, grade: g.grade, summary: g.summary, questionCount: (g.questions || []).length, teacherName: g.teacherName, hasRoster });
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
  games.recordResult(g.id, { studentId, name, score, total: g.questions.length, answers });
  res.json({ score, total: g.questions.length });
});

// Teacher: results for one of their games (owner only).
// If the game has a roster, join real names from it.
app.get('/api/game/:id/results', requireAuth, (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found.' });
  if (g.teacherId !== req.userId) return res.status(403).json({ error: 'Not your game.' });
  const rosterData = g.rosterId ? roster.getRoster(req.userId, g.rosterId) : null;
  const rosterMap = rosterData ? Object.fromEntries(rosterData.students.map(s => [s.id, s.name])) : {};
  const results = games.getResults(g.id)
    .map(r => ({
      studentId: r.studentId,
      name: rosterMap[r.studentId] || r.name,
      score: r.score, total: r.total, at: r.at, attempts: r.attempts,
    }))
    .sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : 1));
  res.json({ lessonTitle: g.lessonTitle, questionCount: g.questions.length, roomCode: g.roomCode, results });
});

// Teacher: list my games.
app.get('/api/games', requireAuth, (req, res) => res.json({ games: games.listTeacherGames(req.userId) }));

// ── Class rosters ──────────────────────────────────────────────────────────────

// Parse a file (CSV, Excel) and return headers + preview rows for UI verification.
// Does NOT save anything — the teacher must confirm the column mapping first.
app.post('/api/roster/preview', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const result = roster.parseRosterFile(req.file.buffer, req.file.originalname);
    res.json({
      headers: result.headers,
      preview: result.rows.slice(0, 12),
      totalRows: result.totalRows,
      detectedIdCol: result.detectedIdCol,
      detectedNameCol: result.detectedNameCol,
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
      const { rows, idCol, nameCol } = req.body;
      if (!idCol) return res.status(400).json({ error: 'idCol is required.' });
      const students = roster.buildStudentsFromMapping(rows, idCol, nameCol);
      if (!students.length) return res.status(400).json({ error: 'No valid students found in the selected columns.' });
      r = roster.saveRoster(req.userId, { name, students });
    } else {
      // Legacy CSV text path
      const csvText = String(req.body || '').trim();
      if (!csvText) return res.status(400).json({ error: 'CSV is empty.' });
      r = roster.saveRoster(req.userId, { name, csvText });
    }
    res.json({ id: r.id, name: r.name, count: r.students.length });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/rosters', requireAuth, (req, res) => res.json({ rosters: roster.listRosters(req.userId) }));

app.delete('/api/roster/:id', requireAuth, (req, res) => {
  const r = roster.getRoster(req.userId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Roster not found.' });
  roster.deleteRoster(req.userId, req.params.id);
  res.json({ ok: true });
});

// Student progress: aggregates every game result for each student in a roster.
// Returns roster summary + per-student { gamesPlayed, avgPct, bestSubject, lastAt, results[] }.
app.get('/api/roster/:id/progress', requireAuth, (req, res) => {
  const r = roster.getRoster(req.userId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Roster not found.' });

  const rosterMap = new Map(r.students.map(s => [s.id, s.name]));
  const allGames  = games.listTeacherGames(req.userId);

  // Collect results keyed by studentId.
  const byStudent = new Map();
  for (const g of allGames) {
    for (const result of games.getResults(g.id)) {
      if (!rosterMap.has(result.studentId)) continue;
      if (!byStudent.has(result.studentId)) byStudent.set(result.studentId, []);
      byStudent.get(result.studentId).push({
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
    const results = (byStudent.get(s.id) || []).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
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

// Student play page (the shareable link target).
app.get('/play/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));

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

// ── External API (v1) ───────────────────────────────────────────────────────────────
// Read-only endpoints for the external report-card app, authenticated via Bearer token.
// Only admin-scoped keys are accepted.
function requireApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(\S+)$/);
  if (!match) return res.status(401).json({ error: 'Missing Authorization header.' });
  const result = apikeys.verifyKey(match[1]);
  if (!result) return res.status(401).json({ error: 'Invalid API key.' });
  req.apiIsAdmin = result.isAdmin;
  next();
}

// List all rosters across all teachers.
app.get('/api/v1/rosters', requireApiKey, (req, res) => {
  const all = [];
  for (const teacherId of listAllUserIds()) {
    for (const r of roster.listRosters(teacherId)) {
      all.push({ id: r.id, teacherId, name: r.name, studentCount: r.count, createdAt: r.createdAt });
    }
  }
  res.json({ rosters: all });
});

// Get all students across all teachers with all game results.
// Optional ?rosterId=<id> to narrow to one roster (still searches all teachers for that roster).
app.get('/api/v1/students', requireApiKey, (req, res) => {
  const filterRosterId = req.query.rosterId || null;
  const allUserIds = listAllUserIds();
  const out = [];

  for (const teacherId of allUserIds) {
    const rosters = filterRosterId
      ? [roster.getRoster(teacherId, filterRosterId)].filter(Boolean)
      : (() => {
          const ids = roster.listRosters(teacherId).map(r => r.id);
          return ids.map(id => roster.getRoster(teacherId, id)).filter(Boolean);
        })();

    if (!rosters.length) continue;

    const allGames = games.listTeacherGames(teacherId);
    const byStudent = new Map();
    for (const g of allGames) {
      for (const result of games.getResults(g.id)) {
        if (!byStudent.has(result.studentId)) byStudent.set(result.studentId, []);
        byStudent.get(result.studentId).push({
          topic: g.topic, subject: g.subject,
          score: result.score, total: result.total,
          percentage: result.total > 0 ? Math.round((result.score / result.total) * 100) : 0,
          at: result.at,
        });
      }
    }

    for (const r of rosters) {
      for (const s of r.students) {
        const results = byStudent.get(s.id) || [];
        out.push({ id: s.id, name: s.name, rosterId: r.id, rosterName: r.name, teacherId, results });
      }
    }
  }

  res.json({ students: out });
});

// Get progress data for a specific roster (by any teacher).
app.get('/api/v1/roster/:id/progress', requireApiKey, (req, res) => {
  const rosterIdParam = req.params.id;
  let foundRoster = null;
  let foundTeacherId = null;
  for (const teacherId of listAllUserIds()) {
    const r = roster.getRoster(teacherId, rosterIdParam);
    if (r) { foundRoster = r; foundTeacherId = teacherId; break; }
  }
  if (!foundRoster) return res.status(404).json({ error: 'Roster not found.' });

  const allGames = games.listTeacherGames(foundTeacherId);
  const byStudent = new Map();
  for (const g of allGames) {
    for (const result of games.getResults(g.id)) {
      if (!foundRoster.students.find(s => s.id === result.studentId)) continue;
      if (!byStudent.has(result.studentId)) byStudent.set(result.studentId, []);
      byStudent.get(result.studentId).push({
        topic: g.topic, subject: g.subject,
        score: result.score, total: result.total,
        percentage: result.total > 0 ? Math.round((result.score / result.total) * 100) : 0,
        at: result.at,
      });
    }
  }

  const students = foundRoster.students.map(s => ({ id: s.id, name: s.name, results: byStudent.get(s.id) || [] }));
  res.json({ roster: { id: foundRoster.id, name: foundRoster.name, teacherId: foundTeacherId }, students });
});

app.listen(PORT, () => console.log(`LessonCope running at http://localhost:${PORT}`));
