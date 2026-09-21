const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-roster-merge-'));
process.env.DATA_DIR = dataDir;

const roster = require('../roster');
const assignments = require('../assignments');
const games = require('../games');
const { mergeExactDuplicateRosters } = require('../roster-merge');

test('duplicate rosters merge into the data-bearing record without losing activities or results', () => {
  const teacherId = 'teacher-safe-merge';
  const students = [{ id: 'G3B7-1', name: 'Learner One' }, { id: 'G3B7-2', name: 'Learner Two' }];
  const dataRoster = roster.saveRoster(teacherId, { name: 'Grade 3B7', students });
  const duplicateRoster = roster.saveRoster(teacherId, { name: 'Grade 3B7', students });
  const assessment = assignments.createAssignment({
    teacherId, type: 'quiz', subject: 'ICT', topic: 'Documents', grade: '3', rosterId: dataRoster.id,
    data: { title: 'ICT project', mcq: [{ question: 'Copy?', options: ['Yes', 'No'], correctIndex: 0 }] },
  });
  assignments.saveSubmission(assessment.id, {
    studentId: 'G3B7-1', name: 'Learner One', answers: { q0: 0 }, grades: { q0: { marksAwarded: 1, source: 'auto' } },
    totalMarks: 1, maxMarks: 1, submittedAt: '2026-09-21T00:00:00.000Z',
  });
  const game = games.createGame({
    teacherId, lessonTitle: 'ICT game', subject: 'ICT', topic: 'Documents', grade: '3', rosterId: duplicateRoster.id,
    game: { questions: [{ question: 'Paste?', options: ['Yes', 'No'], correctIndex: 0 }] },
  });
  games.recordResult(game.id, { studentId: 'G3B7-2', name: 'Learner Two', score: 1, total: 1, answers: [0], rosterId: duplicateRoster.id });

  const reports = mergeExactDuplicateRosters();
  const report = reports.find(item => item.teacherId === teacherId);
  assert.equal(report.keptRosterId, dataRoster.id, 'the roster with submitted assessment data is retained');
  assert.equal(report.archivedRosterId, duplicateRoster.id);
  assert.equal(roster.listRosters(teacherId).length, 1);
  assert.equal(assignments.getAssignment(assessment.id).rosterId, dataRoster.id);
  assert.deepEqual(games.getRosterIds(games.getGame(game.id)), [dataRoster.id]);
  assert.equal(games.getResults(game.id)[0].rosterId, dataRoster.id);
  assert.equal(assignments.getSubmission(assessment.id, 'G3B7-1').totalMarks, 1);
  assert.ok(fs.existsSync(path.join(dataDir, 'users', teacherId, 'rosters', '_merged', `${duplicateRoster.id}.json`)));
});

test('same-name classes with different learner IDs are never merged', () => {
  const teacherId = 'teacher-no-merge';
  roster.saveRoster(teacherId, { name: 'Grade 3B7', students: [{ id: 'OLD-1', name: 'Old Learner' }] });
  roster.saveRoster(teacherId, { name: 'Grade 3B7', students: [{ id: 'NEW-1', name: 'New Learner' }] });
  mergeExactDuplicateRosters();
  assert.equal(roster.listRosters(teacherId).length, 2);
});
