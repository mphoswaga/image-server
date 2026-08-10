// Filling a teacher's own Word template with the generated lesson.
//
// School forms come in more than one shape, and the app only understood one of
// them: a two-column label|value table. A plain document — headings with space
// beneath, which is just as common — matched nothing, so every section was
// skipped and the teacher got their template back byte-for-byte, exactly as if
// the lesson had been ignored.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { fillDocx } = require('../fill-template.js');

// A minimal but genuine .docx: PizZip reads it, and fillDocx only ever touches
// word/document.xml, so this exercises the real code path.
function docx(bodyXml) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
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

const textOf = (buffer) => {
  const xml = new PizZip(buffer).file('word/document.xml').asText();
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
};

const SECTIONS = [
  { heading: 'Learning Objectives', content: 'Identify binary as a decision-making system.\nExplain how computers use 0s and 1s.' },
  { heading: 'Starter', content: 'Show a light switch and ask what states it has.' },
  { heading: 'Main Teaching', content: 'Model a binary question.\nDefine bits and bytes.' },
  { heading: 'Plenary', content: 'Exit ticket: write your name in binary.' },
];

test('a plain document — headings with space beneath — gets filled', () => {
  // This is the shape that produced an untouched download.
  const template = docx([
    para('Lesson Plan', true),
    para('Learning Objectives', true), para(''),
    para('Starter', true), para(''),
    para('Main Teaching', true), para(''),
    para('Plenary', true), para(''),
  ].join(''));

  const out = fillDocx(template, SECTIONS);
  assert.equal(out.filled, 4, 'every section should find its heading');
  assert.deepEqual(out.skipped, []);

  const text = textOf(out.buffer);
  assert.match(text, /Identify binary as a decision-making system/);
  assert.match(text, /Show a light switch/);
  assert.match(text, /Define bits and bytes/);
  assert.match(text, /write your name in binary/);
  assert.match(text, /Learning Objectives/, 'the template\'s own headings survive');
});

test('content lands under its own heading, not somewhere else', () => {
  const template = docx([para('Starter', true), para(''), para('Plenary', true), para('')].join(''));
  const out = fillDocx(template, [
    { heading: 'Starter', content: 'STARTER-CONTENT' },
    { heading: 'Plenary', content: 'PLENARY-CONTENT' },
  ]);
  const text = textOf(out.buffer);
  assert.ok(text.indexOf('Starter') < text.indexOf('STARTER-CONTENT'), 'starter content follows its heading');
  assert.ok(text.indexOf('STARTER-CONTENT') < text.indexOf('Plenary'), 'and stops before the next heading');
  assert.ok(text.indexOf('Plenary') < text.indexOf('PLENARY-CONTENT'));
});

test('the two-column table template still works', () => {
  // The shape that already worked must not regress.
  const template = docx(table(
    row(cell(para('Learning Objectives')), cell(para('example text'))),
    row(cell(para('Starter')), cell(para('example text'))),
  ));
  const out = fillDocx(template, SECTIONS);
  assert.ok(out.filled >= 2);
  const text = textOf(out.buffer);
  assert.match(text, /Identify binary as a decision-making system/);
  assert.doesNotMatch(text, /example text/, 'the example content is replaced, not appended to');
});

test('a stacked table — heading and answer in one cell — gets filled', () => {
  const template = docx(table(
    row(cell(para('Learning Objectives', true) + para(''))),
    row(cell(para('Starter', true) + para(''))),
  ));
  const out = fillDocx(template, SECTIONS);
  assert.ok(out.filled >= 2, 'a one-column form is still a form');
  assert.match(textOf(out.buffer), /Identify binary as a decision-making system/);
});

test('a template that matches nothing reports it rather than looking filled', () => {
  // The caller refuses to send a file on filled === 0; that decision depends on
  // this count being honest.
  const template = docx([para('Attendance Register', true), para('Signature', true)].join(''));
  const out = fillDocx(template, SECTIONS);
  assert.equal(out.filled, 0);
  assert.equal(out.total, 4);
  assert.deepEqual(out.skipped.sort(), ['Learning Objectives', 'Main Teaching', 'Plenary', 'Starter']);
});

test('empty sections are not counted as filled', () => {
  const template = docx([para('Starter', true), para('')].join(''));
  const out = fillDocx(template, [{ heading: 'Starter', content: '   ' }]);
  assert.equal(out.filled, 0, 'a blank section fills nothing');
});

test('markdown and inline numbering are cleaned up on the way in', () => {
  const template = docx([para('Main Teaching', true), para('')].join(''));
  const out = fillDocx(template, [{ heading: 'Main Teaching', content: '**Bold idea** 1. First step 2. Second step' }]);
  const text = textOf(out.buffer);
  assert.doesNotMatch(text, /\*\*/, 'no markdown asterisks reach the teacher\'s form');
  assert.match(text, /First step/);
  assert.match(text, /Second step/);
});
