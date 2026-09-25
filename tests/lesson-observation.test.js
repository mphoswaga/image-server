const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt, planSchema } = require('../lesson-plan');
const { getTeachingModel } = require('../teaching-models');
const { integrateTeachingEvidence } = require('../lesson-observation');

const base = {
  subject: 'Science', topic: 'habitats', grade: 'Grade 3', tone: 'clear',
  objectives: 'Explain how a habitat meets an animal’s needs.',
  successCriteria: ['I can explain how a habitat meets an animal’s needs.'],
  templateText: 'Starter:\nMain Activity:\nPlenary:\nReflection:',
};

test('ordinary and sequential plans require observable thinking and responsive assessment within existing fields', () => {
  for (const options of [ {},
    { sequence: { enabled: true, lessonCount: 3, periodMinutes: 35 }, structuredSequence: true },
    { sequence: { enabled: true, lessonCount: 3, periodMinutes: 35 }, sequenceLessonNumber: 2 },
    { sourceMaterialText: 'Slide 1: Animals need food, water and shelter.' },
  ]) {
    const prompt = buildPrompt({ ...base, ...options });
    assert.match(prompt, /exact, subject-specific questions/);
    assert.match(prompt, /plausible expected reasoning and a likely misconception/);
    assert.match(prompt, /evidence is gathered from all learners/);
    assert.match(prompt, /specific if\/then response/);
    assert.match(prompt, /a new short check to see whether it helped/);
    assert.match(prompt, /Replace part of the planned practice/);
    assert.match(prompt, /self-check followed by improvement/);
    assert.match(prompt, /do not label groups by fixed ability/);
    assert.match(prompt, /exactly its headings, exactly once|every authored template heading exactly once/);
    assert.match(prompt, /Return them exactly in successCriteria/);
  }
});

test('observation guidance never asks for invented learner evidence or completed reflection', () => {
  const prompt = buildPrompt(base);
  assert.match(prompt, /Do not invent learner identities, diagnoses, attainment, prior results/);
  assert.match(prompt, /Leave the teacher's Reflection\/post-lesson reflection field blank/);
  assert.match(prompt, /never claim that students have already achieved them/);
  assert.match(prompt, /not from forcing all thirteen rubric components/);
  assert.match(prompt, /safe accessible use of space/);
  assert.match(prompt, /practical alternative if it fails/);
});

test('assessment plans retain integrity instead of importing taught-lesson discussion and reteaching', () => {
  for (const lessonPurpose of ['test', 'project']) {
    const prompt = buildPrompt({ ...base, lessonPurpose });
    assert.match(prompt, /ASSESSMENT INTEGRITY TAKES PRIORITY/);
    assert.match(prompt, /Do not introduce peer discussion, answer checking, hints, modelling or reteaching/);
    assert.doesNotMatch(prompt, /WRITE CLASSROOM-READY LESSON STEPS/);
    assert.doesNotMatch(prompt, /specific if\/then response/);
    assert.match(prompt, /after the assessment, subject to its conditions/);
  }
});

test('observation improvements do not introduce required export fields or ratings', () => {
  const schema = planSchema(getTeachingModel('standard'));
  assert.deepEqual(schema.required, ['successCriteria', 'sections']);
  assert.deepEqual(schema.properties.sections.items.required, ['heading', 'content', 'stageId']);
});

const checkpoint = {
  timings: [{ sectionHeading: 'Guided Practice', minutes: 10 }],
  lesson: 1, sectionHeading: 'Guided Practice', question: 'Which shelter is safer and why?',
  expectedReasoning: 'A sheltered nest protects the bird from rain.',
  allLearnerCheck: 'Every pupil draws a shelter and explains one protective feature.',
  ifThenResponse: 'If pupils choose an exposed site, show contrasting shelters; otherwise compare two suitable sites.',
  recheck: 'Choose a safe shelter for a different bird and explain.',
  studentReview: 'Check your drawing against the shelter criterion and revise one feature.',
};

test('checkpoint becomes ordinary editable content without changing template fields', () => {
  const raw = { sections: [{ heading: 'Guided Practice', content: 'Practice for 10 minutes.', stageId: 'practice' }, { heading: 'Reflection', content: '' }], teachingEvidence: [checkpoint] };
  const result = integrateTeachingEvidence(raw);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.plan.sections.map(s => s.heading), ['Guided Practice', 'Reflection']);
  assert.match(result.plan.sections[0].content, /Choose a safe shelter for a different bird/);
  assert.equal(result.plan.sections[1].content, '');
  assert.equal(result.plan.teachingEvidence, undefined);
  assert.equal(raw.sections[0].content, 'Practice for 10 minutes.');
});

test('missing, incomplete or misplaced evidence requires a retry', () => {
  const sections = [{ heading: 'Guided Practice', content: 'Task' }, { heading: 'Reflection', content: '' }];
  for (const teachingEvidence of [undefined, [], [{ ...checkpoint, recheck: '' }], [{ ...checkpoint, sectionHeading: 'Reflection' }], [{ ...checkpoint, sectionHeading: 'Invented heading' }]]) {
    assert.ok(integrateTeachingEvidence({ sections, teachingEvidence }).issues.length);
  }
});

test('each structured period needs its own checkpoint and duplicates are rejected', () => {
  const sections = [1, 2].map(lesson => ({ lesson, heading: 'Guided Practice', content: 'Task' }));
  assert.ok(integrateTeachingEvidence({ sections, teachingEvidence: [checkpoint] }).issues.length);
  assert.ok(integrateTeachingEvidence({ sections, teachingEvidence: [checkpoint, checkpoint] }).issues.length);
  const result = integrateTeachingEvidence({ sections, teachingEvidence: [checkpoint, { ...checkpoint, lesson: 2 }] });
  assert.deepEqual(result.issues, []);
  assert.ok(result.plan.sections.every(s => s.content.includes('Learning checkpoint:')));
});

test('structured evidence is internal to taught generation and absent from assessments', () => {
  const model = getTeachingModel('standard');
  assert.ok(planSchema(model, null, false, false, true).required.includes('teachingEvidence'));
  assert.equal(planSchema(model, null, false, true, true).properties.teachingEvidence, undefined);
});

test('timing totals are checked against the requested period and never placed in reflection', () => {
  const sections = [{ heading: 'Guided Practice', content: 'Task' }, { heading: 'Reflection', content: '' }];
  assert.ok(integrateTeachingEvidence({ sections, teachingEvidence: [checkpoint] }, { periodMinutes: 35 }).issues.length);
  const valid = { ...checkpoint, timings: [{ sectionHeading: 'Guided Practice', minutes: 35 }] };
  assert.deepEqual(integrateTeachingEvidence({ sections, teachingEvidence: [valid] }, { periodMinutes: 35 }).issues, []);
  for (const timings of [[], [{ sectionHeading: 'Reflection', minutes: 35 }], [{ sectionHeading: 'Guided Practice', minutes: -1 }], [checkpoint.timings[0], checkpoint.timings[0]]]) {
    assert.ok(integrateTeachingEvidence({ sections, teachingEvidence: [{ ...checkpoint, timings }] }).issues.length);
  }
});
