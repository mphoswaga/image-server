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
    'Create and run a student game',
    'Review marks and class progress',
    'Download or export your finished work',
    'Understand your subscription and usage',
  ]) {
    assert.match(html, new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `guide should explain: ${topic}`);
  }
  assert.match(html, /sessionStorage\.getItem\('lc_wizard_step'\)/);
  assert.match(html, /sessionStorage\.setItem\('lc_wizard_step'/);
  assert.match(html, /wz-progress-label/);
});
