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

test('a class list shows enough to find yourself and not enough to be a class list', () => {
  // The join screen is public — a game link is shareable by definition — so the
  // names on it belong to children who did not choose to be listed. First name
  // and last initial lets a child find themselves in their own class without
  // publishing a register.
  const label = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const first = parts[0] || '';
    return `${first}${parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : ''}`;
  };
  assert.equal(label('Ama Okafor'), 'Ama O.');
  assert.equal(label('Mpho Gift Mokoena'), 'Mpho M.', 'the LAST name is the surname, not the middle one');
  assert.equal(label('Thandi'), 'Thandi', 'one name stays one name');
  assert.doesNotMatch(label('Ama Okafor'), /Okafor/, 'the surname never reaches the page');
});

test('a join list carries no school identifiers', () => {
  // The join screen is public. Names are reduced to a first name and an
  // initial, and the school's own ID — often an admission number — must not
  // travel at all. It is replaced by a handle that means nothing outside the
  // one activity it was minted for.
  const crypto = require('node:crypto');
  const handle = (activityId, studentId) =>
    crypto.createHmac('sha256', 'test-secret')
      .update(`${activityId}:${roster.normalizeStudentId(studentId)}`)
      .digest('hex').slice(0, 16);

  const h = handle('game-1', 'ADM-88421');
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.doesNotMatch(h, /ADM|88421/, 'the ID must not be recoverable by eye');

  // Stable within an activity, so a tap resolves to the child who was listed.
  assert.equal(h, handle('game-1', 'ADM-88421'));
  // Different per activity, so a handle copied from one game is useless in another.
  assert.notEqual(h, handle('game-2', 'ADM-88421'));
  // And distinct per child.
  assert.notEqual(h, handle('game-1', 'ADM-90233'));
});

test('gender is normalised for the spellings schools actually use', () => {
  // One class list will contain M, m, Male, boy and B for the same thing.
  for (const v of ['M', 'm', 'Male', 'boy', 'B', 'MAN']) assert.equal(roster.normalizeGender(v), 'male', v);
  for (const v of ['F', 'f', 'Female', 'girl', 'G', 'woman']) assert.equal(roster.normalizeGender(v), 'female', v);
});

test('a value that is neither is kept as written, not forced into a bucket', () => {
  // Schools record other values, and rewriting a child's record to fit two
  // options would be worse than storing what we were told.
  assert.equal(roster.normalizeGender('Non-binary'), 'Non-binary');
  assert.equal(roster.normalizeGender('prefer not to say'), 'prefer not to say');
  assert.equal(roster.normalizeGender(''), '', 'and blank stays blank — not recording it is valid');
  assert.equal(roster.normalizeGender('   '), '');
});

test('a header tells us the shape, so any value in that column is taken', () => {
  const rows = roster.parseCSV('studentId,name,gender\nS1,Ama Okafor,F\nS2,Jean-Luc,Non-binary\nS3,Sam Dube,');
  assert.equal(rows[0].gender, 'female');
  assert.equal(rows[1].gender, 'Non-binary', 'not swallowed into the name');
  assert.ok(!('gender' in rows[2]), 'blank means absent, not empty string');
});

test('without a header a name containing a comma still survives', () => {
  // "S4,Okafor, Ama" is a surname-first name, not a gender called "Ama". With
  // no header to go on the parser only splits off a tail it is sure about.
  const rows = roster.parseCSV('S4,"Okafor, Ama"\nS5,"Dube, Sam",M');
  assert.equal(rows[0].name, 'Okafor, Ama');
  assert.ok(!rows[0].gender);
  assert.equal(rows[1].name, 'Dube, Sam');
  assert.equal(rows[1].gender, 'male');
});

test('the mapped column is optional and survives being saved', () => {
  const rows = [
    { ID: 'S1', Learner: 'Ama Okafor', Sex: 'F' },
    { ID: 'S2', Learner: 'Sam Dube', Sex: '' },
  ];
  const withGender = roster.buildStudentsFromMapping(rows, 'ID', 'Learner', 'Sex');
  assert.equal(withGender[0].gender, 'female');
  assert.ok(!('gender' in withGender[1]));

  const without = roster.buildStudentsFromMapping(rows, 'ID', 'Learner');
  assert.ok(!('gender' in without[0]), 'no column mapped means nothing recorded');
});

test('renaming a class keeps its id, its students and their PINs', async () => {
  // The id is what game results, assignments and PINs point at. A rename that
  // minted a new one would be a new class wearing the old one's students —
  // every result recorded so far would be orphaned.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-rename-'));
  try {
    for (const m of ['../roster.js', '../storage.js']) delete require.cache[require.resolve(m)];
    const r = require('../roster.js');

    const saved = r.saveRoster('t1', { name: '2B4', students: [
      { id: 'ADM-1', name: 'Ama Okafor', gender: 'F' },
      { id: 'ADM-2', name: 'Sam Dube' },
    ] });

    const renamed = r.renameRoster('t1', saved.id, '  Grade 2B4  ');
    assert.equal(renamed.id, saved.id, 'the id must not change');
    assert.equal(renamed.name, 'Grade 2B4', 'and the name is tidied, not stored with its spaces');
    assert.deepEqual(renamed.students, saved.students, 'students untouched, gender included');
    assert.deepEqual(r.findStudentInRoster('t1', saved.id, 'ADM-1'), saved.students[0], 'lookups still resolve');
  } finally {
    process.env.DATA_DIR = previous;
    for (const m of ['../roster.js', '../storage.js']) delete require.cache[require.resolve(m)];
  }
});

test('a rename is refused rather than half-applied', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-rename2-'));
  try {
    for (const m of ['../roster.js', '../storage.js']) delete require.cache[require.resolve(m)];
    const r = require('../roster.js');
    const saved = r.saveRoster('t1', { name: 'Original', students: [{ id: 'S1', name: 'Ama' }] });

    assert.equal(r.renameRoster('t1', saved.id, '   '), null, 'a blank name is not a name');
    assert.equal(r.renameRoster('t1', 'no-such-roster', 'X'), null);
    // Another teacher must not be able to rename a class that is not theirs.
    assert.equal(r.renameRoster('t2', saved.id, 'Stolen'), null);
    assert.equal(r.getRoster('t1', saved.id).name, 'Original', 'and none of that changed anything');

    const capped = r.renameRoster('t1', saved.id, 'x'.repeat(300));
    assert.equal(capped.name.length, 80, 'a pasted essay cannot become a class name');
  } finally {
    process.env.DATA_DIR = previous;
    for (const m of ['../roster.js', '../storage.js']) delete require.cache[require.resolve(m)];
  }
});
