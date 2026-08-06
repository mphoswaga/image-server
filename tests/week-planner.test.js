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
