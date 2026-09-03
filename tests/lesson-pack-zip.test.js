// The full lesson pack: six student resources as one download.
//
// A zip is the easiest artifact to get quietly wrong, because a zip missing one
// of its members still downloads, still opens, and looks completely normal. The
// teacher discovers it when they go to use that resource and it was never
// in there — in front of a class.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { lessonPackZip, worksheetDocx, PACK_MEMBERS } = require('../docgen.js');

const part = (name) => Buffer.from(`pretend ${name} docx`);
const ALL = {
  studyNotes: part('study notes'),
  worksheet: part('worksheet'),
  exitTicket: part('exit ticket'),
  quiz: part('quiz'),
  homework: part('homework'),
  activities: part('activities'),
};

const namesIn = (buffer) => Object.keys(new PizZip(buffer).files).sort();

test('all six student resources are in the pack, named for what they are', () => {
  // The teacher unzips this beside four other lessons' worth of files, so
  // "document1.docx" would be useless.
  assert.deepEqual(namesIn(lessonPackZip('Spreadsheets', ALL)), [
    'Spreadsheets-differentiated-activities.docx',
    'Spreadsheets-exit-ticket.docx',
    'Spreadsheets-homework.docx',
    'Spreadsheets-quiz.docx',
    'Spreadsheets-study-notes.docx',
    'Spreadsheets-worksheet.docx',
  ]);
});

test('a pack missing a handout fails loudly instead of shipping short', () => {
  // Every resource, because it is the one that goes missing that matters
  // and there is no reason to think it will always be the same one.
  for (const [key, label] of PACK_MEMBERS) {
    const short = { ...ALL };
    delete short[key];
    assert.throws(
      () => lessonPackZip('Spreadsheets', short),
      new RegExp(label),
      `dropping ${label} produced a pack instead of an error`,
    );
  }
});

test('an empty buffer counts as missing, not as an empty handout', () => {
  // A generator that returned nothing must not become a 0-byte file that Word
  // refuses to open.
  assert.throws(() => lessonPackZip('x', { ...ALL, quiz: Buffer.alloc(0) }), /quiz/);
});

test('the contents survive the round trip byte for byte', async () => {
  // A real .docx this time: the zip must not mangle what it stores.
  const real = await worksheetDocx({ title: 'Round trip', questions: ['Is this intact?'] }, { subject: 'ICT' });
  const packed = lessonPackZip('trip', { ...ALL, worksheet: real });
  const back = new PizZip(packed).file('trip-worksheet.docx').asNodeBuffer();
  assert.deepEqual(back, real, 'the worksheet came back different from how it went in');

  // And it is still a readable .docx after being unpacked.
  const text = new PizZip(back).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ');
  assert.match(text, /Is this intact\?/);
});

test('an awkward topic name still produces sane filenames', () => {
  // Teachers type things like "Fractions: ½ & ¼ (part 2)".
  const names = namesIn(lessonPackZip('Fractions: ½ & ¼ (part 2)', ALL));
  for (const name of names) {
    assert.match(name, /^[A-Za-z0-9-]+\.docx$/, `unsafe filename: ${name}`);
  }
  assert.ok(names.every(n => n.startsWith('Fractions-')), names.join(', '));
});

test('a topic of nothing but punctuation still names the files', () => {
  const names = namesIn(lessonPackZip('???', ALL));
  assert.ok(names.every(n => n.startsWith('lesson-')), names.join(', '));
});
