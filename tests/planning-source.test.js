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

test('AI-capable parser does not call AI when rules extract strong data', async () => {
  const buffer = workbookBuffer({
    'Grade 4': [
      ['Week', 'Unit', 'Objectives', 'Resources'],
      [1, 'Algorithms', 'Identify inputs and outputs; Create a simple flowchart', 'Worksheet 1'],
    ],
  });

  const parsed = await planningSource.parseExcelSourceWithAi(buffer, 'ICT Grade 4.xlsx');

  assert.equal(parsed.extractionMode, 'rules');
  assert.equal(parsed.subject, 'ICT');
  assert.deepEqual(parsed.gradesFound, ['Grade 4']);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].learningObjectives.length, 2);
});

test('AI-capable parser safely returns weak rule output when no API key is available', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const buffer = workbookBuffer({
      Overview: [
        ['WK', 'Dates', 'Unit/ Topic'],
        [1, '17 Aug', 'Unit 1: Overview only'],
      ],
    });

    const parsed = await planningSource.parseExcelSourceWithAi(buffer, 'Stage 3 Plan.xlsx');

    assert.equal(parsed.extractionMode, 'rules_weak_no_ai');
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].learningObjectives.length, 0);
  } finally {
    if (oldKey) process.env.OPENAI_API_KEY = oldKey;
  }
});

test('WK headers expose every teaching week instead of stopping after week 1', () => {
  const buffer = workbookBuffer({
    'Grade 2': [
      ['WK', 'Dates', 'Notes', 'Unit/ Topic', 'Learning Objectives', 'Success Criteria'],
      [1, '17 Aug', '', 'Number sense', 'Count objects accurately', 'I can count objects'],
      [2, '24 Aug', '', 'Place value', 'Compose two-digit numbers', 'I can compose numbers'],
      [3, '31 Aug', '', 'Comparing', 'Compare and order numbers', 'I can order numbers'],
      [4, '7 Sep', '', 'Patterns', 'Continue number patterns', 'I can continue a pattern'],
    ],
  });

  const parsed = planningSource.parseExcelSource(buffer, 'Maths pacing guide.xlsx');

  assert.deepEqual(parsed.items.map(item => item.weekNumber), [1, 2, 3, 4]);
  assert.equal(parsed.items[3].unitTitle, 'Patterns');
});

test('Topic and Success Criteria columns become usable Global Perspectives objectives', () => {
  const buffer = workbookBuffer({
    'Grade 3': [
      ['Grade 3 Advanced Cambridge Program - Global Perspectives'],
      ['WK', 'Dates', 'Notes', 'Topic / Success Criteria', 'Recommended Activities & Resources'],
      [1, '17 Aug', '', 'Who do I live with? Example Success Criteria (I can...): • I can describe the people I live with. • I can explain how families can be different.', 'Create a family-group poster.'],
      [2, '24 Aug', '', 'Which groups do we belong to? Example Success Criteria (I can...): • I can identify groups in my community. • I can compare different groups.', 'Create a community map.'],
    ],
  });

  const parsed = planningSource.parseExcelSource(buffer, 'Global Perspectives Pacing Guide.xlsx');

  assert.equal(parsed.subject, 'Global Perspectives');
  assert.deepEqual(parsed.items.map(item => item.weekNumber), [1, 2]);
  assert.equal(parsed.items[0].unitTitle, 'Who do I live with?');
  assert.deepEqual(parsed.items[0].successCriteria, [
    'I can describe the people I live with.',
    'I can explain how families can be different.',
  ]);
  assert.deepEqual(parsed.items[0].learningObjectives.map(item => item.text), parsed.items[0].successCriteria);
});

test('AI enrichment can fill gaps without deleting rule-extracted weeks', () => {
  const rules = [1, 2, 3].map(weekNumber => ({
    id: `rule-${weekNumber}`, grade: 'Grade 2', weekNumber,
    unitTitle: `Rule week ${weekNumber}`, learningObjectives: [], successCriteria: [], resources: [],
  }));
  const ai = [{
    id: 'ai-1', grade: 'Grade 2', weekNumber: 1,
    unitTitle: 'AI week 1', learningObjectives: [{ code: null, text: 'Enriched objective' }],
    successCriteria: ['I can show it'], resources: [], extractionConfidence: 0.8,
  }];

  const merged = planningSource.mergeParsedItems(rules, ai);

  assert.deepEqual(merged.map(item => item.weekNumber), [1, 2, 3]);
  assert.equal(merged[0].learningObjectives[0].text, 'Enriched objective');
  assert.equal(merged[1].unitTitle, 'Rule week 2');
});
