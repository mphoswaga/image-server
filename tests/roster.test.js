const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-roster-'));

const roster = require('../roster');
const assignments = require('../assignments');
const games = require('../games');
const gradebook = require('../gradebook');

function workbookBuffer(rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Worksheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('roster import prefers Student code over row number and keeps all rows', () => {
  const rows = [
    ['#', 'Student code', 'Fullname', 'DOB', 'Behavior points', 'Comments'],
    [1, 'VS068922', 'Nguyen A', '17/03/2019', '', ''],
    [2, 'VS072970', 'Nguyen B', '16/04/2019', '', ''],
    [3, 'VS114657', 'Nguyen C', '06/02/2019', '', ''],
  ];
  const parsed = roster.parseRosterFile(workbookBuffer(rows), 'data_2425_default_school_2B2.xlsx');

  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.detectedIdCol, 'Student code');
  assert.equal(parsed.detectedNameCol, 'Fullname');

  const students = roster.buildStudentsFromMapping(parsed.rows, parsed.detectedIdCol, parsed.detectedNameCol);
  assert.deepEqual(students, [
    { id: 'VS068922', name: 'Nguyen A' },
    { id: 'VS072970', name: 'Nguyen B' },
    { id: 'VS114657', name: 'Nguyen C' },
  ]);
});

test('roster save normalizes and deduplicates student IDs', () => {
  const teacherId = `teacher-${Date.now()}`;
  const saved = roster.saveRoster(teacherId, {
    name: '2B2',
    students: [
      { id: ' vs068922 ', name: 'Nguyen A' },
      { id: 'VS068922', name: 'Duplicate A' },
      { id: 'vs 072970', name: 'Nguyen B' },
    ],
  });

  assert.deepEqual(saved.students, [
    { id: 'VS068922', name: 'Nguyen A' },
    { id: 'VS072970', name: 'Nguyen B' },
  ]);
  assert.deepEqual(roster.findStudentInRoster(teacherId, saved.id, 'vs068922'), { id: 'VS068922', name: 'Nguyen A' });
});

test('activity results match rosters when student IDs use different casing', () => {
  const teacherId = `teacher-results-${Date.now()}`;
  const saved = roster.saveRoster(teacherId, {
    name: '2B2',
    students: [{ id: 'VS068922', name: 'Nguyen A' }],
  });

  const assignment = assignments.createAssignment({
    teacherId,
    type: 'quiz',
    subject: 'ICT',
    topic: 'Flowcharts',
    grade: '4',
    rosterId: saved.id,
    data: {
      title: 'Flowcharts Quiz',
      mcq: [{ question: 'Start symbol?', options: ['Oval', 'Square'], correctIndex: 0 }],
    },
  });
  assignments.saveSubmission(assignment.id, {
    studentId: ' vs068922 ',
    name: 'Nguyen A',
    answers: {},
    grades: [],
    totalMarks: 1,
    maxMarks: 1,
    submittedAt: '2026-01-01T00:00:00.000Z',
  });

  const game = games.createGame({
    teacherId,
    lessonTitle: 'Flowcharts Game',
    subject: 'ICT',
    topic: 'Flowcharts',
    grade: '4',
    rosterId: saved.id,
    game: {
      questions: [{ question: 'Start symbol?', options: ['Oval', 'Square'], correctIndex: 0 }],
    },
  });
  games.recordResult(game.id, {
    studentId: 'vs068922',
    name: 'Nguyen A',
    score: 1,
    total: 1,
    answers: [0],
    arcadeScore: 10,
    gameType: 'car',
  });

  assert.equal(assignments.getSubmission(assignment.id, 'VS068922').studentId, 'VS068922');
  assert.equal(games.getResults(game.id)[0].studentId, 'VS068922');

  const gb = gradebook.buildGradebook(teacherId, saved.id);
  assert.equal(gb.rows[0].done, 2);
  assert.equal(gb.rows[0].average, 1);
});

test('a student who is not on a roster keeps the name they typed', () => {
  // studentId is an identity KEY — upper-cased with spaces removed, so that one
  // person is one person across attempts. Used as a NAME it produced results a
  // teacher reads as AMAOKAFOR, which is what this separates.
  assert.equal(roster.displayNameFrom('Mpho Mokoena', 'MPHOMOKOENA'), 'Mpho Mokoena');
  assert.equal(roster.displayNameFrom('  ama   okafor ', 'AMAOKAFOR'), 'ama okafor', 'tidied, not mangled');
  assert.equal(roster.displayNameFrom("O'Brien, Sarah", 'X'), "O'Brien, Sarah", 'real names have punctuation');
});

test('two spellings of one name are still one student', () => {
  // The point of the key: a child who types their name differently on Tuesday
  // must not appear twice in the teacher's results.
  assert.equal(roster.normalizeStudentId('Mpho Mokoena'), roster.normalizeStudentId('mpho  MOKOENA'));
});

test('no name given falls back rather than leaving a blank row', () => {
  // Older clients send no name at all; a result with an empty label is worse
  // than an ugly one, because the teacher cannot tell whose it is.
  assert.equal(roster.displayNameFrom('', 'AMAOKAFOR'), 'AMAOKAFOR');
  assert.equal(roster.displayNameFrom('   ', 'AMAOKAFOR'), 'AMAOKAFOR');
  assert.equal(roster.displayNameFrom(undefined, 'AMAOKAFOR'), 'AMAOKAFOR');
});

test('a pasted essay cannot become a student name', () => {
  const long = roster.displayNameFrom('x'.repeat(500), 'FALLBACK');
  assert.equal(long.length, 60, 'capped so one row cannot wreck the results table');
});
