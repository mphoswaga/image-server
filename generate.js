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
const { gradeProfile } = require('./grade');
const { parseFraction, drawFractionPizza, drawStepsDiagram, drawStepsHorizontal, drawNumberLine, detectLabelledDiagram, drawLabelledDiagram } = require('./concept-diagram');

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

  // Brand-new subject/topic with no images yet → fetch + caption a starter set.
  if (!pool.length) {
    const { addImages } = require('./admin-images');
    try {
      const count = Math.min(15, Math.max(8, slides.length + 2));
      const added = await addImages({ subject, topic, count });
      if (added.length) {
        addLibraryImages(added);
        pool = LIBRARY.images.filter(img => img.subject === subject && img.topic === topic);
      }
    } catch (err) {
      throw new Error(`Couldn't fetch images for "${subject} / ${topic}": ${err.message}`);
    }
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

    // Weak/no match → try to fetch a gap-filler from Unsplash.
    let fetched = null;
    if (slide.imageQuery) {
      console.log(`No strong match for "${slide.imageQuery}" — fetching from Unsplash…`);
      fetched = await fetchUnsplashImage({ query: slide.imageQuery, subject, topic, publicDir: PUBLIC_DIR });
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

function bulletItems(bullets, t) {
  return bullets.map((b, bi) => {
    // Playful (early grades): an emoji acts as the bullet marker. breakLine
    // keeps each on its own paragraph (needed for layout + per-bullet animation).
    if (t.playful && t.bulletEmojis) {
      return {
        text: `${t.bulletEmojis[bi % t.bulletEmojis.length]}  ${b}`,
        options: { color: t.bulletPalette[bi % t.bulletPalette.length], fontSize: t.bulletSize, bold: true, breakLine: true, paraSpaceAfter: t.paraSpaceAfter },
      };
    }
    return {
      text: b,
      options: {
        bullet: { code: t.bulletGlyph },
        color: t.colorful ? t.bulletPalette[bi % t.bulletPalette.length] : (t.bulletPalette[0] || THEME.text),
        fontSize: t.bulletSize,
        bold: t.colorful,
      },
    };
  });
}

function addTitleBar(pptx, slide, title, t, accent) {
  slide.addText(title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
}

function renderSlide(pptx, slideData, imgPath, t, idx = 0, state = { photoN: 0 }) {
  const slide = pptx.addSlide();
  slide.background = { color: THEME.bg };
  const accent = t.accent;
  slide.addNotes(slideData.speakerNotes || '');

  switch (slideData.type) {
    case 'title': {
      slide.addImage({ path: imgPath, x: 0, y: 0, w: 10, h: 5.625, sizing: { type: 'cover', w: 10, h: 5.625 } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 3.6, w: 10, h: 2.025, fill: { color: THEME.primary, transparency: 15 } });
      slide.addText(slideData.title, { x: 0.5, y: 3.75, w: 9, h: 0.9, fontFace: THEME.font, fontSize: 40, bold: true, color: 'FFFFFF' });
      slide.addText(slideData.subtitle || '', { x: 0.5, y: 4.65, w: 9, h: 0.6, fontFace: THEME.font, fontSize: 18, color: 'FFFFFF' });
      break;
    }
    case 'objectives': {
      // Section-divider look: colored panel on the left, full-height image right.
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 5.4, h: 5.625, fill: { color: THEME.primary } });
      slide.addText('LEARNING OBJECTIVES', { x: 0.5, y: 0.6, w: 4.4, h: 0.5, fontFace: THEME.font, fontSize: 15, bold: true, color: SOFT.accentSoft, charSpacing: 2 });
      slide.addText(
        slideData.bullets.map((b, i) => ({ text: `${i + 1}.  ${b}`, options: { color: 'FFFFFF', fontSize: Math.max(16, t.bulletSize - 2), paraSpaceAfter: 14, breakLine: true } })),
        { x: 0.5, y: 1.4, w: 4.5, h: 3.8, fontFace: THEME.font, valign: 'top' }
      );
      slide.addImage({ path: imgPath, x: 5.4, y: 0, w: 4.6, h: 5.625, sizing: { type: 'cover', w: 4.6, h: 5.625 } });
      break;
    }
    case 'activity': {
      // Stand-out task slide: warm tinted background, big accent heading.
      slide.background = { color: SOFT.accentSoft };
      slide.addText('YOUR TURN', { x: 0.5, y: 0.45, w: 9, h: 0.4, fontFace: THEME.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
      slide.addText(slideData.title || 'Activity', { x: 0.5, y: 0.85, w: 9, h: 0.8, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
      slide.addText(
        slideData.bullets.map((b, i) => ({ text: b, options: { bullet: { code: '25B6' }, color: THEME.text, fontSize: t.bulletSize, paraSpaceAfter: t.paraSpaceAfter } })),
        { x: 0.5, y: 1.9, w: 5, h: 3.3, fontFace: THEME.font, valign: 'top' }
      );
      slide.addImage({ path: imgPath, x: 5.8, y: 1.9, w: 3.7, h: 3.2, sizing: { type: 'cover', w: 3.7, h: 3.2 }, rounding: true });
      break;
    }
    case 'recap': {
      slide.background = { color: SOFT.primarySoft };
      addTitleBar(pptx, slide, slideData.title || 'Recap', t, accent);
      slide.addText(
        slideData.bullets.map(b => ({ text: b, options: { bullet: { code: '2713' }, color: THEME.text, fontSize: t.bulletSize, paraSpaceAfter: t.paraSpaceAfter } })),
        { x: 0.5, y: 1.5, w: 5, h: 3.6, fontFace: THEME.font, valign: 'top' }
      );
      slide.addImage({ path: imgPath, x: 5.8, y: 1.4, w: 3.7, h: 3.5, sizing: { type: 'cover', w: 3.7, h: 3.5 } });
      break;
    }
    case 'check': { // a "check for understanding" question; the answer reveals on click
      slide.addText('QUICK CHECK', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: THEME.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
      slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
      slide.addText(bulletItems(slideData.bullets, t), { x: 0.5, y: 2.05, w: 5, h: 3.1, fontFace: THEME.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
      placeVisual(pptx, slide, slideData, imgPath, accent, { x: 5.8, y: 1.9, w: 3.7, h: 3.2 });
      break;
    }
    default: { // content
      const v = slideData.visual;
      const hasFraction = parseFraction(slideData.example) || parseFraction(slideData.title) || parseFraction(slideData.imageQuery);

      // Curated labelled science diagram (water cycle, cell, plant…) → hero layout.
      const labelledKey = detectLabelledDiagram(`${slideData.title} ${slideData.imageQuery || ''} ${slideData.example || ''}`);
      if (!hasFraction && labelledKey) {
        slide.addText('LABELLED DIAGRAM', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: THEME.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
        drawLabelledDiagram(pptx, slide, labelledKey, accent);
        break;
      }

      // General (any-subject) generated SVG diagram → big hero image.
      if (slideData.visual && slideData.visual.type === 'diagram') {
        slide.addText('DIAGRAM', { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: THEME.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
        slide.addImage({ path: imgPath, x: 1.25, y: 1.9, w: 7.5, h: 3.55, sizing: { type: 'contain', w: 7.5, h: 3.55 } });
        break;
      }
      // Diagram-led: the diagram is the hero — title on top, big visual below.
      const isFlow = v && (v.type === 'steps' || v.type === 'cycle') && Array.isArray(v.items) && v.items.length >= 2;
      const isLine = v && v.type === 'numberline' && Array.isArray(v.items) && v.items.length >= 3;
      if (!hasFraction && (isFlow || isLine)) {
        const kicker = isLine ? 'NUMBER LINE' : (v.type === 'cycle' ? 'THE CYCLE' : 'STEP BY STEP');
        slide.addText(kicker, { x: 0.5, y: 0.4, w: 9, h: 0.4, fontFace: THEME.font, fontSize: 14, bold: true, color: accent, charSpacing: 3 });
        slide.addText(slideData.title, { x: 0.5, y: 0.85, w: 9, h: 0.9, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
        const caption = slideData.example || (slideData.bullets && slideData.bullets[0]) || '';
        if (caption) slide.addText(caption, { x: 0.5, y: 1.8, w: 9, h: 0.6, fontFace: THEME.font, fontSize: 16, italic: true, align: 'center', color: '6B7280' });
        let drew = false;
        if (isLine) {
          const [a, b, s, mk] = v.items.map(Number);
          drew = drawNumberLine(pptx, slide, { start: a, end: b, step: s, mark: v.items[3] != null ? mk : null, x: 0.9, y: 2.7, w: 8.2, accent });
        }
        if (!drew && isFlow) drawStepsHorizontal(pptx, slide, { items: v.items, x: 0.5, y: 2.9, w: 9, h: 2.2, accent, isCycle: v.type === 'cycle' });
        else if (!drew && !isFlow) { // numberline failed validation → fall back to photo layout
          slide.addImage({ path: imgPath, x: 3.15, y: 2.7, w: 3.7, h: 2.5, sizing: { type: 'cover', w: 3.7, h: 2.5 } });
        }
        break;
      }
      // alternates image side, with an example callout
      const imageLeft = slideData.side === 'left';
      const textX = imageLeft ? 4.7 : 0.5;
      const imgX = imageLeft ? 0.4 : 5.8;

      // Layout variety: alternate PHOTO slides use a half-bleed photo for a more
      // designed feel (counted among photo slides so it doesn't collide with
      // diagram slides). Text sits on the white half. Skips fraction & playful.
      if (!hasFraction && !t.playful && (state.photoN++ % 2 === 1)) {
        const img = imageLeft ? { x: 0, y: 0, w: 4.9, h: 5.625 } : { x: 5.1, y: 0, w: 4.9, h: 5.625 };
        slide.addImage({ path: imgPath, ...img, sizing: { type: 'cover', w: img.w, h: img.h } });
        const tx = imageLeft ? 5.35 : 0.5;
        slide.addText(slideData.title, { x: tx, y: 0.6, w: 4.15, h: 1.0, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
        slide.addText(bulletItems(slideData.bullets, t), { x: tx, y: 1.85, w: 4.15, h: 2.6, fontFace: THEME.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
        if (slideData.example) {
          slide.addShape(pptx.ShapeType.roundRect, { x: tx, y: 4.5, w: 4.15, h: 0.85, fill: { color: SOFT.accentSoft }, line: { type: 'none' }, rectRadius: 0.08 });
          slide.addText([{ text: 'Example  ', options: { bold: true, color: accent } }, { text: slideData.example, options: { color: THEME.text } }],
            { x: tx + 0.15, y: 4.55, w: 3.85, h: 0.75, fontFace: THEME.font, fontSize: Math.max(12, t.bulletSize - 4), valign: 'middle', italic: true });
        }
        break;
      }
      // Playful early-grade design: soft pastel background + decorative blobs.
      if (t.playful) {
        slide.background = { color: t.pastels[idx % t.pastels.length] };
        slide.addShape(pptx.ShapeType.ellipse, { x: 8.8, y: -0.7, w: 2, h: 2, fill: { color: accent, transparency: 86 }, line: { type: 'none' } });
        slide.addShape(pptx.ShapeType.ellipse, { x: -0.6, y: 4.5, w: 1.7, h: 1.7, fill: { color: THEME.primary, transparency: 90 }, line: { type: 'none' } });
      }
      slide.addText(slideData.title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontFace: THEME.font, fontSize: t.titleSize, bold: true, color: THEME.primary });
      slide.addText(bulletItems(slideData.bullets, t), { x: textX, y: 1.45, w: 4.9, h: 2.9, fontFace: THEME.font, fontSize: t.bulletSize, valign: 'top', paraSpaceAfter: t.paraSpaceAfter });
      if (slideData.example) {
        slide.addShape(pptx.ShapeType.roundRect, { x: textX, y: 4.5, w: 4.9, h: 0.85, fill: { color: SOFT.accentSoft }, line: { type: 'none' }, rectRadius: 0.08 });
        slide.addText([
          { text: 'Example  ', options: { bold: true, color: accent } },
          { text: slideData.example, options: { color: THEME.text } },
        ], { x: textX + 0.15, y: 4.55, w: 4.6, h: 0.75, fontFace: THEME.font, fontSize: Math.max(12, t.bulletSize - 4), valign: 'middle', italic: true });
      }
      placeVisual(pptx, slide, slideData, imgPath, accent, { x: imgX, y: 1.35, w: 3.9, h: 4.0 });
    }
  }
}

function assembleDeck(slides, images, gradeTheme) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
  pptx.defineSlideMaster({ title: 'LESSONCOPE', background: { color: THEME.bg } });
  const state = { photoN: 0 };
  slides.forEach((slideData, idx) => {
    const img = images[idx];
    renderSlide(pptx, slideData, path.join(PUBLIC_DIR, img.relpath), gradeTheme, idx, state);
  });
  return pptx;
}

// ── Pipeline orchestrator (reusable by CLI and server) ─────────────────────
// Returns { pptx, slides }. Caller decides how to output (writeFile / buffer).
const slugify = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function buildDeck({ subject, topic, slideCount = 4, grade = 'middle school', tone = 'clear and engaging', focus = '', objectives = '', lessonPlanText = '' }) {
  subject = slugify(subject);
  topic = slugify(topic);
  if (!subject || !topic) throw new Error('Subject and topic are required.');
  slideCount = Math.min(20, Math.max(1, parseInt(slideCount, 10) || 4));
  // Note: no validateSelection here — unknown subjects/topics are allowed and
  // their images are fetched on demand in selectImages().

  const profile = gradeProfile(grade);
  const slides = await generateContent(subject, topic, slideCount, grade, tone, focus, { objectives, lessonPlanText });
  const images = await selectImages(slides, subject, topic);
  const pptx = assembleDeck(slides, images, profile.theme);
  return { pptx, slides, images, band: profile.band };
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
function rebuildDeck({ slides, images, grade }) {
  const theme = gradeProfile(grade).theme;
  return assembleDeck(slides, images, theme);
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

module.exports = { buildDeck, rebuildDeck, alternativeImage, findReusableImage, listLibrary, validateSelection, selectImages, addLibraryImages, libraryStats };

if (require.main === module) {
  main().catch(err => {
    console.error('Generation failed:', err.message);
    process.exit(1);
  });
}
