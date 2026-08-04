const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const roster = require('../roster');

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
