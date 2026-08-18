const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-planning-framework-'));

const frameworks = require('../planning-framework');
const { buildPrompt } = require('../lesson-plan');

function makeFramework(userId = 'independent-teacher') {
  return frameworks.create(userId, {
    name: 'My observation rubric', type: 'observation', appliesTo: 'observation',
    filename: 'rubric.pdf', sourceText: 'The full source document stays stored for later review.',
    buffer: Buffer.from('original-pdf'),
    draft: {
      summary: 'Plan for durable learning and visible student thinking.',
      requirements: ['Require individual thinking before group discussion.', 'Use formative evidence to adapt support.'],
      avoidances: ['Do not mistake smooth performance for durable learning.'],
    },
  });
}

test('an independent teacher can save a private framework without an institution', () => {
  const saved = makeFramework();
  assert.equal(saved.ownerType, 'personal');
  assert.equal(saved.active, false);
  assert.equal(frameworks.list('independent-teacher').length, 1);
  assert.equal(frameworks.list('another-teacher').length, 0);
  assert.equal(frameworks.get('another-teacher', saved.id), null);
});

test('a framework cannot guide generation until the teacher approves it', () => {
  const saved = makeFramework('review-first');
  assert.equal(frameworks.promptText(saved), '');
  assert.throws(() => frameworks.update('review-first', saved.id, { summary: '', requirements: [], active: true }), /summary and at least one requirement/i);

  const active = frameworks.update('review-first', saved.id, { active: true });
  assert.equal(active.active, true);
  assert.equal(active.version, 2);
  assert.equal(active.versions.length, 1);
  assert.match(frameworks.promptText(active), /individual thinking before group discussion/i);
  assert.doesNotMatch(frameworks.promptText(active), /full source document stays stored/i);
});

test('an approved framework guides pedagogy without replacing objectives or template fields', () => {
  const active = frameworks.update('prompt-teacher', makeFramework('prompt-teacher').id, { active: true });
  const prompt = buildPrompt({
    subject: 'Science', topic: 'states of matter', grade: 'Grade 5', tone: 'clear',
    objectives: 'Describe changes of state', successCriteria: [],
    templateText: 'Starter\nMain activity\nPlenary', unitBlock: '', sourceMaterialText: '',
    planningFrameworkText: frameworks.promptText(active), teachingModel: 'standard',
  });
  assert.match(prompt, /PLANNING FRAMEWORK START/);
  assert.match(prompt, /Require individual thinking before group discussion/);
  assert.match(prompt, /Describe changes of state/);
  assert.match(prompt, /Starter\nMain activity\nPlenary/);
  assert.match(prompt, /without changing supplied curriculum objectives/i);
});

test('unsafe framework ids cannot escape a teacher framework directory', () => {
  assert.equal(frameworks.get('teacher', '../../users/another/private'), null);
});
