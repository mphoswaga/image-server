const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPrompt,
  finalizeLessonPlan,
  generateLessonPlan,
  lessonPlanIssues,
  repairGeneratedPlan,
  ensureAssessmentFlowVisible,
} = require('../lesson-plan');

async function withoutOpenAI(run) {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try { return await run(); }
  finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
}

const templateText = [
  'Front matter:',
  'Mini-Lesson:',
  'Model:',
  'Guided Practice:',
  'Plenary:',
  'Resources:',
  'Reflection:',
  'Phonics:',
].join('\n');

function administrativeTestPlan(overrides = {}) {
  const content = {
    'Front matter': 'Students complete the written assessment under formal test conditions.',
    'Mini-Lesson': 'Teacher states the test instructions, permitted materials and timing before the test starts.',
    Model: 'Teacher confirms the room code and approved access arrangements.',
    'Guided Practice': 'Students work independently while the teacher supervises the room.',
    Plenary: 'Students submit their work. Teacher confirms collection before dismissal and records marks in LessonScope.',
    Resources: 'Before the test, students use a revision worksheet and an unassessed rehearsal activity to review prerequisite knowledge. Provide the assessment, timer and approved accommodation materials for the live session.',
    Reflection: '',
    Phonics: '',
    ...overrides,
  };
  return {
    sections: Object.entries(content).map(([heading, value], index) => ({
      heading,
      content: value,
      stageId: index < 2 ? 'review' : 'check',
    })),
  };
}

test('project and test prompts override instructional models while normal lessons retain them', () => {
  const base = {
    subject: 'ICT', topic: 'documents', grade: 'Grade 2', tone: 'clear',
    objectives: 'Create and save a document.', teachingModel: 'explicit_instruction',
    templateText,
  };
  const normal = buildPrompt({ ...base, lessonPurpose: 'lesson' });
  const project = buildPrompt({ ...base, lessonPurpose: 'project' });
  const assessment = buildPrompt({ ...base, lessonPurpose: 'test' });

  assert.match(normal, /Teach the new concept in small, clear steps/);
  assert.match(normal, /Demonstrate the exact process/);
  for (const prompt of [project, assessment]) {
    assert.match(prompt, /purpose overrides instructional actions/i);
    assert.doesNotMatch(prompt, /Teach the new concept in small, clear steps/);
    assert.doesNotMatch(prompt, /Demonstrate the exact process and make thinking visible/);
    assert.match(prompt, /school template still owns every heading and its order/i);
  }
});

test('project validation rejects assessed-skill teaching even when students also create a product', () => {
  const raw = { sections: [
    { heading: 'Project Launch', content: 'Teacher launches the document project, task brief, phases and success criteria.' },
    { heading: 'Project Work', content: 'Teacher models how to copy and paste the text.\nStudents create and revise the required document through a checkpoint.' },
    { heading: 'Plenary', content: 'Teacher checks the submission list and confirms that every learner submitted.' },
    { heading: 'Resources', content: 'Before the project, students use an unassessed mouse practice activity and a keyboard reference card to rehearse prerequisite skills on a separate sample. Provide the task brief, device and submission checklist.' },
    { heading: 'Assessment', content: 'Teacher circulates, observes the project work and records evidence.' },
  ] };
  const issues = lessonPlanIssues(raw, { lessonPurpose: 'project' });
  assert.ok(issues.some(issue => /teaches or demonstrates assessed skills/.test(issue)));
});

test('project repair recognises Share and Reflect as the template plenary without reordering rows', () => {
  const projectTemplate = [
    'Driving Question:',
    'Plan:',
    'Create and Revise:',
    'Share and Reflect:',
    'Reflection:',
    'Phonics:',
  ].join('\n');
  const raw = { sections: [
    { heading: 'Driving Question', content: 'Teacher launches the assessed project outcome, brief, phases and success criteria.' },
    { heading: 'Plan', content: 'Before the project, students use an unassessed planning exercise and a reference checklist to rehearse prerequisite skills. Students then plan the project product and prepare the required materials.' },
    { heading: 'Create and Revise', content: 'Students create, check and revise the product.\nTeacher circulates, observes checkpoints and records evidence.' },
    { heading: 'Share and Reflect', content: 'Students prepare the finished product for upload.' },
    { heading: 'Reflection', content: '' },
    { heading: 'Phonics', content: '' },
  ] };
  const repaired = repairGeneratedPlan(raw, { lessonPurpose: 'project', templateText: projectTemplate });
  assert.deepEqual(repaired.sections.map(section => section.heading), [
    'Driving Question', 'Plan', 'Create and Revise', 'Share and Reflect', 'Reflection', 'Phonics',
  ]);
  assert.match(repaired.sections[3].content, /confirms that every student has submitted/);
  assert.deepEqual(lessonPlanIssues(repaired, { lessonPurpose: 'project', templateText: projectTemplate }), []);
});

test('test rows may keep instructional template names when their content is administration only', () => {
  const raw = administrativeTestPlan();
  assert.deepEqual(lessonPlanIssues(raw, { lessonPurpose: 'test', templateText }), []);
  assert.deepEqual(raw.sections.map(section => section.heading), [
    'Front matter', 'Mini-Lesson', 'Model', 'Guided Practice', 'Plenary', 'Resources', 'Reflection', 'Phonics',
  ]);
});

test('test validation rejects mini-lessons, modelling, guided practice, hints and answer leakage', () => {
  const raw = administrativeTestPlan({
    'Mini-Lesson': 'Teacher teaches the document skill before students begin.',
    Model: 'Teacher demonstrates a worked example and reveals the correct answer.',
    'Guided Practice': 'Teacher leads guided practice and provides a hint before independent work.',
  });
  const issues = lessonPlanIssues(raw, { lessonPurpose: 'test', templateText });
  assert.ok(issues.some(issue => /administration only/.test(issue)));
});

test('a prohibition cannot hide teaching elsewhere in the same test instruction', () => {
  const raw = administrativeTestPlan({
    Model: 'Teacher models the correct method and does not provide hints during the remaining test.',
  });
  const issues = lessonPlanIssues(raw, { lessonPurpose: 'test', templateText });
  assert.ok(issues.some(issue => /administration only/.test(issue)));

  const safe = administrativeTestPlan({
    Model: 'Teacher confirms the room code and supervises without explaining answers.',
  });
  assert.deepEqual(lessonPlanIssues(safe, { lessonPurpose: 'test', templateText }), []);
});

test('project and test plans reject placeholder rows but allow blank Reflection and Phonics', () => {
  const raw = administrativeTestPlan({ Resources: 'Not set — type it here if your form needs it.' });
  const issues = lessonPlanIssues(raw, { lessonPurpose: 'test', templateText });
  assert.ok(issues.some(issue => /placeholder content: Resources/.test(issue)));
  assert.ok(!issues.some(issue => /placeholder content:.*(?:Reflection|Phonics)/.test(issue)));
});

test('project and test resources must prepare students without exposing assessed content', () => {
  const equipmentOnly = administrativeTestPlan({ Resources: 'Provide the assessment paper, timer and pencils.' });
  assert.ok(lessonPlanIssues(equipmentOnly, { lessonPurpose: 'test', templateText })
    .some(issue => /before-assessment review, rehearsal or reference activity/.test(issue)));

  const leakedAnswers = administrativeTestPlan({
    Resources: 'Before the test, students use the answer key and completed assessed document to review the required skills.',
  });
  assert.ok(lessonPlanIssues(leakedAnswers, { lessonPurpose: 'test', templateText })
    .some(issue => /expose live assessment content, answers or a completed assessed product/.test(issue)));

  const safeProject = { sections: [
    { heading: 'Project Launch', content: 'Teacher launches the assessed project outcome, brief, phases and success criteria.' },
    { heading: 'Project Work', content: 'Students create and revise the project product through visible checkpoints. Teacher circulates, observes and records evidence.' },
    { heading: 'Plenary', content: 'Teacher checks the LessonScope submission list and confirms that every student submitted.' },
    { heading: 'Resources', content: 'Before the project, students use an unassessed practice activity and a vocabulary reference guide to rehearse prerequisite skills on a separate sample.' },
    { heading: 'Assessment', content: 'Teacher grades the submitted project product against the approved criteria.' },
  ] };
  assert.ok(!lessonPlanIssues(safeProject, { lessonPurpose: 'project' })
    .some(issue => /preparation resources/.test(issue)));
});

test('offline project and test fallbacks remain purpose-correct for instructional model selections', async () => {
  const project = await withoutOpenAI(() => generateLessonPlan({
    subject: 'ICT', topic: 'documents', grade: 'Grade 2', objectives: 'Create and save a document.',
    teachingModel: 'explicit_instruction', lessonPurpose: 'project',
    assessmentQuestionTypes: ['practical'], assessmentTotalMarks: 35,
  }));
  const assessment = await withoutOpenAI(() => generateLessonPlan({
    subject: 'ICT', topic: 'documents', grade: 'Grade 2', objectives: 'Create and save a document.',
    teachingModel: 'project_based', lessonPurpose: 'test',
    assessmentQuestionTypes: ['mcq'], assessmentMcqCount: 15, assessmentTotalMarks: 15,
  }));

  assert.deepEqual(lessonPlanIssues(project, { lessonPurpose: 'project' }), []);
  assert.deepEqual(lessonPlanIssues(assessment, { lessonPurpose: 'test' }), []);
  assert.ok(project.sections.every(section => !/Teaching model:|I Do|Guided Practice/.test(section.content)));
  assert.ok(assessment.sections.every(section => !/mini-lesson|worked example|correct answer/i.test(section.content)));
});

test('finalisation never injects gradual-release teaching into project or test plans', () => {
  const project = finalizeLessonPlan({ sections: [
    { heading: 'Project Work', content: 'Students create the project product while the teacher circulates.' },
  ] }, { teachingModelId: 'gradual_release', lessonPurpose: 'project' });
  const normal = finalizeLessonPlan({ sections: [
    { heading: 'Main Teaching', content: 'Introduce the new skill.' },
  ] }, { teachingModelId: 'gradual_release', lessonPurpose: 'lesson' });

  assert.doesNotMatch(project.sections[0].content, /Teaching model: Gradual Release|I Do|We Do/);
  assert.match(normal.sections[0].content, /Teaching model: Gradual Release/);
  assert.match(normal.sections[0].content, /I Do/);
});

test('the plan assessment row mirrors the editable phase order, titles, counts and marks', () => {
  const sections = [
    { heading: 'Project work', content: 'Students complete contextual project checkpoints.' },
    { heading: 'Assessment', content: 'Phase 1 has 15 multiple-choice questions and the practical is worth 35 marks.' },
    { heading: 'Plenary', content: 'Teacher confirms that every learner submitted.' },
  ];
  const assessmentDraft = {
    sections: [
      { title: 'Written response', type: 'short-answer', items: [{ marks: 5 }, { marks: 7 }] },
      { title: 'Practical investigation', type: 'practical', items: [{ marks: 18 }, { marks: 30 }] },
      { title: 'Knowledge check', type: 'mcq', items: Array.from({ length: 20 }, () => ({ marks: 1 })) },
    ],
  };
  const updated = ensureAssessmentFlowVisible(sections, 'project', {
    totalMarks: 80,
    questionTypes: ['short-answer', 'practical', 'mcq'],
    mcqCount: 20,
  }, assessmentDraft);

  assert.deepEqual(updated.map(section => section.heading), ['Project work', 'Assessment', 'Plenary']);
  assert.match(updated[1].content, /phase 1 .* Written response \(short-answer\).*2 items.*12 marks/i);
  assert.match(updated[1].content, /phase 2 .* Practical investigation \(project practical\).*2 criteria.*48 marks/i);
  assert.match(updated[1].content, /phase 3 .* Knowledge check \(LessonScope multiple-choice\).*20 questions.*20 marks/i);
  assert.ok(updated[1].content.indexOf('Written response') < updated[1].content.indexOf('Practical investigation'));
  assert.ok(updated[1].content.indexOf('Practical investigation') < updated[1].content.indexOf('Knowledge check'));
  assert.doesNotMatch(updated[1].content, /15 multiple-choice|35 marks/);

  const normal = ensureAssessmentFlowVisible(sections, 'lesson', {}, assessmentDraft);
  assert.deepEqual(normal, sections, 'ordinary lessons are unchanged');
});
