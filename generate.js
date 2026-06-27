// LessonCope pipeline: subject + topic -> themed .pptx from the local image library.
//
// CLI:
//   node generate.js <subject> <topic> [slideCount] [grade]
//   node generate.js maths fractions 6 "grade 4"
//
// Also exports the pipeline (buildDeck, listLibrary, validateSelection) so the
// Express server can reuse it. The three stages — content (content.js),
// matcher, assembler — stay separate.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const { generateContent } = require('./content');
const { fetchUnsplashImage } = require('./fetch-image');
const { rewriteImageQuery } = require('./query-rewrite');
const { gradeProfile } = require('./grade');
const { parseFraction, drawFractionPizza, drawStepsDiagram, drawStepsHorizontal, drawNumberLine, detectLabelledDiagram, drawLabelledDiagram } = require('./concept-diagram');
const { getPreset } = require('./slide-presets');

// Draw an animated concept diagram in the image area when one fits; otherwise
// place the photo. Returns true if a diagram was drawn.
//   1. a fraction → pizza diagram (maths)
//   2. an LLM-chosen steps/cycle process → step-flow diagram (any subject)
function placeVisual(pptx, slide, slideData, imgPath, accent, rect) {
  const frac = parseFraction(slideData.example) || parseFraction(slideData.title) || parseFraction(slideData.imageQuery);
  if (frac) {
    const size = Math.min(rect.w, rect.h - 0.6);
    drawFractionPizza(pptx, slide, { num: frac.num, den: frac.den, x: rect.x + (rect.w - size) / 2, y: rect.y, w: size, accent });
    return true;
  }
  const v = slideData.visual;
  if (v && (v.type === 'steps' || v.type === 'cycle') && Array.isArray(v.items) && v.items.length >= 2) {
    drawStepsDiagram(pptx, slide, { items: v.items, x: rect.x, y: rect.y, w: rect.w, h: rect.h, accent, isCycle: v.type === 'cycle' });
    return true;
  }
  slide.addImage({ path: imgPath, x: rect.x, y: rect.y, w: rect.w, h: rect.h, sizing: { type: 'cover', w: rect.w, h: rect.h } });
  return false;
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_DIR = path.join(__dirname, 'output');
const LIBRARY_PATH = path.join(PUBLIC_DIR, 'library.json');
const LIBRARY = require('./public/library.json');

// Minimum caption-overlap score to accept a library image; below this we treat
// it as a gap and fetch a fresh photo from Unsplash.
const MATCH_THRESHOLD = 1;

const THEME = {
  bg: 'FFFFFF',
  primary: '1F4E79',   // deep blue — titles
  accent: '2E75B6',    // lighter blue — bullets/rules
  text: '333333',
  font: 'Arial',
};

// ── Library helpers ────────────────────────────────────────────────────────
// { subjects: [...], topicsBySubject: { maths: [...], ... } } — drives the UI.
function listLibrary() {
  const topicsBySubject = {};
  for (const img of LIBRARY.images) {
    (topicsBySubject[img.subject] ||= new Set()).add(img.topic);
  }
  for (const s of Object.keys(topicsBySubject)) {
    topicsBySubject[s] = [...topicsBySubject[s]].sort();
  }
  return { subjects: LIBRARY.subjects, topicsBySubject };
}

// Throws an Error with a clear message if subject/topic aren't in the library.
function validateSelection(subject, topic) {
  const { subjects, topicsBySubject } = listLibrary();
  if (!subjects.includes(subject)) {
    throw new Error(`Subject "${subject}" not found. Available: ${subjects.join(', ')}`);
  }
  if (!topicsBySubject[subject].includes(topic)) {
    throw new Error(`Topic "${topic}" not found in ${subject}. Available: ${topicsBySubject[subject].join(', ')}`);
  }
}

// ── C. Image Matcher (V2: content-aware — scores captions vs. imageQuery) ───
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'with', 'at', 'by', 'is', 'are', 'this', 'that']);

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t))
  );
}

// How well an image matches a query: count of shared tokens between the query
// and the image's caption + keywords + tags (folder names). 0 if uncaptioned
// and nothing overlaps, which lets the round-robin fallback take over.
function scoreImage(img, queryTokens) {
  const imgTokens = tokenize([img.caption, (img.keywords || []).join(' '), (img.tags || []).join(' ')].join(' '));
  let score = 0;
  for (const t of queryTokens) if (imgTokens.has(t)) score++;
  return score;
}

// Best-scoring unused image in the pool for a query (null if nothing overlaps).
function bestLibraryMatch(pool, queryTokens, used) {
  let best = null, bestScore = -1;
  if (queryTokens.size) {
    for (const img of pool) {
      if (used.has(img.relpath)) continue;
      const s = scoreImage(img, queryTokens);
      if (s > bestScore) { best = img; bestScore = s; }
    }
  }
  return { best, bestScore };
}

// Round-robin fallback: next unused image, allowing reuse once exhausted.
function roundRobinPick(pool, used) {
  for (const img of pool) {
    if (!used.has(img.relpath)) { used.add(img.relpath); return img; }
  }
  return pool[0];
}

// Persist a newly fetched image into library.json. Re-reads first to minimize
// clobbering a concurrent writer (e.g. the captioning job).
function persistNewImage(entry) {
  try {
    const lib = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
    if (!lib.images.some(i => i.relpath === entry.relpath)) {
      lib.images.push(entry);
      lib.count = lib.images.length;
      fs.writeFileSync(LIBRARY_PATH, JSON.stringify(lib, null, 2));
    }
  } catch (err) {
    console.log(`Could not persist new image: ${err.message}`);
  }
}

// Pick one image per slide. Uses a content match when strong enough; otherwise
// fetches a fresh Unsplash photo, caches it into the library, and uses that.
async function selectImages(slides, subject, topic) {
  let pool = LIBRARY.images.filter(img => img.subject === subject && img.topic === topic);

  // Brand-new subject/topic — fetch a starter set from Unsplash.
  // Wikimedia is intentionally excluded here: its unfiltered corpus returns
  // buildings, trams, portraits and other off-topic photos at generation time.
  // Teachers can still pull Wikimedia images via the picker ("Search the web").
  if (!pool.length) {
    const { addImages } = require('./admin-images');
    try {
      const count = Math.min(15, Math.max(8, slides.length + 2));
      const topicQuery = await rewriteImageQuery(`${topic.replace(/-/g,' ')} ${subject.replace(/-/g,' ')}`);
      const added = await addImages({ subject, topic, count, query: topicQuery, skipCaption: true });
      if (added.length) {
        addLibraryImages(added);
        pool = LIBRARY.images.filter(img => img.subject === subject && img.topic === topic);
      }
    } catch (err) {
      throw new Error(`Couldn't fetch images for "${subject} / ${topic}": ${err.message}`);
    }
  }
  // If the specific topic returned nothing (e.g. Unsplash had no results or all
  // downloads failed), fall back to any images from the same subject so the deck
  // can still be built rather than crashing.
  if (!pool.length) {
    pool = LIBRARY.images.filter(img => img.subject === subject);
    if (pool.length) console.log(`No images for "${topic}" — falling back to ${pool.length} images from subject "${subject}".`);
  }
  if (!pool.length) throw new Error(`No images available for "${subject} / ${topic}". Try a different topic.`);

  const used = new Set();
  const chosen = [];

  for (const slide of slides) {
    // LLM asked for a labelled diagram, and it's not one of the curated ones →
    // generate (or reuse) an SVG diagram for any subject.
    if (slide.visual && slide.visual.type === 'diagram' && !detectLabelledDiagram(`${slide.title} ${slide.imageQuery || ''}`)) {
      const concept = (slide.visual.items || []).join(', ').trim() || slide.title;
      const reuse = findReusableImage({ subject, topic, query: concept, minScore: 3, source: 'svg-diagram', exclude: [...used] });
      if (reuse) { used.add(reuse.relpath); chosen.push(reuse); continue; }
      try {
        const { generateDiagram } = require('./svg-diagram');
        const entry = await generateDiagram({ subject, topic, concept });
        addLibraryImages([entry]); used.add(entry.relpath); chosen.push(entry); continue;
      } catch (err) {
        console.log(`Diagram generation failed (${err.message}) — falling back to a photo.`);
        // fall through to normal image selection
      }
    }

    const queryTokens = tokenize(slide.imageQuery);
    const { best, bestScore } = bestLibraryMatch(pool, queryTokens, used);

    if (best && bestScore >= MATCH_THRESHOLD) {
      used.add(best.relpath);
      chosen.push(best);
      continue;
    }

    // Weak/no match → fetch a gap-filler from Unsplash.
    let fetched = null;
    if (slide.imageQuery) {
      const rewrittenQ = await rewriteImageQuery(slide.imageQuery);
      console.log(`No strong match for "${slide.imageQuery}" → rewritten to "${rewrittenQ}" — fetching from Unsplash…`);
      fetched = await fetchUnsplashImage({ query: rewrittenQ, subject, topic, publicDir: PUBLIC_DIR });
    }
    if (fetched) {
      pool.push(fetched);
      LIBRARY.images.push(fetched); // self-heal: available to future slides/sessions in this process
      persistNewImage(fetched);
      used.add(fetched.relpath);
      chosen.push(fetched);
    } else {
      // No key, no result, or no query → fall back to the best/round-robin pick.
      const pick = best || roundRobinPick(pool, used);
      used.add(pick.relpath);
      chosen.push(pick);
    }
  }

  return chosen;
}

// ── D. PPTX Assembler — distinct layout per slide type ─────────────────────
const SOFT = { accentSoft: 'FBEEDE', primarySoft: 'EAF1F8' };

// Rainbow bullet palette for multicolor (playful) presets.
const RAINBOW_PALETTE = ['E11D48', 'D97706', '16A34A', '2563EB', '7C3AED', 'DB2777'];
// Pastel slide backgrounds that cycle across content slides for multicolor presets.
const MC_PASTELS = ['FFF1F2', 'FFFBEB', 'F0FDF4', 'EFF6FF', 'FDF4FF', 'ECFDF5'];
// Accent blobs: semi-transparent corner decorations on multicolor slides.
const MC_BLOBS   = ['E11D48', 'D97706', '16A34A', '2563EB', '7C3AED'];

function bulletItems(bullets, t, thm, multicolor) {
  thm = thm || THEME;
  return bullets.map((b, bi) => {
    if (t.playful && t.bulletEmojis) {
      return {
        text: `${t.bulletEmojis[bi % t.bulletEmojis.length]}  ${b}`,
        options: { color: t.bulletPalette[bi % t.bulletPalette.length], fontSize: t.bulletSize, bold: true, breakLine: true, paraSpaceAfter: t.paraSpaceAfter },
      };
    }
    const bulletColor = multicolor
      ? RAINBOW_PALETTE[bi % RAINBOW_PALETTE.length]
      : (t.colorful ? t.bulletPalette[bi % t.bulletPalette.length] : (t.bulletPalette[0] || thm.text));
    return {
      text: b,
      options: {
        bullet: { code: t.bulletGlyph },
        color: bulletColor,
        fontSize: t.bulletSize,
        bold: multicolor || t.colorful,
      },
    };
  });
}

function addTitleBar(pptx, slide, title, t, accent, thm) {
  thm = thm || THEME;
  slide.addText(title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
}

function drawShortcuts(pptx, slide, shortcuts, accent, thm) {
  thm = thm || THEME;
  const list = shortcuts.slice(0, 6);
  const startY = 2.25, rowH = Math.min(0.74, (5.15 - startY) / Math.max(list.length, 1));
  list.forEach((sc, i) => {
    const y = startY + i * rowH, capY = y + (rowH - 0.5) / 2;
    slide.addText(sc.action, { x: 0.7, y, w: 3.1, h: rowH, fontFace: thm.font, fontSize: 18, bold: true, color: thm.text, valign: 'middle' });
    let x = 4.05;
    const keys = String(sc.keys).split('+').map(k => k.trim()).filter(Boolean);
    keys.forEach((k, ki) => {
      if (ki > 0) { slide.addText('+', { x, y, w: 0.3, h: rowH, fontFace: thm.font, fontSize: 18, bold: true, color: '9AA5B1', align: 'center', valign: 'middle' }); x += 0.34; }
      const kw = Math.max(0.62, 0.42 + 0.16 * k.length);
      slide.addShape(pptx.ShapeType.roundRect, { x, y: capY, w: kw, h: 0.5, fill: { color: 'F1F3F7' }, line: { color: 'C7D0DC', width: 1.25 }, rectRadius: 0.07, shadow: { type: 'outer', blur: 4, offset: 2, angle: 90, color: 'AEB7C4', opacity: 0.55 } });
      slide.addText(k, { x, y: capY, w: kw, h: 0.5, fontFace: thm.font, fontSize: 15, bold: true, color: '2B3645', align: 'center', valign: 'middle' });
      x += kw + 0.16;
    });
  });
}

function drawWorked(pptx, slide, worked, accent, thm) {
  thm = thm || THEME;
  const steps = (worked.steps || []).slice(0, 6);
  if (worked.task) slide.addText(worked.task, { x: 0.6, y: 1.62, w: 8.9, h: 0.5, fontFace: thm.font, fontSize: 17, bold: true, italic: true, color: '6B7280' });
  const startY = 2.32, rowH = Math.min(0.64, (5.2 - startY) / Math.max(steps.length, 1));
  steps.forEach((st, i) => {
    const y = startY + i * rowH, badgeY = y + (rowH - 0.42) / 2;
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.7, y: badgeY, w: 0.42, h: 0.42, fill: { color: accent }, line: { type: 'none' } });
    slide.addText(String(i + 1), { x: 0.7, y: badgeY, w: 0.42, h: 0.42, fontFace: thm.font, fontSize: 14, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
    slide.addText(st, { x: 1.36, y, w: 8.0, h: rowH, fontFace: thm.font, fontSize: 15.5, color: thm.text, valign: 'middle' });
  });
}

function renderSlide(pptx, slideData, imgPath, t, idx = 0, state = { photoN: 0 }, preset = null) {
  // Derive theme colours, layout variant, and multicolor flag from the preset.
  const thm = preset || THEME;
  const soft = preset ? { accentSoft: preset.soft, primarySoft: preset.soft } : SOFT;
  const layout = (preset && preset.layout) || 'classic';
  const multicolor = !!(preset && preset.multicolor);

  const slide = pptx.addSlide();
  slide.background = { color: thm.bg };
  const accent = t.accent;
  slide.addNotes(slideData.speakerNotes || '');

  switch (slideData.type) {
    case 'title': {
      slide.addImage({ path: imgPath, x: 0, y: 0, w: 10, h: 5.625, sizing: { type: 'cover', w: 10, h: 5.625 } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 3.6, w: 10, h: 2.025, fill: { color: thm.primary, transparency: 15 } });
      slide.addText(slideData.title, { x: 0.5, y: 3.75, w: 9, h: 0.9, fontFace: thm.font, fontSize: 40, bold: true, color: 'FFFFFF' });
      slide.addText(slideData.subtitle || '', { x: 0.5, y: 4.65, w: 9, h: 0.6, fontFace: thm.font, fontSize: 18, color: 'FFFFFF' });
      break;
    }
    case 'objectives': {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 5.4, h: 5.625, fill: { color: thm.primary } });
      slide.addText('LEARNING OBJECTIVES', { x: 0.5, y: 0.6, w: 4.4, h: 0.5, fontFace: thm.font, fontSize: 15, bold: true, color: soft.accentSoft, charSpacing: 2 });
      slide.addText(
        slideData.bullets.map((b, i) => ({ text: `${i + 1}.  ${b}`, options: { color: 'FFFFFF', fontSize: Math.max(16, t.bulletSize - 2), paraSpaceAfter: 14, breakLine: true } })),
        { x: 0.5, y: 1.4, w: 4.5, h: 3.8, fontFace: thm.font, valign: 'top' }
      );
      slide.addImage({ path: imgPath, x: 5.4, y: 0, w: 4.6, h: 5.625, sizing: { type: 'cover', w: 4.6, h: 5.625 } });
      break;
    }
    case 'activity': {
      slide.background = { color: soft.accentSoft };
      slide.addText('YOUR TURN', { x: 0.5, y: 0.45, w: 9, h: 0.4, fontFace: thm.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
      slide.addText(slideData.title || 'Activity', { x: 0.5, y: 0.85, w: 9, h: 0.8, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
      slide.addText(
        slideData.bullets.map((b) => ({ text: b, options: { bullet: { code: '25B6' }, color: thm.text, fontSize: t.bulletSize, paraSpaceAfter: t.paraSpaceAfter } })),
        { x: 0.5, y: 1.9, w: 5, h: 3.3, fontFace: thm.font, valign: 'top' }
      );
      slide.addImage({ path: imgPath, x: 5.8, y: 1.9, w: 3.7, h: 3.2, sizing: { type: 'cover', w: 3.7, h: 3.2 }, rounding: true });
      break;
    }
    case 'recap': {
      slide.background = { color: soft.primarySoft };
      addTitleBar(pptx, slide, slideData.title || 'Recap', t, accent, thm);
      slide.addText(
        slideData.bullets.map(b => ({ text: b, options: { bullet: { code: '2713' }, color: thm.text, fontSize: t.bulletSize, paraSpaceAfter: t.paraSpaceAfter } })),
        { x: 0.5, y: 1.5, w: 5, h: 3.6, fontFace: thm.font, valign: 'top' }
      );
      slide.addImage({ path: imgPath, x: 5.8, y: 1.4, w: 3.7, h: 3.5, sizing: { type: 'cover', w: 3.7, h: 3.5 } });
      break;
    }
    case 'check': {
      slide.addText('QUICK CHECK', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: thm.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
      slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
      slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: 0.5, y: 2.05, w: 5, h: 3.1, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
      placeVisual(pptx, slide, slideData, imgPath, accent, { x: 5.8, y: 1.9, w: 3.7, h: 3.2 });
      break;
    }
    default: { // content
      const v = slideData.visual;
      const hasFraction = parseFraction(slideData.example) || parseFraction(slideData.title) || parseFraction(slideData.imageQuery);

      // Multicolor (playful preset): cycle pastel slide backgrounds + corner blob decorations.
      if (multicolor) {
        slide.background = { color: MC_PASTELS[idx % MC_PASTELS.length] };
        slide.addShape(pptx.ShapeType.ellipse, { x: 8.4, y: -0.9, w: 2.4, h: 2.4, fill: { color: MC_BLOBS[(idx + 2) % MC_BLOBS.length], transparency: 80 }, line: { type: 'none' } });
        slide.addShape(pptx.ShapeType.ellipse, { x: -0.9, y: 4.2, w: 2.0, h: 2.0, fill: { color: MC_BLOBS[(idx + 1) % MC_BLOBS.length], transparency: 83 }, line: { type: 'none' } });
      }

      // Curated labelled diagram → hero layout (layout-agnostic; content drives it).
      const labelledKey = detectLabelledDiagram(`${slideData.title} ${slideData.imageQuery || ''} ${slideData.example || ''}`);
      if (!hasFraction && labelledKey) {
        slide.addText('LABELLED DIAGRAM', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: thm.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        drawLabelledDiagram(pptx, slide, labelledKey, accent);
        break;
      }

      // Generated SVG diagram → hero.
      if (slideData.visual && slideData.visual.type === 'diagram') {
        slide.addText('DIAGRAM', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: thm.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        slide.addImage({ path: imgPath, x: 1.25, y: 1.9, w: 7.5, h: 3.55, sizing: { type: 'contain', w: 7.5, h: 3.55 } });
        break;
      }
      // Keyboard shortcuts → keycap layout.
      if (Array.isArray(slideData.shortcuts) && slideData.shortcuts.length) {
        slide.addText('SHORTCUTS', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: thm.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        if (slideData.example) slide.addText(slideData.example, { x: 0.5, y: 1.62, w: 9, h: 0.5, fontFace: thm.font, fontSize: 15, italic: true, color: '6B7280' });
        drawShortcuts(pptx, slide, slideData.shortcuts, accent, thm);
        break;
      }
      // Worked example → numbered steps.
      if (slideData.worked && Array.isArray(slideData.worked.steps) && slideData.worked.steps.length) {
        slide.addText('WORKED EXAMPLE', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: thm.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        drawWorked(pptx, slide, slideData.worked, accent, thm);
        break;
      }
      // Diagram-led: steps/cycle/numberline.
      const isFlow = v && (v.type === 'steps' || v.type === 'cycle') && Array.isArray(v.items) && v.items.length >= 2;
      const isLine = v && v.type === 'numberline' && Array.isArray(v.items) && v.items.length >= 3;
      if (!hasFraction && (isFlow || isLine)) {
        const kicker = isLine ? 'NUMBER LINE' : (v.type === 'cycle' ? 'THE CYCLE' : 'STEP BY STEP');
        slide.addText(kicker, { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: thm.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        const caption = slideData.example || (slideData.bullets && slideData.bullets[0]) || '';
        if (caption) slide.addText(caption, { x: 0.5, y: 1.8, w: 9, h: 0.6, fontFace: thm.font, fontSize: 16, italic: true, align: 'center', color: '6B7280' });
        let drew = false;
        if (isLine) {
          const [a, b, s, mk] = v.items.map(Number);
          drew = drawNumberLine(pptx, slide, { start: a, end: b, step: s, mark: v.items[3] != null ? mk : null, x: 0.9, y: 2.7, w: 8.2, accent });
        }
        if (!drew && isFlow) drawStepsHorizontal(pptx, slide, { items: v.items, x: 0.5, y: 2.9, w: 9, h: 2.2, accent, isCycle: v.type === 'cycle' });
        else if (!drew && !isFlow) {
          slide.addImage({ path: imgPath, x: 3.15, y: 2.7, w: 3.7, h: 2.5, sizing: { type: 'cover', w: 3.7, h: 2.5 } });
        }
        break;
      }

      // ── Layout variant: fullbleed — image fills slide, text on dark overlay ──
      if (layout === 'fullbleed') {
        slide.addImage({ path: imgPath, x: 0, y: 0, w: 10, h: 5.625, sizing: { type: 'cover', w: 10, h: 5.625 } });
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 3.025, fill: { color: '000000', transparency: 30 }, line: { type: 'none' } });
        slide.addText(slideData.title, { x: 0.5, y: 2.75, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: 'FFFFFF' });
        slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: 0.5, y: 3.75, w: 9, h: 1.6, fontFace: thm.font, fontSize: Math.max(13, t.bulletSize - 2), valign: 'top', paraSpaceAfter: 4 });
        if (slideData.example) {
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: 'E2E8F0' } }],
            { x: 0.5, y: 5.18, w: 9, h: 0.32, fontFace: thm.font, fontSize: Math.max(11, t.bulletSize - 5), valign: 'middle', italic: true });
        }
        break;
      }

      // ── Layout variant: twocol — two-column bullets, no image ─────────────
      if (layout === 'twocol') {
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.15, fill: { color: thm.soft }, line: { type: 'none' } });
        slide.addText(slideData.title, { x: 0.5, y: 0.12, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        const half = Math.ceil(slideData.bullets.length / 2);
        slide.addText(bulletItems(slideData.bullets.slice(0, half), t, thm, multicolor), { x: 0.5, y: 1.3, w: 4.15, h: 3.6, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        slide.addShape(pptx.ShapeType.rect, { x: 4.85, y: 1.4, w: 0.05, h: 3.4, fill: { color: accent, transparency: 50 }, line: { type: 'none' } });
        slide.addText(bulletItems(slideData.bullets.slice(half), t, thm, multicolor), { x: 5.1, y: 1.3, w: 4.4, h: 3.6, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        if (slideData.example) {
          slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 5.0, w: 9, h: 0.4, fill: { color: thm.soft }, line: { type: 'none' }, rectRadius: 0.06 });
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: thm.text } }],
            { x: 0.65, y: 5.02, w: 8.7, h: 0.36, fontFace: thm.font, fontSize: Math.max(11, t.bulletSize - 5), valign: 'middle', italic: true });
        }
        break;
      }

      // ── Layout variant: sidebar — colored left panel, content right ────────
      if (layout === 'sidebar') {
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 1.9, h: 5.625, fill: { color: thm.primary }, line: { type: 'none' } });
        slide.addShape(pptx.ShapeType.rect, { x: 0.25, y: 0.35, w: 1.4, h: 0.09, fill: { color: accent }, line: { type: 'none' } });
        slide.addShape(pptx.ShapeType.ellipse, { x: 0.2, y: 2.4, w: 1.5, h: 1.5, fill: { color: accent, transparency: 78 }, line: { type: 'none' } });
        slide.addText(slideData.title, { x: 2.15, y: 0.3, w: 7.6, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: 2.15, y: 1.35, w: 4.5, h: 3.0, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        placeVisual(pptx, slide, slideData, imgPath, accent, { x: 6.85, y: 1.0, w: 2.85, h: 3.8 });
        if (slideData.example) {
          slide.addShape(pptx.ShapeType.roundRect, { x: 2.15, y: 4.5, w: 7.6, h: 0.85, fill: { color: thm.soft }, line: { type: 'none' }, rectRadius: 0.08 });
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: thm.text } }],
            { x: 2.3, y: 4.55, w: 7.3, h: 0.75, fontFace: thm.font, fontSize: Math.max(12, t.bulletSize - 4), valign: 'middle', italic: true });
        }
        break;
      }

      // ── Layout variant: splash — full-width colored hero, content below ────
      if (layout === 'splash') {
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 2.05, fill: { color: thm.primary }, line: { type: 'none' } });
        slide.addText(slideData.title, { x: 0.5, y: 0.2, w: 9, h: 1.65, fontFace: thm.font, fontSize: Math.min(t.titleSize + 4, 36), bold: true, color: 'FFFFFF', valign: 'middle' });
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.0, w: 10, h: 0.1, fill: { color: accent }, line: { type: 'none' } });
        slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: 0.5, y: 2.3, w: 5.5, h: 2.8, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        slide.addImage({ path: imgPath, x: 6.2, y: 2.2, w: 3.6, h: 3.0, sizing: { type: 'cover', w: 3.6, h: 3.0 }, rounding: true });
        if (slideData.example) {
          slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 5.1, w: 5.5, h: 0.38, fill: { color: thm.soft }, line: { type: 'none' }, rectRadius: 0.06 });
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: thm.text } }],
            { x: 0.65, y: 5.12, w: 5.2, h: 0.34, fontFace: thm.font, fontSize: Math.max(11, t.bulletSize - 5), valign: 'middle', italic: true });
        }
        break;
      }

      // ── Layout variant: banner — colored full-width header bar ──────────────
      if (layout === 'banner') {
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.25, fill: { color: thm.primary }, line: { type: 'none' } });
        slide.addText(slideData.title, { x: 0.5, y: 0.15, w: 9, h: 0.95, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: 'FFFFFF' });
        slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: 0.5, y: 1.45, w: 5.0, h: 3.7, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        placeVisual(pptx, slide, slideData, imgPath, accent, { x: 5.8, y: 1.45, w: 3.8, h: 3.7 });
        if (slideData.example) {
          slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 5.1, w: 5.0, h: 0.38, fill: { color: soft.accentSoft }, line: { type: 'none' }, rectRadius: 0.06 });
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: thm.text } }],
            { x: 0.65, y: 5.12, w: 4.7, h: 0.34, fontFace: thm.font, fontSize: Math.max(11, t.bulletSize - 5), valign: 'middle', italic: true });
        }
        break;
      }

      // ── Layout variant: split — always half-bleed photo ─────────────────────
      if (layout === 'split') {
        const imageLeft = idx % 2 === 0;
        const img = imageLeft ? { x: 0, y: 0, w: 4.9, h: 5.625 } : { x: 5.1, y: 0, w: 4.9, h: 5.625 };
        slide.addImage({ path: imgPath, ...img, sizing: { type: 'cover', w: img.w, h: img.h } });
        const tx = imageLeft ? 5.35 : 0.5;
        slide.addText(slideData.title, { x: tx, y: 0.6, w: 4.15, h: 1.0, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: tx, y: 1.85, w: 4.15, h: 2.6, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        if (slideData.example) {
          slide.addShape(pptx.ShapeType.roundRect, { x: tx, y: 4.5, w: 4.15, h: 0.85, fill: { color: soft.accentSoft }, line: { type: 'none' }, rectRadius: 0.08 });
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: thm.text } }],
            { x: tx + 0.15, y: 4.55, w: 3.85, h: 0.75, fontFace: thm.font, fontSize: Math.max(12, t.bulletSize - 4), valign: 'middle', italic: true });
        }
        break;
      }

      // ── Layout variant: minimal — clean typography, accent underline ─────────
      if (layout === 'minimal') {
        slide.addText(slideData.title, { x: 0.5, y: 0.4, w: 8.5, h: 0.85, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.32, w: 2.0, h: 0.07, fill: { color: accent }, line: { type: 'none' } });
        slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: 0.5, y: 1.55, w: 5.8, h: 3.1, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        if (slideData.example) {
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: thm.text } }],
            { x: 0.5, y: 4.85, w: 5.8, h: 0.55, fontFace: thm.font, fontSize: Math.max(12, t.bulletSize - 4), valign: 'middle', italic: true });
        }
        slide.addImage({ path: imgPath, x: 6.55, y: 1.5, w: 3.2, h: 3.7, sizing: { type: 'cover', w: 3.2, h: 3.7 }, rounding: true });
        break;
      }

      // ── Classic / dark layout — image right (or half-bleed alternating) ─────
      const imageLeft = slideData.side === 'left';
      const textX = imageLeft ? 4.7 : 0.5;
      const imgX = imageLeft ? 0.4 : 5.8;

      if (!hasFraction && !t.playful && (state.photoN++ % 2 === 1)) {
        const img = imageLeft ? { x: 0, y: 0, w: 4.9, h: 5.625 } : { x: 5.1, y: 0, w: 4.9, h: 5.625 };
        slide.addImage({ path: imgPath, ...img, sizing: { type: 'cover', w: img.w, h: img.h } });
        const tx = imageLeft ? 5.35 : 0.5;
        slide.addText(slideData.title, { x: tx, y: 0.6, w: 4.15, h: 1.0, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
        slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: tx, y: 1.85, w: 4.15, h: 2.6, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        if (slideData.example) {
          slide.addShape(pptx.ShapeType.roundRect, { x: tx, y: 4.5, w: 4.15, h: 0.85, fill: { color: soft.accentSoft }, line: { type: 'none' }, rectRadius: 0.08 });
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: thm.text } }],
            { x: tx + 0.15, y: 4.55, w: 3.85, h: 0.75, fontFace: thm.font, fontSize: Math.max(12, t.bulletSize - 4), valign: 'middle', italic: true });
        }
        break;
      }
      if (t.playful) {
        slide.background = { color: t.pastels[idx % t.pastels.length] };
        slide.addShape(pptx.ShapeType.ellipse, { x: 8.8, y: -0.7, w: 2, h: 2, fill: { color: accent, transparency: 86 }, line: { type: 'none' } });
        slide.addShape(pptx.ShapeType.ellipse, { x: -0.6, y: 4.5, w: 1.7, h: 1.7, fill: { color: thm.primary, transparency: 90 }, line: { type: 'none' } });
      }
      slide.addText(slideData.title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontFace: thm.font, fontSize: t.titleSize, bold: true, color: thm.primary });
      slide.addText(bulletItems(slideData.bullets, t, thm, multicolor), { x: textX, y: 1.45, w: 4.9, h: 2.9, fontFace: thm.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
      if (slideData.example) {
        slide.addShape(pptx.ShapeType.roundRect, { x: textX, y: 4.5, w: 4.9, h: 0.85, fill: { color: soft.accentSoft }, line: { type: 'none' }, rectRadius: 0.08 });
        slide.addText([
          { text: 'Example  ', options: { bold: true, color: accent } },
          { text: slideData.example, options: { color: thm.text } },
        ], { x: textX + 0.15, y: 4.55, w: 4.6, h: 0.75, fontFace: thm.font, fontSize: Math.max(12, t.bulletSize - 4), valign: 'middle', italic: true });
      }
      placeVisual(pptx, slide, slideData, imgPath, accent, { x: imgX, y: 1.35, w: 3.9, h: 4.0 });
    }
  }
}

function assembleDeck(slides, images, gradeTheme, preset) {
  const thm = preset || THEME;
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
  pptx.defineSlideMaster({ title: 'LESSONCOPE', background: { color: thm.bg } });
  const state = { photoN: 0 };
  slides.forEach((slideData, idx) => {
    const img = images[idx];
    renderSlide(pptx, slideData, path.join(PUBLIC_DIR, img.relpath), gradeTheme, idx, state, preset);
  });
  return pptx;
}

// ── Pipeline orchestrator (reusable by CLI and server) ─────────────────────
// Returns { pptx, slides }. Caller decides how to output (writeFile / buffer).
const slugify = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function buildDeck({ subject, topic, slideCount = 4, grade = 'middle school', tone = 'clear and engaging', focus = '', objectives = '', lessonPlanText = '', extras = {}, skipAssemble = false, presetId = null }) {
  subject = slugify(subject);
  topic = slugify(topic);
  if (!subject || !topic) throw new Error('Subject and topic are required.');
  slideCount = Math.min(20, Math.max(1, parseInt(slideCount, 10) || 4));
  // Note: no validateSelection here — unknown subjects/topics are allowed and
  // their images are fetched on demand in selectImages().

  const preset = getPreset(presetId);
  const profile = gradeProfile(grade);
  const slides = await generateContent(subject, topic, slideCount, grade, tone, focus, { objectives, lessonPlanText, ...extras });
  const images = await selectImages(slides, subject, topic);
  if (skipAssemble) return { slides, images, band: profile.band, preset };
  const pptx = assembleDeck(slides, images, profile.theme, preset);
  return { pptx, slides, images, band: profile.band, preset };
}

// ── CLI entrypoint (only when run directly, not when imported) ──────────────
async function main() {
  const fs = require('fs');
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('\nUsage: node generate.js <subject> <topic> [slideCount] [grade]');
    console.log('Example: node generate.js maths fractions');
    console.log('Example: node generate.js maths fractions 6 "grade 4"');
    console.log(`\nSubjects: ${LIBRARY.subjects.join(', ')}`);
    return;
  }
  const subject = args[0].toLowerCase();
  const topic = args[1].toLowerCase();
  const slideCount = Math.max(1, parseInt(args[2], 10) || 4);
  const grade = args[3] || 'middle school';

  console.log(`Generating: ${subject} / ${topic} (${slideCount} content slides, grade: ${grade})`);
  const { pptx, slides, band } = await buildDeck({ subject, topic, slideCount, grade });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `${subject}-${topic}.pptx`);
  const { animateBuffer } = require('./animate-pptx');
  fs.writeFileSync(outPath, animateBuffer(await pptx.write({ outputType: 'nodebuffer' }), band));
  const contentCount = slides.filter(s => s.type === 'content').length;
  console.log(`\nDone -> ${outPath}`);
  console.log(`Slides: ${slides.length} (title + objectives + ${contentCount} content + activity + recap)`);
}

// Reassemble a deck from already-chosen slides + images (no LLM call) — used by
// the editable preview when the teacher edits text or swaps images.
function rebuildDeck({ slides, images, grade, presetId = null }) {
  const theme = gradeProfile(grade).theme;
  const preset = getPreset(presetId);
  return assembleDeck(slides, images, theme, preset);
}

// Find an existing saved image good enough to reuse for a concept (so we don't
// re-fetch or re-generate something we already have). Optionally restrict to a
// source (e.g. only reuse a prior 'ai-generated' image for an AI request).
function findReusableImage({ subject, topic, query, minScore = 3, source = null, exclude = [] }) {
  const ex = new Set(exclude);
  const qt = tokenize(query);
  if (!qt.size) return null;
  let best = null, bestScore = minScore - 1;
  for (const img of LIBRARY.images) {
    if (img.subject !== subject || img.topic !== topic) continue;
    if (source && img.source !== source) continue;
    if (ex.has(img.relpath)) continue;
    const s = scoreImage(img, qt);
    if (s > bestScore) { best = img; bestScore = s; }
  }
  return best;
}

// Pick a different library image for a slide (for the "swap image" button).
// Best caption match among unused images, excluding ones already in the deck.
function alternativeImage({ subject, topic, imageQuery, exclude = [] }) {
  const excludeSet = new Set(exclude);
  const pool = LIBRARY.images.filter(i => i.subject === subject && i.topic === topic && !excludeSet.has(i.relpath));
  if (!pool.length) return null;
  const queryTokens = tokenize(imageQuery);
  let best = pool[0], bestScore = -1;
  for (const img of pool) {
    const s = scoreImage(img, queryTokens);
    if (s > bestScore) { best = img; bestScore = s; }
  }
  return best;
}

const imageInfo = img => ({ relpath: img.relpath, image: '/' + img.relpath, caption: img.caption || '', source: img.source || 'library', credit: img.credit || null });

// Stock-first image search for the picker: rank the whole library by how well
// the query matches each image's caption/keywords/tags, lightly boosting the
// lesson's own subject/topic. Empty query → show this subject's images.
function searchLibrary({ q, subject, topic, limit = 24 }) {
  const qt = tokenize(q || '');
  const scored = [];
  for (const img of LIBRARY.images) {
    let s = qt.size ? scoreImage(img, qt) : 0;
    if (subject && img.subject === subject) s += 0.5;
    if (topic && img.topic === topic) s += 1;
    if (qt.size === 0) { if (!(subject && img.subject === subject)) continue; }
    else if (s <= 0) continue;
    scored.push({ img, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(x => imageInfo(x.img));
}

// Look up a single library image by its relpath (for "set this image").
function getLibraryImage(relpath) {
  return LIBRARY.images.find(i => i.relpath === relpath) || null;
}

// Admin: append newly-fetched images to the in-memory library + persist to disk
// so they're matchable immediately (no server restart).
function addLibraryImages(entries) {
  for (const e of entries) LIBRARY.images.push(e);
  LIBRARY.count = LIBRARY.images.length;
  LIBRARY.subjects = [...new Set(LIBRARY.images.map(i => i.subject))].sort();
  try { fs.writeFileSync(LIBRARY_PATH, JSON.stringify(LIBRARY, null, 2)); } catch (err) { console.log('library persist failed:', err.message); }
  return LIBRARY.images.length;
}

// Admin: per-subject/topic counts + how many are captioned.
function libraryStats() {
  const bySubject = {};
  for (const img of LIBRARY.images) {
    (bySubject[img.subject] ||= {});
    const t = (bySubject[img.subject][img.topic] ||= { count: 0, captioned: 0 });
    t.count++;
    if (img.caption) t.captioned++;
  }
  return { total: LIBRARY.images.length, captioned: LIBRARY.images.filter(i => i.caption).length, bySubject };
}

// Return all images for a specific subject/topic (for the admin browse view).
function getLibraryByTopic(subject, topic) {
  return LIBRARY.images.filter(i => i.subject === subject && i.topic === topic);
}

// Return images added within the last `days` days, newest first.
function recentLibraryImages(days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return LIBRARY.images
    .filter(i => i.addedAt && new Date(i.addedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
}

// Remove one image from the in-memory library and persist the change.
function removeLibraryImage(relpath) {
  const idx = LIBRARY.images.findIndex(i => i.relpath === relpath);
  if (idx === -1) return false;
  LIBRARY.images.splice(idx, 1);
  LIBRARY.count = LIBRARY.images.length;
  LIBRARY.subjects = [...new Set(LIBRARY.images.map(i => i.subject))].sort();
  try { fs.writeFileSync(LIBRARY_PATH, JSON.stringify(LIBRARY, null, 2)); } catch (err) { console.log('library persist failed:', err.message); }
  return true;
}

module.exports = { buildDeck, rebuildDeck, alternativeImage, findReusableImage, searchLibrary, getLibraryImage, listLibrary, validateSelection, selectImages, addLibraryImages, libraryStats, getLibraryByTopic, recentLibraryImages, removeLibraryImage };

if (require.main === module) {
  main().catch(err => {
    console.error('Generation failed:', err.message);
    process.exit(1);
  });
}
