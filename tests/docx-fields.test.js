// Reading a Word lesson-plan template's field names.
//
// The failure this prevents: a school form arrives with a worked example
// already filled in — a whole week of somebody else's lesson. Sent whole to the
// model, that example is imitated rather than filled, so the plan comes back as
// a generic Starter / Main Activities / Plenary. Those headings match nothing in
// the real document, so the download is the template, untouched.
//
// Sending the field NAMES alone is what makes the plan come back in the
// teacher's own fields, which is what makes filling possible at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { docxFieldLabels, docxTemplateText, cleanLabel } = require('../docx-fields.js');

function docx(bodyXml) {
  const zip = new PizZip();
  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>`
    + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' });
}
const para = (text, bold) =>
  `<w:p>${bold ? '<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>' : ''}<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${text}</w:t></w:r></w:p>`;
const cell = (inner) => `<w:tc>${inner}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;
const table = (...rows) => `<w:tbl>${rows.join('')}</w:tbl>`;

// Modelled on a real school weekly form: label column on the left, a worked
// example already filled in on the right, decorative emoji in the labels.
const SCHOOL_FORM = docx(table(
  row(cell(para('Topic (s):')), cell(para('Data Café (C3.4)'))),
  row(cell(para('Newsletter')), cell(para('Students will revisit their previously created cake sales spreadsheets and develop their understanding of spreadsheet structure.'))),
  row(cell(para('Periods')), cell(para('Period 1 & 2'))),
  row(cell(para('Learning Objectives 🎯')), cell(para('3MD.04 Know that spreadsheets are comprised of rows and columns.') + para('3MD.05 Know how to format cells according to their purpose.'))),
  row(cell(para('Success Criteria ✅')), cell(para('I can identify that a spreadsheet is like a table.') + para('I can format a cell to show the date correctly.'))),
  row(cell(para('Resources')), cell(para('Desktop computers'))),
));

test("a school form's labels are read, and its worked example is not", () => {
  const labels = docxFieldLabels(SCHOOL_FORM);
  assert.deepEqual(labels, ['Topic (s)', 'Newsletter', 'Periods', 'Learning Objectives', 'Success Criteria', 'Resources']);

  const prompt = docxTemplateText(SCHOOL_FORM);
  // The point of the whole module: none of the previous lesson comes through.
  assert.doesNotMatch(prompt, /Data Café/);
  assert.doesNotMatch(prompt, /3MD\.04/);
  assert.doesNotMatch(prompt, /cake sales/);
  assert.doesNotMatch(prompt, /Desktop computers/);
  assert.match(prompt, /^Topic \(s\):$/m);
  assert.match(prompt, /^Success Criteria:$/m);
});

test('decoration and trailing colons are not part of a field name', () => {
  // "Learning Objectives 🎯" and "Learning Objectives" are the same row, and the
  // heading the plan comes back with has to match the document's own text.
  assert.equal(cleanLabel('Learning Objectives 🎯'), 'Learning Objectives');
  assert.equal(cleanLabel('Topic (s):'), 'Topic (s)');
  assert.equal(cleanLabel('  Success   Criteria ✅ '), 'Success Criteria');
});

test('a flowing document with bold headings is read too', () => {
  const flowing = docx([
    para('Lesson Plan', true),
    para('Learning Objectives', true), para('Students will…'),
    para('Starter', true), para(''),
    para('Main Teaching', true), para(''),
    para('Plenary', true), para(''),
  ].join(''));
  const labels = docxFieldLabels(flowing);
  for (const wanted of ['Learning Objectives', 'Starter', 'Main Teaching', 'Plenary']) {
    assert.ok(labels.includes(wanted), `missed "${wanted}"`);
  }
});

test('lesson content is never mistaken for a field name', () => {
  const wordy = docx(table(
    row(cell(para('Learning Objectives')), cell(para('x'))),
    row(cell(para('Students will revisit their previously created cake sales spreadsheets and develop their understanding of spreadsheet structure, then apply formatting to different types of data.')), cell(para('y'))),
    row(cell(para('This is a full sentence.')), cell(para('z'))),
  ));
  const labels = docxFieldLabels(wordy);
  assert.ok(labels.includes('Learning Objectives'));
  assert.ok(!labels.some((l) => l.includes('cake sales')), 'a paragraph is not a label');
  assert.ok(!labels.includes('This is a full sentence.'), 'a sentence is not a label');
});

test('a document that is not a form falls back rather than inventing fields', () => {
  // A letterhead or policy document would yield a stray label or two. Mirroring
  // those would be worse than using the extracted text as before.
  const notAForm = docx([para('Vinschool', true), para('Some prose about the school.')].join(''));
  assert.equal(docxTemplateText(notAForm), '', 'below four labels, the caller falls back');
});

test('the same label twice is listed once', () => {
  const repeated = docx(table(
    row(cell(para('Resources')), cell(para('a'))),
    row(cell(para('Resources')), cell(para('b'))),
    row(cell(para('Assessment')), cell(para('c'))),
    row(cell(para('Plenary')), cell(para('d'))),
    row(cell(para('Starter')), cell(para('e'))),
  ));
  const labels = docxFieldLabels(repeated);
  assert.equal(labels.filter((l) => l === 'Resources').length, 1);
});
