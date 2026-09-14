const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  cleanContext,
  proposeEdit,
  assertPurposeTargetIsEditable,
  validatePurposeEdits,
} = require('../lesson-assistant');
const { generateContent } = require('../content');

const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');

test('Assistant context keeps public project assessment settings without sending private items', () => {
  const context = cleanContext({
    lessonPurpose: 'project',
    assessmentTotalMarks: 50,
    assessmentQuestionTypes: 'mcq, practical',
    assessmentMcqCount: 15,
    assessmentSummary: 'Phase 1: Knowledge · mcq · 15 items · 15 marks',
    assessmentDraft: { sections: [{ items: [{ prompt: 'Private live question', correctIndex: 2 }] }] },
  });

  assert.equal(context.lessonPurpose, 'project');
  assert.equal(context.assessmentTotalMarks, '50');
  assert.match(context.assessmentSummary, /15 items/);
  assert.equal(Object.hasOwn(context, 'assessmentDraft'), false);
  assert.doesNotMatch(JSON.stringify(context), /Private live question/);
});

test('Assistant blocks test edits and assessment-linked project targets before generation', () => {
  assert.throws(
    () => assertPurposeTargetIsEditable({ type: 'slide', items: [{ index: 0, slideType: 'content' }] }, { lessonPurpose: 'test' }),
    /stays locked/i,
  );
  assert.throws(
    () => assertPurposeTargetIsEditable({ type: 'plan-section', items: [{ index: 2, heading: 'Assessment', content: 'Assessment phase 1' }] }, { lessonPurpose: 'project' }),
    /linked to the approved project setup/i,
  );
});

test('test Assistant edit requests fail closed before an AI call is attempted', async () => {
  await assert.rejects(
    proposeEdit({
      instruction: 'Improve this slide',
      context: { lessonPurpose: 'test' },
      target: { type: 'slide', items: [{ index: 1, slideType: 'content', title: 'During the test', bullets: ['Work quietly.'] }] },
    }),
    /stays locked/i,
  );
});

test('Assistant rejects unsafe project rewrites but accepts student-led progress wording', () => {
  const target = {
    type: 'slide',
    items: [{ index: 3, slideType: 'content', title: 'Create your document', bullets: ['What step are you on?'] }],
  };
  const unsafe = validatePurposeEdits(target, { lessonPurpose: 'project' }, [{
    index: 3, heading: '', content: '', title: 'Watch the method', subtitle: '',
    bullets: ['The teacher demonstrates the assessed skill.', 'Press Ctrl + V.'], example: '',
  }]);
  assert.match(unsafe.join(' '), /teacher-led instruction/i);
  assert.match(unsafe.join(' '), /keyboard shortcut/i);
  assert.match(unsafe.join(' '), /progress question/i);

  const safe = validatePurposeEdits(target, { lessonPurpose: 'project' }, [{
    index: 3, heading: '', content: '', title: 'Create your document', subtitle: '',
    bullets: ['Write your own letter.', 'Copy using the keyboard.', 'Have you checked your spelling?'], example: '',
  }]);
  assert.deepEqual(safe, []);
});

test('Assistant rejects keyboard shortcut variants in project-facing text', () => {
  const target = {
    type: 'slide',
    items: [{ index: 0, slideType: 'content', title: 'Create your document', bullets: ['What step are you on?'] }],
  };
  for (const shortcut of ['Ctrl V', 'Ctrl-V', 'Control V', 'Cmd V', 'Command V', 'Ctrl + V', '⌘V']) {
    const issues = validatePurposeEdits(target, { lessonPurpose: 'project' }, [{
      index: 0, heading: '', content: '', title: 'Create your document', subtitle: '',
      bullets: [`Press ${shortcut} to paste.`, 'Have you checked this stage?'], example: '',
    }]);
    assert.match(issues.join(' '), /keyboard shortcut/i, shortcut);
  }
});

test('Assistant keeps a project launch specific and keeps activity edits student-led', () => {
  const planLaunch = { type: 'plan-section', items: [{ index: 0, heading: 'Project Launch', content: 'Explain the project brief, phases and success criteria.' }] };
  for (const generic of [
    'Begin with a brief discussion about what a document is and why we create one.',
    'Ask students to share their prior knowledge about documents.',
    'Invite students to share any experiences they have with documents.',
    'Introduce the lesson objectives.',
  ]) {
    const issues = validatePurposeEdits(planLaunch, { lessonPurpose: 'project' }, [{
      index: 0, heading: 'Project Launch', content: generic, title: '', subtitle: '', bullets: [], example: '',
    }]);
    assert.match(issues.join(' '), /generic lesson introduction/i, generic);
  }

  const slideLaunch = { type: 'slide', items: [{ index: 2, slideType: 'content', title: 'Get ready', bullets: ['What will you produce?'] }] };
  const slideIssues = validatePurposeEdits(slideLaunch, { lessonPurpose: 'project' }, [{
    index: 2, heading: '', content: '', title: 'Get ready', subtitle: '',
    bullets: ['Students share what they already know about documents.', 'Are you ready?'], example: '',
  }]);
  assert.match(slideIssues.join(' '), /generic lesson introduction/i);

  const activity = { type: 'slide', items: [{ index: 2, slideType: 'activity', title: 'Project work', bullets: ['What step are you on?'] }] };
  const safe = validatePurposeEdits(activity, { lessonPurpose: 'project' }, [{
    index: 2, heading: '', content: '', title: 'Project work', subtitle: '',
    bullets: ['Students write and revise their own letter.', 'Have you checked your spelling?'], example: '',
  }]);
  assert.deepEqual(safe, []);
  const vague = validatePurposeEdits(activity, { lessonPurpose: 'project' }, [{
    index: 2, heading: '', content: '', title: 'Project work', subtitle: '',
    bullets: ['Listen carefully.', 'Are you ready?'], example: '',
  }]);
  assert.match(vague.join(' '), /work students must complete/i);
});

test('Assistant cannot remove the project plenary submission confirmation', () => {
  const target = { type: 'plan-section', items: [{ index: 8, heading: 'Plenary (10m)', content: 'Teacher confirms every student submitted.' }] };
  const missing = validatePurposeEdits(target, { lessonPurpose: 'project' }, [{
    index: 8, heading: 'Plenary (10m)', content: 'Students discuss what they learned.', title: '', subtitle: '', bullets: [], example: '',
  }]);
  assert.match(missing.join(' '), /all-student submission check/i);
  const retained = validatePurposeEdits(target, { lessonPurpose: 'project' }, [{
    index: 8, heading: 'Plenary (10m)', content: 'The teacher checks that every student has submitted in LessonScope.', title: '', subtitle: '', bullets: [], example: '',
  }]);
  assert.deepEqual(retained, []);
});

test('all test slides and only required project phase slides carry export protection', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const assessmentDraft = {
      sections: [
        { type: 'mcq', title: 'Knowledge', items: Array.from({ length: 2 }, () => ({ marks: 1 })) },
        { type: 'practical', title: 'Practical', items: [{ marks: 8 }] },
      ],
    };
    const extras = { lessonPurpose: 'test', assessmentDraft, assessmentTotalMarks: 10, assessmentQuestionTypes: ['mcq', 'practical'], assessmentMcqCount: 2 };
    const testDeck = await generateContent('ICT', 'documents', 4, 'Grade 2', 'clear', '', extras);
    assert.ok(testDeck.length > 0);
    assert.ok(testDeck.every(slide => slide.assessmentProtected), 'every test administration slide must be protected');

    const projectDeck = await generateContent('ICT', 'documents', 4, 'Grade 2', 'clear', '', { ...extras, lessonPurpose: 'project', lessonPlanText: '## Task\nStudents write a letter and check their spelling.\n## Plenary\nTeacher confirms every student submitted.' });
    const phases = projectDeck.filter(slide => slide.assessmentPhaseType);
    assert.equal(phases.length, 2);
    assert.ok(phases.every(slide => slide.assessmentProtected));
    assert.ok(projectDeck.some(slide => !slide.assessmentProtected), 'contextual project stages remain teacher-editable');
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('new-plan reset and Google deck restore retain a complete, purpose-aware UI state', () => {
  const clearStart = ui.indexOf('function clearWorkspaceState()');
  const clearEnd = ui.indexOf('function workspaceDeckEdits', clearStart);
  const clearBody = ui.slice(clearStart, clearEnd);
  assert.match(clearBody, /lessonPurpose.*value="lesson"/s);
  assert.match(clearBody, /assessmentPlanTotal'\)\.value='50'/);
  assert.match(clearBody, /assessmentPlanStructure'\)\.value='balanced'/);
  assert.match(clearBody, /assessmentPlanDelivery'\)\.value='live'/);
  assert.match(clearBody, /assessmentPlanMcqCount'\)\.value='15'/);
  assert.match(clearBody, /input\.value==='mcq'\|\|input\.value==='practical'/);

  assert.match(server, /function deckContextPayload\(deck\)/);
  assert.match(server, /assessmentDraft: deck\.assessmentDraft \|\| null/);
  assert.match(server, /deck\.lessonPurpose === 'test' \|\| s\.assessmentProtected \|\| s\.assessmentPhaseType/);
  assert.match(server, /app\.get\('\/api\/deck\/:id'[\s\S]*res\.json\(deckPreviewPayload\(req\.params\.id, deck\)\)/);
  const restoreStart = ui.indexOf('async function restoreGoogleExport');
  const restoreEnd = ui.indexOf("$('driveExportBtn')", restoreStart);
  const restoreBody = ui.slice(restoreStart, restoreEnd);
  assert.match(restoreBody, /ctx=\{\.\.\.\(ctx\|\|\{\}\),\.\.\.d\.context\}/);
  assert.match(restoreBody, /restoreContextFields\(ctx\)/);
  assert.match(restoreBody, /sourceMaterialText=ctx\.sourceMaterialText/);
});

test('every slide mutation route rejects test and assessment-protected slides at the server boundary', () => {
  assert.match(server, /function rejectProtectedAssessmentSlideMutation\(res, deck, index\)/);
  assert.match(server, /deck\.lessonPurpose === 'test'[\s\S]{0,180}slide\.assessmentProtected[\s\S]{0,180}slide\.assessmentPhaseType/);
  for (const route of ['swap-image', 'youtube', 'set-image', 'ai-image', 'diagram', 'regenerate']) {
    const start = server.indexOf(`app.post('/api/slide/:id/${route}'`);
    assert.notEqual(start, -1, `${route} route exists`);
    const end = server.indexOf('\napp.', start + 1);
    const body = server.slice(start, end < 0 ? server.length : end);
    assert.match(body, /rejectProtectedAssessmentSlideMutation\(res, deck, i\)/, `${route} must enforce the assessment lock`);
  }
  const deleteStart = server.indexOf("app.delete('/api/slide/:id/youtube'");
  const deleteEnd = server.indexOf('\napp.', deleteStart + 1);
  assert.match(server.slice(deleteStart, deleteEnd), /rejectProtectedAssessmentSlideMutation\(res, deck, i\)/);
});
