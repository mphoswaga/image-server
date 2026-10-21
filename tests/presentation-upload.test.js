const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { requirePresentationUpload, validateUpload, PRESENTATION_LIMITS } = require('../upload-security');
const { extractPptxSlides } = require('../template');

test('media-heavy PowerPoint over the old 50 MB limit passes validation and extracts learning text', async () => {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', '<a:p><a:t>Habitats</a:t></a:p><a:p><a:t>Where animals live</a:t></a:p>');
  zip.file('ppt/media/image1.png', Buffer.alloc(51 * 1024 * 1024, 1));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE'});
  const file = { originalname: 'lesson.PPTX', buffer };
  assert.throws(() => validateUpload(file, 'slides'), /15 MB/);
  for (const group of ['slides', 'game']) {
    let accepted = false;
    requirePresentationUpload(group)({ file }, { status: () => ({ json: body => assert.fail(body.error) }) }, () => { accepted = true;});
    assert.ok(accepted);
  }
  assert.deepEqual(await extractPptxSlides(buffer), [{ title: 'Habitats', bullets: ['Where animals live'] }]);
  assert.throws(() => validateUpload({ originalname: 'lesson.pptx', buffer: Buffer.alloc(PRESENTATION_LIMITS.maxBytes + 1) }, 'slides', PRESENTATION_LIMITS), /150 MB/);
});

test('larger presentation allowance keeps other file and archive checks', async () => {
  let error;
  requirePresentationUpload('game')({ file: { originalname: 'lesson.txt', buffer: Buffer.alloc(16 * 1024 * 1024, 65) } }, { status: () => ({ json: body => { error = body.error; } }) }, () => assert.fail('Oversized text accepted'));
  assert.match(error, /15 MB/);
  assert.throws(() => validateUpload({ originalname: 'lesson.pptx', buffer: Buffer.from('not an office file') }, 'slides', PRESENTATION_LIMITS), /do not match/);
  const zip = new JSZip(); zip.file('ppt/slides/slide1.xml', 'small');
  const buffer = await zip.generateAsync({ type: 'nodebuffer'});
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt32LE(PRESENTATION_LIMITS.maxExpandedBytes + 1, central + 24);
  assert.throws(() => validateUpload({ originalname: 'lesson.pptx', buffer }, 'slides', PRESENTATION_LIMITS), /safe processing limit/);
});

test('presentation size boundary is 150 MB per file', async () => {
  assert.equal(PRESENTATION_LIMITS.maxBytes, 150 * 1024 * 1024);
  const zip = new JSZip(); zip.file('ppt/slides/slide1.xml', '<a:t>Boundary</a:t>');
  zip.file('ppt/media/padding.bin', Buffer.alloc(0));
  const empty = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE'});
  zip.file('ppt/media/padding.bin', Buffer.alloc(PRESENTATION_LIMITS.maxBytes - empty.length));
  const exact = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE'});
  assert.equal(exact.length, PRESENTATION_LIMITS.maxBytes);
  assert.doesNotThrow(() => validateUpload({ originalname: 'boundary.pptx', buffer: exact }, 'slides', PRESENTATION_LIMITS));
});
