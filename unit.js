// Unit (scheme-of-work) management. Teachers upload a scheme of work; LessonCope
// parses it into a structured unit so every lesson plan and deck knows its
// position in the sequence — prior lesson, next lesson, assessment goals.
// Stored at DATA_DIR/users/<teacherId>/units/<id>.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { client: aiClient } = require('./ai-client');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function unitDir(teacherId) { return path.join(DATA_DIR, 'users', teacherId, 'units'); }
function unitPath(teacherId, id) { return path.join(unitDir(teacherId), id + '.json'); }

// ── Parsing ────────────────────────────────────────────────────────────────

const UNIT_SCHEMA = {
  type: 'object',
  properties: {
    name:     { type: 'string' },
    subject:  { type: 'string' },
    grade:    { type: 'string' },
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n:               { type: 'integer' },
          title:           { type: 'string' },
          objectives:      { type: 'string' },
          assessmentGoals: { type: 'string' },
        },
        required: ['n', 'title', 'objectives', 'assessmentGoals'],
        additionalProperties: false,
      },
    },
    assessments: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'subject', 'grade', 'lessons', 'assessments'],
  additionalProperties: false,
};

async function parseUnit(text) {
  const ai = aiClient();
  const res = await ai.chat.completions.create({
    model: MODEL, max_tokens: 6000,
    messages: [{
      role: 'user',
      content: `Extract the full structure of this scheme of work / unit plan.

--- SCHEME OF WORK ---
${String(text || '').slice(0, 10000)}
--- END ---

Extract:
- name: the unit/module name (infer if not explicit)
- subject: one word, lowercase (e.g. "maths", "english", "science")
- grade: grade or year level (e.g. "Grade 5", "Year 7"; infer from context)
- lessons: every lesson/session, each with:
    n: lesson number (integer from 1)
    title: lesson title or topic
    objectives: what students should be able to do (1-2 sentences; infer if not stated)
    assessmentGoals: what to assess in/after this lesson (1 sentence; infer if not stated)
- assessments: any formal assessments mentioned (e.g. "Mid-unit test after lesson 4"). Empty array if none.

Number lessons sequentially from 1 if not explicit. Output plain text — no markdown, no bullet symbols.`,
    }],
    response_format: { type: 'json_schema', json_schema: { name: 'unit', strict: true, schema: UNIT_SCHEMA } },
  });
  const out = res.choices[0]?.message?.content;
  if (!out) throw new Error('No unit structure returned from the model.');
  return JSON.parse(out);
}

// ── Storage ────────────────────────────────────────────────────────────────

async function saveUnit(teacherId, parsed, originalFilename) {
  fs.mkdirSync(unitDir(teacherId), { recursive: true });
  const id = crypto.randomUUID().split('-')[0];
  const record = { id, ...parsed, originalFilename: originalFilename || null, createdAt: new Date().toISOString() };
  writeJsonAtomic(unitPath(teacherId, id), record);
  return record;
}

function getUnit(teacherId, id) {
  try { return JSON.parse(fs.readFileSync(unitPath(teacherId, id), 'utf8')); } catch { return null; }
}

function listUnits(teacherId) {
  const dir = unitDir(teacherId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const u = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { id: u.id, name: u.name, subject: u.subject, grade: u.grade, lessonCount: (u.lessons || []).length, createdAt: u.createdAt };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function deleteUnit(teacherId, id) {
  const p = unitPath(teacherId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ── Context block ──────────────────────────────────────────────────────────
// Builds a compact text block injected into lesson-plan and lesson-pack prompts.

function buildUnitBlock(unit, lessonIndex) {
  if (!unit || !Array.isArray(unit.lessons) || !unit.lessons.length) return '';
  const idx = Math.max(0, Math.min(Number(lessonIndex) || 0, unit.lessons.length - 1));
  const lesson = unit.lessons[idx];
  if (!lesson) return '';
  const prev = idx > 0 ? unit.lessons[idx - 1] : null;
  const next = idx < unit.lessons.length - 1 ? unit.lessons[idx + 1] : null;
  const n = lesson.n || (idx + 1);

  return [
    `\nUNIT CONTEXT — "${unit.name}" (lesson ${n} of ${unit.lessons.length}, ${unit.subject}, ${unit.grade}):`,
    prev ? `Previous lesson (${prev.n}): "${prev.title}" — students already covered: ${prev.objectives || '(see scheme of work)'}` : null,
    `This lesson (${n}): "${lesson.title}"`,
    next ? `Next lesson (${next.n}): "${next.title}" — signpost this, but do NOT teach it yet` : null,
    lesson.assessmentGoals ? `Assessment goals: ${lesson.assessmentGoals}` : null,
    unit.assessments && unit.assessments.length ? `Formal assessments: ${unit.assessments.join('; ')}` : null,
    `Instructions: draw on what students know from the previous lesson; align content to the assessment goals above; signpost what is coming next.`,
  ].filter(Boolean).join('\n');
}

module.exports = { parseUnit, saveUnit, getUnit, listUnits, deleteUnit, buildUnitBlock };
