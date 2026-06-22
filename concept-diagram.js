// Animated concept diagrams — visuals that *explain* the maths instead of just
// decorating the slide. First widget: a fraction "pizza" cut into equal slices
// with the fraction's slices shaded; the shaded slices are named so the animator
// makes them fill in one-by-one ("cutting/colouring the pizza").
//
// Topic-specific by nature — this covers fractions; more can be added.

// Pull a simple proper fraction (m/n, n=2..12, m<=n) out of text.
function parseFraction(text) {
  const m = String(text || '').match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (!m) return null;
  const num = parseInt(m[1], 10), den = parseInt(m[2], 10);
  if (den < 2 || den > 12 || num < 1 || num > den) return null;
  return { num, den };
}

// Draw the fraction pizza into a square region. Shaded slices get objectName
// "lc-anim-fill-<i>" so animate-pptx can reveal them sequentially.
function drawFractionPizza(pptx, slide, { num, den, x, y, w, accent }) {
  const step = 360 / den;
  const box = { x, y, w, h: w }; // square
  // The whole pizza, cut into `den` equal slices (light, outlined).
  for (let i = 0; i < den; i++) {
    slide.addShape(pptx.ShapeType.pie, {
      ...box, angleRange: [i * step, (i + 1) * step],
      fill: { color: 'FFF6E9' }, line: { color: accent, width: 2 }, objectName: 'lc-pizza',
    });
  }
  // The shaded fraction — these animate in one at a time.
  for (let i = 0; i < num; i++) {
    slide.addShape(pptx.ShapeType.pie, {
      ...box, angleRange: [i * step, (i + 1) * step],
      fill: { color: accent }, line: { color: accent, width: 2 }, objectName: `lc-anim-fill-${i}`,
    });
  }
  // Fraction label below the pizza.
  slide.addText(
    [{ text: `${num}`, options: { color: accent } }, { text: '⁄', options: { color: '666666' } }, { text: `${den}`, options: { color: '1F4E79' } }],
    { x, y: y + w + 0.08, w, h: 0.7, align: 'center', fontFace: 'Arial', fontSize: 30, bold: true }
  );
}

// General, subject-agnostic diagram: a vertical sequence of labelled steps
// (works for processes, methods, sequences, cycles). Each box is named so the
// animator reveals them one-by-one — explaining the flow as it builds.
function drawStepsDiagram(pptx, slide, { items, x, y, w, h, accent, isCycle }) {
  const list = (items || []).slice(0, 5);
  const n = list.length;
  if (!n) return;
  const gap = 0.14;
  const boxH = Math.max(0.5, (h - (n - 1) * gap) / n);
  list.forEach((label, i) => {
    const yy = y + i * (boxH + gap);
    slide.addText(
      [{ text: `${isCycle ? '↻ ' : i + 1 + '  '}`, options: { bold: true, color: accent } }, { text: String(label), options: { color: '333333' } }],
      {
        x, y: yy, w, h: boxH, shape: pptx.ShapeType.roundRect, rectRadius: 0.07,
        fill: { color: 'FFF6E9' }, line: { color: accent, width: 1.5 },
        fontFace: 'Arial', fontSize: 13, align: 'left', valign: 'middle', margin: 7,
        objectName: `lc-anim-fill-${i}`,
      }
    );
    // small connector arrow between boxes
    if (i < n - 1) {
      slide.addText('▼', { x, y: yy + boxH - 0.04, w, h: gap + 0.08, align: 'center', valign: 'middle', fontSize: 10, color: accent });
    }
  });
}

// Horizontal step flow across the slide — boxes connected by arrows, revealed
// one-by-one. Used on "diagram-led" process slides where the flow is the hero.
function drawStepsHorizontal(pptx, slide, { items, x, y, w, h, accent, isCycle }) {
  const list = (items || []).slice(0, 5);
  const n = list.length;
  if (!n) return;
  const arrowW = 0.5;
  const boxW = (w - (n - 1) * arrowW) / n;
  list.forEach((label, i) => {
    const bx = x + i * (boxW + arrowW);
    slide.addText(
      [{ text: `${isCycle ? '↻' : i + 1}`, options: { bold: true, color: accent, fontSize: 22, breakLine: true } },
       { text: String(label), options: { color: '333333', fontSize: 15, bold: true } }],
      {
        x: bx, y, w: boxW, h, shape: pptx.ShapeType.roundRect, rectRadius: 0.09,
        fill: { color: 'FFF6E9' }, line: { color: accent, width: 2 },
        fontFace: 'Arial', align: 'center', valign: 'middle', margin: 8,
        objectName: `lc-anim-fill-${i}`,
      }
    );
    if (i < n - 1) {
      slide.addText(isCycle ? '↻' : '→', { x: bx + boxW, y, w: arrowW, h, align: 'center', valign: 'middle', fontSize: 26, bold: true, color: accent });
    }
  });
}

// Number line: ticks from start→end every `step`, an arrow marking `mark`.
// The marker arrow is named so it animates in (revealing "the answer").
function drawNumberLine(pptx, slide, { start, end, step, mark, x, y, w, accent }) {
  if (!(end > start) || !(step > 0)) return false;
  const ticks = Math.round((end - start) / step);
  if (ticks < 1 || ticks > 20) return false;
  const lineY = y + 1.1;
  const pos = val => x + ((val - start) / (end - start)) * w;
  // main line
  slide.addShape(pptx.ShapeType.line, { x, y: lineY, w, h: 0, line: { color: '1F4E79', width: 3 } });
  // ticks + labels
  for (let i = 0; i <= ticks; i++) {
    const val = start + i * step;
    const tx = pos(val);
    slide.addShape(pptx.ShapeType.line, { x: tx, y: lineY - 0.12, w: 0, h: 0.24, line: { color: '1F4E79', width: 2 } });
    slide.addText(String(Math.round(val * 100) / 100), { x: tx - 0.5, y: lineY + 0.18, w: 1, h: 0.35, align: 'center', fontFace: 'Arial', fontSize: 13, color: '333333' });
  }
  // marker arrow (animates in)
  if (mark != null && mark >= start && mark <= end) {
    const mx = pos(mark);
    slide.addText('▼', { x: mx - 0.4, y: lineY - 0.85, w: 0.8, h: 0.5, align: 'center', fontFace: 'Arial', fontSize: 30, bold: true, color: accent, objectName: 'lc-anim-fill-0' });
    slide.addText(String(mark), { x: mx - 0.5, y: lineY - 1.25, w: 1, h: 0.4, align: 'center', fontFace: 'Arial', fontSize: 18, bold: true, color: accent, objectName: 'lc-anim-fill-1' });
  }
  return true;
}

// ── Labelled diagrams (curated, accurate, animated) ───────────────────────
// Detect which curated diagram (if any) a slide is about.
function detectLabelledDiagram(text) {
  const s = String(text || '').toLowerCase();
  if (/water cycle|hydrological cycle/.test(s)) return 'water-cycle';
  if (/plant cell/.test(s)) return 'plant-cell';
  if (/animal cell/.test(s)) return 'animal-cell';
  if (/parts of (a |the )?(flower|plant)|plant parts|flower parts/.test(s)) return 'plant-parts';
  return null;
}

// A label chip (named so it animates in). leaderTo = optional {x,y} part to point at.
function addLabel(pptx, slide, text, lx, ly, lw, accent, idx, leaderTo) {
  if (leaderTo) {
    slide.addShape(pptx.ShapeType.line, { x: Math.min(lx, leaderTo.x), y: Math.min(ly + 0.16, leaderTo.y), w: Math.abs(leaderTo.x - lx), h: Math.abs(leaderTo.y - (ly + 0.16)), line: { color: '9AA6B2', width: 1, beginArrowType: 'none', endArrowType: 'oval' }, flipH: leaderTo.x < lx, flipV: leaderTo.y < ly + 0.16 });
  }
  slide.addText(text, { x: lx, y: ly, w: lw, h: 0.36, fontFace: 'Arial', fontSize: 13, bold: true, color: '1F4E79', align: 'center', valign: 'middle', fill: { color: 'FFFFFF' }, line: { color: accent, width: 1 }, rectRadius: 0.04, shape: pptx.ShapeType.roundRect, objectName: `lc-anim-fill-${idx}` });
}

function drawWaterCycle(pptx, slide, { accent }) {
  // sea + ground
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.7, y: 4.55, w: 8.6, h: 0.8, fill: { color: 'AED6F1' }, line: { type: 'none' }, rectRadius: 0.05 });
  // sun
  slide.addShape(pptx.ShapeType.ellipse, { x: 0.9, y: 2.05, w: 1.0, h: 1.0, fill: { color: 'F7C948' }, line: { color: 'E1A100', width: 1.5 } });
  // cloud
  slide.addShape(pptx.ShapeType.ellipse, { x: 3.9, y: 2.0, w: 2.7, h: 1.2, fill: { color: 'EEF2F7' }, line: { color: 'B8C4D0', width: 1.5 } });
  // evaporation arrow (up, left) and precipitation arrow (down, right)
  slide.addShape(pptx.ShapeType.line, { x: 2.5, y: 3.1, w: 1.1, h: 1.45, flipV: true, line: { color: '2E86C1', width: 4, endArrowType: 'triangle' } });
  slide.addShape(pptx.ShapeType.line, { x: 6.6, y: 3.2, w: 1.0, h: 1.35, line: { color: '2E86C1', width: 4, endArrowType: 'triangle' } });
  // labels (reveal in cycle order)
  addLabel(pptx, slide, '1  Evaporation', 1.5, 3.55, 1.7, accent, 0);
  addLabel(pptx, slide, '2  Condensation', 3.95, 1.45, 1.9, accent, 1);
  addLabel(pptx, slide, '3  Precipitation', 6.9, 3.5, 1.8, accent, 2);
  addLabel(pptx, slide, '4  Collection', 3.95, 4.62, 1.7, accent, 3);
}

function drawCell(pptx, slide, { accent, animal }) {
  const cx = 1.0, cy = 2.1, cw = 4.3, ch = 3.1; // cell body on the left
  // cell wall (plant) / membrane (animal)
  if (!animal) slide.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: cw, h: ch, fill: { color: 'EAF7EC' }, line: { color: '2F9E44', width: 3 }, rectRadius: 0.06 });
  slide.addShape(animal ? pptx.ShapeType.ellipse : pptx.ShapeType.roundRect, { x: cx + 0.18, y: cy + 0.18, w: cw - 0.36, h: ch - 0.36, fill: { color: animal ? 'FDEEF4' : 'D7F0DC' }, line: { color: animal ? 'D6336C' : '69B578', width: 2 }, rectRadius: 0.5 });
  // nucleus
  const nuc = { x: cx + 1.5, y: cy + 1.1, w: 1.0, h: 1.0 };
  slide.addShape(pptx.ShapeType.ellipse, { ...nuc, fill: { color: '7048E8' }, line: { color: '4A2FB0', width: 2 } });
  // vacuole (plant) or extra organelles
  if (!animal) slide.addShape(pptx.ShapeType.ellipse, { x: cx + 2.7, y: cy + 0.5, w: 1.2, h: 2.0, fill: { color: 'CFE9FF' }, line: { color: '4DABF7', width: 2 } });
  // chloroplasts (plant) / mitochondria (animal)
  for (let i = 0; i < 3; i++) slide.addShape(pptx.ShapeType.ellipse, { x: cx + 0.5 + i * 0.55, y: cy + 0.4, w: 0.4, h: 0.22, fill: { color: animal ? 'F08C00' : '2F9E44' }, line: { type: 'none' } });

  // labels on the right with leaders
  let i = 0;
  addLabel(pptx, slide, animal ? 'Cell membrane' : 'Cell wall', 6.4, 2.2, 2.4, accent, i++, { x: cx + cw, y: cy + 0.3 });
  addLabel(pptx, slide, 'Nucleus', 6.4, 2.95, 2.4, accent, i++, { x: nuc.x + nuc.w, y: nuc.y + 0.5 });
  if (!animal) addLabel(pptx, slide, 'Vacuole', 6.4, 3.7, 2.4, accent, i++, { x: cx + cw - 0.2, y: cy + 1.5 });
  addLabel(pptx, slide, animal ? 'Mitochondria' : 'Chloroplast', 6.4, 4.45, 2.4, accent, i++, { x: cx + 1.0, y: cy + 0.5 });
}

function drawPlantParts(pptx, slide, { accent }) {
  const sx = 2.6; // stem center x
  // roots
  for (let i = -2; i <= 2; i++) slide.addShape(pptx.ShapeType.line, { x: sx, y: 4.5, w: 0.5 * i, h: 0.7, line: { color: '8B5E34', width: 2 } });
  // stem
  slide.addShape(pptx.ShapeType.roundRect, { x: sx - 0.12, y: 3.0, w: 0.24, h: 1.55, fill: { color: '2F9E44' }, line: { type: 'none' }, rectRadius: 0.1 });
  // leaves
  slide.addShape(pptx.ShapeType.ellipse, { x: sx - 1.1, y: 3.5, w: 1.1, h: 0.5, fill: { color: '69B578' }, line: { color: '2F9E44', width: 1.5 }, rotate: 20 });
  slide.addShape(pptx.ShapeType.ellipse, { x: sx + 0.1, y: 3.7, w: 1.1, h: 0.5, fill: { color: '69B578' }, line: { color: '2F9E44', width: 1.5 }, rotate: -20 });
  // flower
  for (let k = 0; k < 6; k++) slide.addShape(pptx.ShapeType.ellipse, { x: sx - 0.55 + 0.5 * Math.cos(k * Math.PI / 3), y: 2.1 + 0.5 * Math.sin(k * Math.PI / 3), w: 0.5, h: 0.5, fill: { color: 'F783AC' }, line: { type: 'none' } });
  slide.addShape(pptx.ShapeType.ellipse, { x: sx - 0.3, y: 2.35, w: 0.6, h: 0.6, fill: { color: 'F59F00' }, line: { type: 'none' } });
  // labels right with leaders
  let i = 0;
  addLabel(pptx, slide, 'Flower', 5.6, 2.4, 2.0, accent, i++, { x: sx + 0.5, y: 2.6 });
  addLabel(pptx, slide, 'Leaf', 5.6, 3.2, 2.0, accent, i++, { x: sx + 1.0, y: 3.9 });
  addLabel(pptx, slide, 'Stem', 5.6, 4.0, 2.0, accent, i++, { x: sx + 0.1, y: 3.8 });
  addLabel(pptx, slide, 'Roots', 5.6, 4.8, 2.0, accent, i++, { x: sx + 0.6, y: 4.9 });
}

function drawLabelledDiagram(pptx, slide, key, accent) {
  if (key === 'water-cycle') return drawWaterCycle(pptx, slide, { accent });
  if (key === 'plant-cell') return drawCell(pptx, slide, { accent, animal: false });
  if (key === 'animal-cell') return drawCell(pptx, slide, { accent, animal: true });
  if (key === 'plant-parts') return drawPlantParts(pptx, slide, { accent });
  return false;
}

module.exports = { parseFraction, drawFractionPizza, drawStepsDiagram, drawStepsHorizontal, drawNumberLine, detectLabelledDiagram, drawLabelledDiagram };
