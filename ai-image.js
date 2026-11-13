// Generates an accurate, literal illustration with OpenAI's image model — for
// slides where a precise depiction matters (an example or a task, e.g.
// "a pizza cut exactly in half"), rather than a generic stock photo.
const { client: aiClient } = require('./ai-client');
const fs = require('fs');
const path = require('path');

const { mediaWriteDir } = require('./media');
// Retired models cannot serve new images. Keep current explicit overrides.
const DEFAULT_MODEL = 'gpt-image-2.5-flare';
const configuredModel = process.env.OPENAI_IMAGE_MODEL;
const MODEL = !configuredModel || ['gpt-image-1','dall-e-2','dall-e-3'].includes(configuredModel) ? DEFAULT_MODEL : configuredModel;
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function buildPrompt({ concept, subject, grade, presetId }) {
  const preset = require('./slide-presets').getPreset(presetId);
  const style = preset.design === 'primary'
    ? `Contemporary gouache and paper-cut storybook illustration with gentle texture, friendly but age-appropriate, calm cream background. Coordinated palette #${preset.primary}, #${preset.accent}, #${preset.soft}. One clear subject, generous margins. `
    : 'Flat modern vector style, bright friendly colours, plain white background, clear and uncluttered, ';
  return `A clean, simple educational illustration for a ${grade} ${subject} lesson. `
    + `Show, accurately and literally: ${concept}. `
    + style
    + `NO text, words, letters, numbers, or labels anywhere in the image.`;
}

// GPT Image returns base64 directly; response_format belongs to retired DALL-E.
async function genB64(client, model, prompt) {
  const r = await client.images.generate({ model, prompt, size: '1536x1024', quality: QUALITY, output_format:'png', n: 1 });
  const b64=r.data?.[0]?.b64_json;
  if(!b64)throw new Error('The illustration service returned no image. Please try again.');
  return b64;
}

async function generateImage({ subject, topic, concept, grade = 'middle school', presetId }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
  if (!concept || !concept.trim()) throw new Error('Nothing to illustrate for this slide.');
  const client = aiClient();
  const prompt = buildPrompt({ concept, subject, grade, presetId });

  const b64 = await genB64(client, MODEL, prompt);

  const subj = slug(subject), top = slug(topic);
  const folder = mediaWriteDir(subj, top);
  const filename = `${subj}_${top}_ai_${(slug(concept).slice(0, 24) || 'image')}_${Date.now().toString(36)}.png`;
  fs.writeFileSync(path.join(folder, filename), Buffer.from(b64, 'base64'));

  return {
    subject: subj, topic: top, filename,
    relpath: path.posix.join(subj, top, filename),
    tags: [subj, top.replace(/-/g, ' ')],
    caption: concept,
    keywords: slug(concept).split('-').filter(Boolean),
    source: 'ai-generated',
    illustrationStyle: require('./slide-presets').getPreset(presetId).design === 'primary' ? presetId : 'classic',
  };
}

module.exports = { generateImage, buildPrompt, model:MODEL };
