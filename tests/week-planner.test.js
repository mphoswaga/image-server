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

test('derived success criteria fill SC when the pacing guide supplied none', async () => {
  const wb = new wp.ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Week 1');
  sheet.getRow(1).getCell(2).value = 'WEEK 1';
  ['Subject', 'LO', 'SC', 'Activities (50 m)'].forEach((label, index) => {
    sheet.getRow(index + 2).getCell(1).value = label;
  });
  const result = wp.addLesson(wb, 1, wp.lessonValuesFrom({
    subject: 'ICT',
    objectives: 'Identify the monitor and keyboard.',
    successCriteria: ['I can name the monitor and keyboard.'],
    planSections: [{ heading: 'Activities (50 m)', content: 'Teaching model: Gradual Release\nI Do: Model the task.' }],
  }));
  assert.equal(result.ok, true);
  assert.equal(sheet.getRow(4).getCell(2).value, 'I can name the monitor and keyboard.');
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

test('what the teacher edited on the review screen is what gets written', () => {
  // Every row on the review screen carries the workbook row it fills, so an
  // edit lands in that row instead of being re-derived from the slides.
  const edited = wp.reviewedValues([
    { heading: 'Unit', content: 'Unit 3 — Input devices', fieldKey: 'unit' },
    { heading: 'LO', content: 'LO1. The words I actually want.', fieldKey: 'objectives' },
    { heading: 'Intro (10m)', content: '', fieldKey: 'intro' },        // cleared on purpose
    { heading: 'Something the app invented', content: 'ignore me' },   // no row: not written
  ]);
  assert.equal(edited.unit, 'Unit 3 — Input devices');
  assert.equal(edited.objectives, 'LO1. The words I actually want.');
  assert.equal(edited.intro, '', 'a row they cleared stays cleared');
  assert.ok(!('undefined' in edited));
  assert.equal(Object.keys(edited).length, 3);
});

test('a reflection the teacher wrote themselves is kept; the app still never writes one', async () => {
  const wb = new wp.ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Week 1');
  ['Subject', 'Topic', 'LO', 'Post lesson Reflection & Next Step']
    .forEach((l, i) => { sheet.getRow(i + 2).getCell(1).value = l; });
  const values = { subject: 'ICT', topic: 'Mouse', postLessonReflection: 'They found dragging hard.' };

  // Without the allowlist the row is refused, as it always has been.
  wp.addLesson(wb, 1, values);
  assert.equal(wp.cellText(sheet.getRow(5).getCell(2).value), '');

  // With it — meaning the teacher typed it — it is kept.
  wp.addLesson(wb, 1, values, 1, { allow: new Set(['postLessonReflection']) });
  assert.equal(wp.cellText(sheet.getRow(5).getCell(2).value), 'They found dragging hard.');
});

test('a weekly sequence is split into one lesson per column, not stacked in the first', () => {
  // A sequence plan is several lessons written as ONE document, because that is
  // all a single-document template can hold. This workbook has a column per
  // lesson, so stacking all three in column B would waste the form and leave
  // the teacher separating them by hand.
  const values = {
    subject: 'ICT', topic: 'using the mouse',
    objectives: 'LO1. Use a mouse.',
    intro: 'Lesson 1 of 3 (35 minutes)\nShow a mouse.\nLesson 2 of 3 (35 minutes)\nRecap clicking.\nLesson 3 of 3 (35 minutes)\nRecap dragging.',
    activities: 'Lesson 1 of 3 (35 minutes)\nName the parts.\nLesson 2 of 3\nPractise clicking.\nLesson 3 of 3\nDrag files.',
    resources: 'Desktop computers',
  };
  const split = wp.splitSequence(values, 3);
  assert.equal(split.length, 3);
  assert.deepEqual(split.map(s => s.intro), ['Show a mouse.', 'Recap clicking.', 'Recap dragging.']);
  assert.deepEqual(split.map(s => s.activities), ['Name the parts.', 'Practise clicking.', 'Drag files.']);

  // Week-level fields repeat rather than being carved up — and objectives above
  // all, which are the pacing guide's words.
  for (const one of split) {
    assert.equal(one.objectives, 'LO1. Use a mouse.');
    assert.equal(one.subject, 'ICT');
    assert.equal(one.resources, 'Desktop computers', 'written once for the week, shown in every lesson');
  }
});

test('a plan with no period markers is one lesson, as before', () => {
  assert.equal(wp.splitSequence({ intro: 'Just one lesson.', activities: 'Do the thing.' }, 3), null);
  assert.equal(wp.splitSequence({ intro: 'Lesson 1 of 3\nx' }, 1), null, 'a count below two is not a sequence');
});

test('period markers are recognised however the model writes them', () => {
  for (const marker of ['Lesson 2 of 3 (35 minutes)', '**Lesson 2**', 'Lesson 2:', 'LESSON 2 OF 3', '  Lesson 2  ']) {
    const { byLesson } = wp.splitFieldByLesson(`Lesson 1\nfirst\n${marker}\nsecond`);
    assert.equal((byLesson.get(2) || []).join('').trim(), 'second', `missed "${marker}"`);
  }
});

test('a sequence longer than the form stops at the last column instead of overflowing', async () => {
  const wb = new wp.ExcelJS.Workbook();
  const tpl = wb.addWorksheet('Template (Week 1)');
  ['Subject', 'Topic', 'Intro'].forEach((l, i) => { tpl.getRow(i + 2).getCell(1).value = l; });
  tpl.getRow(2).getCell(3).value = 'x';                 // a two-lesson-wide form
  const sheet = wb.addWorksheet('Week 5');
  ['Subject', 'Topic', 'Intro'].forEach((l, i) => { sheet.getRow(i + 2).getCell(1).value = l; });
  assert.equal(wp.lessonsPerWeek(wb), 2);

  const split = wp.splitSequence({
    subject: 'ICT', topic: 'Mouse',
    intro: 'Lesson 1\nfirst\nLesson 2\nsecond\nLesson 3\nthird',
  }, 3);
  assert.equal(split.length, 3, 'the plan really does hold three');

  // Only two fit. Writing the third would land outside the teacher's form.
  const written = [];
  for (let i = 0; i < split.length; i++) {
    if (i + 1 > wp.lessonsPerWeek(wb)) break;
    written.push(wp.addLesson(wb, 5, split[i], i + 1).column);
  }
  assert.deepEqual(written, ['B', 'C']);
  assert.equal(wp.cellText(sheet.getRow(4).getCell(4).value), '', 'nothing written past the form');
});

test('a stored workbook that cannot be opened is not the same as no workbook', async () => {
  // These two disagree when a file is corrupt or half-written, and that
  // disagreement is why swallowing the read error was dangerous: hasPlanner
  // says the teacher has a form, loadPlanner cannot produce it, and the route
  // used to quietly generate a plan in a shape they never asked for — charging
  // them a credit for a generic structure with nothing to explain why.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-planner-'));
  try {
    // Re-require so the module picks up the throwaway data dir.
    delete require.cache[require.resolve('../week-planner.js')];
    delete require.cache[require.resolve('../storage.js')];
    const planner = require('../week-planner.js');

    const dir = path.join(process.env.DATA_DIR, 'users', 'u1', 'week-planner');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'planner.xlsx'), Buffer.from('not a spreadsheet at all'));
    fs.writeFileSync(path.join(dir, 'planner.json'), JSON.stringify({ filename: 'plan.xlsx' }));

    assert.equal(planner.hasPlanner('u1'), true, 'the file exists, so the teacher believes they have a form');
    await assert.rejects(() => planner.loadPlanner('u1'), 'but it cannot be opened');
  } finally {
    process.env.DATA_DIR = previous;
    delete require.cache[require.resolve('../week-planner.js')];
    delete require.cache[require.resolve('../storage.js')];
  }
});
