const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const assignments = require('../assignments');
const { generateLessonPlan, buildPrompt, planSchema, lessonPlanIssues, dedupeSectionLines, isAllowedBlankPlanSection, repairGeneratedPlan, repairAssessmentDraft } = require('../lesson-plan');
const { generateContent } = require('../content');
const { getTeachingModel } = require('../teaching-models');
const { normalizeAssessmentOptions, normalizeAssessmentDraft, assessmentDraftIssues, assessmentOnlyPrompt } = require('../assessment-draft');

async function withoutOpenAI(run) {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try { return await run(); }
  finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
}

const DOCUMENT_MCQ_BANK = [
  ['Which command keeps recent changes in a document?', ['Save', 'Print', 'Close', 'Undo'], 0],
  ['What does a red wavy underline usually show in a document?', ['A possible spelling error', 'A saved file', 'A printed page', 'A selected picture'], 0],
  ['Which action duplicates selected text without removing the original?', ['Copy', 'Cut', 'Delete', 'Undo'], 0],
  ['Which action inserts text that has already been copied?', ['Paste', 'Save', 'Rename', 'Print'], 0],
  ['Where does typed text appear in a document?', ['At the text cursor', 'In the title bar', 'On the taskbar', 'Inside the printer'], 0],
  ['Which file name is easiest to recognise later?', ['Class_Letter_Monday', 'Document1', 'Untitled', 'New File'], 0],
  ['Which tool checks a document for possible spelling mistakes?', ['Spelling checker', 'Zoom control', 'Print preview', 'Page colour'], 0],
  ['What should you do before changing the format of a sentence?', ['Select the sentence', 'Close the document', 'Turn off the screen', 'Open the printer'], 0],
  ['Which command reverses the most recent editing action?', ['Undo', 'Paste', 'Save As', 'Print'], 0],
  ['Which key removes the character immediately before the cursor?', ['Backspace', 'Shift', 'Caps Lock', 'Tab'], 0],
  ['Which change makes a heading stand out more clearly?', ['Apply bold formatting', 'Remove every space', 'Hide the document', 'Close the program'], 0],
  ['What separates two words when typing a sentence?', ['One space', 'A full stop', 'A slash', 'A quotation mark'], 0],
  ['What should you check before submitting a document?', ['That it is saved with the required name', 'That the screen is blank', 'That the file has no title', 'That every word is deleted'], 0],
  ['Which command creates a second copy with a different file name?', ['Save As', 'Paste', 'Undo', 'Find'], 0],
  ['What is the safest action before closing a document you changed?', ['Save the changes', 'Delete the text', 'Turn off the monitor', 'Open a new blank file'], 0],
];

function documentMcqItems(count, marks = () => 1) {
  return DOCUMENT_MCQ_BANK.slice(0, count).map(([prompt, options, correctIndex], index) => ({
    prompt, options, correctIndex, marks: marks(index), answerKey: '',
  }));
}

test('Plan exposes lesson, project and test with automatic assessment controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const value of ['lesson', 'project', 'test']) assert.match(html, new RegExp(`name="lessonPurpose" value="${value}"`));
  for (const id of ['autoAssessmentSettings', 'assessmentPlanTotal', 'assessmentPlanStructure', 'assessmentPlanDelivery', 'assessmentPlanMcqCount', 'assessmentPlanBrief', 'autoAssessmentSummary']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} should exist exactly once`);
  }
  assert.match(html, /assessmentQuestionTypes:assessmentTypes/);
  assert.match(html, /Review and edit before publishing/);
});

test('project generation returns a valid editable assessment with the requested total', async () => {
  const plan = await withoutOpenAI(() => generateLessonPlan({
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2',
    objectives: 'Open a word processor\nWrite and correct a short letter\nCopy and paste text',
    lessonPurpose: 'project', assessmentTotalMarks: 50,
    assessmentQuestionTypes: ['mcq', 'practical'], assessmentMcqCount: 15,
  }));
  assert.equal(plan.lessonPurpose, 'project');
  assert.equal(plan.assessmentDraft.totalMarks, 50);
  const mcq = plan.assessmentDraft.sections.find(section => section.type === 'mcq');
  const practical = plan.assessmentDraft.sections.find(section => section.type === 'practical');
  assert.equal(mcq.items.length, 15);
  assert.equal(mcq.items.reduce((sum, item) => sum + item.marks, 0), 15);
  assert.equal(practical.items.reduce((sum, item) => sum + item.marks, 0), 35);
  const planText = plan.sections.map(section => section.content).join('\n');
  assert.match(planText, /LessonScope multiple-choice[\s\S]+15 questions \(15 marks\)/);
  assert.match(planText, /Project practical[\s\S]+\(35 marks\)/);
  assert.match(plan.assessmentDraft.instructions, /\[REVIEW REQUIRED\]/);
  assert.throws(() => assignments.normalizeAssessment(plan.assessmentDraft), /replace placeholder text/i);
});

test('offline generation preserves an explicitly structured duplicate phase plan', async () => {
  const assessmentPhases = [
    { type: 'short-answer', title: 'Plan', marks: 5 },
    { type: 'short-answer', title: 'Evaluate', marks: 10 },
    { type: 'practical', title: 'Create', marks: 15 },
  ];
  const plan = await withoutOpenAI(() => generateLessonPlan({
    subject: 'Design', topic: 'Purposeful design', grade: 'Grade 8',
    objectives: 'Create and evaluate a purposeful design.', lessonPurpose: 'project',
    assessmentTotalMarks: 30, assessmentQuestionTypes: ['short-answer', 'practical'], assessmentMcqCount: 0,
    assessmentPhases,
  }));
  assert.deepEqual(plan.assessmentDraft.sections.map(section => section.type), ['short-answer', 'short-answer', 'practical']);
  assert.deepEqual(plan.assessmentDraft.sections.map(section => section.title), ['Plan', 'Evaluate', 'Create']);
  assert.deepEqual(plan.assessmentDraft.sections.map(section => section.items.reduce((sum, item) => sum + item.marks, 0)), [5, 10, 15]);
});

test('assessment settings keep teacher-selected item types and counts', () => {
  const options = normalizeAssessmentOptions({
    assessmentTotalMarks: 80,
    assessmentStructure: 'custom',
    assessmentQuestionTypes: ['short-answer', 'extended-response'],
    assessmentMcqCount: 0,
    assessmentDeliveryMode: 'self-paced',
  });
  assert.deepEqual(options.questionTypes, ['short-answer', 'extended-response']);
  assert.equal(options.totalMarks, 80);
  assert.equal(options.mcqCount, 0);
  assert.equal(options.deliveryMode, 'self-paced');
});

test('assessment schema is added only for project and test generation', () => {
  const model = getTeachingModel('standard');
  assert.deepEqual(planSchema(model).required, ['successCriteria', 'sections']);
  assert.deepEqual(planSchema(model, null, false, true).required, ['successCriteria', 'sections', 'assessmentDraft']);
});

test('purpose prompts change the teacher role while preserving the school template', () => {
  const base = { subject: 'ICT', topic: 'word processing', grade: 'Grade 2', tone: 'clear', objectives: 'Copy and paste text.', teachingModel: 'standard', templateText: 'Introduction:\nActivity:\nAssessment:' };
  const project = buildPrompt({ ...base, lessonPurpose: 'project', assessmentOptions: { assessmentTotalMarks: 50, assessmentQuestionTypes: ['mcq', 'practical'], assessmentMcqCount: 15 } });
  const assessment = buildPrompt({ ...base, lessonPurpose: 'test', assessmentOptions: { assessmentTotalMarks: 50, assessmentQuestionTypes: ['mcq', 'practical'], assessmentMcqCount: 20 } });
  assert.match(project, /PROJECT SESSION/);
  assert.match(project, /assessed project work, not a normal teacher-led lesson/);
  assert.match(project, /Do not pad the launch with a generic discussion/);
  assert.match(project, /project plenary must include the teacher checking the submission list and confirming that every student has submitted/);
  assert.match(project, /Fill EVERY requested section with useful content/);
  assert.match(project, /Create exactly 15 multiple-choice items/);
  assert.match(project, /Phase 1: students complete 15 multiple-choice questions independently in LessonScope \(15 marks\)/);
  assert.match(project, /practical[\s\S]+\(35 marks\)/i);
  assert.match(assessment, /TEST SESSION/);
  assert.match(assessment, /does not teach, prompt, explain answers/i);
  for (const prompt of [project, assessment]) assert.match(prompt, /Reproduce its section headings and their order EXACTLY/);
});

test('weak normal-lesson prose and blank workbook fields fail project-plan validation', () => {
  const repeated = 'Begin with a brief discussion about what a document is and why we create them.';
  const raw = { sections: [
    { heading: 'Intro (10m)', stageId: 'launch', content: `${repeated}\nIntroduce the objectives of the lesson.\n${repeated}` },
    { heading: 'Activities (50m)', stageId: 'practice', content: 'Teacher demonstrates typing and students practise.' },
    { heading: 'Plenary (10m)', stageId: 'reflect', content: '' },
    { heading: 'Differentiation', stageId: 'practice', content: '   ' },
    { heading: 'Assessment', stageId: 'check', content: '' },
  ] };
  const issues = lessonPlanIssues(raw, {
    lessonPurpose: 'project',
    templateText: 'Intro (10m):\nActivities (50m):\nPlenary (10m):\nDifferentiation:\nAssessment:',
  });
  assert.ok(issues.some(issue => /sections are empty/.test(issue)));
  assert.ok(issues.some(issue => /repeated instructions/.test(issue)));
  assert.ok(issues.some(issue => /assessed project outcome/.test(issue)));
  assert.ok(issues.some(issue => /project checkpoint/.test(issue)));
  assert.ok(issues.some(issue => /generic lesson introduction/.test(issue)));
  assert.ok(issues.some(issue => /main activity is teacher-led/.test(issue)));
  assert.ok(issues.some(issue => /teaches or demonstrates assessed skills/.test(issue)));
});

test('a complete student-led project fills every school field and passes validation', () => {
  const raw = { sections: [
    { heading: 'Intro (10m)', stageId: 'launch', content: 'Teacher launches the document project, explains the letter product and displays the phases.\nPupils prepare their files and identify the required outcome.' },
    { heading: 'Activities (50m)', stageId: 'practice', content: 'Pupils create a letter, check spelling and produce five copies.\nTeacher circulates, observes each checkpoint and records practical evidence.' },
    { heading: 'Plenary (10m)', stageId: 'reflect', content: 'Teacher checks the submission list and confirms every pupil submitted the finished document.\nPupils reflect on one improvement.' },
    { heading: 'Differentiation', stageId: 'practice', content: 'Before the project, pupils use an unassessed typing rehearsal and a vocabulary reference card to review prerequisite skills. Provide a visual stage card and extra processing time while keeping the same assessed product.' },
    { heading: 'Assessment', stageId: 'check', content: 'Students complete the LessonScope knowledge section independently, then present the practical product for grading.' },
  ] };
  assert.deepEqual(lessonPlanIssues(raw, {
    lessonPurpose: 'project',
    templateText: 'Intro (10m):\nActivities (50m):\nPlenary (10m):\nDifferentiation:\nAssessment:',
  }), []);
});

test('only reflection and phonics may remain blank', () => {
  assert.equal(isAllowedBlankPlanSection({ heading: 'Post lesson Reflection & Next Step' }), true);
  assert.equal(isAllowedBlankPlanSection({ heading: 'Reflection' }), true);
  assert.equal(isAllowedBlankPlanSection({ heading: 'Phonics (delete row if not applicable)' }), true);
  for (const heading of ['Plenary (10m)', 'Differentiation', 'Assessment', 'Resources', 'Unit']) {
    assert.equal(isAllowedBlankPlanSection({ heading }), false, `${heading} must be filled`);
  }
  const issues = lessonPlanIssues({ sections: [
    { heading: 'Project Launch', content: 'Teacher launches the project product and checks the task brief.' },
    { heading: 'Activity', content: 'Students create the assessed product while teacher circulates and records evidence.' },
    { heading: 'Plenary', content: 'Teacher checks the submission list and confirms every student submitted.\nStudents reflect on the project.' },
    { heading: 'Reflection', content: '' },
    { heading: 'Phonics', content: '' },
    { heading: 'Assessment', content: '' },
  ] }, { lessonPurpose: 'project' });
  assert.ok(issues.some(issue => /these sections are empty: Assessment/.test(issue)));
  assert.ok(!issues.some(issue => /Reflection|Phonics/.test(issue)));
});

test('project generation repairs an omitted optional Phonics row and submission confirmation', () => {
  const templateText = [
    'Red Thread:', 'Key vocabulary:', 'Resources:', 'Phonics (delete row if not applicable):',
    'Intro(10m):', 'Activities(50m):', 'Plenary(10m):', 'Differentiation:', 'Assessment:',
  ].join('\n');
  const repaired = repairGeneratedPlan({ sections: [
    { heading: 'Red Thread', stageId: 'launch', content: 'Students connect document creation to communicating a clear message.' },
    { heading: 'Key vocabulary', stageId: 'launch', content: 'Document: a digital page used to record and share information.' },
    { heading: 'Resources', stageId: 'launch', content: 'Before the project, students use an unassessed word-processing rehearsal and a vocabulary reference checklist to review prerequisite skills on a separate sample. Provide the word processor, saved task brief, submission checklist and accessible keyboard for the project.' },
    { heading: 'Intro(10m)', stageId: 'launch', content: 'Teacher launches the assessed project product and explains the task brief and success criteria.' },
    { heading: 'Activities(50m)', stageId: 'practice', content: 'Students create and revise the required document through visible checkpoints.\nTeacher circulates, observes progress and records practical evidence.' },
    { heading: 'Plenary(10m)', stageId: 'reflect', content: 'Students save the finished product and prepare it for upload.' },
    { heading: 'Differentiation', stageId: 'practice', content: 'Provide a visual stage card and extra processing time while keeping the assessed outcome unchanged.' },
    { heading: 'Assessment', stageId: 'check', content: 'Students complete the LessonScope knowledge phase independently and submit the project for grading.' },
  ] }, { lessonPurpose: 'project', templateText });
  assert.deepEqual(repaired.sections.map(section => section.heading), [
    'Red Thread', 'Key vocabulary', 'Resources', 'Phonics (delete row if not applicable)',
    'Intro(10m)', 'Activities(50m)', 'Plenary(10m)', 'Differentiation', 'Assessment',
  ]);
  assert.equal(repaired.sections[3].content, '');
  assert.match(repaired.sections[6].content, /Teacher checks the LessonScope submission list and confirms that every student has submitted/);
  assert.deepEqual(lessonPlanIssues(repaired, { lessonPurpose: 'project', templateText }), []);
});

test('focused assessment recovery preserves the teacher requested question count', () => {
  const prompt = assessmentOnlyPrompt({
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2',
    objectives: 'Create and revise a short letter.', lessonPurpose: 'project',
    totalMarks: 50, questionTypes: ['mcq', 'practical'], mcqCount: 15, deliveryMode: 'live',
  });
  assert.match(prompt, /Create ONLY the editable assessment draft/);
  assert.match(prompt, /Multiple choice: exactly 15 different questions/);
  assert.match(prompt, /remaining 35 marks belong to the other selected section/);
  assert.match(prompt, /Use every selected section type and no unselected type/);
});

test('mixed assessments reserve one mark per MCQ and allocate the exact remainder to practical work', () => {
  const mcqItems = documentMcqItems(15, index => index === 0 ? 4 : 1);
  const draft = normalizeAssessmentDraft({ title: 'Project', instructions: 'Complete both parts.', sections: [
    { title: 'Knowledge', type: 'mcq', instructions: 'Choose one.', objectiveIndexes: [0], items: mcqItems },
    { title: 'Practical', type: 'practical', instructions: 'Create the product.', objectiveIndexes: [0], items: [
      { prompt: 'Complete the required product.', marks: 1, options: [], correctIndex: 0, answerKey: '' },
    ] },
  ] }, {
    subject: 'ICT', topic: 'Documents', grade: 'Grade 2', objectives: 'Create a document.', lessonPurpose: 'project',
    totalMarks: 50, questionTypes: ['mcq', 'practical'], mcqCount: 15,
  });
  const mcq = draft.sections.find(section => section.type === 'mcq');
  const practical = draft.sections.find(section => section.type === 'practical');
  assert.equal(mcq.items.length, 15);
  assert.ok(mcq.items.every(item => item.marks === 1));
  assert.equal(practical.items.reduce((sum, item) => sum + item.marks, 0), 35);
  assert.deepEqual(assessmentDraftIssues(draft, { totalMarks: 50, questionTypes: ['mcq', 'practical'], mcqCount: 15 }), []);
});

test('assessment recovery completes a 14-question response without discarding the valid draft', async () => {
  const existing = documentMcqItems(14);
  let calls = 0;
  const client = { chat: { completions: { create: async () => {
    calls += 1;
    return { choices: [{ message: { content: JSON.stringify({
      item_1: { prompt: 'Which action saves a document?', marks: 1, options: ['Choose Save', 'Close the screen'], correctIndex: 0, answerKey: '' },
    }) } }] };
  } } } };
  const options = normalizeAssessmentOptions({ totalMarks: 50, questionTypes: ['mcq', 'practical'], mcqCount: 15 });
  const context = {
    subject: 'ICT', topic: 'Documents', grade: 'Grade 2', objectives: 'Create and save a document.',
    lessonPurpose: 'project', ...options,
  };
  const repaired = await repairAssessmentDraft(client, { title: 'Document project', instructions: 'Complete both parts.', sections: [
    { title: 'Knowledge', type: 'mcq', instructions: 'Choose one.', objectiveIndexes: [0], items: existing },
    { title: 'Practical', type: 'practical', instructions: 'Create a document.', objectiveIndexes: [0], items: [
      { prompt: 'Create and save the required document.', marks: 36, options: [], correctIndex: 0, answerKey: '' },
    ] },
  ] }, context, options);
  const mcq = repaired.sections.find(section => section.type === 'mcq');
  const practical = repaired.sections.find(section => section.type === 'practical');
  assert.equal(calls, 1);
  assert.equal(mcq.items.length, 15);
  assert.equal(mcq.items.reduce((sum, item) => sum + item.marks, 0), 15);
  assert.equal(practical.items.reduce((sum, item) => sum + item.marks, 0), 35);
  assert.deepEqual(assessmentDraftIssues(repaired, options), []);
});

test('repeated lines are removed as a final display safeguard', () => {
  const line = 'Introduce the objectives and expected outcome.';
  assert.equal(dedupeSectionLines([{ heading: 'Intro', content: `${line}\n${line}\nStudents open the project brief.` }])[0].content,
    `${line}\nStudents open the project brief.`);
});

test('a selected multiple-choice section cannot be silently omitted', () => {
  const options = { totalMarks: 50, structure: 'balanced', questionTypes: ['mcq', 'practical'], mcqCount: 15, deliveryMode: 'live' };
  const incomplete = {
    totalMarks: 50,
    sections: [{ type: 'practical', items: [{ prompt: 'Create the product', marks: 50 }] }],
  };
  assert.deepEqual(assessmentDraftIssues(incomplete, options), [
    'mcq section is missing',
    'expected assessment phase order mcq -> practical but received practical',
    'expected 15 multiple-choice items but received 0',
  ]);
});

test('test decks remove question checks, worked solutions and shortcuts', async () => {
  const slides = await withoutOpenAI(() => generateContent('ICT', 'document creation', 4, 'Grade 2', 'clear', '', { lessonPurpose: 'test' }));
  assert.equal(slides.some(slide => slide.type === 'check'), false);
  assert.ok(slides.filter(slide => slide.type === 'content').every(slide => !slide.example && !slide.worked && slide.shortcuts.length === 0));
  assert.equal(slides.at(-1).title, 'Finish and submit');
});

test('project decks retain progress questions without answer bullets or shortcut keys', async () => {
  const slides = await withoutOpenAI(() => generateContent('ICT', 'document creation', 4, 'Grade 2', 'clear', '', { lessonPurpose: 'project' }));
  const check = slides.find(slide => slide.type === 'check');
  assert.ok(check);
  assert.deepEqual(check.bullets, []);
  assert.ok(slides.filter(slide => slide.type === 'content').every(slide => slide.shortcuts.length === 0));
  assert.equal(slides.at(-1).title, 'Project submission');
});
