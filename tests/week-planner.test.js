// Week-tracker lesson plans: one workbook, a tab per week, a column per lesson.
//
// The rule that matters most here is that learning objectives are the school's
// words, copied from the pacing guide and never reworded — the teacher said so,
// and their own template says "Copy and paste the relevant LOs for this lesson
// from the pacing guide". The generator legitimately writes its own "Learning
// Objectives" prose section; that section must never become the LO field.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const wp = require('../week-planner.js');

const GUIDE_LO = 'LO1. Identify the rows, columns and cells of a spreadsheet.\nLO2. Enter data into the correct cell.';
const GUIDE_SC = ['I can point to a row and a column.', 'I can type a price into the right cell.'];

function values(extra = {}) {
  return wp.lessonValuesFrom({
    subject: 'ICT', topic: 'data-cafe', unit: 'Unit 1', period: 'Period 1 - 35 mins',
    objectives: GUIDE_LO,
    successCriteria: GUIDE_SC,
    planSections: [
      // A rephrased objectives section — present, and must be ignored.
      { heading: 'Learning Objectives', content: 'Students will understand spreadsheets better.' },
      { heading: 'Starter / Hook', content: 'Show a messy price list.' },
      { heading: 'Main Teaching', content: 'Model naming rows and columns.' },
      { heading: 'Plenary / Exit Card', content: 'Exit ticket: what is a cell?' },
    ],
    ...extra,
  });
}

test('learning objectives are copied verbatim, never the model\'s rewording', () => {
  const v = values();
  assert.equal(v.objectives, GUIDE_LO, 'LO must be byte-identical to the pacing guide');
  assert.doesNotMatch(v.objectives, /understand spreadsheets better/, 'the generated section must not leak into LO');
});

test('success criteria are verbatim too', () => {
  assert.equal(values().successCriteria, GUIDE_SC.join('\n'));
});

test('the pacing guide\'s resources win over the generated ones', () => {
  const v = values({
    guideResources: ['Laptops (one per pair)'],
    planSections: [{ heading: 'Resources', content: 'Some invented resource list.' }],
  });
  assert.equal(v.resources, 'Laptops (one per pair)');
});

test('post-lesson reflection is never produced or written', () => {
  assert.ok(!('postLessonReflection' in values()), 'not produced by the mapper');
  assert.ok(wp.NEVER_WRITE.has('postLessonReflection'), 'and refused by the writer');
});

test('plan sections map onto the school\'s row labels', () => {
  const v = values();
  assert.equal(v.intro, 'Show a messy price list.');
  assert.equal(v.activities, 'Model naming rows and columns.');
  assert.equal(v.plenary, 'Exit ticket: what is a cell?');
  assert.equal(v.assessment, '', 'a section that was not generated stays blank rather than invented');
});

test('labels are matched despite bracketed instructions', () => {
  // "Intro (10m)", "Activities (50 m)" and "Phonics (delete row if not
  // applicable)" all have to resolve.
  assert.equal(wp.normaliseLabel('Intro (10m)'), 'intro');
  assert.equal(wp.normaliseLabel('Activities (50 m)'), 'activities');
  assert.equal(wp.normaliseLabel('Phonics (delete row if not applicable)'), 'phonics');
  assert.equal(wp.normaliseLabel('Post lesson Reflection & Next Step'), 'post lesson reflection next step');
});

test('week numbers are read from sheet names, and template sheets are not weeks', () => {
  assert.equal(wp.weekNumberOf('Week 1'), 1);
  assert.equal(wp.weekNumberOf('WEEK 12'), 12);
  assert.equal(wp.weekNumberOf('Template (Week 2)'), 2);
  assert.equal(wp.weekNumberOf('Summary'), null);
  assert.ok(wp.isTemplateSheet('Template (Week 2)'), 'the example sheet is not a real week');
  assert.ok(!wp.isTemplateSheet('Week 2'));
});

test('the plan is driven by the workbook\'s own field labels', async () => {
  const wb = new wp.ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Week 1');
  sheet.getRow(1).getCell(2).value = 'WEEK 1';
  ['Subject', 'Topic', 'LO', 'SC', 'Key vocabulary', 'Intro (10m)', 'Activities (50 m)', 'Post lesson Reflection & Next Step']
    .forEach((label, i) => { sheet.getRow(i + 2).getCell(1).value = label; });

  const outline = wp.fieldOutline(wb);
  assert.ok(outline, 'a week workbook yields an outline');
  const byLabel = Object.fromEntries(outline.map(f => [f.label, f]));

  // The model writes the teaching content...
  assert.equal(byLabel['Intro (10m)'].authored, true);
  assert.equal(byLabel['Key vocabulary'].authored, true);
  // ...but never the school's objectives, nor the teacher's own reflection.
  assert.equal(byLabel['LO'].authored, false, 'objectives are the pacing guide\'s words');
  assert.equal(byLabel['SC'].authored, false);
  assert.equal(byLabel['Post lesson Reflection & Next Step'].authored, false, 'written after teaching');
  assert.equal(byLabel['Subject'].authored, false, 'metadata already known');

  // The prompt gets the teacher's labels, so sections come back named like
  // their rows rather than a generic structure.
  const text = wp.templateTextFromWorkbook(wb);
  assert.match(text, /Intro \(10m\):/);
  assert.match(text, /Activities \(50 m\):/);
  assert.doesNotMatch(text, /\bLO:/, 'objectives are not for the model to write');
  assert.doesNotMatch(text, /Reflection/, 'reflection is not for the model to write');
});

test('a workbook that is not a week tracker yields no outline', async () => {
  const wb = new wp.ExcelJS.Workbook();
  const s = wb.addWorksheet('Sheet1');
  s.getRow(1).getCell(1).value = 'Just a spreadsheet';
  assert.equal(wp.fieldOutline(wb), null);
  assert.equal(wp.templateTextFromWorkbook(wb), '');
});

test('filing the same lesson twice updates its column instead of duplicating', async () => {
  // The plan is filed when the teacher downloads it at the review stage, and
  // again when they generate the slides. That must not consume two lesson slots
  // and leave the week showing the same lesson twice.
  const wb = new wp.ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Week 1');
  sheet.getRow(1).getCell(2).value = 'WEEK 1';
  ['Subject', 'Topic', 'LO', 'Activities (50 m)'].forEach((l, i) => { sheet.getRow(i + 2).getCell(1).value = l; });

  const lesson = topic => ({ subject: 'ICT', topic, objectives: 'LO1.', activities: 'Do the thing.' });

  const first = wp.addLesson(wb, 1, lesson('Computer Systems'));
  assert.equal(first.column, 'B');
  assert.equal(first.updated, false);

  const again = wp.addLesson(wb, 1, lesson('Computer Systems'));
  assert.equal(again.column, 'B', 'same lesson returns to the same column');
  assert.equal(again.updated, true);

  const different = wp.addLesson(wb, 1, lesson('Spreadsheets'));
  assert.equal(different.column, 'C', 'a different lesson still takes a new slot');
  assert.equal(different.updated, false);
});

test('the school\'s form declares how many lessons a week holds', async () => {
  // Two shapes have to work: a subject planning one lesson a week (only column
  // B), and one laying five across B..F. The blank "Template" sheet is drawn at
  // the school's intended width, so a term whose weeks are only one column wide
  // so far is still a five-lesson form.
  const one = new wp.ExcelJS.Workbook();
  const w1 = one.addWorksheet('Week 1');
  ['Subject', 'Topic', 'LO', 'Activities'].forEach((l, i) => { w1.getRow(i + 2).getCell(1).value = l; });
  w1.getRow(2).getCell(2).value = 'ICT';
  assert.equal(wp.lessonsPerWeek(one), 1);
  assert.equal(wp.detect(one).shape, 'weekly');

  const many = new wp.ExcelJS.Workbook();
  const tpl = many.addWorksheet('Template (Week 2)');
  ['Subject', 'Topic', 'LO', 'Activities'].forEach((l, i) => { tpl.getRow(i + 2).getCell(1).value = l; });
  tpl.getRow(2).getCell(6).value = '';                 // the form reaches column F
  tpl.getRow(2).getCell(6).value = 'Lesson 5';
  const w = many.addWorksheet('Week 1');
  ['Subject', 'Topic', 'LO', 'Activities'].forEach((l, i) => { w.getRow(i + 2).getCell(1).value = l; });
  assert.equal(wp.lessonsPerWeek(many), 5);
  const info = wp.detect(many);
  assert.equal(info.shape, 'weekly-multi', 'the app must ask which lesson, not guess');
  assert.equal(info.weeks.length, 1, 'the blank template sheet is not a week of teaching');
});

test('the teacher chooses the lesson slot, and the week reports which are used', async () => {
  const wb = new wp.ExcelJS.Workbook();
  const tpl = wb.addWorksheet('Template (Week 2)');
  ['Subject', 'Topic', 'LO', 'Activities'].forEach((l, i) => { tpl.getRow(i + 2).getCell(1).value = l; });
  tpl.getRow(2).getCell(6).value = 'x';
  const sheet = wb.addWorksheet('Week 3');
  ['Subject', 'Topic', 'LO', 'Activities'].forEach((l, i) => { sheet.getRow(i + 2).getCell(1).value = l; });

  const lesson = topic => ({ subject: 'ICT', topic, objectives: 'LO1.', activities: 'Do it.' });

  // Asked for lesson 4 — it goes to lesson 4, not to the next free slot.
  const put = wp.addLesson(wb, 3, lesson('Cells'), 4);
  assert.equal(put.lessonNumber, 4);
  assert.equal(put.column, 'E');

  assert.deepEqual(wp.detect(wb).weeks[0].lessonsUsed, [4], 'the UI can offer the free slots');

  // An out-of-range slot is ignored rather than writing off the end of the form.
  assert.equal(wp.addLesson(wb, 3, lesson('Rows'), 9).lessonNumber, 1);
});

test('Red Thread and Key vocabulary are filled from the plan when nothing else supplies them', () => {
  // A deck the teacher imported carries no vocab list — the words exist only in
  // its text — and there is no pacing guide to state the Red Thread. Both rows
  // used to come back blank even though the model had written those sections.
  const v = wp.lessonValuesFrom({
    subject: 'ICT', topic: 'using the mouse',
    planSections: [
      { heading: 'Red Thread', content: 'Precise input, built on in later ICT units.' },
      { heading: 'Key vocabulary', content: 'Cursor — the arrow that shows where you point.' },
    ],
  });
  assert.equal(v.redThread, 'Precise input, built on in later ICT units.');
  assert.equal(v.keyVocabulary, 'Cursor — the arrow that shows where you point.');
});

test('the pacing guide and the real slide vocabulary still win over the plan\'s prose', () => {
  const v = wp.lessonValuesFrom({
    redThread: 'From the pacing guide.',
    vocab: [{ term: 'Cursor', definition: 'the pointer' }],
    planSections: [
      { heading: 'Red Thread', content: 'the model\'s version' },
      { heading: 'Key vocabulary', content: 'the model\'s version' },
    ],
  });
  assert.equal(v.redThread, 'From the pacing guide.');
  assert.equal(v.keyVocabulary, 'Cursor — the pointer');
});
