const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const markup = html.slice(0, html.indexOf('<script>'));

test('lesson creation exposes exactly three focused wizard pages', () => {
  const pages = [...markup.matchAll(/data-flow-page="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(pages, [1, 2, 3]);
  assert.match(markup, /id="composer"[^>]*style="display:none"/);
  assert.match(markup, /id="flowSourceNextBtn"/);
  assert.match(markup, /id="flowObjectivesNextBtn"/);
  assert.match(markup, /id="flowSetupBackBtn"/);
});

test('the wizard preserves every field needed by the existing generation request', () => {
  for (const id of [
    'subject', 'topic', 'objectives', 'grade', 'slideCount', 'tone', 'teachingModel',
    'sequenceEnabled', 'sequenceLessonCount', 'periodMinutes', 'focus', 'presetSelect', 'planBtn',
  ]) {
    const occurrences = [...markup.matchAll(new RegExp(`id="${id}"`, 'g'))].length;
    assert.equal(occurrences, 1, `${id} should still exist exactly once`);
  }
  assert.match(html, /fetch\('\/api\/lesson-plan'/, 'the established lesson-plan endpoint remains wired');
  assert.match(html, /lessonSequenceFromForm\(\)/, 'weekly sequence values remain part of the request');
  assert.match(html, /ctx\.successCriteria=d\.successCriteria\.slice\(\)/,
    'generated success criteria must survive from plan review to workbook download');
});

test('saved lessons have a permanent navigation entry and autosave wiring', () => {
  for (const id of [
    'lessonsBtn', 'lessonsPanel', 'lessonsList', 'lessonsSearch', 'newLessonBtn',
    'workspaceSaveStatus', 'workspaceSaveText',
  ]) {
    assert.equal([...markup.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} should exist exactly once`);
  }
  assert.match(html, /fetch\('\/api\/lesson-workspaces'/);
  assert.match(html, /\/api\/lesson-workspaces\/\$\{encodeURIComponent\(id\)\}\/resume/);
  assert.match(html, /function scheduleWorkspaceSave\(\)/);
  assert.match(html, /deckEl\.addEventListener\('input'/);
  assert.match(html, /\$\('packSection'\)\.addEventListener\('input'/);
});

test('saved templates can be named, assigned to a grade, selected, and edited', () => {
  for (const id of ['tplList', 'tplName', 'tplGrade', 'tplType', 'tplAddBtn']) {
    assert.equal([...markup.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} should exist exactly once`);
  }
  assert.match(html, /TEMPLATE_PREF_PREFIX='lessonscope\.template\.'/);
  assert.match(html, /syncTemplateToGrade\(\{force:true\}\)/);
  assert.match(html, /data-edit=/);
  assert.match(html, /fd\.append\('grade',grade\)/);
  assert.match(html, /templateId:selectedTemplateId/);
  assert.match(html, /data-kind="planner"/);
  assert.match(html, /\/api\/week-planner\/'\+row\.dataset\.id\+'\/select/);
  assert.match(html, /Template saved and selected — your other templates are still available/);
});

test('personal planning frameworks are reviewed before they can guide a lesson', () => {
  for (const id of [
    'planningFramework', 'frameworkManageBtn', 'frameworkModal', 'frameworkUploadBtn',
    'frameworkFile', 'frameworkList', 'frameworkEditor',
  ]) {
    assert.equal([...markup.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} should exist exactly once`);
  }
  assert.match(html, /fetch\('\/api\/planning-frameworks'/);
  assert.match(html, /planningFrameworkId:selectedPlanningFrameworkId/);
  assert.match(markup, /Lesson generation works exactly as before/);
  assert.match(html, /Approve and activate/);
});

test('multi-lesson mode exposes staged plan and slide controls without replacing single-lesson controls', () => {
  for (const id of [
    'sequencePlanFlow', 'sequencePlanTabs', 'nextSequencePlanBtn',
    'sequenceSlidesFlow', 'sequenceSlidesTabs', 'nextSequenceSlidesBtn',
    'acceptBtn', 'dlPlanBtn', 'downloadBtn',
  ]) {
    assert.equal([...markup.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} should exist exactly once`);
  }
  assert.match(html, /sequenceEnabled:false/, 'each staged deck disables the old all-at-once sequence generation');
  assert.match(html, /if\(sequenceMode\(\)\)/, 'sequence behavior is isolated behind an explicit branch');
});

test('import routes retain a visible return to the starting-point choice', () => {
  assert.equal([...markup.matchAll(/data-mode-back/g)].length, 2);
  assert.match(markup, /id="importPlanBtn"/);
  assert.match(markup, /id="importSlidesPlanBtn"/);
  assert.match(markup, /id="importSlidesOnlyBtn"/);
});

test('the complete guide covers the full teacher workflow and can resume', () => {
  for (const topic of [
    'Choose the right starting point',
    'Add your school lesson-plan template',
    'Import a pacing guide or year plan',
    'Choose a teaching model',
    'Add optional supporting materials',
    'Plan one lesson or several periods',
    'Generate, review, and edit the lesson plan',
    'Create and review the slide deck',
    'Build the lesson resource pack',
    'Create and verify class rosters',
    'Publish an online assignment',
    'Create and run a lesson game',
    'Review marks and class progress',
    'Download or export your finished work',
    'Understand your subscription and usage',
  ]) {
    assert.match(html, new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `guide should explain: ${topic}`);
  }
  assert.match(html, /sessionStorage\.getItem\('lc_wizard_step'\)/);
  assert.match(html, /sessionStorage\.setItem\('lc_wizard_step'/);
  assert.match(html, /wz-progress-label/);
  assert.match(html, /Individual Arcade[\s\S]+FishQuest[\s\S]+ColonyQuest/);
});

test('the admin panel exposes protected code rollback without implying data rollback', () => {
  for (const id of ['releasePanel', 'releaseHistory', 'rollbackForm', 'rollbackTarget', 'rollbackCode', 'rollbackBtn', 'rollbackStatus']) {
    assert.equal([...markup.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} should exist exactly once`);
  }
  assert.match(html, /fetch\('\/api\/admin\/releases'/);
  assert.match(html, /fetch\('\/api\/admin\/rollback'/);
  assert.match(markup, /Teacher accounts, templates, lessons, submissions, and files[^<]+not deleted or rewound/);
});
