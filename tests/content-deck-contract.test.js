const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function contentSlide(overrides = {}) {
  return {
    title: 'Student project stage',
    stageId: 'practice',
    bullets: ['Complete this stage independently.', 'Have you checked your work?'],
    layoutHint: 'TEXT_HEAVY',
    example: '',
    speakerNotes: 'Circulate and observe while students work.',
    imageQuery: 'students project work',
    visual: { type: 'steps', items: ['Plan', 'Create', 'Check', 'Save'] },
    vocab: [],
    shortcuts: [],
    worked: { task: '', steps: [] },
    ...overrides,
  };
}

function deckResponse(overrides = {}) {
  return {
    titleSlide: { title: 'Document creation', subtitle: 'Create your own work', imageQuery: 'student document' },
    objectives: { items: ['Complete the task independently.'], imageQuery: 'student goal' },
    slides: [contentSlide()],
    check: { question: 'Have you completed this stage?', answer: [], imageQuery: 'student checklist' },
    activity: {
      title: 'Project work', goal: 'Complete the current stage', materials: [],
      instructions: ['Work independently.', 'Save your work.'],
      speakerNotes: 'Observe without completing the work for students.', imageQuery: 'student project',
    },
    recap: { points: ['Save and submit your work.'], imageQuery: 'student submission' },
    differentiation: { support: 'Read the stage card aloud.', stretch: 'Check each required part.' },
    ...overrides,
  };
}

function loadContent(reply) {
  const filename = path.join(__dirname, '..', 'content.js');
  const realRequire = createRequire(filename);
  const requests = [];
  let callIndex = 0;
  const moduleObject = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: moduleObject,
    process: { env: { OPENAI_API_KEY: 'test-only' } },
    console,
    require: name => {
      if (name === './ai-client') return { client: () => ({ chat: { completions: {
        create: async request => {
          requests.push(request);
          const response = typeof reply === 'function' ? reply(request, callIndex++) : reply;
          return { choices: [{ message: { content: JSON.stringify(response) } }] };
        },
      } } }) };
      if (name === './cache') return { wrap: async (_namespace, _inputs, generate) => generate() };
      return realRequire(name);
    },
  }, { filename });
  return { ...moduleObject.exports, requests };
}

function projectedAndNotesText(slides) {
  return slides.map(slide => [
    slide.title,
    slide.subtitle,
    ...(Array.isArray(slide.bullets) ? slide.bullets : []),
    slide.example,
    slide.speakerNotes,
    ...(Array.isArray(slide.vocab) ? slide.vocab.flatMap(item => [item.term, item.definition]) : []),
    ...(Array.isArray(slide.shortcuts) ? slide.shortcuts.flatMap(item => [item.action, item.keys]) : []),
    slide.worked && slide.worked.task,
    ...(Array.isArray(slide.worked && slide.worked.steps) ? slide.worked.steps : []),
  ].filter(Boolean).join(' ')).join('\n');
}

test('a missing selected MCQ phase is repaired deterministically before the project deck is returned', async () => {
  const response = deckResponse({
    slides: [
      contentSlide({
        title: 'Practical task: Create the letter',
        stageId: 'independent_practice',
        bullets: ['Write and save your own letter.', 'Have you checked the spelling?'],
      }),
      contentSlide({ title: 'Submit the practical work', stageId: 'check', bullets: ['Save the document.', 'Submit when asked.'] }),
    ],
  });
  const { generateContent } = loadContent(response);

  const slides = await generateContent('ICT', 'document creation', 2, 'Grade 2', 'clear', '', {
    teachingModelId: 'explicit_instruction',
    lessonPurpose: 'project',
    lessonPlanText: '## Assessment\nStudents complete 15 LessonScope multiple-choice questions, then a 35-mark practical task.',
    assessmentTotalMarks: 50,
    assessmentQuestionTypes: ['mcq', 'practical'],
    assessmentMcqCount: 15,
  });

  const phases = slides.filter(slide => slide.assessmentPhaseType);
  assert.equal(phases.map(slide => slide.assessmentPhaseType).join(','), 'mcq,practical');
  assert.equal(phases.map(slide => slide.assessmentPhaseIndex).join(','), '0,1');
  const mcqText = projectedAndNotesText([phases[0]]);
  assert.match(mcqText, /LessonScope/i);
  assert.match(mcqText, /15 (?:multiple-choice )?questions/i);
  assert.match(mcqText, /15 marks/i);
  assert.match(mcqText, /independent/i);
  assert.match(mcqText, /submit|wait/i);
});

test('project repair retains the approved task context instead of replacing it with generic stages', async () => {
  const response = deckResponse({
    slides: [
      contentSlide({
        title: 'Practical task: Write the letter',
        stageId: 'guided_practice',
        bullets: ['Open a document and write your own short letter.', 'Have you checked the spelling?'],
      }),
      contentSlide({
        title: 'Create five copies',
        stageId: 'model',
        bullets: ['Copy and paste your letter until there are five copies.', 'Do all five copies match?'],
      }),
      contentSlide({
        title: 'Save and submit',
        stageId: 'check',
        bullets: ['Save the completed document.', 'Can you see that it was submitted?'],
      }),
    ],
  });
  const { generateContent } = loadContent(response);

  const slides = await generateContent('ICT', 'document creation', 3, 'Grade 2', 'clear', '', {
    teachingModelId: 'explicit_instruction',
    lessonPurpose: 'project',
    lessonPlanText: [
      '## Project work',
      'Students open a document, write a short letter, correct its spelling, and copy and paste the letter five times.',
      '## Plenary',
      'Teacher confirms every submission.',
    ].join('\n'),
    assessmentTotalMarks: 35,
    assessmentQuestionTypes: ['practical'],
  });

  const text = projectedAndNotesText(slides);
  assert.match(text, /letter/i);
  assert.match(text, /spelling/i);
  assert.match(text, /five copies/i);
});

test('project purpose overrides the selected normal-lesson model stage schedule', async () => {
  const response = deckResponse({
    slides: [
      contentSlide({
        title: 'Practical task: Write the letter',
        stageId: 'guided_practice',
        bullets: ['Write your own short letter.', 'Have you checked it?'],
      }),
      contentSlide({
        title: 'Create five copies',
        stageId: 'model',
        bullets: ['Copy and paste your letter until there are five copies.', 'Do all five copies match?'],
      }),
      contentSlide({
        title: 'Save and submit',
        stageId: 'check',
        bullets: ['Save the completed document.', 'Can you see that it was submitted?'],
      }),
    ],
  });
  const { generateContent } = loadContent(response);

  const slides = await generateContent('ICT', 'document creation', 3, 'Grade 2', 'clear', '', {
    teachingModelId: 'explicit_instruction',
    lessonPurpose: 'project',
    lessonPlanText: '## Project work\nStudents write, copy, check and submit their own letter.',
    assessmentTotalMarks: 35,
    assessmentQuestionTypes: ['practical'],
  });

  assert.ok(slides.every(slide => slide.modelLabel !== 'Explicit Instruction'));
  const lessonStageIds = new Set(['review', 'explain', 'model', 'guided_practice', 'independent_practice', 'check']);
  assert.ok(slides.filter(slide => slide.type === 'content').every(slide => !lessonStageIds.has(slide.modelStage)),
    'a project deck must use project/assessment stages rather than the selected normal-lesson schedule');
});

test('test decks replace every leaked question, answer, hint, worked example and shortcut with administration-only content', async () => {
  const response = deckResponse({
    titleSlide: { title: 'LEAKED_QUESTION: What is 84 rounded to 10?', subtitle: 'SECRET_ANSWER_90', imageQuery: 'rounding answer' },
    objectives: { items: ['Hint: the correct answer is SECRET_ANSWER_90.'], imageQuery: 'math answer' },
    slides: [contentSlide({
      title: 'Worked example and guided practice',
      stageId: 'model',
      bullets: ['LEAKED_QUESTION: Round 84 to the nearest 10?', 'The answer is SECRET_ANSWER_90.'],
      example: '84 rounds to 90.',
      speakerNotes: 'Teach the rule and explain how to choose the answer.',
      vocab: [{ term: 'rounding', definition: 'Use the ones digit to find the answer.' }],
      shortcuts: [{ action: 'Submit answer', keys: 'Ctrl + V' }],
      worked: { task: 'Round 84', steps: ['Read 84', 'Choose 90'] },
    })],
    check: { question: 'Is SECRET_ANSWER_90 correct?', answer: ['Yes'], imageQuery: 'correct answer' },
    activity: {
      title: 'Try the live test question', goal: 'Find SECRET_ANSWER_90', materials: [],
      instructions: ['Use the hint.', 'Choose 90.'], speakerNotes: 'Explain the answer.', imageQuery: 'math test',
    },
    recap: { points: ['Remember that 84 rounds to SECRET_ANSWER_90.'], imageQuery: 'rounding answer' },
  });
  const { generateContent } = loadContent(response);

  const slides = await generateContent('Mathematics', 'rounding', 1, 'Grade 3', 'formal', '', {
    teachingModelId: 'explicit_instruction',
    lessonPurpose: 'test',
    assessmentTotalMarks: 50,
    assessmentQuestionTypes: ['mcq', 'practical'],
    assessmentMcqCount: 20,
  });

  const text = projectedAndNotesText(slides);
  assert.doesNotMatch(text, /LEAKED_QUESTION|SECRET_ANSWER_90|84 rounds to 90/i);
  assert.doesNotMatch(text, /\?/);
  assert.doesNotMatch(text, /\b(?:hint|correct answer|answer is|worked example|guided practice|Ctrl\s*\+)\b/i);
  assert.ok(slides.every(slide => slide.type !== 'check' && slide.type !== 'activity'));
  assert.ok(slides.every(slide => !slide.example && !slide.worked && (!slide.shortcuts || !slide.shortcuts.length) && (!slide.vocab || !slide.vocab.length)));
});

test('long approved plans keep late Assessment and Plenary sections in the model context', async () => {
  const response = deckResponse({ slides: [contentSlide({ title: 'Prepare', bullets: ['Follow the approved plan.'] })] });
  const { generateContent, requests } = loadContent(response);
  const filler = 'Context for this school planning field. '.repeat(24);
  const plan = Array.from({ length: 18 }, (_, index) => `## Planning field ${index + 1}\n${filler}`).join('\n\n')
    + `\n\n## Assessment\nWRITTEN_PHASE_SENTINEL: students complete the LessonScope section independently.${filler}`
    + `\n\n## Plenary\nSUBMISSION_SENTINEL: teacher confirms that every student submitted.${filler}`;
  assert.ok(plan.length > 12000);

  await generateContent('ICT', 'documents', 1, 'Grade 2', 'clear', '', {
    lessonPurpose: 'lesson',
    lessonPlanText: plan,
  });

  assert.equal(requests.length, 1);
  const prompt = requests[0].messages[0].content;
  assert.match(prompt, /## Assessment[\s\S]*WRITTEN_PHASE_SENTINEL/);
  assert.match(prompt, /## Plenary[\s\S]*SUBMISSION_SENTINEL/);
});

test('an edited assessment draft supplies custom phase order and mark allocations without exposing written phase titles', async () => {
  const response = deckResponse({
    slides: [contentSlide({ title: 'Generic project work', bullets: ['Complete your work independently.'] })],
  });
  const { generateContent } = loadContent(response);
  const mcqItems = Array.from({ length: 20 }, (_, index) => ({
    id: `mcq-${index + 1}`, prompt: `Private question ${index + 1}`, marks: 1,
    options: ['Private correct answer', 'Private distractor'], correctIndex: 0,
  }));
  const assessmentDraft = {
    title: 'Custom document project', subject: 'ICT', grade: 'Grade 5', assessmentType: 'project',
    deliveryMode: 'live', totalMarks: 80, instructions: 'Complete all three phases.',
    objectives: [{ id: 'objective-1', text: 'Create and explain a document.' }],
    sections: [
      { id: 'planning', title: 'Written planning', type: 'short-answer', objectiveIds: ['objective-1'], instructions: 'Write independently.', items: [{ id: 'plan-1', prompt: 'Private planning question', answerKey: 'Private marking guide', marks: 12 }] },
      { id: 'product', title: 'Build the product', type: 'practical', objectiveIds: ['objective-1'], instructions: 'Create your own product.', items: [{ id: 'product-1', prompt: 'Private practical criterion', marks: 48 }] },
      { id: 'knowledge', title: 'Knowledge check', type: 'mcq', objectiveIds: ['objective-1'], instructions: 'Choose one answer.', items: mcqItems },
    ],
  };

  const slides = await generateContent('ICT', 'document creation', 3, 'Grade 5', 'clear', '', {
    lessonPurpose: 'project',
    lessonPlanText: '## Assessment\nUse the approved custom three-phase assessment.',
    assessmentTotalMarks: 80,
    assessmentQuestionTypes: ['mcq', 'short-answer', 'practical'],
    assessmentMcqCount: 20,
    assessmentStructure: 'custom',
    assessmentDraft,
  });

  const phases = slides.filter(slide => slide.assessmentPhaseType);
  assert.equal(phases.map(slide => slide.assessmentPhaseType).join(','), 'short-answer,practical,mcq');
  const phaseText = phases.map(slide => projectedAndNotesText([slide]));
  assert.match(phaseText[0], /Short-answer section/i);
  assert.doesNotMatch(phaseText[0], /Written planning/i);
  assert.match(phaseText[0], /12 marks/i);
  assert.match(phaseText[1], /Build the product/i);
  assert.match(phaseText[1], /48 marks/i);
  assert.match(phaseText[2], /LessonScope questions/i);
  assert.doesNotMatch(phaseText[2], /Knowledge check/i);
  assert.match(phaseText[2], /20 marks/i);
  assert.doesNotMatch(projectedAndNotesText(slides), /Private question|Private correct answer|Private distractor|Private marking guide|Private practical criterion/i);
  const practicalDeckIndex = slides.findIndex(slide => slide.assessmentPhaseType === 'practical');
  const mcqDeckIndex = slides.findIndex(slide => slide.assessmentPhaseType === 'mcq');
  const projectFlowIndexes = slides.map((slide, index) => ['check', 'activity'].includes(slide.type) ? index : -1).filter(index => index >= 0);
  assert.ok(projectFlowIndexes.length > 0);
  assert.ok(projectFlowIndexes.every(index => index > practicalDeckIndex && index < mcqDeckIndex));
  assert.ok(slides.slice(mcqDeckIndex + 1).every(slide => slide.type === 'recap'), 'only neutral submission may follow the final phase');
});

test('a practical-first project completes every project stage before its final MCQ phase', async () => {
  const response = deckResponse({
    slides: [
      contentSlide({ title: 'Practical task', bullets: ['Open your document.', 'What must you create?'] }),
      contentSlide({ title: 'Write and revise', bullets: ['Write your own letter and check the spelling.', 'Is the letter complete?'] }),
      contentSlide({ title: 'Save the document', bullets: ['Save your work.', 'Can you find the saved file?'] }),
      contentSlide({ title: 'LessonScope multiple-choice', bullets: ['Answer 3 questions independently.', 'Have you answered every question?'] }),
    ],
  });
  const { generateContent } = loadContent(response);
  const assessmentDraft = {
    sections: [
      { title: 'Create the document', type: 'practical', items: [{ marks: 27 }] },
      { title: 'Knowledge check', type: 'mcq', items: [{ marks: 1 }, { marks: 1 }, { marks: 1 }] },
    ],
  };
  const slides = await generateContent('ICT', 'document creation', 4, 'Grade 2', 'clear', '', {
    lessonPurpose: 'project', assessmentDraft,
    lessonPlanText: 'Students open a document, write and revise a letter, save it, then complete the LessonScope knowledge check.',
  });
  const practicalIndex = slides.findIndex(slide => slide.assessmentPhaseType === 'practical');
  const mcqIndex = slides.findIndex(slide => slide.assessmentPhaseType === 'mcq');
  const projectFlowIndexes = slides.map((slide, index) => {
    const contextualContent = slide.type === 'content' && !slide.assessmentPhaseType;
    return contextualContent || slide.type === 'check' || slide.type === 'activity' ? index : -1;
  }).filter(index => index >= 0);

  assert.ok(practicalIndex >= 0 && mcqIndex > practicalIndex);
  assert.ok(projectFlowIndexes.length > 0);
  assert.ok(projectFlowIndexes.every(index => index > practicalIndex && index < mcqIndex));
  assert.ok(slides.slice(mcqIndex + 1).every(slide => slide.type === 'recap'));
});

test('an MCQ-only project keeps contextual work before the private phase without inventing another phase', async () => {
  const response = deckResponse({
    slides: [
      contentSlide({ title: 'Prepare your project context', bullets: ['Read the project scenario.', 'What information will you need?'] }),
      contentSlide({ title: 'LessonScope multiple-choice', bullets: ['Answer 5 questions independently.', 'Have you answered every question?'] }),
    ],
  });
  const { generateContent } = loadContent(response);
  const slides = await generateContent('Geography', 'local environments', 2, 'Grade 5', 'clear', '', {
    lessonPurpose: 'project',
    assessmentDraft: { sections: [{ title: 'Knowledge check', type: 'mcq', items: Array.from({ length: 5 }, () => ({ marks: 1 })) }] },
    lessonPlanText: 'Students read the local-environment project scenario and identify the information they need before opening LessonScope.',
  });
  const phaseTypes = slides.filter(slide => slide.assessmentPhaseType).map(slide => slide.assessmentPhaseType);
  const mcqIndex = slides.findIndex(slide => slide.assessmentPhaseType === 'mcq');
  const projectFlowIndexes = slides.map((slide, index) => {
    const contextualContent = slide.type === 'content' && !slide.assessmentPhaseType;
    return contextualContent || slide.type === 'check' || slide.type === 'activity' ? index : -1;
  }).filter(index => index >= 0);

  assert.equal(phaseTypes.join(','), 'mcq');
  assert.ok(projectFlowIndexes.length > 0);
  assert.ok(projectFlowIndexes.every(index => index < mcqIndex));
  assert.ok(slides.slice(mcqIndex + 1).every(slide => slide.type === 'recap'));
});

test('an extended-response-only project anchors its contextual work in that selected phase', async () => {
  const response = deckResponse({
    slides: [
      contentSlide({ title: 'Extended response', bullets: ['Write your own proposal.', 'Does it address the project scenario?'] }),
      contentSlide({ title: 'Check the proposal', bullets: ['Check every required paragraph.', 'Is the proposal ready to submit?'] }),
    ],
  });
  const { generateContent } = loadContent(response);
  const slides = await generateContent('English', 'community proposal', 2, 'Grade 8', 'formal', '', {
    lessonPurpose: 'project',
    assessmentDraft: { sections: [{ title: 'Written proposal', type: 'extended-response', items: [{ marks: 30 }] }] },
    lessonPlanText: 'Students draft, check and submit their own community proposal.',
  });
  const phaseTypes = slides.filter(slide => slide.assessmentPhaseType).map(slide => slide.assessmentPhaseType);
  const responseIndex = slides.findIndex(slide => slide.assessmentPhaseType === 'extended-response');
  const projectFlowIndexes = slides.map((slide, index) => {
    const contextualContent = slide.type === 'content' && !slide.assessmentPhaseType;
    return contextualContent || slide.type === 'check' || slide.type === 'activity' ? index : -1;
  }).filter(index => index >= 0);

  assert.equal(phaseTypes.join(','), 'extended-response');
  assert.ok(projectFlowIndexes.length > 0);
  assert.ok(projectFlowIndexes.every(index => index > responseIndex));
  assert.ok(slides.slice(Math.max(...projectFlowIndexes) + 1).every(slide => slide.type === 'recap'));
});

test('contextual project stages stay inside the practical phase when a written phase follows it', () => {
  const { ensureAssessmentDeckCoverage } = loadContent(deckResponse());
  const data = deckResponse({
    slides: [
      contentSlide({ title: 'Plan the investigation', bullets: ['Prepare your results table.', 'Is every heading ready?'] }),
      contentSlide({ title: 'Carry out the investigation', bullets: ['Record each observation.', 'Have you recorded every trial?'] }),
      contentSlide({ title: 'Check the evidence', bullets: ['Check the recorded results.', 'Is the evidence complete?'] }),
      contentSlide({ title: 'Refine the product', bullets: ['Improve the final product.', 'Is it ready to submit?'] }),
      contentSlide({ title: 'Save the work', bullets: ['Save your own work.', 'Can you find the saved file?'] }),
    ],
  });
  const assessmentDraft = {
    sections: [
      { title: 'Planning response', type: 'short-answer', items: [{ marks: 10 }] },
      { title: 'Practical investigation', type: 'practical', items: [{ marks: 25 }] },
      { title: 'Final knowledge check', type: 'mcq', items: [{ marks: 1 }, { marks: 1 }, { marks: 1 }] },
    ],
  };

  const repaired = ensureAssessmentDeckCoverage(data, 'project', {
    assessmentDraft,
    lessonPlanText: 'Students prepare a results table, record observations, check the evidence and save their work.',
  }, 'science investigation');
  const practicalIndex = repaired.slides.findIndex(slide => slide.assessmentPhaseType === 'practical');
  const mcqIndex = repaired.slides.findIndex(slide => slide.assessmentPhaseType === 'mcq');
  const contextualIndexes = repaired.slides.map((slide, index) => slide.assessmentPhaseType ? -1 : index).filter(index => index >= 0);

  assert.equal(repaired.slides.filter(slide => slide.assessmentPhaseType).map(slide => slide.assessmentPhaseType).join(','), 'short-answer,practical,mcq');
  assert.ok(contextualIndexes.length > 0);
  assert.ok(contextualIndexes.every(index => index > practicalIndex && index < mcqIndex));
});

test('project repair rejects teacher instructional phrasing after a colon or dash', () => {
  const { ensureAssessmentDeckCoverage } = loadContent(deckResponse());
  const unsafe = deckResponse({
    slides: [
      contentSlide({ title: 'Teacher-led step', bullets: ['Teacher: Explain how to create the assessed product.'] }),
      contentSlide({ title: 'Teacher-led model', bullets: ['Teacher — Model the correct method for students.'] }),
      contentSlide({ title: 'Teacher demonstration', bullets: ['Educator: Demonstrate the finished answer.'] }),
    ],
  });
  const repaired = ensureAssessmentDeckCoverage(unsafe, 'project', {
    assessmentDraft: { sections: [{ title: 'Practical task', type: 'practical', items: [{ marks: 30 }] }] },
    lessonPlanText: 'Students open their own document, write a letter, check the spelling, save and submit it.',
  }, 'document project');
  const text = projectedAndNotesText(repaired.slides);

  assert.doesNotMatch(text, /Teacher\s*(?::|—|-)\s*(?:Explain|Model)|Educator\s*:\s*Demonstrate/i);
  assert.match(text, /document|letter|spelling/i);
});

test('deterministic project repair keeps practical steps from the approved plan when model slides are unusable', () => {
  const { ensureAssessmentDeckCoverage } = loadContent(deckResponse());
  const plan = [
    '## Activities',
    'Phase 1: Students complete 15 multiple-choice questions in LessonScope (15 marks).',
    'Phase 2: Students open a Word document, write a letter, fix their spelling, then copy and paste the letter 5 times, save and submit (35 marks).',
    'Teacher circulates and records marks while students work.',
    '## Plenary',
    'Teacher confirms every student has submitted.',
  ].join('\n');
  const unsafe = deckResponse({
    slides: [
      contentSlide({ title: 'Review', bullets: ['Placeholder point 1.'] }),
      contentSlide({ title: 'Explain', bullets: ['Teacher explains how to write the answer.'] }),
      contentSlide({ title: 'Model', bullets: ['Teacher demonstrates Ctrl + C and Ctrl + V.'] }),
      contentSlide({ title: 'Guided Practice', bullets: ['Copy the finished answer.'] }),
    ],
  });

  const repaired = ensureAssessmentDeckCoverage(unsafe, 'project', {
    lessonPlanText: plan,
    assessmentTotalMarks: 50,
    assessmentQuestionTypes: ['mcq', 'practical'],
    assessmentMcqCount: 15,
  }, 'document creation');
  const text = projectedAndNotesText(repaired.slides);

  assert.match(text, /Open a Word document/i);
  assert.match(text, /Write a letter/i);
  assert.match(text, /Fix your spelling/i);
  assert.match(text, /letter 5 times/i);
  assert.doesNotMatch(text, /Placeholder|Review|Guided Practice|Ctrl\s*\+/i);
  assert.doesNotMatch(text, /Teacher circulates and records marks/i);
});

test('project plan step extraction removes private assessment content and exact shortcuts', () => {
  const { projectPlanSteps } = loadContent(deckResponse());
  const steps = projectPlanSteps([
    'Students type their own letter.',
    'Students use Ctrl + C and Ctrl + V to make five copies.',
    'LessonScope multiple-choice question: SECRET QUESTION (15 marks).',
    'Teacher checks the private rubric and answer key.',
  ].join('\n'), 'document creation');
  const text = steps.join(' ');

  assert.match(text, /Type your own letter/i);
  assert.match(text, /copy using the keyboard/i);
  assert.match(text, /paste using the keyboard/i);
  assert.doesNotMatch(text, /SECRET QUESTION|rubric|answer key|Ctrl\s*\+/i);
});

test('project shortcut redaction catches spaced, hyphenated, command-symbol and modified forms', () => {
  const { replacesShortcutKeys } = loadContent(deckResponse());
  const source = 'Ctrl C, Ctrl-C, Control C, Cmd C, Command C and ⌘C copy; Ctrl V and ⌘V paste; Ctrl-X cuts; Control S saves; Cmd Z undoes; Command-Y redoes; Ctrl Shift P opens another command.';
  const safe = replacesShortcutKeys(source);

  assert.doesNotMatch(safe, /(?:Ctrl|Control|Cmd|Command)(?:\s*\+\s*|\s*-\s*|\s+)(?:(?:Shift|Alt|Option)(?:\s*\+\s*|\s*-\s*|\s+))*[A-Z0-9]\b|⌘\s*(?:\+|-)?\s*[A-Z0-9]/i);
  assert.match(safe, /copy using the keyboard/i);
  assert.match(safe, /paste using the keyboard/i);
  assert.match(safe, /cut using the keyboard/i);
  assert.match(safe, /save using the keyboard/i);
  assert.match(safe, /undo using the keyboard/i);
  assert.match(safe, /redo using the keyboard/i);
  assert.match(safe, /the keyboard command/i);
});

test('project assessment phase titles cannot expose exact shortcut answers', () => {
  const { ensureAssessmentDeckCoverage } = loadContent(deckResponse());
  const repaired = ensureAssessmentDeckCoverage(deckResponse(), 'project', {
    assessmentDraft: {
      sections: [
        { title: 'Copy with Ctrl + C', type: 'practical', items: [{ marks: 20 }] },
        { title: 'Save with ⌘S', type: 'short-answer', items: [{ marks: 10 }] },
      ],
    },
    lessonPlanText: 'Students copy using the keyboard, save their own work, and submit it.',
  }, 'document creation');
  const phaseTitles = repaired.slides.filter(slide => slide.assessmentPhaseType).map(slide => slide.title).join(' ');

  assert.match(phaseTitles, /copy using the keyboard/i);
  assert.match(phaseTitles, /Short-answer section/i);
  assert.doesNotMatch(phaseTitles, /save using the keyboard/i);
  assert.doesNotMatch(phaseTitles, /Ctrl\s*\+\s*C|⌘\s*S/i);
});

test('project knowledge phase headings never repeat private stems or answers while practical headings stay useful', () => {
  const { ensureAssessmentDeckCoverage } = loadContent(deckResponse());
  const repaired = ensureAssessmentDeckCoverage(deckResponse(), 'project', {
    assessmentDraft: {
      sections: [
        {
          title: 'Which command copies selected text?', type: 'mcq',
          items: [{ prompt: 'Which command copies selected text?', options: ['Ctrl + C', 'Ctrl + V'], correctIndex: 0, marks: 1 }],
        },
        {
          title: 'The answer is Microsoft Word', type: 'short-answer',
          items: [{ prompt: 'Name the word processor.', answerKey: 'Microsoft Word', marks: 4 }],
        },
        {
          title: 'Create and save the school letter with Ctrl + S', type: 'practical',
          items: [{ prompt: 'Private practical marking criterion', marks: 15 }],
        },
      ],
    },
    lessonPlanText: 'Students create and save their own school letter, then submit it.',
  }, 'document creation');
  const phases = repaired.slides.filter(slide => slide.assessmentPhaseType);
  const phaseTitles = phases.map(slide => slide.title);
  const allText = projectedAndNotesText(repaired.slides);

  assert.equal(phaseTitles.join('\n'), [
    'Phase 1: LessonScope questions',
    'Phase 2: Short-answer section',
    'Phase 3: Create and save the school letter with save using the keyboard',
  ].join('\n'));
  assert.doesNotMatch(allText, /Which command copies selected text|The answer is Microsoft Word|Name the word processor|Microsoft Word|Ctrl\s*\+\s*[CSV]|Private practical marking criterion/i);
});

test('test administration comes before phase one and submission comes after the final phase', () => {
  const { ensureAssessmentDeckCoverage } = loadContent(deckResponse());
  const source = deckResponse({
    slides: Array.from({ length: 5 }, (_, index) => contentSlide({ title: `Unsafe test slide ${index + 1}` })),
  });
  const repaired = ensureAssessmentDeckCoverage(source, 'test', {
    assessmentDraft: {
      sections: [
        { title: 'Knowledge check', type: 'mcq', items: Array.from({ length: 15 }, () => ({ marks: 1 })) },
        { title: 'Practical task', type: 'practical', items: [{ marks: 35 }] },
      ],
    },
  }, 'document creation');
  const phaseIndexes = repaired.slides.map((slide, index) => slide.assessmentPhaseType ? index : -1).filter(index => index >= 0);
  const submitIndex = repaired.slides.findIndex(slide => /check and submit/i.test(slide.title));

  assert.equal(repaired.slides[0].title, 'Before the test');
  assert.ok(repaired.slides.findIndex(slide => /test conditions/i.test(slide.title)) < phaseIndexes[0]);
  assert.equal(phaseIndexes.map(index => repaired.slides[index].assessmentPhaseType).join(','), 'mcq,practical');
  assert.ok(submitIndex > phaseIndexes.at(-1));
  assert.equal(repaired.slides.filter((slide, index) => /check and submit/i.test(slide.title) && index < phaseIndexes.at(-1)).length, 0);
  assert.equal(repaired.slides.at(-1).title, 'Check and submit');
});

test('a structured phase manifest keeps duplicate phase types, order and exact marks without a draft', () => {
  const { assessmentPhaseManifest } = loadContent(deckResponse());
  const manifest = assessmentPhaseManifest({
    assessmentTotalMarks: 30,
    assessmentQuestionTypes: ['short-answer', 'practical'],
    assessmentPhases: [
      { type: 'short-answer', title: 'Plan', marks: 5 },
      { type: 'short-answer', title: 'Evaluate', marks: 10 },
      { type: 'practical', title: 'Create', marks: 15 },
    ],
  });
  assert.deepEqual(manifest.map(phase => `${phase.type}:${phase.title}:${phase.marks}`), [
    'short-answer:Plan:5',
    'short-answer:Evaluate:10',
    'practical:Create:15',
  ]);
});

test('project and test deck repair removes every exact private assessment string', async () => {
  const privateValues = {
    question: 'PRIVATE QUESTION: Which file name should you choose?',
    option: 'PRIVATE OPTION: Class_Letter_Monday',
    answerKey: 'PRIVATE KEY: award two marks for purpose and audience.',
    criterion: 'Create a file named Saturn and format the heading in blue',
    sectionTitle: 'PRIVATE TITLE QUESTION: Which document command is correct?',
    rubric: 'PRIVATE RUBRIC: award marks for the exact finished layout.',
  };
  const assessmentDraft = {
    sections: [
      { title: privateValues.sectionTitle, type: 'mcq', instructions: privateValues.rubric, items: [{ prompt: privateValues.question, options: [privateValues.option, 'Another private option'], correctIndex: 0, marks: 1 }] },
      { title: 'Written response', type: 'short-answer', items: [{ prompt: 'Explain the document purpose in your own words.', answerKey: privateValues.answerKey, marks: 4 }] },
      { title: 'Practical task', type: 'practical', items: [{ prompt: privateValues.criterion, marks: 15 }] },
    ],
  };
  const response = deckResponse({
    slides: [
      contentSlide({ title: privateValues.question, bullets: [privateValues.option, privateValues.answerKey] }),
      contentSlide({ title: 'Create the file', bullets: [privateValues.criterion, 'Have you checked the work?'] }),
    ],
  });
  const { generateContent } = loadContent(response);
  for (const purpose of ['project', 'test']) {
    const slides = await generateContent('ICT', 'document creation', 2, 'Grade 5', 'clear', '', {
      lessonPurpose: purpose,
      lessonPlanText: `Students ${privateValues.criterion}.`,
      assessmentDraft,
    });
    const text = projectedAndNotesText(slides);
    for (const value of Object.values(privateValues)) assert.ok(!text.toLowerCase().includes(value.toLowerCase()), `${purpose} deck leaked ${value}`);
    if (purpose === 'test') assert.match(text, /Phase 1: LessonScope questions/);
  }
});
