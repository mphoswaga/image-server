const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const planningSource = require('../planning-source');

function workbookBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('Cambridge-style unit pacing guide extracts weekly outcomes', () => {
  const buffer = workbookBuffer({
    Overview: [
      ['WK', 'Dates', 'Notes', 'Unit/ Topic'],
      [1, '17 Aug', '', 'Unit 1: Danger!'],
      [2, '24 Aug', '', 'Unit 1: Danger!'],
      [3, '31 Aug', '', 'Unit 1: Danger!'],
    ],
    'Unit 1 Danger!': [
      [''],
      ['Unit ', 'Strand', 'Unit 1 Learning Objectives ', 'Unit 1 Week 1 Learning Outcomes ', 'Week 1 Resources', 'Unit 1 Week 2 Learning Outcomes ', 'Week 2 Resources '],
      ['Unit 1 Danger!', 'Reading: Word Structure', '3Rw.02 Read words with apostrophes. 3Rv.01 Deduce meanings from context.', '-Read words with apostrophes -Use context clues', 'Book p. 1; Slides 1A', '-Deduce meanings from context -Record interesting words', 'Book p. 2'],
      ['', 'Writing: Grammar', '3Wg.03 Use speech marks correctly.', '-Punctuate direct speech', '', '-Write sentences using speech marks', 'Workbook p. 3'],
    ],
  });

  const parsed = planningSource.parseExcelSource(buffer, 'Stage 3 Pacing Guide.xlsx');

  assert.equal(parsed.subject, 'English');
  assert.deepEqual(parsed.gradesFound, ['Grade 3']);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].weekNumber, 1);
  assert.equal(parsed.items[0].unitTitle, 'Danger!');
  assert.equal(parsed.items[0].learningObjectives.length, 3);
  assert.equal(parsed.items[0].learningObjectives[0].text, 'Read words with apostrophes');
  assert.equal(parsed.items[0].successCriteria[0], '3Rw.02 Read words with apostrophes.');
  assert.deepEqual(parsed.items[0].resources, ['Book p. 1', 'Slides 1A']);
  assert.equal(parsed.items[1].weekNumber, 2);
  assert.equal(parsed.items[1].learningObjectives[1].text, 'Record interesting words');
});
