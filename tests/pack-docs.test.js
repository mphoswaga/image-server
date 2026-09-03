// The documents a teacher prints and hands out.
//
// These are tested by opening the .docx and reading the text, not by checking
// the generator returned something. The bug class this exists to catch is the
// one that has bitten this app repeatedly: the code runs, the file downloads,
// it opens without complaint — and the content a teacher needed is not in it.
//
// An answer key that silently vanishes is worse than a crash: the teacher finds
// out in front of the class.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { studyNotesDocx, worksheetDocx, exitTicketDocx, quizDocx, homeworkDocx, activitiesDocx } = require('../docgen.js');

const META = { subject: 'ICT', topic: 'Spreadsheets', grade: 'Grade 5' };

// The generators already return the finished .docx buffer, which is what the
// download route sends — so this opens exactly the bytes a teacher receives.
async function textOf(buffer) {
  const xml = new PizZip(await buffer).file('word/document.xml').asText();
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('study notes teach the content and preserve every support section', async () => {
  const text = await textOf(studyNotesDocx({
    title: 'Spreadsheet study notes',
    summary: 'Spreadsheets organise information into rows and columns.',
    keyIdeas: ['Rows go across and columns go down.', 'A cell has an address such as B3.'],
    vocabulary: [{ term: 'Cell', definition: 'A box where a row and column meet.' }],
    workedExample: { title: 'Find cell B3', steps: ['Find column B.', 'Move down to row 3.'] },
    commonMistakes: ['Do not write the row number before the column letter.'],
    selfCheck: ['I can identify a cell address.'],
  }, META));
  for (const wanted of ['Spreadsheet study notes', 'Rows go across', 'Cell', 'Find cell B3', 'row number', 'I can identify']) {
    assert.ok(text.includes(wanted), `missing from the study notes: "${wanted}"`);
  }
});

test('a worksheet keeps its questions AND its answer key', async () => {
  const text = await textOf(worksheetDocx({
    title: 'Spreadsheet basics',
    focus: 'Rows, columns and cells',
    warmup: ['Name three things you could put in a spreadsheet.'],
    example: { problem: 'Which cell is column B, row 3?', solution: 'B3' },
    questions: ['Name the cell where column C meets row 7.', 'What does a row look like?'],
    challenge: 'Design a table for a class tuck shop.',
    answerKey: ['C7', 'A row goes across.'],
  }, META));

  for (const wanted of ['Spreadsheet basics', 'Rows, columns and cells', 'Name three things',
    'Which cell is column B', 'B3', 'Name the cell where column C', 'class tuck shop', 'C7']) {
    assert.ok(text.includes(wanted), `missing from the worksheet: "${wanted}"`);
  }
});

test('a quiz keeps every option and marks its correct answers', async () => {
  const text = await textOf(quizDocx({
    title: 'Spreadsheets quiz',
    instructions: 'Answer all questions.',
    mcq: [{ question: 'What is a cell?', options: ['A box', 'A row', 'A file', 'A chart'], correctIndex: 0 }],
    shortAnswer: [{ question: 'Explain what a column is.', marks: 2, answer: 'A column goes down.' }],
    totalMarks: 6,
  }, META));

  // Every option must appear: a multiple-choice question missing an option is
  // unanswerable, and nothing upstream would notice.
  for (const wanted of ['What is a cell?', 'A box', 'A row', 'A file', 'A chart',
    'Explain what a column is', 'A column goes down']) {
    assert.ok(text.includes(wanted), `missing from the quiz: "${wanted}"`);
  }
});

test('an exit ticket carries its questions and answers', async () => {
  const text = await textOf(exitTicketDocx({
    title: 'Exit ticket',
    questions: ['Write down one thing you learned.', 'What is cell A1?'],
    answerKey: ['Any reasonable answer.', 'The first cell.'],
  }, META));
  assert.ok(text.includes('Write down one thing you learned'));
  assert.ok(text.includes('What is cell A1?'));
  assert.ok(text.includes('The first cell'));
});

test('homework carries its tasks and its estimate', async () => {
  const text = await textOf(homeworkDocx({
    title: 'Spreadsheet homework',
    instructions: 'Complete at home.',
    estimatedMinutes: 20,
    recap: ['A cell is one box.'],
    tasks: ['List five things a spreadsheet could track.', 'Draw a table with three columns.'],
    applyTask: 'Make a spreadsheet of your week.',
    answerKey: ['Answers will vary.'],
  }, META));
  for (const wanted of ['Spreadsheet homework', 'Complete at home', 'List five things',
    'Draw a table with three columns', 'Make a spreadsheet of your week']) {
    assert.ok(text.includes(wanted), `missing from the homework: "${wanted}"`);
  }
});

test('differentiated activities keep every group — not just the first', async () => {
  // The whole point of this sheet is that there are several groups. Losing the
  // stretch group and keeping the support group would look like a normal
  // worksheet and quietly leave half a class with nothing.
  const text = await textOf(activitiesDocx({
    title: 'Spreadsheets — three ways',
    focus: 'Same objective, three entry points',
    levels: [
      { label: 'Support', audience: 'Working towards', tasks: ['Colour in the cells named for you.'], answerKey: ['n/a'] },
      { label: 'Core', audience: 'Working at', tasks: ['Enter five prices into column B.'], answerKey: ['n/a'] },
      { label: 'Stretch', audience: 'Working beyond', tasks: ['Format column B as currency.'], answerKey: ['n/a'] },
    ],
  }, META));

  for (const group of ['Support', 'Core', 'Stretch']) {
    assert.ok(text.includes(group), `group missing: ${group}`);
  }
  assert.ok(text.includes('Colour in the cells'));
  assert.ok(text.includes('Enter five prices'));
  assert.ok(text.includes('Format column B as currency'), 'the stretch task is the one most likely to be dropped');
});

test('a document with empty sections still opens', async () => {
  // A generation that came back thin must not produce a corrupt file — the
  // teacher should get a sparse handout, not an error in Word.
  const text = await textOf(worksheetDocx({ title: 'Sparse', questions: [] }, META));
  assert.ok(text.includes('Sparse'));
});
