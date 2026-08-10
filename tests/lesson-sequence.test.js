const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getTeachingModel } = require('../teaching-models');
const { planSchema, sequencePromptBlock, sequenceStepPromptBlock, buildPrompt } = require('../lesson-plan');
const { groupSectionsByLesson, assertLessonFields, combineOrderedLessons } = require('../lesson-sequence');
const weekPlanner = require('../week-planner');

const sequence = { enabled: true, lessonCount: 3, periodMinutes: 35 };

test('ordinary lesson schema remains unchanged and has no lesson property', () => {
  const item = planSchema(getTeachingModel('standard')).properties.sections.items;
  assert.deepEqual(item.required, ['heading', 'content', 'stageId']);
  assert.equal(item.properties.lesson, undefined);
});

test('workbook sequence schema requires a bounded lesson number', () => {
  const item = planSchema(getTeachingModel('standard'), sequence, true).properties.sections.items;
  assert.deepEqual(item.required, ['heading', 'content', 'stageId', 'lesson']);
  assert.deepEqual(item.properties.lesson.enum, [1, 2, 3]);
  assert.match(sequencePromptBlock(sequence, true, true), /one separate section for EACH lesson/);
  assert.match(sequencePromptBlock(sequence, true, true), /Do not combine several lessons/);
});

test('non-workbook sequence instructions keep the existing marker format', () => {
  const prompt = sequencePromptBlock(sequence, true, false);
  assert.match(prompt, /Clearly label the content for each period/);
  assert.match(prompt, /inside the relevant content fields separate the work/);
  assert.doesNotMatch(prompt, /"lesson" property/);
});

test('staged sequence prompt requests exactly one lesson and carries earlier context', () => {
  const prompt = sequenceStepPromptBlock(sequence, 2, 'LESSON 1\nStarter: Recall prior knowledge');
  assert.match(prompt, /Create ONLY Lesson 2 of 3/);
  assert.match(prompt, /exactly 35 minutes/);
  assert.match(prompt, /Advance the learning instead of repeating/);
  assert.match(prompt, /Starter: Recall prior knowledge/);
  assert.match(prompt, /Do not create, outline, preview, or append any other lesson/);
});

test('single lesson prompt remains free of staged sequence instructions', () => {
  const prompt = buildPrompt({
    subject: 'Science', topic: 'forces', grade: 'middle school', tone: 'clear',
    objectives: 'Explain balanced forces', teachingModel: 'standard', sequence: null,
  });
  assert.doesNotMatch(prompt, /STAGED WEEKLY LESSON SEQUENCE/);
  assert.doesNotMatch(prompt, /Create ONLY Lesson/);
});

test('an incomplete generated sequence is rejected before it can be filed', () => {
  assert.throws(
    () => groupSectionsByLesson([
      { heading: 'Intro', content: 'One', lesson: 1 },
      { heading: 'Intro', content: 'Three', lesson: 3 },
    ], sequence),
    /missing lesson 2/
  );
});

test('each lesson must contain every authored school field', () => {
  const groups = groupSectionsByLesson([
    { heading: 'Intro (10m)', content: 'One', lesson: 1 },
    { heading: 'Activities (20m)', content: 'One', lesson: 1 },
    { heading: 'Intro (10m)', content: 'Two', lesson: 2 },
    { heading: 'Activities (20m)', content: 'Two', lesson: 2 },
    { heading: 'Intro (10m)', content: 'Three', lesson: 3 },
  ], sequence);
  assert.throws(
    () => assertLessonFields(groups, [
      { label: 'LO', authored: false },
      { label: 'Intro (10m)', authored: true },
      { label: 'Activities (20m)', authored: true },
    ]),
    /Lesson 3 was missing school field: Activities \(20m\)/
  );
});

test('repeated school fields are combined into markers the workbook splitter understands', () => {
  const outline = [
    { key: 'objectives', label: 'LO' },
    { key: 'intro', label: 'Intro (10m)' },
    { key: 'activities', label: 'Activities (20m)' },
  ];
  const orderedLessons = [1, 2, 3].map(lesson => [
    { heading: 'LO', content: 'LO1 verbatim', fieldKey: 'objectives', stageId: 'launch' },
    { heading: 'Intro (10m)', content: `Intro ${lesson}`, fieldKey: 'intro', stageId: 'launch' },
    { heading: 'Activities (20m)', content: `Activity ${lesson}`, fieldKey: 'activities', stageId: 'practice' },
  ]);

  const combined = combineOrderedLessons(orderedLessons, outline, sequence);
  assert.equal(combined.length, 3);
  assert.equal(combined[0].content, 'LO1 verbatim', 'shared objectives remain byte-identical and unsplit');
  assert.match(combined[1].content, /^Lesson 1 of 3 \(35 minutes\)\nIntro 1/m);
  assert.match(combined[1].content, /Lesson 2 of 3 \(35 minutes\)\nIntro 2/);
  assert.match(combined[1].content, /Lesson 3 of 3 \(35 minutes\)\nIntro 3$/);

  const values = Object.fromEntries(combined.map(section => [section.fieldKey, section.content]));
  const filed = weekPlanner.splitSequence(values, 3);
  assert.equal(filed.length, 3);
  assert.equal(filed[0].intro, 'Intro 1');
  assert.equal(filed[1].intro, 'Intro 2');
  assert.equal(filed[2].intro, 'Intro 3');
  assert.equal(filed[0].activities, 'Activity 1');
  assert.equal(filed[2].activities, 'Activity 3');
  assert.equal(filed[0].objectives, 'LO1 verbatim');
  assert.equal(filed[2].objectives, 'LO1 verbatim');
});
