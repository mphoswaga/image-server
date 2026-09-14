const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-assessments-'));
const assignments = require('../assignments');
const gradebook = require('../gradebook');
const roster = require('../roster');

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

test('numeric multiple-choice answer keys are corrected before publishing', () => {
  const assessment = validAssessment({
    totalMarks: 1,
    sections: [{
      id: 'math', title: 'Rounding', type: 'mcq', objectiveIds: ['knowledge'],
      items: [{ id: 'round-84', prompt: 'Round 84 to the nearest 10.', options: ['80', '84', '90', '85'], correctIndex: 2, marks: 1 }],
    }],
  });
  assert.equal(assignments.normalizeAssessment(assessment).questions[0].correctIndex, 0);
});

test('publishing rejects broken or duplicate multiple-choice content', () => {
  const badMath = validAssessment({
    totalMarks: 1,
    sections: [{
      id: 'math', title: 'Rounding', type: 'mcq', objectiveIds: ['knowledge'],
      items: [{ prompt: 'Round 84 to the nearest 10.', options: ['84', '90', '85'], correctIndex: 0, marks: 1 }],
    }],
  });
  assert.throws(() => assignments.normalizeAssessment(badMath), /calculated answer 80 is missing/);

  const placeholders = validAssessment({
    totalMarks: 1,
    sections: [{
      id: 'placeholder', title: 'Knowledge', type: 'mcq', objectiveIds: ['knowledge'],
      items: [{ prompt: 'Knowledge question 1 about forces', options: ['Correct answer', 'Plausible alternative'], correctIndex: 0, marks: 1 }],
    }],
  });
  assert.throws(() => assignments.normalizeAssessment(placeholders), /replace placeholder text/);

  const duplicateOptions = validAssessment({
    totalMarks: 1,
    sections: [{
      id: 'duplicate', title: 'Knowledge', type: 'mcq', objectiveIds: ['knowledge'],
      items: [{ prompt: 'Which statement is accurate?', options: ['The first statement', 'The first statement'], correctIndex: 0, marks: 1 }],
    }],
  });
  assert.throws(() => assignments.normalizeAssessment(duplicateOptions), /options must be different/);
});

test('publishing rejects review-required fallback prompts and marking keys', () => {
  const practical = validAssessment({
    totalMarks: 20,
    sections: [{
      id: 'practical', title: 'Practical', type: 'practical', objectiveIds: ['investigation'],
      items: [{ prompt: '[REVIEW REQUIRED] Replace this practical criterion.', marks: 20 }],
    }],
  });
  assert.throws(() => assignments.normalizeAssessment(practical), /replace placeholder text/);

  const written = validAssessment({
    totalMarks: 20,
    sections: [{
      id: 'written', title: 'Written response', type: 'short-answer', objectiveIds: ['knowledge'],
      items: [{ prompt: 'Explain the result.', answerKey: 'REVIEW REQUIRED: add a checked marking key.', marks: 20 }],
    }],
  });
  assert.throws(() => assignments.normalizeAssessment(written), /replace placeholder text/);
});

test('publishing rejects generic drafts left in an older automatic-assessment cache', () => {
  const cachedFallback = validAssessment({
    totalMarks: 20,
    sections: [{
      id: 'cached-knowledge', title: 'Knowledge check', type: 'mcq', objectiveIds: ['knowledge'],
      items: [{
        prompt: 'Item 1: Which response best demonstrates the learning goal about forces?',
        options: [
          'A correct response demonstrates: Explain how forces affect motion',
          'A response about a different skill',
          'An unrelated response',
          'No response to the learning goal',
        ],
        correctIndex: 0,
        marks: 20,
      }],
    }],
  });
  assert.throws(() => assignments.normalizeAssessment(cachedFallback), /replace placeholder text/);
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

test('published assessments snapshot and normalize the selected cohort', () => {
  const record = assignments.createAssessment({
    teacherId: 'teacher-cohort', data: validAssessment(), rosterId: 'class-cohort',
    rosterSnapshot: [
      { id: ' learner-1 ', name: 'Learner One' },
      { id: 'LEARNER-1', name: 'Duplicate' },
      { id: 'learner 2', name: 'Learner Two' },
    ],
  });
  assert.deepEqual(record.rosterSnapshot, [
    { id: 'LEARNER-1', name: 'Learner One' },
    { id: 'LEARNER2', name: 'Learner Two' },
  ]);
});

test('project deck generation receives the canonical published assessment snapshot', () => {
  const record = assignments.createAssessment({
    teacherId: 'teacher-deck-context',
    data: validAssessment({
      title: 'Document creation project',
      subject: 'ICT',
      grade: 'Grade 2',
      assessmentType: 'project',
      deliveryMode: 'live',
      lessonWorkspaceId: 'workspace-document-project',
      unitId: 'unit-document-creation',
      unitName: 'Document creation',
    }),
  });
  const context = assignments.publishedAssessmentGenerationContext({
    assessmentId: record.id,
    teacherId: 'teacher-deck-context',
    lessonPurpose: 'project',
    subject: 'ict',
    grade: 'grade 2',
    unitId: 'unit-document-creation',
    lessonWorkspaceId: 'workspace-document-project',
  });

  assert.equal(context.assessmentPublishedId, record.id);
  assert.equal(context.assessmentDraft.title, 'Document creation project');
  assert.equal(context.assessmentDraft.sections[0].items[0].prompt, 'Which force slows a moving object?');
  assert.deepEqual(context.assessmentQuestionTypes, ['mcq', 'practical']);
  assert.deepEqual(context.assessmentPhases.map(phase => [phase.type, phase.marks]), [['mcq', 5], ['practical', 15]]);
  assert.equal(context.assessmentMcqCount, 1);
  assert.equal(context.assessmentTotalMarks, 20);

  // The returned copy cannot mutate the stored publication used by a later
  // generation request.
  context.assessmentDraft.sections[0].items[0].prompt = 'Forged browser question';
  assert.equal(assignments.getAssignment(record.id).sections[0].items[0].prompt, 'Which force slows a moving object?');
});

test('project/test deck generation rejects missing, foreign and mismatched publications', () => {
  const record = assignments.createAssessment({
    teacherId: 'teacher-gate-owner',
    data: validAssessment({ subject: 'ICT', grade: 'Grade 2', assessmentType: 'project', unitId: 'unit-1', lessonWorkspaceId: 'workspace-1' }),
  });
  const request = {
    teacherId: 'teacher-gate-owner', lessonPurpose: 'project', subject: 'ICT', grade: 'Grade 2', unitId: 'unit-1', lessonWorkspaceId: 'workspace-1',
  };

  assert.throws(
    () => assignments.publishedAssessmentGenerationContext(request),
    error => error.code === 'assessment_publish_required' && error.status === 400,
  );
  assert.throws(
    () => assignments.publishedAssessmentGenerationContext({ ...request, assessmentId: record.id, teacherId: 'another-teacher' }),
    error => error.code === 'assessment_not_owned' && error.status === 403,
  );
  for (const mismatch of [
    { lessonPurpose: 'test' },
    { subject: 'Mathematics' },
    { grade: 'Grade 6' },
    { unitId: 'another-unit' },
    { lessonWorkspaceId: 'another-workspace' },
    { lessonWorkspaceId: 'workspace 1' },
  ]) {
    assert.throws(
      () => assignments.publishedAssessmentGenerationContext({ ...request, assessmentId: record.id, ...mismatch }),
      error => error.code === 'assessment_context_mismatch' && error.status === 409,
    );
  }

  assert.throws(
    () => assignments.publishedAssessmentGenerationContext({ ...request, assessmentId: record.id, lessonWorkspaceId: undefined }),
    error => error.code === 'assessment_workspace_required' && error.status === 400,
  );
  const unbound = assignments.createAssessment({
    teacherId: 'teacher-gate-owner',
    data: validAssessment({ subject: 'ICT', grade: 'Grade 2', assessmentType: 'project', unitId: 'unit-1' }),
  });
  assert.throws(
    () => assignments.publishedAssessmentGenerationContext({ ...request, assessmentId: unbound.id }),
    error => error.code === 'assessment_workspace_missing' && error.status === 409,
  );
});

test('assessment results require teacher release and expose objective-level evidence', () => {
  const record = assignments.createAssessment({
    teacherId: 'teacher-evidence',
    data: validAssessment({ lessonWorkspaceId: 'lesson-workspace-7', unitId: 'unit-forces', unitName: 'Forces and motion' }),
    cutoffAt: '2020-01-01T00:00:00.000Z',
  });
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
  assert.deepEqual(gradebook.assignmentResultRows('teacher-evidence'), [], 'provisional marks are not exported');
  assert.deepEqual(gradebook.gatherStudentResults(['teacher-evidence'], 'student-1').rows, [], 'provisional marks do not affect summaries');
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
  assert.deepEqual(gradebook.assignmentResultRows('teacher-evidence'), [], 'fully marked results remain private until release');
  assert.equal(assignments.releaseResults(record.id, true).status, 'finalised');
  assert.equal(assignments.isReleased(assignments.getAssignment(record.id)), true);
  const row = gradebook.assignmentResultRows('teacher-evidence')[0];
  assert.equal(row.objectiveEvidence.length, 3);
  assert.equal(row.objectiveEvidence[0].objective, 'Explain how forces affect motion');
  assert.deepEqual(row.objectiveEvidence.map(evidence => evidence.source), ['auto', 'teacher', 'teacher']);
  assert.deepEqual(row.objectiveEvidence.map(evidence => evidence.teacherConfirmed), [false, true, true]);
  assert.deepEqual(row.objectiveEvidence.map(evidence => evidence.automaticallyMarked), [true, false, false]);
  assert.deepEqual(
    { lessonWorkspaceId: row.lessonWorkspaceId, unitId: row.unitId, unitName: row.unitName },
    { lessonWorkspaceId: 'lesson-workspace-7', unitId: 'unit-forces', unitName: 'Forces and motion' },
  );
  const summaryRow = gradebook.gatherStudentResults(['teacher-evidence'], 'student-1').rows[0];
  assert.equal(summaryRow.objectiveEvidence.length, 3);
  assert.deepEqual(
    { lessonWorkspaceId: summaryRow.lessonWorkspaceId, unitId: summaryRow.unitId, unitName: summaryRow.unitName },
    { lessonWorkspaceId: 'lesson-workspace-7', unitId: 'unit-forces', unitName: 'Forces and motion' },
  );
  assert.equal(row.at, row.finalisedAt, 'incremental exports use the release time');
});

test('gradebook excludes unreleased and pending assessment marks from progress', () => {
  const teacherId = 'teacher-final-progress';
  const classRoster = roster.saveRoster(teacherId, {
    name: 'Grade 6A',
    students: [{ id: 'learner-1', name: 'Learner One' }],
  });
  const record = assignments.createAssessment({
    teacherId,
    rosterId: classRoster.id,
    data: validAssessment(),
  });
  assignments.saveSubmission(record.id, {
    studentId: 'learner-1', name: 'Learner One', answers: { q1: 0 },
    grades: {
      q1: { marksAwarded: 5, source: 'auto' },
      'criterion-1': { marksAwarded: 4, source: 'teacher' },
      'criterion-2': { marksAwarded: 0, source: 'teacher-required' },
    },
    totalMarks: 9, maxMarks: 20, submittedAt: '2026-09-10T10:00:00.000Z',
  });

  let book = gradebook.buildGradebook(teacherId, classRoster.id);
  assert.equal(gradebook.listClasses(teacherId)[0].assignments, 0);
  assert.equal(book.assessments.length, 0);
  assert.equal(book.rows[0].done, 0);
  assert.equal(book.rows[0].average, null);
  assert.deepEqual(gradebook.assignmentResultRows(teacherId), []);

  // Defend the reporting boundary even if a malformed caller finalises a
  // record before all teacher-required grades have been supplied.
  assignments.releaseResults(record.id, true);
  book = gradebook.buildGradebook(teacherId, classRoster.id);
  assert.equal(book.assessments.length, 1);
  assert.equal(book.assessments[0].done, 0);
  assert.equal(book.rows[0].done, 0);
  assert.equal(book.rows[0].average, null);
  assert.deepEqual(gradebook.assignmentResultRows(teacherId), []);
  assert.deepEqual(gradebook.gatherStudentResults([teacherId], 'learner-1').rows, []);

  assignments.releaseResults(record.id, false);
  assignments.saveSubmission(record.id, {
    ...assignments.getSubmission(record.id, 'learner-1'),
    grades: {
      q1: { marksAwarded: 5, source: 'auto' },
      'criterion-1': { marksAwarded: 4, source: 'teacher' },
      'criterion-2': { marksAwarded: 8, source: 'teacher' },
    },
    // The final projection is rebuilt from item grades, not this stale field.
    totalMarks: 0,
  });
  assert.deepEqual(gradebook.assignmentResultRows(teacherId), [], 'explicitly unreleased corrections remain private');
  assignments.releaseResults(record.id, true);

  book = gradebook.buildGradebook(teacherId, classRoster.id);
  assert.equal(book.rows[0].done, 1);
  assert.equal(book.rows[0].cells[record.id].mark, 17);
  assert.equal(book.rows[0].cells[record.id].max, 20);
  assert.equal(book.rows[0].average, 0.85);
  assert.equal(gradebook.gatherStudentResults([teacherId], 'learner-1').rows[0].mark, 17);
  assert.equal(gradebook.assignmentResultRows(teacherId)[0].score, 17);
});

test('final assessment submissions and released marks stay immutable until explicit unrelease', () => {
  const record = assignments.createAssessment({ teacherId: 'teacher-locks', data: validAssessment() });
  const submission = {
    studentId: 'learner-lock', name: 'Learner Lock', answers: { q1: 0 },
    grades: {
      q1: { marksAwarded: 5, source: 'auto' },
      'criterion-1': { marksAwarded: 5, source: 'teacher' },
      'criterion-2': { marksAwarded: 10, source: 'teacher' },
    },
    totalMarks: 20, maxMarks: 20, submittedAt: '2026-09-12T08:00:00.000Z',
  };
  assignments.saveNewSubmission(record.id, submission);
  assert.throws(
    () => assignments.saveNewSubmission(record.id, { ...submission, totalMarks: 0 }),
    error => error.code === 'assessment_already_submitted' && error.status === 409,
  );

  const finalised = assignments.releaseResults(record.id, true);
  const finalisedAt = finalised.finalisedAt;
  assert.equal(assignments.releaseResults(record.id, true).finalisedAt, finalisedAt, 'repeat release is idempotent');
  assert.throws(() => assignments.saveSubmission(record.id, { ...submission, totalMarks: 0 }), /finalised/i);
  assert.throws(() => assignments.saveDraft(record.id, { studentId: 'learner-lock', answers: { q1: 1 } }), /finalised/i);
  assert.throws(() => assignments.saveDraftGrade(record.id, { studentId: 'learner-lock', questionId: 'criterion-1', grade: { marksAwarded: 0 } }), /finalised/i);

  assignments.releaseResults(record.id, false);
  assignments.saveSubmission(record.id, { ...submission, totalMarks: 19 });
  assert.equal(assignments.getSubmission(record.id, 'learner-lock').totalMarks, 19);
});

test('legacy assignments retain their existing resubmission and post-release correction behavior', () => {
  const record = assignments.createAssignment({
    teacherId: 'teacher-legacy', type: 'quiz', subject: 'ICT', topic: 'Files', grade: 'Grade 2',
    data: { title: 'Files quiz', mcq: [{ question: 'Which button saves?', options: ['Save', 'Print'], correctIndex: 0 }] },
  });
  const base = { studentId: 'legacy-learner', name: 'Legacy Learner', answers: { q0: 0 }, grades: { q0: { marksAwarded: 1, source: 'auto' } }, totalMarks: 1, maxMarks: 1, submittedAt: '2026-09-12T08:00:00.000Z' };
  assignments.saveNewSubmission(record.id, base);
  assignments.saveNewSubmission(record.id, { ...base, totalMarks: 0 });
  assignments.releaseResults(record.id, true);
  assignments.saveSubmission(record.id, { ...base, totalMarks: 1 });
  assert.equal(assignments.getSubmission(record.id, 'legacy-learner').totalMarks, 1);
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

test('assessment answers reject malformed or incomplete knowledge responses but allow practical observation', () => {
  const questions = assignments.normalizeAssessment(validAssessment()).questions;
  assert.deepEqual(assignments.sanitizeLearnerAnswers(questions, {
    q1: '0', 'criterion-1': 'forged practical response', unknown: 'ignore me',
  }), { q1: 0 });
  assert.deepEqual(assignments.sanitizeLearnerAnswers(questions, { q1: '', }), {});
  assert.deepEqual(assignments.sanitizeLearnerAnswers(questions, { q1: 9 }), {});
  assert.deepEqual(assignments.incompleteAssessmentAnswers(questions, { q1: 0 }), []);
  assert.deepEqual(assignments.incompleteAssessmentAnswers(questions, {}).map(question => question.id), ['q1']);

  const written = assignments.normalizeAssessment(validAssessment({
    totalMarks: 20,
    sections: [{ id: 'written', title: 'Written', type: 'short-answer', objectiveIds: ['knowledge'], items: [{ id: 'written-1', prompt: 'Explain friction.', answerKey: 'Friction opposes motion.', marks: 20 }] }],
  })).questions;
  assert.deepEqual(assignments.incompleteAssessmentAnswers(written, { 'written-1': '   ' }).map(question => question.id), ['written-1']);
  assert.deepEqual(assignments.incompleteAssessmentAnswers(written, { 'written-1': 'It opposes motion.' }), []);
});

test('teachers can record practical evidence before submission and release waits for the full roster', () => {
  const teacherId = 'teacher-live-observation';
  const classRoster = roster.saveRoster(teacherId, {
    name: 'Grade 6B',
    students: [{ id: 'student-one', name: 'Student One' }, { id: 'student-two', name: 'Student Two' }],
  });
  const record = assignments.createAssessment({ teacherId, rosterId: classRoster.id, data: validAssessment() });
  assignments.saveDraftGrade(record.id, {
    studentId: 'student-one', name: 'Student One', questionId: 'criterion-1',
    grade: { marksAwarded: 4, verdict: 'partial', rationale: 'Observed in class.', source: 'teacher' },
  });
  assert.equal(assignments.getDraft(record.id, 'STUDENT-ONE').observationGrades['criterion-1'].marksAwarded, 4);

  assignments.saveSubmission(record.id, {
    studentId: 'student-one', name: 'Student One', answers: { q1: 0 },
    grades: {
      q1: { marksAwarded: 5, source: 'auto' },
      'criterion-1': { marksAwarded: 4, source: 'teacher' },
      'criterion-2': { marksAwarded: 10, source: 'teacher' },
    },
    totalMarks: 19, maxMarks: 20, submittedAt: '2026-09-11T01:00:00.000Z',
  });
  const readiness = assignments.assessmentReleaseReadiness(record, classRoster.students.map(student => student.id));
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missingStudents, 1);
  assert.deepEqual(readiness.missingStudentIds, ['STUDENT-TWO']);
  assert.match(readiness.reason, /not submitted/i);
});

test('self-paced assessments open all sections without a live lobby', () => {
  const record = assignments.createAssessment({ teacherId: 'teacher-self-paced', data: validAssessment({ deliveryMode: 'self-paced' }) });
  assert.deepEqual(assignments.deliveryState(record), {
    mode: 'self-paced', phase: 'open', activeSectionIndex: null, previousPhase: null, updatedAt: record.delivery.updatedAt,
  });
  assert.throws(() => assignments.updateDelivery(record.id, 'start'), /self-paced/);
});

test('test presentation slides never expose questions, options, or answers', () => {
  const record = assignments.createAssessment({ teacherId: 'teacher-present-test', data: validAssessment({
    title: 'PRIVATE TEST QUESTION in the title',
    instructions: 'HIDDEN OVERALL INSTRUCTION: the correct answer is Friction.',
    sections: [
      {
        id: 'theory', title: 'HIDDEN SECTION TITLE: Which force?', type: 'mcq', objectiveIds: ['knowledge'],
        instructions: 'HIDDEN SECTION HINT: remember the rough surface.',
        items: [
          { id: 'q1', prompt: 'Which force slows a moving object?', options: ['Friction', 'Gravity'], correctIndex: 0, marks: 5 },
        ],
      },
      {
        id: 'practical', title: 'Investigation answer: clamp the ramp', type: 'practical', objectiveIds: ['investigation'],
        instructions: 'HIDDEN ASSESSED PROCEDURE: place the clamp at 10 cm.',
        items: [
          { id: 'criterion-1', prompt: 'Controls the variables', marks: 5 },
          { id: 'criterion-2', prompt: 'Records and explains the results', marks: 10 },
        ],
      },
    ],
  }) });
  const text = JSON.stringify(assignments.presentationSlides(record));
  assert.doesNotMatch(text, /Which force slows/);
  assert.doesNotMatch(text, /Friction/);
  assert.doesNotMatch(text, /Controls the variables/);
  assert.doesNotMatch(text, /PRIVATE TEST QUESTION|HIDDEN OVERALL|HIDDEN SECTION|HIDDEN ASSESSED|clamp the ramp/);
  assert.match(text, /Test overview/);
  assert.match(text, /independently in LessonScope/);
});

test('project presentation keeps marked MCQs private and makes practical directions shortcut-safe', () => {
  const project = validAssessment({
    assessmentType: 'project', totalMarks: 20,
    instructions: 'Use Ctrl+C, save with Ctrl + S, undo with Control-Z, and use Ctrl Shift P only when instructed.',
    sections: [
      {
        id: 'knowledge', title: 'Private knowledge question', type: 'mcq', objectiveIds: ['knowledge'],
        instructions: 'HIDDEN MCQ HINT',
        items: [{ id: 'q1', prompt: 'SECRET PROJECT MCQ PROMPT', options: ['SECRET CORRECT OPTION', 'Other'], correctIndex: 0, marks: 1 }],
      },
      {
        id: 'writing', title: 'Create with Cmd + Z, then save with ⌘S', type: 'practical', objectiveIds: ['knowledge'],
        instructions: 'Write in your own words, then paste with Control V and redo with Command Y.',
        items: [{ id: 'explanation', prompt: 'Formats the letter accurately without help', marks: 9 }],
      },
      {
        id: 'reflection', title: 'Written response', type: 'short-answer', objectiveIds: ['knowledge'],
        instructions: 'Complete the written response privately in LessonScope.',
        items: [{ id: 'written', prompt: 'PRIVATE WRITTEN PROJECT PROMPT', answerKey: 'SECRET MARKING ANSWER', marks: 10 }],
      },
    ],
  });
  const record = assignments.createAssessment({ teacherId: 'teacher-present-project', data: project });
  const text = JSON.stringify(assignments.presentationSlides(record));
  assert.match(text, /Write in your own words/);
  assert.match(text, /paste using the keyboard/i);
  assert.match(text, /save using the keyboard|undo using the keyboard|redo using the keyboard|the keyboard command/i);
  assert.doesNotMatch(text, /SECRET PROJECT MCQ PROMPT|SECRET CORRECT OPTION|HIDDEN MCQ HINT/);
  assert.doesNotMatch(text, /Formats the letter accurately without help/);
  assert.doesNotMatch(text, /PRIVATE WRITTEN PROJECT PROMPT/);
  assert.doesNotMatch(text, /(?:Ctrl|Control|Cmd|Command)(?:\s*\+\s*|\s*-\s*|\s+)(?:(?:Shift|Alt|Option)(?:\s*\+\s*|\s*-\s*|\s+))*[A-Z0-9]\b|⌘\s*(?:\+|-)?\s*[A-Z0-9]/i);
  assert.doesNotMatch(text, /SECRET MARKING ANSWER/);
});

test('assignment evidence remains scoped to its selected roster when a learner is in two classes', () => {
  const teacherId = 'teacher-two-rosters';
  const classA = roster.saveRoster(teacherId, { name: 'Class A', students: [{ id: 'SHARED-1', name: 'Shared Learner' }] });
  const classB = roster.saveRoster(teacherId, { name: 'Class B', students: [{ id: 'SHARED-1', name: 'Shared Learner' }] });
  const publish = classRoster => assignments.createAssessment({ teacherId, data: validAssessment(), rosterId: classRoster.id, rosterSnapshot: classRoster.students });
  const submitAndRelease = record => {
    assignments.saveNewSubmission(record.id, {
      studentId: 'SHARED-1', name: 'Shared Learner', answers: { q1: 0 },
      grades: { q1: { marksAwarded: 5, source: 'auto' }, 'criterion-1': { marksAwarded: 5, source: 'teacher' }, 'criterion-2': { marksAwarded: 10, source: 'teacher' } },
      totalMarks: 20, maxMarks: 20, submittedAt: '2026-09-12T08:00:00.000Z',
    });
    assignments.releaseResults(record.id, true);
  };
  const assessmentA = publish(classA);
  const assessmentB = publish(classB);
  submitAndRelease(assessmentA);
  submitAndRelease(assessmentB);
  const rows = gradebook.assignmentResultRows(teacherId);
  assert.equal(rows.length, 2, 'the teacher owns evidence in both classes');
  assert.deepEqual(
    assignments.filterAssignmentEvidenceForRoster(rows, 'class-a').map(row => row.assignmentId),
    [],
    'invented roster ids match nothing',
  );
  assert.deepEqual(
    assignments.filterAssignmentEvidenceForRoster(rows, classA.id).map(row => row.assignmentId),
    [assessmentA.id],
  );
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  assert.match(serverSource, /filterAssignmentEvidenceForRoster\(gradebook\.assignmentResultRows\(foundTeacherId\), foundRoster\.id\)/);
});
