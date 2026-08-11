// Pictures actually reaching the downloaded .pptx.
//
// The failure this exists to catch is silent, which is what made it survive:
// pptxgenjs rejects a malformed image argument by logging to the server console
// and carrying on, so the deck builds, downloads, opens — and has no picture in
// it. The web preview reads the same library directly, so the slide still looks
// right on screen and only the real file is empty.
//
// Nothing short of opening the .pptx and looking for the media part catches it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const PizZip = require('pizzip');

const { rebuildDeck } = require('../generate.js');
const { mediaWriteDir, MEDIA_DIR } = require('../media.js');

// Smallest valid files of each kind — enough for pptxgenjs to embed.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const FOLDER = 'decktest';
function seed() {
  const dir = mediaWriteDir(FOLDER, 'media');
  fs.writeFileSync(path.join(dir, 'photo.png'), PNG);
  fs.writeFileSync(path.join(dir, 'clip.gif'), GIF);
}
function cleanup() {
  fs.rmSync(path.join(MEDIA_DIR, FOLDER), { recursive: true, force: true });
}

async function mediaPartsFor(relpath, presetId) {
  const pptx = rebuildDeck({
    slides: [{ type: 'content', title: 'A slide', bullets: ['one', 'two', 'three'] }],
    images: [{ relpath }],
    grade: 'Grade 5',
    presetId,
  });
  const file = path.join(os.tmpdir(), `deck-images-${process.pid}.pptx`);
  await pptx.writeFile({ fileName: file });
  const parts = Object.keys(new PizZip(fs.readFileSync(file)).files)
    .filter(f => f.startsWith('ppt/media/') && !f.endsWith('/'));
  fs.unlinkSync(file);
  return parts;
}

test('a chosen photo reaches the downloaded deck', async () => {
  seed();
  try {
    // Every layout that places a picture, because the bug lived in the shared
    // helper they all call and would have come back for any one of them.
    for (const preset of ['ocean-classic', 'ruby-sidebar', 'navy-banner', 'teal-split']) {
      const parts = await mediaPartsFor(`${FOLDER}/media/photo.png`, preset);
      assert.ok(parts.length, `${preset}: the deck has no image in it at all`);
      assert.ok(parts.some(p => p.endsWith('.png')), `${preset}: expected a png, got ${parts.join(', ')}`);
    }
  } finally { cleanup(); }
});

test('an animated GIF reaches the deck as a GIF', async () => {
  // The extension has to survive: PowerPoint and Google Slides animate a .gif,
  // and would show a still frame if it arrived renamed.
  seed();
  try {
    const parts = await mediaPartsFor(`${FOLDER}/media/clip.gif`, 'ocean-classic');
    assert.ok(parts.some(p => p.endsWith('.gif')), `expected a gif, got ${parts.join(', ') || 'nothing'}`);
  } finally { cleanup(); }
});

test('a slide with no image still builds', async () => {
  const parts = await mediaPartsFor('does/not/exist.png', 'ocean-classic');
  assert.deepEqual(parts, [], 'a missing image is not an error, just no picture');
});
