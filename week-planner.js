// Week-tracker lesson plans: one workbook per teacher, one TAB per week, one
// COLUMN per lesson within that week.
//
// This is a second, distinct shape of lesson-plan template. The original kind is
// a single document whose headings the generator mirrors (see template.js and
// lesson-plan.js). This kind is a living workbook the teacher keeps all term:
// generating a lesson fills the next free lesson slot in the right week's tab,
// and the teacher downloads the accumulated workbook whenever they want.
//
// Layout, taken from a real school template:
//   row 1        week title ("WEEK 2")
//   rows 2..n    one field per row, label in column A
//   columns B..F one lesson each — a subject with a single weekly lesson uses
//                only column B, and Unit/Topic/Red Thread may be merged across
//                the columns because they describe the whole week.
//
// exceljs rather than SheetJS because the teacher's workbook carries merges,
// column widths and row heights, and SheetJS's community build cannot write
// those back — the file would return to them stripped of its formatting.
const ExcelJS = require('exceljs');

const FIRST_LESSON_COL = 2;   // column B
const LAST_LESSON_COL = 6;    // column F
const TITLE_ROW = 1;

// ── Detection ──────────────────────────────────────────────────────────────
const WEEK_SHEET_RE = /(?:^|\W)week\s*(\d+)/i;

function weekNumberOf(sheetName) {
  const m = String(sheetName || '').match(WEEK_SHEET_RE);
  return m ? parseInt(m[1], 10) : null;
}

// A sheet called "Template (Week 2)" is the blank example, not week 2 itself.
function isTemplateSheet(name) {
  return /template/i.test(String(name || ''));
}

// How many lessons a week holds in THIS school's form. Some subjects plan one
// lesson a week and only ever use column B; others lay five across B..F. The
// template sheet shows the intended width — it is the blank example, drawn with
// every column the school expects to fill — so a workbook whose weeks are
// currently one column wide is still recognised as a five-lesson form.
function lessonsPerWeek(workbook) {
  const sheets = workbook.worksheets || [];
  const model = sheets.find(s => isTemplateSheet(s.name)) || sheets.find(s => weekNumberOf(s.name) !== null);
  if (!model) return 1;
  let widest = FIRST_LESSON_COL;
  model.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (_cell, n) => { if (n > widest) widest = n; });
  });
  // Merges that span the lesson columns describe the whole week, and their
  // width is the clearest statement of how many lessons the week holds.
  for (const range of Object.keys(model._merges || {})) {
    const m = String(range).match(/[A-Z]+\d+:([A-Z]+)\d+/);
    if (!m) continue;
    const end = m[1].split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
    if (end > widest) widest = end;
  }
  return Math.max(1, Math.min(LAST_LESSON_COL, widest) - FIRST_LESSON_COL + 1);
}

// A workbook is a week tracker when it has at least one sheet that names a week
// AND a column of field labels. The label check keeps an ordinary spreadsheet
// that merely mentions "week" from being mistaken for one.
function detect(workbook) {
  const sheets = workbook.worksheets || [];
  const weekSheets = sheets.filter(s => weekNumberOf(s.name) !== null);
  if (!weekSheets.length) return { isWeekPlanner: false };
  const model = weekSheets.find(s => !isTemplateSheet(s.name)) || weekSheets[0];
  const labels = fieldRows(model);
  if (Object.keys(labels).length < 4) return { isWeekPlanner: false };
  const perWeek = lessonsPerWeek(workbook);
  return {
    isWeekPlanner: true,
    // How the school's plan is shaped, so the app knows what to ask for:
    //   'weekly'          one lesson per week — only the week is needed
    //   'weekly-multi'    several lessons a week — week AND which lesson
    // (A single-document template isn't a workbook at all and never gets here.)
    shape: perWeek > 1 ? 'weekly-multi' : 'weekly',
    lessonsPerWeek: perWeek,
    templateSheet: sheets.find(s => isTemplateSheet(s.name))?.name || null,
    weeks: sheets.filter(s => weekNumberOf(s.name) !== null && !isTemplateSheet(s.name))
      .map((s) => {
        const map = mapRowsToFields(s);
        // Which lesson slots in this week already hold a lesson, so the app can
        // offer the next free one rather than making the teacher work it out.
        const used = [];
        for (let col = FIRST_LESSON_COL; col <= FIRST_LESSON_COL + perWeek - 1; col++) {
          if (columnHasContent(s, col, map)) used.push(col - FIRST_LESSON_COL + 1);
        }
        return { name: s.name, week: weekNumberOf(s.name), lessonsUsed: used };
      })
      .sort((a, b) => a.week - b.week),
    fields: Object.keys(labels),
  };
}

// ── Field labels ───────────────────────────────────────────────────────────
// Normalise a label so "Activities (50 m)", "Intro (10m)" and
// "Phonics (delete row if not applicable)" all reduce to something matchable.
function normaliseLabel(value) {
  return String(value == null ? '' : value)
    .replace(/\([^)]*\)/g, ' ')       // drop parenthetical instructions
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// label (normalised) -> row number, for every row that has a label in column A.
function fieldRows(sheet) {
  const out = {};
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === TITLE_ROW) return;
    const label = normaliseLabel(row.getCell(1).value);
    if (label && !out[label]) out[label] = n;
  });
  return out;
}

// Which generated value belongs in which row. Matched on the normalised label,
// longest key first so "post lesson reflection" wins over "lesson".
const FIELD_MATCHERS = [
  ['postLessonReflection', ['post lesson reflection', 'reflection next step', 'reflection']],
  ['periodAndLength',      ['period and length', 'period length', 'period']],
  ['keyVocabulary',        ['key vocabulary', 'vocabulary', 'vocab']],
  ['successCriteria',      ['sc', 'success criteria']],
  ['objectives',           ['lo', 'learning objective', 'learning objectives', 'objectives']],
  ['differentiation',      ['differentiation']],
  ['assessment',           ['assessment']],
  ['redThread',            ['red thread']],
  ['resources',            ['resources']],
  ['activities',           ['activities', 'main activities', 'main teaching', 'main']],
  ['plenary',              ['plenary']],
  ['phonics',              ['phonics']],
  ['subject',              ['subject']],
  ['topic',                ['topic']],
  ['intro',                ['intro', 'introduction', 'starter', 'hook', 'spark']],
  ['unit',                 ['unit']],
];

// Resolve each row of this sheet to one of our field keys (or null).
function mapRowsToFields(sheet) {
  const rows = fieldRows(sheet);
  const mapping = {};
  for (const [label, rowNumber] of Object.entries(rows)) {
    for (const [key, aliases] of FIELD_MATCHERS) {
      if (mapping[key]) continue;
      if (aliases.some(a => label === a || label.startsWith(a + ' ') || label === a.replace(/\s+/g, ''))) {
        mapping[key] = rowNumber;
        break;
      }
    }
  }
  return mapping;
}

// ── Reading / writing lessons ──────────────────────────────────────────────
const cellText = value => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(t => t.text).join('');
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    return '';
  }
  return String(value);
};

// Fields that mean "a lesson has been written here". Subject, Unit, Topic and
// Red Thread are deliberately excluded: they describe the whole week (in the
// school's own template Unit and Topic are merged across every lesson column),
// so a teacher who has pre-filled them has not yet used up a lesson slot.
const LESSON_CONTENT_FIELDS = ['objectives', 'successCriteria', 'intro', 'activities', 'plenary', 'assessment'];

// True when this lesson column already holds an actual lesson.
function columnHasContent(sheet, col, fieldMap) {
  return LESSON_CONTENT_FIELDS
    .filter(k => fieldMap[k])
    .some(k => cellText(sheet.getRow(fieldMap[k]).getCell(col).value).trim() !== '');
}

// The next lesson slot in a week. Subjects with one lesson a week only ever use
// column B; a subject with five fills B..F.
function nextFreeLessonColumn(sheet, fieldMap) {
  for (let col = FIRST_LESSON_COL; col <= LAST_LESSON_COL; col++) {
    if (!columnHasContent(sheet, col, fieldMap)) return col;
  }
  return null; // week already full
}

// Copy the layout of a model sheet — labels, widths, row heights, merges and
// the styling on both — without carrying over any lesson content. Used when a
// week the teacher is generating for doesn't exist yet.
function cloneWeekSheet(workbook, modelSheet, newName, weekNumber) {
  const sheet = workbook.addWorksheet(newName, {
    views: modelSheet.views,
    pageSetup: modelSheet.pageSetup,
  });

  modelSheet.columns.forEach((col, i) => {
    if (col && col.width) sheet.getColumn(i + 1).width = col.width;
  });

  modelSheet.eachRow({ includeEmpty: true }, (row, n) => {
    const target = sheet.getRow(n);
    if (row.height) target.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const t = target.getCell(colNumber);
      // Keep the label column and its styling; blank every lesson column.
      if (colNumber === 1 || n === TITLE_ROW) t.value = cell.value;
      if (cell.style) t.style = JSON.parse(JSON.stringify(cell.style));
    });
    target.commit();
  });

  // Re-apply merges (Unit/Topic/Red Thread often span the lesson columns).
  for (const range of Object.keys(modelSheet._merges || {})) {
    try { sheet.mergeCells(range); } catch { /* overlapping merge — skip */ }
  }

  if (weekNumber != null) {
    const titleCell = sheet.getRow(TITLE_ROW).getCell(2);
    titleCell.value = `WEEK ${weekNumber}`;
  }
  return sheet;
}

// Write one lesson into a week sheet. `values` is keyed by the field names in
// FIELD_MATCHERS; anything absent is left exactly as the teacher had it, so a
// blank stays blank rather than being overwritten with an empty string.
//
// postLessonReflection is never written even if supplied: the teacher fills it
// in after they have taught, and inventing it would put words in their mouth.
// Phonics is only written when the sheet actually has that row — some subjects
// delete it.
const NEVER_WRITE = new Set(['postLessonReflection']);

function writeLesson(sheet, col, values, fieldMap, { allow } = {}) {
  const map = fieldMap || mapRowsToFields(sheet);
  const written = [];
  for (const [key, rowNumber] of Object.entries(map)) {
    if (NEVER_WRITE.has(key) && !(allow && allow.has(key))) continue;
    const value = values[key];
    if (value == null || String(value).trim() === '') continue;
    const cell = sheet.getRow(rowNumber).getCell(col);
    // Don't fight a merge: writing to a covered cell throws in exceljs, and the
    // master cell already carries the week-level value.
    if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
    cell.value = String(value);
    cell.alignment = { ...(cell.alignment || {}), wrapText: true, vertical: 'top' };
    written.push(key);
  }
  sheet.getRow(TITLE_ROW).commit?.();
  return written;
}

// Find the sheet for a week, creating it from the best available model if the
// teacher hasn't reached that week yet.
function ensureWeekSheet(workbook, weekNumber) {
  const existing = workbook.worksheets.find(
    s => weekNumberOf(s.name) === weekNumber && !isTemplateSheet(s.name),
  );
  if (existing) return { sheet: existing, created: false };

  // Prefer a real week the teacher has already used (it reflects how they
  // actually keep the file); fall back to the blank template sheet.
  const weeks = workbook.worksheets
    .filter(s => weekNumberOf(s.name) !== null && !isTemplateSheet(s.name))
    .sort((a, b) => weekNumberOf(b.name) - weekNumberOf(a.name));
  const model = weeks[0] || workbook.worksheets.find(s => isTemplateSheet(s.name)) || workbook.worksheets[0];
  if (!model) return { sheet: null, created: false };

  const sheet = cloneWeekSheet(workbook, model, `Week ${weekNumber}`, weekNumber);
  return { sheet, created: true };
}

// A lesson already written into this week, identified by its topic. Filing the
// same lesson twice — downloading the plan, then generating the slides — must
// update that column rather than consume another slot and leave a duplicate.
function findLessonColumn(sheet, fieldMap, topic) {
  const want = String(topic || '').trim().toLowerCase();
  if (!want || !fieldMap.topic) return null;
  for (let col = FIRST_LESSON_COL; col <= LAST_LESSON_COL; col++) {
    const cell = sheet.getRow(fieldMap.topic).getCell(col);
    // A merged Topic describes the whole week, so it can't identify a lesson.
    if (cell.isMerged) continue;
    if (cellText(cell.value).trim().toLowerCase() === want) return col;
  }
  return null;
}

// The whole operation: put this lesson in the right week — updating the column
// it already occupies if it has been filed before, otherwise taking the next
// free slot. Returns what happened so the caller can tell the teacher.
function addLesson(workbook, weekNumber, values, lessonNumber, options) {
  const { sheet, created } = ensureWeekSheet(workbook, weekNumber);
  if (!sheet) return { ok: false, reason: 'no_week_sheet' };
  const fieldMap = mapRowsToFields(sheet);
  if (!Object.keys(fieldMap).length) return { ok: false, reason: 'no_fields' };

  // The teacher can say which lesson of the week this is — a week may hold
  // several, and "the third lesson" is theirs to decide, not ours to infer.
  // Failing that: the slot this lesson already occupies, else the next free one.
  const perWeek = lessonsPerWeek(workbook);
  const asked = parseInt(lessonNumber, 10);
  const chosen = Number.isFinite(asked) && asked >= 1 && asked <= perWeek
    ? FIRST_LESSON_COL + asked - 1
    : null;
  const existing = findLessonColumn(sheet, fieldMap, values.topic);
  const col = chosen || existing || nextFreeLessonColumn(sheet, fieldMap);
  if (!col) return { ok: false, reason: 'week_full', sheetName: sheet.name };
  const written = writeLesson(sheet, col, values, fieldMap, options);
  return {
    ok: true,
    sheetName: sheet.name,
    weekCreated: created,
    updated: !!existing,
    column: String.fromCharCode(64 + col),
    lessonNumber: col - FIRST_LESSON_COL + 1,
    fieldsWritten: written,
  };
}

// ── Assembling a lesson from what LessonScope already produces ─────────────
// Which generated plan section feeds which row. Matched loosely because the
// headings follow whatever template the school uploaded, not a fixed set.
const SECTION_SOURCES = {
  intro:           [/starter/i, /hook/i, /^intro/i, /spark/i, /warm/i],
  activities:      [/main teaching/i, /main activit/i, /guided practice/i, /^activit/i, /^we do/i, /^i do/i],
  plenary:         [/plenary/i, /exit (card|ticket)/i, /^recap/i, /review/i],
  assessment:      [/assessment/i, /check for understanding/i, /^check/i],
  differentiation: [/differentiat/i, /support.*stretch/i, /scaffold/i],
  resources:       [/resource/i, /material/i, /equipment/i],
  // Both of these are the model's to write. Key vocabulary is normally lifted
  // off the generated slides, but a deck the teacher imported carries no vocab
  // list — the words are only in its text — so the plan's own section has to be
  // able to fill the row. Red Thread reaches us from the pacing guide when
  // there is one; from slides alone the model works it out.
  keyVocabulary:   [/key vocab/i, /^vocab/i, /key word/i, /glossary/i],
  redThread:       [/red thread/i],
};

function sectionText(sections, patterns) {
  const list = Array.isArray(sections) ? sections : [];
  for (const pattern of patterns) {
    const hit = list.find(s => pattern.test(String(s && s.heading || '')));
    if (hit && String(hit.content || '').trim()) return String(hit.content).trim();
  }
  return '';
}

const asLines = v => (Array.isArray(v) ? v.filter(Boolean).join('\n') : String(v == null ? '' : v));

// Build the values for one lesson column.
//
// LO and SC are taken VERBATIM from what the teacher selected in the pacing
// guide — never from the generated "Learning Objectives" section, which may
// legitimately rephrase for prose. A school's LOs are the school's words, and
// the teacher's own template says to copy and paste them.
// ── Weekly sequences ───────────────────────────────────────────────────────
// A sequence plan is several lessons written as one document: the model keeps
// the school's field names and marks the periods inside them, because that is
// the only thing it can do to a single-document template.
//
// A week workbook is not a single document. It has a column per lesson, so
// three lessons belong in three columns — stacking them in the first one wastes
// the form and leaves the teacher separating them by hand.
const SEQUENCE_MARKER = /^\s*(?:\*\*)?\s*lesson\s+(\d+)\s*(?:of\s*\d+)?\s*(?:\([^)]*\))?\s*:?\s*(?:\*\*)?\s*$/i;

// Fields that describe the WEEK rather than one period. They are repeated into
// every lesson column instead of being carved up — and objectives especially,
// which are the pacing guide's words and are never rewritten or split.
const SHARED_FIELDS = new Set([
  'subject', 'unit', 'topic', 'periodAndLength', 'redThread', 'objectives', 'successCriteria',
]);

// Text under "Lesson 2 …" belongs to lesson 2. Anything before the first
// marker applies to all of them.
function splitFieldByLesson(text) {
  const byLesson = new Map();
  const shared = [];
  let current = null;
  for (const line of String(text == null ? '' : text).split('\n')) {
    const match = line.match(SEQUENCE_MARKER);
    if (match) {
      current = parseInt(match[1], 10);
      if (!byLesson.has(current)) byLesson.set(current, []);
      continue;
    }
    if (current === null) shared.push(line);
    else byLesson.get(current).push(line);
  }
  return { shared: shared.join('\n').trim(), byLesson };
}

// One set of values per lesson. Returns null when the plan carries no period
// markers at all — then it is one lesson and the caller files it as before.
function splitSequence(values, lessonCount) {
  // One lesson is not a sequence. Clamping up to two here would turn an
  // ordinary single lesson into a two-column split the teacher never asked for.
  const asked = parseInt(lessonCount, 10);
  if (!Number.isFinite(asked) || asked < 2) return null;
  const count = Math.min(LAST_LESSON_COL - FIRST_LESSON_COL + 1, asked);

  const split = {};
  let sawMarker = false;
  for (const [key, value] of Object.entries(values || {})) {
    if (SHARED_FIELDS.has(key)) continue;
    const parts = splitFieldByLesson(value);
    if (parts.byLesson.size) sawMarker = true;
    split[key] = parts;
  }
  if (!sawMarker) return null;

  const out = [];
  for (let lesson = 1; lesson <= count; lesson++) {
    const one = {};
    for (const [key, value] of Object.entries(values || {})) {
      if (SHARED_FIELDS.has(key)) { one[key] = value; continue; }
      const parts = split[key];
      const mine = (parts.byLesson.get(lesson) || []).join('\n').trim();
      // A field the model did not split (say Resources, written once for the
      // week) is repeated, because an empty Resources row in lessons 2 and 3
      // reads as an oversight rather than as "same as lesson 1".
      one[key] = mine || parts.shared;
    }
    out.push(one);
  }
  return out;
}

function reviewedValues(sections) {
  const out = {};
  for (const section of (Array.isArray(sections) ? sections : [])) {
    const key = section && section.fieldKey;
    if (!key) continue;
    out[key] = String(section.content == null ? '' : section.content).trim();
  }
  return out;
}

function lessonValuesFrom({
  subject = '', topic = '', unit = '', period = '',
  objectives = '', successCriteria = [], guideResources = [],
  planSections = [], vocab = [], redThread = '',
} = {}) {
  const vocabText = (Array.isArray(vocab) ? vocab : [])
    .map(v => (v && v.term ? (v.definition ? `${v.term} — ${v.definition}` : v.term) : String(v || '')))
    .filter(Boolean).join('\n');

  return {
    subject: String(subject || '').trim(),
    unit: String(unit || '').trim(),
    topic: String(topic || '').replace(/-/g, ' ').trim(),
    periodAndLength: String(period || '').trim(),
    // The pacing guide's Red Thread wins; from slides alone the plan's own is used.
    redThread: String(redThread || '').trim() || sectionText(planSections, SECTION_SOURCES.redThread),

    // Verbatim — see the note above. Do not route these through the model.
    objectives: asLines(objectives).trim(),
    successCriteria: asLines(successCriteria).trim(),

    keyVocabulary: vocabText || sectionText(planSections, SECTION_SOURCES.keyVocabulary),
    // Prefer the pacing guide's own resource list; fall back to the plan's.
    resources: asLines(guideResources).trim() || sectionText(planSections, SECTION_SOURCES.resources),

    intro: sectionText(planSections, SECTION_SOURCES.intro),
    activities: sectionText(planSections, SECTION_SOURCES.activities),
    plenary: sectionText(planSections, SECTION_SOURCES.plenary),
    differentiation: sectionText(planSections, SECTION_SOURCES.differentiation),
    assessment: sectionText(planSections, SECTION_SOURCES.assessment),
    // postLessonReflection deliberately absent — the teacher writes it after
    // teaching, and writeLesson() refuses it even if passed.
  };
}

module.exports = {
  ExcelJS,
  writeLesson, ensureWeekSheet, addLesson, LESSON_CONTENT_FIELDS, NEVER_WRITE,
  lessonValuesFrom, reviewedValues, sectionText, SECTION_SOURCES,
  splitSequence, splitFieldByLesson, SEQUENCE_MARKER, SHARED_FIELDS,
  FIRST_LESSON_COL, LAST_LESSON_COL, TITLE_ROW,
  weekNumberOf, isTemplateSheet, detect,
  normaliseLabel, fieldRows, mapRowsToFields,
  cellText, columnHasContent, nextFreeLessonColumn, cloneWeekSheet, findLessonColumn, lessonsPerWeek,
};

// ── Per-teacher storage ────────────────────────────────────────────────────
// The workbook is a living document: uploaded once, appended to all term, and
// downloaded whenever the teacher wants it. It lives on the persistent volume
// beside their templates (see media.js for why runtime writes never go to
// public/).
const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeFileAtomic, writeJsonAtomic } = require('./storage');

const plannerDir = userId => path.join(DATA_DIR, 'users', String(userId), 'week-planner');
const plannerFile = userId => path.join(plannerDir(userId), 'planner.xlsx');
const plannerMeta = userId => path.join(plannerDir(userId), 'planner.json');

function hasPlanner(userId) {
  try { return fs.existsSync(plannerFile(userId)); } catch { return false; }
}

function readPlannerMeta(userId) {
  try { return JSON.parse(fs.readFileSync(plannerMeta(userId), 'utf8')); } catch { return null; }
}

async function loadPlanner(userId) {
  if (!hasPlanner(userId)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(plannerFile(userId));
  return wb;
}

async function savePlanner(userId, workbook, meta = {}) {
  fs.mkdirSync(plannerDir(userId), { recursive: true });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  writeFileAtomic(plannerFile(userId), buffer);
  const info = detect(workbook);
  writeJsonAtomic(plannerMeta(userId), {
    ...(readPlannerMeta(userId) || {}),
    ...meta,
    updatedAt: new Date().toISOString(),
    shape: info.shape,
    lessonsPerWeek: info.lessonsPerWeek,
    weeks: info.weeks || [],
    fieldCount: (info.fields || []).length,
  });
  return buffer;
}

// Store a freshly uploaded workbook as this teacher's planner.
async function installPlanner(userId, buffer, filename) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const info = detect(wb);
  if (!info.isWeekPlanner) return { ok: false, reason: 'not_a_week_planner' };
  fs.mkdirSync(plannerDir(userId), { recursive: true });
  writeFileAtomic(plannerFile(userId), buffer);
  writeJsonAtomic(plannerMeta(userId), {
    filename: filename || 'lesson-plan.xlsx',
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    templateSheet: info.templateSheet,
    shape: info.shape,
    lessonsPerWeek: info.lessonsPerWeek,
    weeks: info.weeks,
    fieldCount: (info.fields || []).length,
  });
  return { ok: true, ...info };
}

// Append one generated lesson to the teacher's planner.
// Re-read the shape off a stored workbook and write it into the meta.
async function refreshMeta(userId) {
  const wb = await loadPlanner(userId);
  if (!wb) return {};
  const info = detect(wb);
  if (!info.isWeekPlanner) return {};
  const patch = { shape: info.shape, lessonsPerWeek: info.lessonsPerWeek, weeks: info.weeks };
  writeJsonAtomic(plannerMeta(userId), { ...(readPlannerMeta(userId) || {}), ...patch });
  return patch;
}

// File a sequence: lesson 1 into the chosen slot, the rest into the ones after
// it. Stops at the width of the form rather than writing off the end.
async function recordSequence(userId, weekNumber, valuesList, firstLesson, options) {
  const wb = await loadPlanner(userId);
  if (!wb) return { ok: false, reason: 'no_planner' };
  const week = parseInt(weekNumber, 10);
  if (!Number.isFinite(week) || week < 1) return { ok: false, reason: 'no_week' };

  const perWeek = lessonsPerWeek(wb);
  const start = Math.max(1, parseInt(firstLesson, 10) || 1);
  const results = [];
  for (let i = 0; i < valuesList.length; i++) {
    const slot = start + i;
    if (slot > perWeek) break;   // the week is full; say so rather than overwrite
    const result = addLesson(wb, week, valuesList[i], slot, options);
    if (!result.ok) return result;
    results.push(result);
  }
  if (!results.length) return { ok: false, reason: 'week_full' };
  await savePlanner(userId, wb);
  return {
    ...results[0],
    lessonsFiled: results.length,
    requested: valuesList.length,
    columns: results.map(r => r.column),
  };
}

async function recordLesson(userId, weekNumber, values, lessonNumber, options) {
  const wb = await loadPlanner(userId);
  if (!wb) return { ok: false, reason: 'no_planner' };
  const week = parseInt(weekNumber, 10);
  if (!Number.isFinite(week) || week < 1) return { ok: false, reason: 'no_week' };
  const result = addLesson(wb, week, values, lessonNumber, options);
  if (!result.ok) return result;
  await savePlanner(userId, wb);
  return result;
}

async function plannerBuffer(userId) {
  if (!hasPlanner(userId)) return null;
  return fs.readFileSync(plannerFile(userId));
}

function deletePlanner(userId) {
  try { fs.rmSync(plannerDir(userId), { recursive: true, force: true }); return true; } catch { return false; }
}

module.exports.hasPlanner = hasPlanner;
module.exports.readPlannerMeta = readPlannerMeta;
module.exports.loadPlanner = loadPlanner;
module.exports.savePlanner = savePlanner;
module.exports.installPlanner = installPlanner;
module.exports.recordSequence = recordSequence;
module.exports.refreshMeta = refreshMeta;
module.exports.recordLesson = recordLesson;
module.exports.plannerBuffer = plannerBuffer;
module.exports.deletePlanner = deletePlanner;

// ── Driving the lesson plan from the workbook's own fields ─────────────────
// The teacher reviews and edits the plan before slides are made. If their
// workbook has rows called "Intro (10m)", "SC" and "Post lesson Reflection",
// the review screen must show THOSE, not a generic structure — otherwise they
// are editing headings that never appear in the file they actually keep.
//
// Fields the model must not author:
//   objectives / successCriteria — the school's words, copied from the pacing
//     guide (see lesson-plan-domain-rules); shown so the teacher can see them.
//   postLessonReflection — written after teaching.
//   subject / unit / topic / period — metadata already known from context.
const NOT_AUTHORED = new Set([
  'objectives', 'successCriteria', 'postLessonReflection',
  'subject', 'unit', 'topic', 'periodAndLength',
]);

// The workbook's field labels in row order, with what each maps to.
function fieldOutline(workbook) {
  const info = detect(workbook);
  if (!info.isWeekPlanner) return null;
  const sheets = workbook.worksheets || [];
  const model = sheets.find(s => weekNumberOf(s.name) !== null && !isTemplateSheet(s.name))
    || sheets.find(s => isTemplateSheet(s.name));
  if (!model) return null;

  const byRow = {};
  for (const [key, row] of Object.entries(mapRowsToFields(model))) byRow[row] = key;

  const out = [];
  model.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === TITLE_ROW) return;
    const label = cellText(row.getCell(1).value).trim();
    if (!label) return;
    out.push({ row: n, label, key: byRow[n] || null, authored: byRow[n] ? !NOT_AUTHORED.has(byRow[n]) : true });
  });
  return out;
}

// A template block the lesson-plan prompt can mirror, built from the workbook's
// own labels so the generated sections come back named exactly as the teacher's
// rows. Only the rows the model should author are listed.
function templateTextFromWorkbook(workbook) {
  const outline = fieldOutline(workbook);
  if (!outline || !outline.length) return '';
  const authored = outline.filter(f => f.authored);
  if (!authored.length) return '';
  return authored.map(f => `${f.label}:`).join('\n');
}

module.exports.NOT_AUTHORED = NOT_AUTHORED;
module.exports.fieldOutline = fieldOutline;
module.exports.templateTextFromWorkbook = templateTextFromWorkbook;
