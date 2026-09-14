const test = require('node:test');
const assert = require('node:assert/strict');
const assignments = require('../assignments');
const { repairAssessmentDraft } = require('../lesson-plan');
const {
  REVIEW_REQUIRED_MARKER,
  fallbackDraft,
  normalizeAssessmentDraft,
  normalizeAssessmentOptions,
  assessmentDraftIssues,
} = require('../assessment-draft');

function fallback(questionTypes) {
  return fallbackDraft({
    subject: 'ICT',
    topic: 'Document creation',
    grade: 'Grade 2',
    objectives: 'Create and save a document.',
    lessonPurpose: 'project',
    assessmentTotalMarks: 10,
    assessmentStructure: 'custom',
    assessmentDeliveryMode: 'live',
    assessmentQuestionTypes: questionTypes,
    assessmentMcqCount: questionTypes.includes('mcq') ? 4 : 0,
  });
}

function genericMcqDraft() {
  return {
    title: 'Document project',
    instructions: 'Complete the questions.',
    sections: [{
      title: 'Knowledge check', type: 'mcq', instructions: 'Choose one.', objectiveIndexes: [0],
      items: [1, 2].map(number => ({
        prompt: `Item ${number}: Which response best demonstrates the learning goal for Document creation Project?`,
        marks: 1,
        options: [
          'An accurate response linked to Create and save a document',
          'A response about a different skill',
          'An unrelated response',
          'No response to the learning goal',
        ],
        correctIndex: 0,
        answerKey: '',
      })),
    }],
  };
}

test('offline assessment fallback stays editable but is explicitly review-required', () => {
  const draft = fallback(['mcq', 'practical']);
  assert.equal(draft.totalMarks, 10);
  assert.equal(draft.sections.find(section => section.type === 'mcq').items.length, 4);
  assert.equal(draft.sections.flatMap(section => section.items).reduce((sum, item) => sum + item.marks, 0), 10);
  assert.match(draft.instructions, /\[REVIEW REQUIRED\]/);
  assert.ok(draft.sections.flatMap(section => section.items).every(item => item.prompt.startsWith(REVIEW_REQUIRED_MARKER)));
  assert.match(assessmentDraftIssues(draft, {
    totalMarks: 10, questionTypes: ['mcq', 'practical'], mcqCount: 4,
  }).join('; '), /placeholder or generic content/);
  assert.throws(() => assignments.normalizeAssessment(draft), /replace placeholder text/i);
});

test('every fallback section type is blocked from publication until its marked content is replaced', () => {
  for (const type of ['mcq', 'short-answer', 'extended-response', 'practical']) {
    const draft = fallback([type]);
    assert.throws(() => assignments.normalizeAssessment(draft), /replace placeholder text/i, `${type} fallback must be rejected`);
  }
});

test('semantic checks reject generic model-shaped MCQs that satisfy counts and marks', () => {
  const draft = normalizeAssessmentDraft(genericMcqDraft(), {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2',
    objectives: 'Create and save a document.', lessonPurpose: 'project',
    totalMarks: 2, questionTypes: ['mcq'], mcqCount: 2,
  });
  const issues = assessmentDraftIssues(draft, { totalMarks: 2, questionTypes: ['mcq'], mcqCount: 2 });
  assert.match(issues.join('; '), /2 assessment items contain placeholder or generic content/);
  assert.match(issues.join('; '), /repeat the same question wording/);
});

test('semantic checks reject bare numbered question placeholders', () => {
  const draft = normalizeAssessmentDraft({
    title: 'Document project', instructions: 'Choose one.', sections: [{
      title: 'Knowledge check', type: 'mcq', instructions: 'Choose one.', objectiveIndexes: [0], items: [{
        prompt: 'Question 1', marks: 1, options: ['Correct', 'Distractor'], correctIndex: 0, answerKey: '',
      }],
    }],
  }, {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2',
    objectives: 'Create and save a document.', lessonPurpose: 'project',
    totalMarks: 1, questionTypes: ['mcq'], mcqCount: 1,
  });
  assert.match(assessmentDraftIssues(draft, {
    totalMarks: 1, questionTypes: ['mcq'], mcqCount: 1,
  }).join('; '), /placeholder or generic content/);
});

test('assessment repair retries generic model output and fails closed after three attempts', async () => {
  const context = {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2',
    objectives: 'Create and save a document.', lessonPurpose: 'project',
    totalMarks: 2, structure: 'knowledge', deliveryMode: 'live', questionTypes: ['mcq'], mcqCount: 2,
  };
  let calls = 0;
  const client = { chat: { completions: { create: async () => {
    calls += 1;
    return { choices: [{ message: { content: JSON.stringify(genericMcqDraft()) } }] };
  } } } };
  await assert.rejects(
    () => repairAssessmentDraft(client, genericMcqDraft(), context, context),
    error => {
      assert.match(error.message, /placeholder or generic content/);
      assert.ok(Array.isArray(error.qualityIssues));
      return true;
    },
  );
  assert.equal(calls, 3);
});

test('normalization cannot turn a missing written answer key into publishable generic guidance', () => {
  const draft = normalizeAssessmentDraft({
    title: 'Document project', instructions: 'Answer clearly.', sections: [{
      title: 'Written response', type: 'short-answer', instructions: '', objectiveIndexes: [0], items: [{
        prompt: 'Why should you save a document while you work?', marks: 4,
        options: [], correctIndex: 0, answerKey: '',
      }],
    }],
  }, {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2',
    objectives: 'Create and save a document.', lessonPurpose: 'project',
    totalMarks: 4, questionTypes: ['short-answer'], mcqCount: 0,
  });
  assert.match(draft.sections[0].items[0].answerKey, /Accept an accurate response/);
  assert.match(assessmentDraftIssues(draft, {
    totalMarks: 4, questionTypes: ['short-answer'], mcqCount: 0,
  }).join('; '), /placeholder or generic content/);
});

test('content checks accept distinct subject-specific questions with plausible choices', () => {
  const draft = normalizeAssessmentDraft({
    title: 'Document project',
    instructions: 'Choose the best answer.',
    sections: [{
      title: 'Knowledge check', type: 'mcq', instructions: 'Choose one.', objectiveIndexes: [0],
      items: [
        {
          prompt: 'Which command keeps the latest changes in an open document?', marks: 1,
          options: ['Save', 'Print', 'Close', 'Undo'], correctIndex: 0, answerKey: '',
        },
        {
          prompt: 'Which file name makes a class letter easiest to identify later?', marks: 1,
          options: ['Class_Letter_Monday', 'Document1', 'Untitled', 'New File'], correctIndex: 0, answerKey: '',
        },
      ],
    }],
  }, {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2',
    objectives: 'Create and save a document.', lessonPurpose: 'project',
    totalMarks: 2, questionTypes: ['mcq'], mcqCount: 2,
  });
  assert.deepEqual(assessmentDraftIssues(draft, { totalMarks: 2, questionTypes: ['mcq'], mcqCount: 2 }), []);
});

test('an unambiguous requirements sentence becomes exact ordered phase marks', () => {
  const options = normalizeAssessmentOptions({
    totalMarks: 50,
    questionTypes: ['mcq', 'practical'],
    mcqCount: 15,
    brief: '20 multiple-choice marks, then a 30-mark investigation',
  });
  assert.equal(options.mcqCount, 20);
  assert.deepEqual(options.phaseRequirements.map(({ type, marks }) => ({ type, marks })), [
    { type: 'mcq', marks: 20 },
    { type: 'practical', marks: 30 },
  ]);

  const draft = normalizeAssessmentDraft({
    title: 'Document creation project', instructions: 'Complete both phases.',
    sections: [
      {
        title: 'Knowledge check', type: 'mcq', instructions: 'Choose the best answer.', objectiveIndexes: [0],
        items: Array.from({ length: 20 }, (_, index) => ({
          prompt: `Which document command completes task ${index + 1}?`, marks: 4,
          options: [`Save task ${index + 1}`, `Print task ${index + 1}`, `Close task ${index + 1}`], correctIndex: 0, answerKey: '',
        })),
      },
      {
        title: 'Document investigation', type: 'practical', instructions: 'Create and check the file.', objectiveIndexes: [0],
        items: [{ prompt: 'Creates, checks and saves the required document independently', marks: 1, options: [], correctIndex: 0, answerKey: '' }],
      },
    ],
  }, {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2', objectives: 'Create and save a document.',
    lessonPurpose: 'project', ...options,
  });
  assert.deepEqual(draft.sections.map(section => section.items.reduce((sum, item) => sum + item.marks, 0)), [20, 30]);
  assert.deepEqual(assessmentDraftIssues(draft, options), []);
});

test('draft validation rejects reordered and unconfigured duplicate phases', () => {
  const options = { totalMarks: 10, questionTypes: ['short-answer', 'practical'], mcqCount: 0 };
  const reversed = normalizeAssessmentDraft({
    title: 'Forces project', instructions: 'Complete both phases.', sections: [
      { title: 'Investigation', type: 'practical', instructions: '', objectiveIndexes: [0], items: [{ prompt: 'Records force measurements in a labelled table', marks: 6, options: [], correctIndex: 0, answerKey: '' }] },
      { title: 'Written check', type: 'short-answer', instructions: '', objectiveIndexes: [0], items: [{ prompt: 'Explain how friction changes motion.', marks: 4, options: [], correctIndex: 0, answerKey: 'Award marks for linking greater friction to slower motion.' }] },
    ],
  }, { subject: 'Science', topic: 'Forces', grade: 'Grade 6', objectives: 'Explain how forces affect motion.', lessonPurpose: 'project', ...options });
  assert.match(assessmentDraftIssues(reversed, options).join('; '), /expected assessment phase order short-answer -> practical but received practical -> short-answer/);

  const duplicated = { ...reversed, sections: [...reversed.sections, { ...reversed.sections[0], id: 'extra-practical' }] };
  assert.match(assessmentDraftIssues(duplicated, options).join('; '), /duplicate practical phase was added without being selected/);
});

test('duplicate phase types pass only when the structured phase plan includes each one', () => {
  const options = normalizeAssessmentOptions({
    totalMarks: 30,
    questionTypes: ['short-answer', 'practical'],
    assessmentPhases: [
      { type: 'short-answer', marks: 5, title: 'Planning response' },
      { type: 'short-answer', marks: 10, title: 'Evaluation response' },
      { type: 'practical', marks: 15, title: 'Practical product' },
    ],
  });
  const draft = normalizeAssessmentDraft({
    title: 'Design assessment', instructions: 'Complete all three phases.', sections: [
      { title: 'Planning response', type: 'short-answer', instructions: '', objectiveIndexes: [0], items: [{ prompt: 'Explain the design choice before creating.', marks: 1, options: [], correctIndex: 0, answerKey: 'Award for a relevant choice linked to purpose.' }] },
      { title: 'Evaluation response', type: 'short-answer', instructions: '', objectiveIndexes: [0], items: [{ prompt: 'Evaluate the completed design against its purpose.', marks: 1, options: [], correctIndex: 0, answerKey: 'Award for evidence-based evaluation and improvement.' }] },
      { title: 'Practical product', type: 'practical', instructions: '', objectiveIndexes: [0], items: [{ prompt: 'Creates a complete design that meets the stated purpose', marks: 1, options: [], correctIndex: 0, answerKey: '' }] },
    ],
  }, { subject: 'Design', topic: 'Purposeful design', grade: 'Grade 8', objectives: 'Create and evaluate a purposeful design.', lessonPurpose: 'project', ...options });
  assert.deepEqual(draft.sections.map(section => section.items[0].marks), [5, 10, 15]);
  assert.deepEqual(assessmentDraftIssues(draft, options), []);
});

test('an explicit phase allocation that conflicts with the total fails closed', () => {
  const options = normalizeAssessmentOptions({
    totalMarks: 50,
    questionTypes: ['mcq', 'practical'],
    brief: '20 multiple-choice marks, then a 20-mark investigation',
  });
  assert.match(options.phaseRequirementIssue, /phase marks total 40.*total is 50/);
});
