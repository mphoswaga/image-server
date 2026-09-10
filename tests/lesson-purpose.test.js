const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const assignments = require('../assignments');
const { generateLessonPlan, buildPrompt, planSchema, lessonPlanIssues, dedupeSectionLines } = require('../lesson-plan');
const { generateContent } = require('../content');
const { getTeachingModel } = require('../teaching-models');
const { normalizeAssessmentOptions, assessmentDraftIssues } = require('../assessment-draft');

async function withoutOpenAI(run) {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try { return await run(); }
  finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
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
  const normalized = assignments.normalizeAssessment(plan.assessmentDraft);
  assert.equal(normalized.questions.reduce((sum, item) => sum + item.marks, 0), 50);
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
  assert.match(project, /A project plenary is a submission, presentation, progress reflection or next-step checkpoint/);
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
    { heading: 'Plenary (10m)', stageId: 'reflect', content: 'Pupils submit the finished document and reflect on one improvement.' },
    { heading: 'Differentiation', stageId: 'practice', content: 'Provide a visual stage card and extra processing time while keeping the same assessed product.' },
    { heading: 'Assessment', stageId: 'check', content: 'Students complete the LessonScope knowledge section independently, then present the practical product for grading.' },
  ] };
  assert.deepEqual(lessonPlanIssues(raw, {
    lessonPurpose: 'project',
    templateText: 'Intro (10m):\nActivities (50m):\nPlenary (10m):\nDifferentiation:\nAssessment:',
  }), []);
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
  assert.equal(slides.at(-1).title, 'Project checkpoint');
});
