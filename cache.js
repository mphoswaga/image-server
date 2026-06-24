// LLM response cache: sha256(namespace+sorted-inputs) → JSON in DATA_DIR/cache/.
// Enabled by default; set LLM_CACHE=false to disable.
// Pass `regenerate: true` in inputs to bypass the cache and refresh the stored value.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const ENABLED = process.env.LLM_CACHE !== 'false';
const CACHE_DIR = path.join(DATA_DIR, 'cache');

// Deterministic JSON serialisation regardless of object key insertion order.
function sortedStringify(val) {
  if (val === null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return '[' + val.map(sortedStringify).join(',') + ']';
  return '{' + Object.keys(val).sort().map(k => JSON.stringify(k) + ':' + sortedStringify(val[k])).join(',') + '}';
}

function cacheKey(namespace, inputs) {
  return crypto.createHash('sha256').update(namespace + ':' + sortedStringify(inputs)).digest('hex');
}

function ensureDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function get(namespace, inputs) {
  if (!ENABLED) return null;
  try {
    ensureDir();
    const file = path.join(CACHE_DIR, cacheKey(namespace, inputs) + '.json');
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed.data ?? null;
  } catch { return null; }
}

function set(namespace, inputs, data) {
  if (!ENABLED) return;
  try {
    ensureDir();
    const file = path.join(CACHE_DIR, cacheKey(namespace, inputs) + '.json');
    writeJsonAtomic(file, { namespace, inputs, data, cachedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('[cache] write failed:', err.message);
  }
}

// Wrap a generator with a cache check.
// If inputs.regenerate === true, bypass the cache and replace the stored value.
async function wrap(namespace, inputs, generate) {
  const { regenerate, ...keyInputs } = inputs;
  if (!regenerate) {
    const cached = get(namespace, keyInputs);
    if (cached !== null) {
      console.log(`[cache] hit: ${namespace}`);
      return cached;
    }
  }
  const result = await generate();
  set(namespace, keyInputs, result);
  return result;
}

module.exports = { wrap };
