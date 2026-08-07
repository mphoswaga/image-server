// Layout rhythm: consecutive slides in one deck use different layouts.
//
// A deck used to render every content slide in the preset's single layout, so
// ten slides in a row were the same shape. The rule that makes this safe is
// that the layout is chosen BEFORE pagination — bullets are split to fit a
// specific box, so deciding the layout afterwards would fit text to one box and
// draw it in another.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paginateSlides, layoutForSlide } = require('../generate.js');
const { getPreset, rhythmFor, PRESETS } = require('../slide-presets.js');
const { gradeProfile } = require('../grade.js');

const THEME = gradeProfile('Grade 5').theme;
const content = (title, n = 3) => ({
  type: 'content', title, bullets: Array.from({ length: n }, (_, i) => `${title} point ${i + 1}`),
});

test('every preset keeps its own layout as the deck opener', () => {
  for (const preset of PRESETS) {
    const rhythm = rhythmFor(preset);
    assert.equal(rhythm[0], preset.layout, `${preset.id} should still open as ${preset.layout}`);
    assert.equal(rhythm.length, 3, `${preset.id} should cycle three layouts`);
    assert.equal(new Set(rhythm).size, 3, `${preset.id} repeats a layout`);
  }
});

test('consecutive teaching slides do not share a layout', () => {
  const preset = getPreset('ocean-classic');
  const pages = paginateSlides([
    { type: 'title', title: 'Using the Mouse', bullets: [] },
    content('Parts of a mouse'), content('Clicking'), content('Dragging'), content('Double-click'),
  ], THEME, preset);

  const teaching = pages.filter(p => p.type === 'content');
  assert.equal(teaching.length, 4);
  for (let i = 1; i < teaching.length; i++) {
    assert.notEqual(teaching[i]._layout, teaching[i - 1]._layout,
      `slides ${i - 1} and ${i} are both ${teaching[i]._layout}`);
  }
});

test('the title slide does not consume a beat, so teaching opens in the preset layout', () => {
  const preset = getPreset('ocean-classic');
  const pages = paginateSlides([
    { type: 'title', title: 'Lesson', bullets: [] },
    content('First teaching slide'),
  ], THEME, preset);
  assert.equal(pages.find(p => p.type === 'content')._layout, preset.layout);
});

test('the rhythm is positional — how much text a slide has does not move it', () => {
  // Layout choice must not depend on text length. If a dense slide were quietly
  // moved to a roomier layout it would stop being split, and splitting dense
  // slides is deliberate (see slide-pagination.test.js).
  const rhythm = rhythmFor(getPreset('ocean-classic'));
  const long = { type: 'content', title: 'A lot to say', bullets: Array.from({ length: 8 },
    (_, i) => `A fairly long bullet number ${i + 1} that runs well past the end of one line`) };
  assert.equal(layoutForSlide(long, 1, rhythm), rhythm[1]);
  assert.equal(layoutForSlide(content('Short', 2), 1, rhythm), rhythm[1], 'same slot, either way');
});

test('paginating twice does not re-deal the layouts the text was fitted to', () => {
  // assembleDeck paginates again over already-paginated slides. If that second
  // pass re-assigned layouts by position, every split slide would be drawn in a
  // different box from the one its bullets were measured against.
  const preset = getPreset('ocean-classic');
  const source = [
    { type: 'title', title: 'Lesson', bullets: [] },
    content('One'), content('Two'), content('Three'),
  ];
  const first = paginateSlides(source, THEME, preset);
  const second = paginateSlides(first.map(({ _sourceIndex, ...s }) => s), THEME, preset);
  assert.deepEqual(second.map(p => p._layout), first.map(p => p._layout));
});

test('continuation slides stay in their parent layout', () => {
  const preset = getPreset('ocean-classic');
  const wordy = { type: 'content', title: 'Wordy', bullets: Array.from({ length: 14 },
    (_, i) => `Bullet ${i + 1} with a good deal of text on it so the slide has to be split in two`) };
  const pages = paginateSlides([wordy], THEME, preset);
  assert.ok(pages.length > 1, 'this slide should have split');
  assert.equal(new Set(pages.map(p => p._layout)).size, 1, 'a split slide must not change layout mid-way');
});

test('slides that style themselves do not consume a beat', () => {
  // Objectives, activity, recap, check, title and video each have their own
  // render branch and never read the layout. If they advanced the rhythm, an
  // objectives card sitting between two content slides would eat a beat and let
  // those two content slides come out identical.
  const preset = getPreset('ocean-classic');
  const rhythm = rhythmFor(preset);
  const pages = paginateSlides([
    { type: 'title', title: 'Lesson', bullets: [] },
    { type: 'objectives', title: 'Objectives', bullets: ['a', 'b'] },
    content('One'),
    { type: 'activity', title: 'Practice', bullets: ['x', 'y'] },
    content('Two'),
    { type: 'recap', title: 'Recap', bullets: ['p', 'q'] },
    content('Three'),
  ], THEME, preset);

  const teaching = pages.filter(p => p.type === 'content').map(p => p._layout);
  assert.deepEqual(teaching, rhythm, 'content slides should walk the rhythm in order');
});
