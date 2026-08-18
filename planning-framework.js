const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeFileAtomic, writeJsonAtomic } = require('./storage');
const { client } = require('./ai-client');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TYPES = ['observation', 'teaching', 'assessment', 'inclusion', 'homework', 'custom'];
const APPLIES_TO = ['all', 'observation', 'optional'];
const MAX_SOURCE = 24000;
const MAX_REQUIREMENTS = 16;

const frameworkDir = userId => path.join(DATA_DIR, 'users', String(userId), 'planning-frameworks');
const recordPath = (userId, id) => path.join(frameworkDir(userId), `${id}.json`);
const originalPath = (userId, id, ext) => path.join(frameworkDir(userId), `${id}-original${ext}`);
const safeId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : '';

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanLines(value, limit = MAX_REQUIREMENTS) {
  const lines = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return lines.map(item => clean(String(item).replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, ''), 500))
    .filter(Boolean).slice(0, limit);
}

function normalizeDraft(input = {}) {
  return {
    summary: clean(input.summary, 1200),
    requirements: cleanLines(input.requirements),
    avoidances: cleanLines(input.avoidances, 10),
  };
}

function fallbackDraft(text) {
  const paragraphs = String(text || '').replace(/\r/g, '').split(/\n\s*\n/)
    .map(block => clean(block.replace(/\n/g, ' '), 1200)).filter(Boolean);
  const sentences = paragraphs.flatMap(block => block.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map(line => clean(line, 500)).filter(line => line.length >= 35);
  const requirements = sentences.filter(line => /\b(?:should|must|require|ensure|use|include|design|provide|allow|focus|create|assess|check)\b/i.test(line)).slice(0, 10);
  return normalizeDraft({
    summary: 'Review the extracted guidance below before activating this framework.',
    requirements: requirements.length ? requirements : sentences.slice(0, 8),
    avoidances: sentences.filter(line => /\b(?:avoid|do not|should not|never)\b/i.test(line)).slice(0, 6),
  });
}

const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    requirements: { type: 'array', maxItems: MAX_REQUIREMENTS, items: { type: 'string' } },
    avoidances: { type: 'array', maxItems: 10, items: { type: 'string' } },
  },
  required: ['summary', 'requirements', 'avoidances'],
};

async function analyze(text) {
  const source = String(text || '').trim().slice(0, MAX_SOURCE);
  if (!source) throw new Error('No readable framework text was found.');
  if (!process.env.OPENAI_API_KEY) return fallbackDraft(source);
  const response = await client().chat.completions.create({
    model: MODEL,
    temperature: 0.15,
    messages: [
      {
        role: 'system',
        content: `Extract a concise, reviewable planning framework from a school or teacher guidance document.

Return only requirements that can meaningfully shape lesson planning. Preserve the source's intent. Requirements must be short, actionable sentences. Avoid turning examples into universal rules. Put explicit cautions and prohibited practices in avoidances. Do not invent requirements, score teachers, mention file names, or include student personal data. The result is a draft that a teacher must approve before use.`,
      },
      { role: 'user', content: source },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'planning_framework', strict: true, schema: ANALYSIS_SCHEMA } },
  });
  return normalizeDraft(JSON.parse(response.choices[0].message.content));
}

function list(userId) {
  const dir = frameworkDir(userId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function get(userId, id) {
  const validId = safeId(id);
  if (!validId) return null;
  const file = recordPath(userId, validId);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function create(userId, { name, type, appliesTo, filename, sourceText, buffer, draft }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ext = path.extname(filename || '').toLowerCase();
  fs.mkdirSync(frameworkDir(userId), { recursive: true });
  if (buffer && ext) writeFileAtomic(originalPath(userId, id, ext), buffer);
  const rec = {
    id,
    ownerType: 'personal',
    name: clean(name, 100) || clean(String(filename || '').replace(/\.[^.]+$/, ''), 100) || 'My planning framework',
    type: TYPES.includes(type) ? type : 'custom',
    appliesTo: APPLIES_TO.includes(appliesTo) ? appliesTo : 'optional',
    filename: clean(filename, 180), ext, hasOriginal: !!buffer,
    status: 'review', active: false,
    ...normalizeDraft(draft),
    sourceText: String(sourceText || '').trim().slice(0, MAX_SOURCE),
    version: 1, versions: [], createdAt: now, updatedAt: now,
  };
  writeJsonAtomic(recordPath(userId, id), rec);
  return rec;
}

function update(userId, id, changes = {}) {
  const rec = get(userId, id);
  if (!rec) return null;
  const previous = {
    version: rec.version || 1, name: rec.name, type: rec.type, appliesTo: rec.appliesTo,
    summary: rec.summary, requirements: rec.requirements, avoidances: rec.avoidances,
    active: !!rec.active, savedAt: rec.updatedAt,
  };
  const nextDraft = normalizeDraft({
    summary: changes.summary == null ? rec.summary : changes.summary,
    requirements: changes.requirements == null ? rec.requirements : changes.requirements,
    avoidances: changes.avoidances == null ? rec.avoidances : changes.avoidances,
  });
  if (changes.active === true && (!nextDraft.summary || !nextDraft.requirements.length)) {
    throw new Error('Add a summary and at least one requirement before activating this framework.');
  }
  const updated = {
    ...rec,
    name: changes.name == null ? rec.name : (clean(changes.name, 100) || rec.name),
    type: TYPES.includes(changes.type) ? changes.type : rec.type,
    appliesTo: APPLIES_TO.includes(changes.appliesTo) ? changes.appliesTo : rec.appliesTo,
    ...nextDraft,
    active: changes.active == null ? !!rec.active : !!changes.active,
    status: changes.active === true ? 'active' : (changes.active === false ? 'review' : rec.status),
    version: (rec.version || 1) + 1,
    versions: [...(Array.isArray(rec.versions) ? rec.versions : []), previous].slice(-20),
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(recordPath(userId, id), updated);
  return updated;
}

function remove(userId, id) {
  const rec = get(userId, id);
  if (!rec) return false;
  try { fs.unlinkSync(recordPath(userId, id)); } catch {}
  if (rec.ext) { try { fs.unlinkSync(originalPath(userId, id, rec.ext)); } catch {} }
  return true;
}

function promptText(rec) {
  if (!rec || !rec.active) return '';
  const requirements = cleanLines(rec.requirements).map(item => `- ${item}`).join('\n');
  const avoidances = cleanLines(rec.avoidances, 10).map(item => `- ${item}`).join('\n');
  return `PLANNING FRAMEWORK: ${clean(rec.name, 100)}\nSummary: ${clean(rec.summary, 1200)}\nRequirements:\n${requirements}${avoidances ? `\nAvoid:\n${avoidances}` : ''}`.slice(0, 7000);
}

module.exports = { TYPES, APPLIES_TO, analyze, list, get, create, update, remove, promptText, normalizeDraft };
