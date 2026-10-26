const test = require('node:test');
const assert = require('node:assert/strict');
const { objectiveAssessmentContext, generateObjectiveAssessment } = require('../assessment-objective-generator');
const { assessmentOnlyPrompt } = require('../assessment-draft');
const input = { subject: 'Science', grade: 'Grade 2', objectives: 'Identify solids and liquids.', kind: 'test', totalMarks: 10 };
test('requires grade, objectives, subject, valid type and whole marks before generation', () => {
  for (const change of [{ grade: '' }, { subject: '' }, { objectives: '' }, { kind: 'other' }, { totalMarks: 0 }, { totalMarks: 2.5 }]) {
    assert.throws(() => objectiveAssessmentContext({ ...input, ...change }));
  }
});
test('tests and projects use the existing assessment validation pipeline', async () => {
  for (const kind of ['test', 'project']) {
    let called = false;
    const result = await generateObjectiveAssessment({ ...input, kind }, { client: {}, generate: async (client, draft, context, options) => {
      called = true; assert.equal(draft, null); assert.equal(context.grade, 'Grade 2');
      assert.equal(context.objectives, input.objectives); assert.equal(options.totalMarks, 10);
      assert.deepEqual(options.questionTypes, kind === 'test' ? ['short-answer'] : ['practical']);
      return { title: 'Editable draft' };
    } });
    assert.equal(called, true); assert.equal(result.title, 'Editable draft');
  }
});
test('grade-specific generation requests concrete language without broadening objectives', () => {
  const prompt = assessmentOnlyPrompt(objectiveAssessmentContext(input));
  assert.match(prompt, /Grade 2/); assert.match(prompt, /short sentences/);
  assert.match(prompt, /beyond the supplied objectives/); assert.match(prompt, /total exactly 10/);
});
test('generated answers pass through real normalization and publication validation', async () => {
  const client = { chat: { completions: { create: async request => {
    assert.match(request.messages[0].content, /Grade 2/);
    return { choices: [{ message: { content: JSON.stringify({ title: 'Materials check', instructions: 'Answer on your own.', sections: [{ title: 'Solids and liquids', type: 'short-answer', instructions: 'Write short answers.', objectiveIndexes: [0], items: [{ prompt: 'Name one liquid you use at home.', marks: 10, answerKey: 'Accept water, milk or another correct liquid.', options: [], correctIndex: 0 }] }] }) } }] };
  } } } };
  const draft = await generateObjectiveAssessment(input, { client });
  assert.equal(draft.grade, 'Grade 2');
  assert.equal(draft.totalMarks, 10);
  assert.equal(draft.objectives[0].text, input.objectives);
  assert.match(draft.sections[0].items[0].answerKey, /water/);
  assert.doesNotThrow(() => require('../assignments').normalizeAssessment(draft));
});
test('mixed tests preserve both common mark splits and practical task counts', () => {
  for (const mcqCount of [25, 30]) {
    const context = objectiveAssessmentContext({ ...input, totalMarks: 50, format: 'mixed', mcqCount, practicalMarks: 50 - mcqCount, practicalCount: 5 });
    assert.equal(context.mcqCount, mcqCount);
    assert.equal(context.practicalCount, 5);
    assert.deepEqual(context.phaseRequirements.map(p => [p.type, p.marks]), [['mcq', mcqCount], ['practical', 50 - mcqCount]]);
    assert.match(assessmentOnlyPrompt(context), /exactly 5 distinct task items/);
  }
});
test('invalid splits and impossible task counts are rejected before AI calls', () => {
  const mixed = { ...input, totalMarks: 50, format: 'mixed', mcqCount: 30, practicalCount: 5, practicalMarks: 20 };
  for (const change of [{ practicalMarks: 25 }, { mcqCount: 51 }, { practicalCount: 21 }, { practicalCount: 0 }, { practicalCount: 2.5 }]) assert.throws(() => objectiveAssessmentContext({ ...mixed, ...change }));
});
test('practical count is validated independently of matching total marks', () => {
  const { assessmentDraftIssues, normalizeAssessmentDraft } = require('../assessment-draft');
  const context = objectiveAssessmentContext({ ...input, totalMarks: 20, format: 'practical', practicalCount: 2, practicalMarks: 20 });
  const raw = { title: 'Materials', sections: [{ title: 'Sorting', type: 'practical', objectiveIndexes: [0], items: [{ prompt: 'Sort the objects into solids and liquids.', marks: 20 }] }] };
  const draft = normalizeAssessmentDraft(raw, context);
  assert.ok(assessmentDraftIssues(draft, context).includes('expected 2 practical tasks but received 1'));
});
