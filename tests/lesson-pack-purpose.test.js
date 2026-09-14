const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function modelResponse(name) {
  const responses = {
    study_notes: {
      title: 'Preparation notes', summary: 'Summary', keyIdeas: ['Idea'],
      vocabulary: [{ term: 'Term', definition: 'Definition' }],
      workedExample: { title: 'Example', steps: ['Step'] },
      commonMistakes: ['Mistake'], selfCheck: ['I can prepare.'],
    },
    worksheet: {
      title: 'Preparation organiser', focus: 'Prepare', warmup: ['Recall'],
      example: { problem: 'Practice', solution: 'Solution' },
      questions: ['Question'], challenge: 'Challenge', answerKey: ['Answer', 'Challenge answer'],
    },
    exit_ticket: { title: 'Readiness check', questions: ['Ready?'], answerKey: ['Yes'] },
    quiz: {
      title: 'Practice quiz', instructions: 'Choose.',
      mcq: [{ question: 'Practice?', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }],
      shortAnswer: [{ question: 'Explain.', marks: 2, answer: 'Explanation' }], totalMarks: 3,
    },
    homework: {
      title: 'Preparation homework', instructions: 'Prepare.', estimatedMinutes: 10,
      recap: ['Recall'], tasks: ['Task'], applyTask: 'Apply', answerKey: ['Answer', 'Apply answer'],
    },
    differentiated_activities: {
      title: 'Preparation support', focus: 'Prepare',
      levels: [{ label: 'Support', audience: 'Learners', tasks: ['Task'], answerKey: ['Answer'] }],
    },
    lesson_game: {
      overview: 'Review this lesson.', concepts: [{ term: 'Term', explanation: 'Explanation' }],
      questions: [{ question: 'Practice?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Explanation' }],
    },
  };
  return responses[name];
}

function lessonPackHarness(responseFor = modelResponse) {
  const filename = path.join(__dirname, '..', 'lesson-pack.js');
  const realRequire = createRequire(filename);
  const requests = [];
  const cacheCalls = [];
  const moduleObject = { exports: {} };

  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: moduleObject,
    process: { env: { OPENAI_API_KEY: 'test-only' } },
    console,
    require: name => {
      if (name === './ai-client') return { client: () => ({ chat: { completions: {
        create: async request => {
          requests.push(request);
          const schemaName = request.response_format.json_schema.name;
          return { choices: [{ message: { content: JSON.stringify(responseFor(schemaName)) } }] };
        },
      } } }) };
      if (name === './cache') return { wrap: async (namespace, inputs, generate) => {
        cacheCalls.push({ namespace, inputs });
        return generate();
      } };
      return realRequire(name);
    },
  }, { filename });

  return { pack: moduleObject.exports, requests, cacheCalls };
}

const baseContext = lessonPurpose => ({
  subject: 'ICT', topic: 'document creation', grade: 'Grade 2',
  objectives: 'Plan and create a document.', teachingModelId: 'standard', lessonPurpose,
  lessonPlanText: '## Introduction\nPrepare for the task.\n## Assessment\nComplete the required phases.\n## Plenary\nConfirm submission.',
});

test('every project and test pack resource receives its purpose-specific preparation role', async () => {
  const { pack, requests } = lessonPackHarness();
  const generators = [
    ['generateStudyNotes', /PROJECT PREPARATION GUIDE/i, /TEST REVISION GUIDE/i],
    ['generateWorksheet', /PROJECT PLANNING ORGANISER/i, /UNASSESSED TEST PRACTICE SHEET/i],
    ['generateExitTicket', /PROJECT READINESS OR PROGRESS CHECK/i, /TEST READINESS CHECK/i],
    ['generateQuiz', /UNASSESSED PROJECT READINESS QUIZ/i, /UNASSESSED PRACTICE QUIZ/i],
    ['generateHomework', /PROJECT PREPARATION TASK/i, /TEST REVISION TASK/i],
    ['generateActivities', /PROJECT PREPARATION SUPPORT SHEETS/i, /DIFFERENTIATED TEST REVISION SHEETS/i],
    ['generateGame', /UNASSESSED PROJECT PREPARATION GAME/i, /UNASSESSED TEST REVISION GAME/i],
  ];

  for (const purpose of ['project', 'test']) {
    for (const [method, projectRole, testRole] of generators) {
      await pack[method](baseContext(purpose));
      const prompt = requests.at(-1).messages[0].content;
      assert.match(prompt, purpose === 'project' ? projectRole : testRole, `${method} needs the ${purpose} preparation role`);
      if (method === 'generateGame') assert.match(prompt, /Begin the overview by stating clearly that this is (?:project|test) preparation/i);
      else assert.match(prompt, new RegExp(`Put "${purpose === 'project' ? 'Project' : 'Test'} preparation" in the title`, 'i'));
      assert.match(prompt, /preparation, not the live (project|test)/i);
      assert.match(prompt, /Never expose.+questions, answer choices, answers, exact assessed procedure, rubric or private marking guidance/is);
    }
  }
});

test('pack prompts and cache retain late plan sections and only a safe assessment phase summary', async () => {
  const { pack, requests, cacheCalls } = lessonPackHarness();
  const longPlan = [
    `## Introduction\n${'Early introduction detail. '.repeat(240)}`,
    `## Main activity\n${'Early activity detail. '.repeat(240)}`,
    '## Assessment\nLATE_ASSESSMENT_SECTION: learners complete the written and practical phases. PRIVATE_PROMPT_ALPHA PRIVATE_OPTION_A PRIVATE_ANSWER_ALPHA',
    '## Plenary\nLATE_PLENARY_SECTION: confirm that every learner has submitted.',
  ].join('\n\n');
  assert.ok(longPlan.length > 10000, 'fixture must exercise long-plan compaction');

  const assessmentDraft = {
    sections: [
      {
        title: 'Written response', type: 'short-answer',
        items: [
          { prompt: 'PRIVATE_PROMPT_ALPHA', marks: 4, answerKey: 'PRIVATE_ANSWER_ALPHA' },
          { prompt: 'PRIVATE_PROMPT_BETA', marks: 6, answerKey: 'PRIVATE_ANSWER_BETA' },
        ],
      },
      {
        title: 'Practical investigation', type: 'practical',
        items: [{ prompt: 'PRIVATE_PRACTICAL_CRITERION', marks: 25 }],
      },
      {
        title: 'Knowledge check', type: 'mcq',
        items: [
          { prompt: 'PRIVATE_MCQ_ONE', options: ['PRIVATE_OPTION_A', 'PRIVATE_OPTION_B'], correctIndex: 0, marks: 1 },
          { prompt: 'PRIVATE_MCQ_TWO', options: ['PRIVATE_OPTION_C', 'PRIVATE_OPTION_D'], correctIndex: 1, marks: 1 },
          { prompt: 'PRIVATE_MCQ_THREE', options: ['PRIVATE_OPTION_E', 'PRIVATE_OPTION_F'], correctIndex: 0, marks: 1 },
        ],
      },
    ],
  };

  await pack.generateStudyNotes({ ...baseContext('project'), lessonPlanText: longPlan, assessmentDraft });
  const prompt = requests[0].messages[0].content;
  const cache = cacheCalls[0].inputs;

  for (const marker of ['LATE_ASSESSMENT_SECTION', 'LATE_PLENARY_SECTION']) {
    assert.match(prompt, new RegExp(marker));
    assert.match(cache.lessonPlanText, new RegExp(marker));
  }

  const expectedPhases = [
    'Phase 1: Written response — short answer, 2 items, 10 marks',
    'Phase 2: Practical investigation — practical / observation, 1 item, 25 marks',
    'Phase 3: Knowledge check — multiple choice, 3 items, 3 marks',
  ];
  let previous = -1;
  for (const phase of expectedPhases) {
    assert.match(prompt, new RegExp(phase));
    assert.match(cache.assessmentStructure, new RegExp(phase));
    const position = prompt.indexOf(phase);
    assert.ok(position > previous, `${phase} must retain the teacher's phase order`);
    previous = position;
  }

  const publicInputs = JSON.stringify({ prompt, cache });
  for (const privateToken of [
    'PRIVATE_PROMPT_ALPHA', 'PRIVATE_PROMPT_BETA', 'PRIVATE_ANSWER_ALPHA', 'PRIVATE_ANSWER_BETA',
    'PRIVATE_PRACTICAL_CRITERION', 'PRIVATE_MCQ_ONE', 'PRIVATE_MCQ_TWO', 'PRIVATE_MCQ_THREE',
    'PRIVATE_OPTION_A', 'PRIVATE_OPTION_B', 'PRIVATE_OPTION_C', 'PRIVATE_OPTION_D', 'PRIVATE_OPTION_E', 'PRIVATE_OPTION_F',
  ]) assert.doesNotMatch(publicInputs, new RegExp(privateToken), `${privateToken} must stay out of model and cache inputs`);
});

test('model output is forced into preparation framing and cannot echo private live-assessment content', async () => {
  const leakingResponse = name => {
    const response = modelResponse(name);
    if (name !== 'worksheet') return response;
    return {
      ...response,
      title: 'PRIVATE_PROMPT_ALPHA live test worksheet',
      focus: 'Use PRIVATE_OPTION_A from this lesson.',
      questions: ['Repeat PRIVATE_PROMPT_ALPHA exactly.'],
      answerKey: ['PRIVATE_ANSWER_ALPHA'],
    };
  };
  const { pack } = lessonPackHarness(leakingResponse);
  const assessmentDraft = { instructions: 'PRIVATE_OVERALL_INSTRUCTIONS', sections: [{
    title: 'PRIVATE TITLE QUESTION: Which document command is correct?', type: 'mcq', instructions: 'PRIVATE_SECTION_INSTRUCTIONS',
    items: [{
      prompt: 'PRIVATE_PROMPT_ALPHA', options: ['PRIVATE_OPTION_A', 'PRIVATE_OPTION_B'],
      correctIndex: 0, marks: 1, answerKey: 'PRIVATE_ANSWER_ALPHA',
    }],
  }] };
  const output = await pack.generateWorksheet({ ...baseContext('test'), assessmentDraft });
  assert.match(output.title, /Test preparation unassessed practice sheet/);
  assert.match(output.focus, /unassessed revision and practice to prepare for the test/i);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_(?:PROMPT|OPTION|ANSWER|SECTION|OVERALL|TITLE)/);
  assert.doesNotMatch(JSON.stringify(output), /this lesson/i);
});

test('test preparation summaries expose only neutral phase labels', async () => {
  const { pack, requests, cacheCalls } = lessonPackHarness();
  const assessmentDraft = { sections: [{
    title: 'PRIVATE TITLE QUESTION: Which document command is correct?', type: 'mcq',
    instructions: 'PRIVATE RUBRIC CRITERIA',
    items: [{ prompt: 'PRIVATE PROMPT', options: ['PRIVATE OPTION A', 'PRIVATE OPTION B'], correctIndex: 0, marks: 1 }],
  }] };
  await pack.generateStudyNotes({ ...baseContext('test'), assessmentDraft });
  const publicInputs = JSON.stringify({ prompt: requests[0].messages[0].content, cache: cacheCalls[0].inputs });
  assert.match(publicInputs, /Phase 1: multiple choice/);
  assert.doesNotMatch(publicInputs, /PRIVATE (?:TITLE|RUBRIC|PROMPT|OPTION)/);
});

test('offline project and test resources keep preparation titles and semantics for every pack output', async () => {
  const pack = require('../lesson-pack');
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const methods = ['generateStudyNotes', 'generateWorksheet', 'generateExitTicket', 'generateQuiz', 'generateHomework', 'generateActivities', 'generateGame'];
    for (const purpose of ['project', 'test']) {
      for (const method of methods) {
        const output = await pack[method]({ ...baseContext(purpose), questionCount: 4 });
        const publicText = JSON.stringify(output);
        if (method !== 'generateGame') assert.match(output.title, new RegExp(`${purpose === 'project' ? 'Project' : 'Test'} preparation`, 'i'));
        else assert.match(output.overview, /prepare (?:and plan )?for the (?:project|test)/i);
        assert.doesNotMatch(publicText, /this lesson|today(?:'|’)s lesson/i);
      }
    }
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test('missing-plan download rebuilds from the deck with its stored purpose and assessment controls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/lesson-plan/download'");
  const end = source.indexOf('\napp.', start + 1);
  const route = source.slice(start, end);
  assert.match(route, /const storedAssessmentOptions = normalizeAssessmentOptions\(deck\.assessmentOptions \|\| \{\}\)/);
  assert.match(route, /lessonPurpose:\s*deck\.lessonPurpose/);
  for (const [argument, field] of [
    ['assessmentTotalMarks', 'totalMarks'], ['assessmentStructure', 'structure'],
    ['assessmentDeliveryMode', 'deliveryMode'], ['assessmentBrief', 'brief'],
    ['assessmentQuestionTypes', 'questionTypes'], ['assessmentMcqCount', 'mcqCount'],
  ]) assert.match(route, new RegExp(`${argument}:\\s*storedAssessmentOptions\\.${field}`));
});
