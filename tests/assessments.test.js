const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-assessments-'));
const assignments = require('../assignments');
const gradebook = require('../gradebook');

function validAssessment(overrides = {}) {
  return {
    title: 'Forces assessment',
    subject: 'Science',
    grade: 'Grade 6',
    assessmentType: 'test',
    totalMarks: 20,
    objectives: [
      { id: 'knowledge', text: 'Explain how forces affect motion' },
      { id: 'investigation', text: 'Carry out a fair investigation' },
    ],
    instructions: 'Complete the knowledge check, then wait for the practical.',
    sections: [
      {
        id: 'theory', title: 'Knowledge check', type: 'mcq', objectiveIds: ['knowledge'],
        items: [
          { id: 'q1', prompt: 'Which force slows a moving object?', options: ['Friction', 'Gravity'], correctIndex: 0, marks: 5 },
        ],
      },
      {
        id: 'practical', title: 'Investigation', type: 'practical', objectiveIds: ['investigation'],
        items: [
          { id: 'criterion-1', prompt: 'Controls the variables', marks: 5 },
          { id: 'criterion-2', prompt: 'Records and explains the results', marks: 10 },
        ],
      },
    ],
    ...overrides,
  };
}

test('a teacher can compose a subject-neutral assessment from marked sections', () => {
  const normalized = assignments.normalizeAssessment(validAssessment());
  assert.equal(normalized.totalMarks, 20);
  assert.deepEqual(normalized.sections.map(section => section.marks), [5, 15]);
  assert.deepEqual(normalized.questions.map(question => question.kind), ['mcq', 'practical', 'practical']);
  assert.deepEqual(normalized.questions[0].objectiveIds, ['knowledge']);
  assert.deepEqual(normalized.questions[1].objectiveIds, ['investigation']);
});

test('publishing is blocked when allocated marks do not equal the teacher total', () => {
  assert.throws(
    () => assignments.normalizeAssessment(validAssessment({ totalMarks: 50 })),
    /Allocated marks \(20\) must equal the assessment total \(50\)/,
  );
});

test('published assessments retain sections and work with assignment rooms', () => {
  const record = assignments.createAssessment({
    teacherId: 'teacher-1', teacherName: 'Teacher One',
    data: validAssessment(), rosterId: 'class-1',
  });
  assert.equal(record.type, 'assessment');
  assert.equal(record.assessmentType, 'test');
  assert.equal(record.version, 1);
  assert.equal(record.totalMarks, 20);
  assert.equal(record.sections.length, 2);
  assert.equal(assignments.getRoomCode(record.roomCode), record.id);
  assert.equal(assignments.listTeacherAssignments('teacher-1')[0].sectionCount, 2);
});

test('assessment results require teacher release and expose objective-level evidence', () => {
  const record = assignments.createAssessment({ teacherId: 'teacher-evidence', data: validAssessment(), cutoffAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(assignments.isReleased(record), false, 'an expired due date must not release a test');
  assignments.saveSubmission(record.id, {
    studentId: 'student-1', name: 'Student One', answers: { q1: 0 },
    grades: {
      q1: { marksAwarded: 5, source: 'auto' },
      'criterion-1': { marksAwarded: 4, source: 'teacher' },
      'criterion-2': { marksAwarded: 0, source: 'teacher-required' },
    },
    totalMarks: 9, maxMarks: 20, submittedAt: '2026-09-10T10:00:00.000Z',
  });
  const row = gradebook.assignmentResultRows('teacher-evidence')[0];
  assert.equal(row.objectiveEvidence.length, 2);
  assert.equal(row.objectiveEvidence[0].objective, 'Explain how forces affect motion');
  assert.equal(row.objectiveEvidence[1].teacherConfirmed, true);
  assert.deepEqual(assignments.assessmentReleaseReadiness(record), {
    ready: false, pendingGrades: 1, submissions: 1, reason: 'Review 1 pending grade before releasing results.',
  });
  assignments.saveSubmission(record.id, {
    ...assignments.getSubmission(record.id, 'student-1'),
    grades: {
      q1: { marksAwarded: 5, source: 'auto' },
      'criterion-1': { marksAwarded: 4, source: 'teacher' },
      'criterion-2': { marksAwarded: 8, source: 'teacher' },
    },
    totalMarks: 17,
  });
  assert.equal(assignments.assessmentReleaseReadiness(record).ready, true);
  assert.equal(assignments.releaseResults(record.id, true).status, 'finalised');
  assert.equal(assignments.isReleased(assignments.getAssignment(record.id)), true);
});

test('free response items require marking guidance and practical criteria do not', () => {
  const invalid = validAssessment({
    sections: [{ id: 'writing', title: 'Writing', type: 'extended-response', objectiveIds: ['knowledge'], items: [{ prompt: 'Explain your conclusion.', marks: 20 }] }],
  });
  assert.throws(() => assignments.normalizeAssessment(invalid), /marking guidance or an answer key/);

  const practical = validAssessment({
    assessmentType: 'performance',
    sections: [{ id: 'performance', title: 'Performance', type: 'practical', objectiveIds: ['investigation'], items: [{ prompt: 'Performs with control and accuracy', marks: 20 }] }],
  });
  assert.equal(assignments.normalizeAssessment(practical).questions[0].kind, 'practical');
});

test('a live assessment moves through teacher-controlled classroom phases', () => {
  const record = assignments.createAssessment({ teacherId: 'teacher-live', data: validAssessment() });
  assert.deepEqual(assignments.deliveryState(record).phase, 'lobby');
  assert.equal(assignments.updateDelivery(record.id, 'start').delivery.activeSectionIndex, 0);
  assert.equal(assignments.updateDelivery(record.id, 'pause').delivery.phase, 'paused');
  assert.equal(assignments.updateDelivery(record.id, 'resume').delivery.phase, 'open');
  assert.equal(assignments.updateDelivery(record.id, 'next').delivery.activeSectionIndex, 1);
  assert.equal(assignments.updateDelivery(record.id, 'previous').delivery.activeSectionIndex, 0);
  assignments.updateDelivery(record.id, 'next');
  assert.equal(assignments.updateDelivery(record.id, 'next').delivery.phase, 'marking');
});

test('server drafts merge answers and record readiness for the active section', () => {
  const record = assignments.createAssessment({ teacherId: 'teacher-drafts', data: validAssessment() });
  assignments.updateDelivery(record.id, 'start');
  assignments.saveDraft(record.id, { studentId: 'learner-1', name: 'Learner One', answers: { q1: 0 } });
  assignments.saveDraft(record.id, { studentId: 'learner-1', answers: {}, completedSectionId: 'theory' });
  assert.deepEqual(assignments.getDraft(record.id, 'LEARNER-1').answers, { q1: 0 });
  assert.equal(assignments.draftProgress(assignments.getAssignment(record.id)).readyCount, 1);
  assert.equal(assignments.listTeacherAssignments('teacher-drafts').length, 1, 'draft files never appear as assignments');
});

test('self-paced assessments open all sections without a live lobby', () => {
  const record = assignments.createAssessment({ teacherId: 'teacher-self-paced', data: validAssessment({ deliveryMode: 'self-paced' }) });
  assert.deepEqual(assignments.deliveryState(record), {
    mode: 'self-paced', phase: 'open', activeSectionIndex: null, previousPhase: null, updatedAt: record.delivery.updatedAt,
  });
  assert.throws(() => assignments.updateDelivery(record.id, 'start'), /self-paced/);
});
