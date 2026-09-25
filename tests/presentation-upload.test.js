const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { requirePresentationUpload, validateUpload, PRESENTATION_LIMITS } = require('../upload-security');
const { extractPptxSlides } = require('../template');

test('media-heavy PowerPoint over 15 MB passes validation and extracts learning text', async () => {
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', '<a:p><a:t>Habitats</a:t></a:p><a:p><a:t>Where animals live</a:t></a:p>');
  zip.file('ppt/media/image1.png', Buffer.alloc(16 * 1024 * 1024, 1));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const file = { originalname: 'lesson.PPTX', buffer };
  assert.throws(() => validateUpload(file, 'slides'), /15 MB/);
  for (const group of ['slides', 'game']) {
    let accepted = false;
    requirePresentationUpload(group)({ file }, { status: () => ({ json: body => assert.fail(body.error) }) }, () => { accepted = true; });
    assert.ok(accepted);
  }
  assert.deepEqual(await extractPptxSlides(buffer), [{ title: 'Habitats', bullets: ['Where animals live'] }]);
  assert.throws(() => validateUpload({ originalname: 'lesson.pptx', buffer: Buffer.alloc(PRESENTATION_LIMITS.maxBytes + 1) }, 'slides', PRESENTATION_LIMITS), /50 MB/);
});

test('larger presentation allowance keeps other file and archive checks', async () => {
  let error;
  requirePresentationUpload('game')({ file: { originalname: 'lesson.txt', buffer: Buffer.alloc(16 * 1024 * 1024, 65) } }, { status: () => ({ json: body => { error = body.error; } }) }, () => assert.fail('Oversized text accepted'));
  assert.match(error, /15 MB/);
  assert.throws(() => validateUpload({ originalname: 'lesson.pptx', buffer: Buffer.from('not an office file') }, 'slides', PRESENTATION_LIMITS), /do not match/);
  const zip = new JSZip(); zip.file('ppt/slides/slide1.xml', 'small');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt32LE(PRESENTATION_LIMITS.maxExpandedBytes + 1, central + 24);
  assert.throws(() => validateUpload({ originalname: 'lesson.pptx', buffer }, 'slides', PRESENTATION_LIMITS), /safe processing limit/);
});
