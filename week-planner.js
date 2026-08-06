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
  return {
    isWeekPlanner: true,
    templateSheet: sheets.find(s => isTemplateSheet(s.name))?.name || null,
    weeks: sheets.filter(s => weekNumberOf(s.name) !== null && !isTemplateSheet(s.name))
      .map(s => ({ name: s.name, week: weekNumberOf(s.name) }))
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

function writeLesson(sheet, col, values, fieldMap) {
  const map = fieldMap || mapRowsToFields(sheet);
  const written = [];
  for (const [key, rowNumber] of Object.entries(map)) {
    if (NEVER_WRITE.has(key)) continue;
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

// The whole operation: put this lesson in the right week, in the next free
// lesson slot. Returns what happened so the caller can tell the teacher.
function addLesson(workbook, weekNumber, values) {
  const { sheet, created } = ensureWeekSheet(workbook, weekNumber);
  if (!sheet) return { ok: false, reason: 'no_week_sheet' };
  const fieldMap = mapRowsToFields(sheet);
  if (!Object.keys(fieldMap).length) return { ok: false, reason: 'no_fields' };
  const col = nextFreeLessonColumn(sheet, fieldMap);
  if (!col) return { ok: false, reason: 'week_full', sheetName: sheet.name };
  const written = writeLesson(sheet, col, values, fieldMap);
  return {
    ok: true,
    sheetName: sheet.name,
    weekCreated: created,
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
    redThread: String(redThread || '').trim(),

    // Verbatim — see the note above. Do not route these through the model.
    objectives: asLines(objectives).trim(),
    successCriteria: asLines(successCriteria).trim(),

    keyVocabulary: vocabText,
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
  lessonValuesFrom, sectionText, SECTION_SOURCES,
  FIRST_LESSON_COL, LAST_LESSON_COL, TITLE_ROW,
  weekNumberOf, isTemplateSheet, detect,
  normaliseLabel, fieldRows, mapRowsToFields,
  cellText, columnHasContent, nextFreeLessonColumn, cloneWeekSheet,
};
