require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const { buildDeck, rebuildDeck, alternativeImage, findReusableImage, listLibrary, addLibraryImages, libraryStats } = require('./generate');
const { generateOneSlide } = require('./content');
const { extractText, saveTemplate, listTemplates, getTemplate, renameTemplate, deleteTemplate, loadOriginalById, loadTemplate, loadOriginal, TYPES } = require('./template');
const { generateLessonPlan, planToText } = require('./lesson-plan');
const { fillDocx, fillXlsx } = require('./fill-template');
const { animateBuffer } = require('./animate-pptx');
const { addImages } = require('./admin-images');
const { generateImage } = require('./ai-image');
const { parseFraction, detectLabelledDiagram } = require('./concept-diagram');
const { generateDiagram } = require('./svg-diagram');

// Add transitions/animations; never let it break the download.
function safeAnimate(buffer, band) {
  try { return animateBuffer(buffer, band); }
  catch (err) { console.log('animation skipped:', err.message); return buffer; }
}
const { signup, login, issueToken, requireAuth, requireAdmin, COOKIE_NAME } = require('./auth');

const app = express();
const PORT = process.env.PORT || 4000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
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
    labelled: detectLabelledDiagram(`${slide.title || ''} ${slide.imageQuery || ''} ${slide.example || ''}`),
  };
}

app.get('/api/library', (req, res) => res.json(listLibrary()));

// ── Admin: grow the image library ─────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => res.json(libraryStats()));

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

// ── Lesson plan generation (objectives + stored template → plan) ──────────
app.post('/api/lesson-plan', requireAuth, async (req, res) => {
  const { subject, topic, grade, tone, objectives, templateId } = req.body || {};
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  if (!objectives || !objectives.trim()) return res.status(400).json({ error: 'Please paste the lesson objectives.' });
  try {
    const tpl = (templateId && getTemplate(req.userId, templateId)) || loadTemplate(req.userId);
    const plan = await generateLessonPlan({
      subject: String(subject).toLowerCase(), topic: String(topic).toLowerCase(),
      grade, tone, objectives, templateText: tpl ? tpl.text : '',
    });
    res.json({ sections: plan.sections, usedTemplate: !!tpl, templateName: tpl ? tpl.name : null, templateId: tpl ? tpl.id : null });
  } catch (err) {
    console.error('Lesson plan failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Generate a deck; store state; return preview metadata + download id.
app.post('/api/generate', requireAuth, async (req, res) => {
  const { subject, topic, slideCount, grade, tone, focus, objectives, lessonPlan } = req.body || {};
  if (!subject || !topic) return res.status(400).json({ error: 'subject and topic are required' });
  try {
    purgeOldDecks();
    // If an accepted lesson plan was passed, the slides follow it.
    const lessonPlanText = lessonPlan && lessonPlan.sections ? planToText(lessonPlan) : '';
    const built = await buildDeck({ subject, topic, slideCount, grade, tone, focus, objectives, lessonPlanText });
    const id = crypto.randomUUID();
    decks.set(id, {
      subject: String(subject).toLowerCase(), topic: String(topic).toLowerCase(),
      grade: grade || 'middle school', tone, focus, band: built.band,
      slides: built.slides, images: built.images, createdAt: Date.now(),
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
    const entry = await generateImage({ subject: deck.subject, topic: deck.topic, concept, grade: deck.grade });
    addLibraryImages([entry]);   // cache for reuse + matching
    deck.images[i] = entry;
    res.json({ image: '/' + entry.relpath, imageSource: 'ai-generated', reused: false });
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
    let entry = reuse;
    if (!entry) { entry = await generateDiagram({ subject: deck.subject, topic: deck.topic, concept }); addLibraryImages([entry]); }
    slide.visual = { type: 'diagram', items: [concept] };
    deck.images[i] = entry;
    res.json({ image: '/' + entry.relpath, imageSource: 'svg-diagram' });
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

app.listen(PORT, () => console.log(`LessonCope running at http://localhost:${PORT}`));
