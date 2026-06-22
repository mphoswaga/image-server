// Generates an accurate, literal illustration with OpenAI's image model — for
// slides where a precise depiction matters (an example or a task, e.g.
// "a pizza cut exactly in half"), rather than a generic stock photo.
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function buildPrompt({ concept, subject, grade }) {
  return `A clean, simple educational illustration for a ${grade} ${subject} lesson. `
    + `Show, accurately and literally: ${concept}. `
    + `Flat modern vector style, bright friendly colours, plain white background, clear and uncluttered, `
    + `NO text, words, letters, numbers, or labels anywhere in the image.`;
}

// Returns base64 PNG. Tries the configured model, falls back to dall-e-3 (which
// is available on more accounts) if the primary errors.
async function genB64(client, model, prompt) {
  if (model === 'gpt-image-1') {
    const r = await client.images.generate({ model, prompt, size: '1536x1024', quality: QUALITY, n: 1 });
    return r.data[0].b64_json;
  }
  const r = await client.images.generate({ model: 'dall-e-3', prompt, size: '1792x1024', response_format: 'b64_json', n: 1 });
  return r.data[0].b64_json;
}

async function generateImage({ subject, topic, concept, grade = 'middle school' }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
  if (!concept || !concept.trim()) throw new Error('Nothing to illustrate for this slide.');
  const client = new OpenAI();
  const prompt = buildPrompt({ concept, subject, grade });

  let b64;
  try {
    b64 = await genB64(client, MODEL, prompt);
  } catch (err) {
    if (MODEL !== 'dall-e-3') {
      console.log(`Image model ${MODEL} failed (${err.message}); falling back to dall-e-3.`);
      b64 = await genB64(client, 'dall-e-3', prompt);
    } else {
      throw err;
    }
  }

  const subj = slug(subject), top = slug(topic);
  const folder = path.join(PUBLIC_DIR, subj, top);
  fs.mkdirSync(folder, { recursive: true });
  const filename = `${subj}_${top}_ai_${(slug(concept).slice(0, 24) || 'image')}_${Date.now().toString(36)}.png`;
  fs.writeFileSync(path.join(folder, filename), Buffer.from(b64, 'base64'));

  return {
    subject: subj, topic: top, filename,
    relpath: path.posix.join(subj, top, filename),
    tags: [subj, top.replace(/-/g, ' ')],
    caption: concept,
    keywords: slug(concept).split('-').filter(Boolean),
    source: 'ai-generated',
  };
}

module.exports = { generateImage };
