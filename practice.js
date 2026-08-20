// LessonScope Practice: versioned practical-skills activities and resumable
// student attempts. This module is intentionally separate from quiz games:
// practice evidence records demonstrated interactions, hints and independence.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const PRACTICE_DIR = path.join(DATA_DIR, 'practice');
const ATTEMPTS_DIR = path.join(PRACTICE_DIR, 'attempts');

const ACTIVITIES = Object.freeze([
  Object.freeze({
    id: 'g2-pointer-control',
    version: 2,
    gradeBand: 'Grades 2-3',
    title: 'Byte City Foundation Arcade',
    description: 'Complete a connected mouse and keyboard arcade adventure.',
    estimatedMinutes: 15,
    device: 'computer',
    steps: Object.freeze([
      Object.freeze({ id: 'move-pointer', title: 'Signal Trail', action: 'pointer_enter', target: 'blue-star' }),
      Object.freeze({ id: 'single-click', title: 'Reactor Rush', action: 'single_click', target: 'green-circle' }),
      Object.freeze({ id: 'double-click', title: 'Vault Breaker', action: 'double_click', target: 'blue-folder' }),
      Object.freeze({ id: 'context-command', title: 'Command Deck', action: 'context_command', target: 'archive-open' }),
      Object.freeze({ id: 'drag-drop', title: 'Cargo Rescue', action: 'drag_drop', target: 'homework-folder' }),
      Object.freeze({ id: 'scroll-find', title: 'Signal Tower', action: 'scroll_find', target: 'gold-star' }),
      Object.freeze({ id: 'keyboard-defense', title: 'Sky Shield', action: 'type_word', target: 'byte-signal' }),
    ]),
  }),
  // Version 1 remains available so previously started attempts can still be
  // validated and reported after the arcade campaign launches.
  Object.freeze({
    id: 'g2-pointer-control',
    version: 1,
    gradeBand: 'Grade 2',
    title: 'Pointer Control',
    description: 'Move, click, double-click, drag and scroll with confidence.',
    estimatedMinutes: 10,
    device: 'computer',
    steps: Object.freeze([
      Object.freeze({ id: 'move-pointer', title: 'Move the pointer', action: 'pointer_enter', target: 'blue-star' }),
      Object.freeze({ id: 'single-click', title: 'Single-click', action: 'single_click', target: 'green-circle' }),
      Object.freeze({ id: 'double-click', title: 'Double-click', action: 'double_click', target: 'blue-folder' }),
      Object.freeze({ id: 'drag-drop', title: 'Drag and drop', action: 'drag_drop', target: 'homework-folder' }),
      Object.freeze({ id: 'scroll-find', title: 'Scroll and find', action: 'scroll_find', target: 'gold-star' }),
    ]),
  }),
]);

function enabled() {
  return process.env.PRACTICE_ENABLED === 'true';
}

function publicActivity(activity) {
  return {
    id: activity.id,
    version: activity.version,
    gradeBand: activity.gradeBand,
    title: activity.title,
    description: activity.description,
    estimatedMinutes: activity.estimatedMinutes,
    device: activity.device,
    steps: activity.steps.map(({ id, title }) => ({ id, title })),
  };
}

function listActivities() {
  const latest = new Map();
  for (const activity of ACTIVITIES) {
    const saved = latest.get(activity.id);
    if (!saved || activity.version > saved.version) latest.set(activity.id, activity);
  }
  return Array.from(latest.values()).map(publicActivity);
}

function getActivity(id, version) {
  const matches = ACTIVITIES.filter((activity) => activity.id === String(id)
    && (version == null || activity.version === Number(version)));
  return matches.sort((a, b) => b.version - a.version)[0] || null;
}

function attemptPath(id) {
  return path.join(ATTEMPTS_DIR, `${String(id)}.json`);
}

function loadAttempt(id) {
  try { return JSON.parse(fs.readFileSync(attemptPath(id), 'utf8')); }
  catch { return null; }
}

function saveAttempt(attempt) {
  fs.mkdirSync(ATTEMPTS_DIR, { recursive: true });
  attempt.updatedAt = new Date().toISOString();
  writeJsonAtomic(attemptPath(attempt.id), attempt);
  return attempt;
}

function allAttempts() {
  try {
    return fs.readdirSync(ATTEMPTS_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(ATTEMPTS_DIR, name), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

function createAttempt({ studentId, studentName, activityId }) {
  const activity = getActivity(activityId);
  if (!activity) throw Object.assign(new Error('Practice activity not found.'), { code: 'activity_not_found' });
  const sid = String(studentId || '').trim().toUpperCase();
  if (!sid) throw new Error('Student identity is required.');

  const resumable = allAttempts()
    .filter((attempt) => attempt.studentId === sid
      && attempt.activityId === activity.id
      && attempt.activityVersion === activity.version
      && attempt.status === 'in_progress')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
  if (resumable) return { attempt: resumable, resumed: true };

  const now = new Date().toISOString();
  const attempt = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
    activityId: activity.id,
    activityVersion: activity.version,
    studentId: sid,
    studentName: String(studentName || sid).trim().slice(0, 120),
    status: 'in_progress',
    currentStepIndex: 0,
    checkpoints: [],
    mastery: 'not_started',
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  };
  saveAttempt(attempt);
  return { attempt, resumed: false };
}

function asBoundedInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function checkpointMastery(attempts, hintsUsed) {
  if (hintsUsed === 0 && attempts <= 1) return 'independent';
  if (hintsUsed <= 2 && attempts <= 4) return 'developing_independence';
  return 'completed_with_support';
}

function overallMastery(checkpoints) {
  const rank = { independent: 3, developing_independence: 2, completed_with_support: 1 };
  if (!checkpoints.length) return 'not_started';
  return checkpoints.reduce((lowest, checkpoint) => (
    rank[checkpoint.mastery] < rank[lowest] ? checkpoint.mastery : lowest
  ), 'independent');
}

function checkpointAttempt(attemptId, studentId, input) {
  const attempt = loadAttempt(attemptId);
  if (!attempt) throw Object.assign(new Error('Practice attempt not found.'), { code: 'attempt_not_found' });
  if (attempt.studentId !== String(studentId || '').trim().toUpperCase()) {
    throw Object.assign(new Error('This practice attempt belongs to a different learner.'), { code: 'forbidden' });
  }

  const checkpointId = String(input && input.checkpointId || '').trim().slice(0, 80);
  if (!checkpointId) throw new Error('Checkpoint ID is required.');
  const existing = attempt.checkpoints.find((checkpoint) => checkpoint.checkpointId === checkpointId);
  if (existing) return { attempt, checkpoint: existing, idempotent: true };
  if (attempt.status === 'completed') {
    throw Object.assign(new Error('This practice attempt is already complete.'), { code: 'attempt_complete' });
  }

  const activity = getActivity(attempt.activityId, attempt.activityVersion);
  if (!activity) throw new Error('The activity version for this attempt is no longer available.');
  const expected = activity.steps[attempt.currentStepIndex];
  if (!expected || String(input.stepId || '') !== expected.id) {
    throw Object.assign(new Error(`Complete ${expected ? expected.title : 'the current step'} before continuing.`), { code: 'step_out_of_order' });
  }
  const evidence = input && input.evidence || {};
  if (evidence.action !== expected.action || evidence.target !== expected.target) {
    throw Object.assign(new Error('The required skill action could not be confirmed.'), { code: 'invalid_evidence' });
  }

  const attempts = asBoundedInt(input.attempts, 1, 50, 1);
  const hintsUsed = asBoundedInt(input.hintsUsed, 0, 5, 0);
  const activeSeconds = asBoundedInt(input.activeSeconds, 1, 600, 1);
  const checkpoint = {
    checkpointId,
    stepId: expected.id,
    attempts,
    hintsUsed,
    activeSeconds,
    mastery: checkpointMastery(attempts, hintsUsed),
    completedAt: new Date().toISOString(),
  };

  attempt.checkpoints.push(checkpoint);
  attempt.currentStepIndex += 1;
  attempt.mastery = overallMastery(attempt.checkpoints);
  if (attempt.currentStepIndex >= activity.steps.length) {
    attempt.status = 'completed';
    attempt.completedAt = checkpoint.completedAt;
  }
  saveAttempt(attempt);
  return { attempt, checkpoint, idempotent: false };
}

function studentSummary(studentId) {
  const sid = String(studentId || '').trim().toUpperCase();
  return allAttempts()
    .filter((attempt) => attempt.studentId === sid)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function teacherResults(studentIds) {
  const allowed = new Set((studentIds || []).map((id) => String(id || '').trim().toUpperCase()).filter(Boolean));
  return allAttempts()
    .filter((attempt) => allowed.has(attempt.studentId))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((attempt) => ({
      ...attempt,
      checkpoints: attempt.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    }));
}

module.exports = {
  enabled,
  listActivities,
  getActivity,
  createAttempt,
  loadAttempt,
  checkpointAttempt,
  studentSummary,
  teacherResults,
};
