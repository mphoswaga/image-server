// General labelled-diagram generator for ANY subject: the LLM draws a clean,
// labelled SVG of the concept (labels are real text, so they're crisp and
// correct), which we sanitize and rasterise to a PNG for the slide.
// Used when no curated diagram fits. gpt-4o gives far better layout than mini.
const { client: aiClient } = require('./ai-client');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const { mediaWriteDir } = require('./media');
const MODEL = process.env.OPENAI_DIAGRAM_MODEL || 'gpt-4o';
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function prompt(concept) {
  return `Produce a single clean, simple, LABELLED educational SVG diagram of: ${concept}.
Output ONLY raw <svg>…</svg> — no markdown, no commentary. Use viewBox="0 0 800 500" and make the
drawing FILL most of that canvas (use the space, don't leave big empty margins).
Flat vector style, bright friendly colours, white background. Arrange the parts in their correct
real-world positions; draw arrows where there is flow or sequence; put a short text label next to
each part with a thin leader line pointing to it. Labels MUST be bold, font-family Arial, font-size
22-26, fill="#1a1a1a" (dark, high contrast — never light grey). Keep labels accurate, well spaced and
NOT overlapping each other or the shapes. CRITICAL: every label and shape must sit FULLY inside the
0–800 × 0–500 canvas — keep the drawing within x=60..740 so right-side labels are never clipped.
No <script>, no <foreignObject>, no external images or fonts.`;
}

// Keep only the <svg> element; strip anything executable/unsafe.
function sanitize(raw) {
  let svg = String(raw || '').trim();
  const m = svg.match(/<svg[\s\S]*<\/svg>/i);
  svg = m ? m[0] : svg;
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '');
  return svg;
}

async function generateDiagram({ subject, topic, concept }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
  if (!concept || !concept.trim()) throw new Error('Nothing to diagram.');
  const client = aiClient();
  const res = await client.chat.completions.create({
    model: MODEL, max_tokens: 3000,
    messages: [{ role: 'user', content: prompt(concept) }],
  });
  const svg = sanitize(res.choices[0]?.message?.content);
  if (!/<svg[\s>]/i.test(svg)) throw new Error('Model did not return an SVG.');

  const png = await sharp(Buffer.from(svg), { density: 150 })
    .resize(1100, null, { fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();

  const subj = slug(subject), top = slug(topic);
  const folder = mediaWriteDir(subj, top);
  const filename = `${subj}_${top}_diagram_${(slug(concept).slice(0, 24) || 'd')}_${Date.now().toString(36)}.png`;
  fs.writeFileSync(path.join(folder, filename), png);

  return {
    subject: subj, topic: top, filename,
    relpath: path.posix.join(subj, top, filename),
    tags: [subj, top.replace(/-/g, ' ')],
    caption: concept,
    keywords: slug(concept).split('-').filter(Boolean),
    source: 'svg-diagram',
  };
}

module.exports = { generateDiagram };
