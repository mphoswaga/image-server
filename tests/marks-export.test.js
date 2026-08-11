// The marks spreadsheet a teacher exports for reporting.
//
// Opened and read back rather than trusted, because a marks file is the one
// artifact here where a quiet mistake follows a child: a mark landing in the
// wrong student's row, or a missing assessment column shifting every mark one
// to the left, would be copied into a report card by a teacher with no reason
// to doubt it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { toWorkbook } = require('../gradebook.js');

// Read the exported file back as a grid, the way a teacher's eye reads it.
function gridOf(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return { sheetName: wb.SheetNames[0], rows: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) };
}

const GRADEBOOK = {
  name: 'Grade 5 ICT',
  assessments: [
    { id: 'a1', title: 'Spreadsheets quiz', average: 0.8 },
    { id: 'a2', title: 'Exit ticket', average: 0.5 },
  ],
  rows: [
    { name: 'Ama',   cells: { a1: { mark: 8, max: 10 }, a2: { mark: 1, max: 2 } }, average: 0.833 },
    { name: 'Bongi', cells: { a1: { mark: 9, max: 10 } },                          average: 0.9 },
    { name: 'Chidi', cells: {},                                                    average: null },
  ],
  classAverage: 0.78,
};

test('every student and every assessment reaches the file', async () => {
  const { sheetName, rows } = gridOf(toWorkbook(GRADEBOOK));
  assert.equal(sheetName, 'Marks');

  assert.deepEqual(rows[0], ['Student', 'Spreadsheets quiz', 'Exit ticket', 'Average %']);
  assert.equal(rows[1][0], 'Ama');
  assert.equal(rows[2][0], 'Bongi');
  assert.equal(rows[3][0], 'Chidi');
});

test('a mark stays in its own student\'s row and its own column', async () => {
  // The failure that matters: a missing mark shifting the rest one cell left,
  // so Bongi's quiz score lands under "Exit ticket" and gets reported as such.
  const { rows } = gridOf(toWorkbook(GRADEBOOK));
  const byName = Object.fromEntries(rows.slice(1).filter(r => r[0]).map(r => [r[0], r]));

  assert.deepEqual(byName['Ama'].slice(0, 3), ['Ama', '8/10', '1/2']);
  // Bongi sat the quiz but not the exit ticket: the gap must stay a gap.
  assert.deepEqual(byName['Bongi'].slice(0, 3), ['Bongi', '9/10', '']);
  // Chidi sat nothing at all, and must still appear rather than being dropped.
  assert.deepEqual(byName['Chidi'].slice(0, 3), ['Chidi', '', '']);
});

test('averages are whole percentages, not raw fractions', async () => {
  // 0.833 printed into a report card as "0.833%" would be nonsense, and a
  // teacher copying it would not stop to check.
  const { rows } = gridOf(toWorkbook(GRADEBOOK));
  const ama = rows.find(r => r[0] === 'Ama');
  assert.equal(ama[3], 83);
  const bongi = rows.find(r => r[0] === 'Bongi');
  assert.equal(bongi[3], 90);
  const chidi = rows.find(r => r[0] === 'Chidi');
  assert.equal(chidi[3], '', 'no marks means no average, not zero');
});

test('the class average row is present and labelled', async () => {
  const { rows } = gridOf(toWorkbook(GRADEBOOK));
  const footer = rows.find(r => r[0] === 'Class average');
  assert.ok(footer, 'the summary row a teacher looks for first');
  assert.equal(footer[1], '80%');
  assert.equal(footer[2], '50%');
  assert.equal(footer[3], 78);
});

test('an empty class exports a usable file rather than failing', async () => {
  const { rows } = gridOf(toWorkbook({ name: 'Empty', assessments: [], rows: [], classAverage: null }));
  assert.deepEqual(rows[0], ['Student', 'Average %']);
});
