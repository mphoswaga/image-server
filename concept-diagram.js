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

module.exports = { parseFraction, drawFractionPizza, drawStepsDiagram, drawStepsHorizontal, drawNumberLine };
