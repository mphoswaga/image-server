const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-practice-'));
const practice = require('../practice');

const evidenceByStep = {
  'move-pointer': { action: 'pointer_enter', target: 'blue-star' },
  'single-click': { action: 'single_click', target: 'green-circle' },
  'double-click': { action: 'double_click', target: 'blue-folder' },
  'drag-drop': { action: 'drag_drop', target: 'homework-folder' },
  'scroll-find': { action: 'scroll_find', target: 'gold-star' },
};

function checkpoint(attempt, stepId, overrides = {}) {
  return practice.checkpointAttempt(attempt.id, attempt.studentId, {
    checkpointId: `${attempt.id}-${stepId}`,
    stepId,
    attempts: 1,
    hintsUsed: 0,
    activeSeconds: 8,
    evidence: evidenceByStep[stepId],
    ...overrides,
  });
}

test('catalog exposes a versioned Grade 2 pointer activity without evidence secrets', () => {
  const [activity] = practice.listActivities();
  assert.equal(activity.id, 'g2-pointer-control');
  assert.equal(activity.version, 1);
  assert.equal(activity.gradeBand, 'Grade 2');
  assert.deepEqual(activity.steps.map((step) => step.id), [
    'move-pointer', 'single-click', 'double-click', 'drag-drop', 'scroll-find',
  ]);
  assert.equal('action' in activity.steps[0], false);
  assert.equal('target' in activity.steps[0], false);
});

test('an unfinished activity resumes instead of creating duplicate attempts', () => {
  const first = practice.createAttempt({ studentId: 'stu-1', studentName: 'Ama', activityId: 'g2-pointer-control' });
  const second = practice.createAttempt({ studentId: 'STU-1', studentName: 'Ama', activityId: 'g2-pointer-control' });
  assert.equal(first.resumed, false);
  assert.equal(second.resumed, true);
  assert.equal(second.attempt.id, first.attempt.id);
});

test('a learner cannot skip a skill or submit mismatched evidence', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-2', studentName: 'Ben', activityId: 'g2-pointer-control' });
  assert.throws(() => checkpoint(attempt, 'double-click'), /Move the pointer/i);
  assert.throws(() => checkpoint(attempt, 'move-pointer', { evidence: { action: 'single_click', target: 'blue-star' } }), /could not be confirmed/i);
  assert.equal(practice.loadAttempt(attempt.id).currentStepIndex, 0);
});

test('checkpoints are idempotent and preserve the first result', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-3', studentName: 'Chi', activityId: 'g2-pointer-control' });
  const first = checkpoint(attempt, 'move-pointer');
  const retry = practice.checkpointAttempt(attempt.id, attempt.studentId, {
    checkpointId: `${attempt.id}-move-pointer`,
    stepId: 'move-pointer', attempts: 9, hintsUsed: 5, activeSeconds: 99,
    evidence: evidenceByStep['move-pointer'],
  });
  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.attempt.checkpoints.length, 1);
  assert.equal(retry.checkpoint.mastery, 'independent');
});

test('all five ordered checkpoints complete the activity and calculate mastery', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-4', studentName: 'Dara', activityId: 'g2-pointer-control' });
  checkpoint(attempt, 'move-pointer');
  checkpoint(attempt, 'single-click');
  checkpoint(attempt, 'double-click', { attempts: 3, hintsUsed: 1 });
  checkpoint(attempt, 'drag-drop');
  const final = checkpoint(attempt, 'scroll-find');
  assert.equal(final.attempt.status, 'completed');
  assert.equal(final.attempt.currentStepIndex, 5);
  assert.equal(final.attempt.mastery, 'developing_independence');
  assert.ok(final.attempt.completedAt);
});

test('students cannot write checkpoints into another learner attempt', () => {
  const { attempt } = practice.createAttempt({ studentId: 'STU-5', studentName: 'Eli', activityId: 'g2-pointer-control' });
  assert.throws(() => practice.checkpointAttempt(attempt.id, 'STU-6', {
    checkpointId: 'foreign', stepId: 'move-pointer', attempts: 1, hintsUsed: 0, activeSeconds: 1,
    evidence: evidenceByStep['move-pointer'],
  }), /different learner/i);
});

test('teacher result filtering returns only roster-owned student IDs', () => {
  practice.createAttempt({ studentId: 'OWN-1', studentName: 'Owned', activityId: 'g2-pointer-control' });
  practice.createAttempt({ studentId: 'OTHER-1', studentName: 'Other', activityId: 'g2-pointer-control' });
  const results = practice.teacherResults(['own-1']);
  assert.deepEqual(results.map((result) => result.studentId), ['OWN-1']);
});

test('teacher preview is protected and explicitly avoids recorded attempts', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  const report = fs.readFileSync(path.join(__dirname, '..', 'practice-teacher.html'), 'utf8');
  assert.match(server, /app\.get\('\/practice\/preview', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.get\('\/api\/practice\/preview', requirePracticeEnabled, requireAuth/);
  assert.match(player, /if \(previewMode\) return savePreviewCheckpoint\(payload\)/);
  assert.match(player, /Preview only - results not saved/);
  assert.match(report, /href="\/practice\/preview"/);
});
