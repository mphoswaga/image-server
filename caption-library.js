// One-time vision pass: describe every image so matching can be content-aware.
//
//   node caption-library.js                 # caption the whole library
//   node caption-library.js maths           # only this subject
//   node caption-library.js maths fractions # only this topic
//   node caption-library.js --limit 10      # first 10 uncaptioned (for testing)
//
// Resumable: images that already have a `caption` are skipped, so you can stop
// and re-run. Writes public/library.json after every batch.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const PUBLIC_DIR = path.join(__dirname, 'public');
const LIBRARY_PATH = path.join(PUBLIC_DIR, 'library.json');
const MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
// Concurrency 3 keeps us well under the 200K tokens/min gpt-4o-mini limit
// (~1K tokens/image). maxRetries lets the SDK back off on any 429 burst.
const CONCURRENCY = 3;

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
  },
  required: ['caption', 'keywords'],
  additionalProperties: false,
};

const client = new OpenAI({ maxRetries: 6 }); // auto-backoff on 429, honoring retry-after

async function captionImage(absPath) {
  const b64 = fs.readFileSync(absPath).toString('base64');
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Describe this photo for use in a teaching slide deck. Give a one-sentence caption of what is literally shown, plus 4-8 concrete keywords (objects, setting, concepts visible). Focus on what is in the image, not interpretation.',
        },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'low' } },
      ],
    }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'image_caption', strict: true, schema: CAPTION_SCHEMA },
    },
  });
  return JSON.parse(res.choices[0].message.content);
}

async function run() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1) {
    limit = parseInt(args[limitIdx + 1], 10) || Infinity;
    args.splice(limitIdx, 2);
  }
  const [subjectFilter, topicFilter] = args.map(a => a && a.toLowerCase());

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set — add it to .env first.');
    process.exit(1);
  }

  const library = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));

  // Build the work list: uncaptioned images matching the optional filters.
  const todo = library.images.filter(img =>
    !img.caption &&
    (!subjectFilter || img.subject === subjectFilter) &&
    (!topicFilter || img.topic === topicFilter)
  ).slice(0, limit);

  const total = library.images.length;
  const captioned = library.images.filter(i => i.caption).length;
  console.log(`Library: ${total} images, ${captioned} already captioned.`);
  console.log(`To caption now: ${todo.length} (model: ${MODEL})\n`);
  if (!todo.length) return;

  let done = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async img => {
      try {
        const { caption, keywords } = await captionImage(path.join(PUBLIC_DIR, img.relpath));
        img.caption = caption;
        img.keywords = keywords;
        done++;
        process.stdout.write(`  [${done + failed}/${todo.length}] ${img.relpath} -> ${caption.slice(0, 60)}\n`);
      } catch (err) {
        failed++;
        process.stdout.write(`  [${done + failed}/${todo.length}] FAILED ${img.relpath}: ${err.message}\n`);
      }
    }));
    // Persist after every batch so progress survives interruption.
    library.captionedAt = new Date().toISOString();
    fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2));
  }

  console.log(`\nDone. Captioned ${done}, failed ${failed}. Saved -> ${LIBRARY_PATH}`);
}

// Only run the bulk job when invoked directly (`node caption-library.js`),
// so other modules can import captionImage without triggering a full run.
if (require.main === module) {
  run().catch(err => {
    console.error('Captioning failed:', err.message);
    process.exit(1);
  });
}

module.exports = { captionImage };
