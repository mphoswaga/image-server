const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');

test('publishing keeps the exact assessment snapshot available to later slide generation', () => {
  assert.match(html, /ctx\.assessmentDraft=JSON\.parse\(JSON\.stringify\(assessment\)\)/);
  assert.match(html, /ctx\.assessmentPublishedId=data\.assessmentId/);
  assert.doesNotMatch(html, /if\(ctx\)ctx\.assessmentDraft=null/);
  assert.match(html, /saved\.assessmentDraft&&!saved\.assessmentPublishedId\?JSON\.parse/);
  assert.match(html, /JSON\.stringify\(\{\.\.\.ctx,lessonWorkspaceId:currentWorkspaceId\|\|undefined,lessonPlan,presetId:selectedPresetId\}\)/);
});

test('a published automatic assessment stays visible beside its generated deck without reopening the publisher', () => {
  assert.match(html, /function currentAutomaticAssessment\(\)\{ return pendingAssessmentDraft\|\|\(ctx&&ctx\.assessmentDraft\)\|\|null; \}/);
  assert.match(html, /Automatic .*?\$\{published\?'published':'draft ready'\}/s);
  assert.match(html, /is published and linked to this deck/);
  assert.match(html, /dataset\.assessmentState==='published'[\s\S]{0,180}assessmentBuilder'\)\.style\.display='none'[\s\S]{0,100}openAssignments\('slides'\)/);
});

test('test practical summaries are administration-only while project summaries retain stage guidance', () => {
  assert.match(html, /const isTest=draft\.assessmentType==='test'/);
  assert.match(html, /announces only timing, permitted materials and submission instructions, supervises without prompting/);
  assert.match(html, /displays one safe stage at a time, circulates without completing assessed work for students/);
});

test('assessment edits update a suitable existing template row without adding or reordering rows', () => {
  assert.match(html, /const planRows=\[\.\.\.planStage\.querySelectorAll\('\.plan-section'\)\]/);
  assert.match(html, /main activit\|learner activit\|student activit\|procedure\|plan\|create\|practi\|task/);
  assert.match(html, /Assessment flow:\\n/);
  assert.match(html, /!\/reflection\|phonic\/\.test\(label\)/);
});

test('project and test decks require the final published assessment snapshot', () => {
  assert.match(html, /function automaticAssessmentIsPublished\(\)\{ return !!\(ctx&&ctx\.assessmentPublishedId&&ctx\.assessmentDraft&&!pendingAssessmentDraft\); \}/);
  assert.match(html, /\['project','test'\]\.includes\(\(ctx&&ctx\.lessonPurpose\)\|\|'lesson'\)&&!automaticAssessmentIsPublished\(\)/);
  assert.match(html, /Review and publish the \$\{ctx\.lessonPurpose\} assessment before creating slides/);
});

test('the generation endpoint resolves project and test context from the owned server publication', () => {
  const routeStart = server.indexOf("app.post('/api/generate'");
  const routeEnd = server.indexOf("app.post('/api/slide/", routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /assignments\.publishedAssessmentGenerationContext\(\{/);
  assert.match(route, /assessmentId: req\.body\.assessmentPublishedId/);
  assert.match(route, /teacherId: req\.userId/);
  assert.ok(route.indexOf('publishedAssessmentGenerationContext') < route.indexOf("reserve(req, 'lessonscope.generate_slide_deck')"), 'publication is checked before credits are reserved');
  assert.match(route, /buildDeck\([\s\S]*\.\.\.generationAssessment/);
  assert.match(route, /assessmentOptions: normalizeAssessmentOptions\(generationAssessment\)/);
  assert.match(route, /assessmentDraft: generationAssessment\.assessmentDraft/);
  assert.match(route, /assessmentPublishedId: generationAssessment\.assessmentPublishedId/);
});

test('automatic assessment publication and every deck request are bound to the saved lesson workspace', () => {
  const publishStart = html.indexOf("$('publishAssessmentBtn').addEventListener");
  const publishEnd = html.indexOf("$('assessmentPublishResult').addEventListener", publishStart);
  const publish = html.slice(publishStart, publishEnd);
  assert.match(publish, /const workspaceSaved=await saveWorkspaceNow\(\)/);
  assert.match(publish, /if\(!workspaceSaved\|\|!currentWorkspaceId\) throw new Error\('This lesson could not be saved/);
  assert.match(publish, /assessment\.lessonWorkspaceId=currentWorkspaceId\|\|null/);
  assert.match(publish, /ctx\.assessmentPublishedId=data\.assessmentId/);
  assert.ok(publish.indexOf('await saveWorkspaceNow()') < publish.indexOf("fetch('/api/assessment'"), 'the workspace is saved before the assessment is published');

  const sequenceDeckStart = html.indexOf('async function generateSequenceDeck');
  const sequenceDeckEnd = html.indexOf("$('sequenceSlidesTabs').addEventListener", sequenceDeckStart);
  const sequenceDeck = html.slice(sequenceDeckStart, sequenceDeckEnd);
  assert.match(sequenceDeck, /const body=\{\.\.\.ctx,lessonWorkspaceId:currentWorkspaceId\|\|undefined,sequenceEnabled:false/);

  const finalDeckStart = html.indexOf("$('acceptBtn').addEventListener");
  const finalDeckEnd = html.indexOf('const KICKER=', finalDeckStart);
  const finalDeck = html.slice(finalDeckStart, finalDeckEnd);
  assert.match(finalDeck, /JSON\.stringify\(\{\.\.\.ctx,lessonWorkspaceId:currentWorkspaceId\|\|undefined,lessonPlan,presetId:selectedPresetId\}\)/);
  assert.match(html, /published\.lessonWorkspaceId===currentWorkspaceId/);
});

test('every formal test and project publication requires an owned class roster', () => {
  assert.match(html, /required for results and TeacherScope/);
  assert.match(html, /if\(!selectedRosterId\) throw new Error\('Choose the class roster before publishing this assessment/);
  assert.match(server, /if \(!selectedRosterId\)/);
  assert.match(server, /const selectedRoster = roster\.getRoster\(req\.userId, selectedRosterId\)/);
  assert.match(server, /if \(!selectedRoster\)/);
  assert.match(server, /!Array\.isArray\(selectedRoster\.students\) \|\| !selectedRoster\.students\.length/);
  assert.match(server, /rosterId: selectedRosterId, rosterSnapshot: selectedRoster\.students/);
});

test('learner visibility is separate from official assessment analysis', () => {
  assert.match(html, /On record · Hidden from learners/);
  assert.match(html, /Marks ready · Tick “Marked by teacher” to add them to records/);
  assert.match(html, /Tick “Marked by teacher” on a completed test or project/);
  assert.match(html, /Games appear here automatically/);
  assert.match(html, /Recall from learners/);
  assert.match(html, /official analysis stays live/);
  const learner = fs.readFileSync(path.join(__dirname, '..', 'public', 'assignment.html'), 'utf8');
  assert.match(learner, /if \(assignmentType !== 'assessment'\) clearInterval\(livePollTimer\)/);
  assert.match(learner, /livePollTimer = setInterval\(refreshLiveTake, 2500\)/);
});

test('teacher presentation offers a live, class-scoped list of learners still to answer', () => {
  const presentation = fs.readFileSync(path.join(__dirname, '..', 'public', 'assessment-present.html'), 'utf8');
  assert.match(server, /awaitingLearners/);
  assert.match(server, /classListForAssignment\(a\)/);
  assert.match(server, /incompleteAssessmentAnswers\(\[question\], draft && draft\.answers\)/);
  assert.match(presentation, /Still to answer this question/);
  assert.match(presentation, /teacher list/);
  assert.match(presentation, /awaitingLearners/);
});
