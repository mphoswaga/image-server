const test = require('node:test');
const assert = require('node:assert/strict');
const { paginateSlides, rebuildDeck } = require('../generate');
const { gradeProfile } = require('../grade');

const denseBullets = [
  'Computational thinking is a structured way to solve problems by breaking them into smaller pieces and checking each step carefully.',
  'Decomposition means splitting one big task into smaller tasks that are easier to understand, explain, test, and improve.',
  'Pattern recognition helps learners notice repeated ideas, repeated actions, and repeated mistakes so they can reuse good solutions.',
  'Abstraction means focusing on the important information and hiding details that are not needed for the current problem.',
  'Algorithms are clear ordered instructions that someone else can follow to solve the same problem in the same way.',
  'Debugging is the process of finding errors, testing possible fixes, and improving the instructions until the result works.',
];

test('dense content slides are split into continuation pages', () => {
  const theme = gradeProfile('Grade 5').theme;
  const slides = [{
    type: 'content',
    title: 'What is Computational Thinking?',
    bullets: denseBullets,
    example: 'Following a recipe is an algorithm because each instruction happens in a clear order.',
    imageQuery: 'computational thinking classroom',
  }];

  const pages = paginateSlides(slides, theme, null);
  assert.ok(pages.length > 1);
  assert.equal(pages[0].title, 'What is Computational Thinking?');
  assert.match(pages[1].title, /\(continued\)$/);
  assert.equal(pages[1].layoutHint, 'TEXT_HEAVY');
  assert.equal(pages[0]._sourceIndex, 0);
  assert.equal(pages[1]._sourceIndex, 0);
});

test('pagination can still assemble a valid pptx buffer', async () => {
  const pptx = rebuildDeck({
    grade: 'Grade 5',
    slides: [{
      type: 'content',
      title: 'A Very Detailed Slide',
      bullets: denseBullets,
      example: 'The app should create another slide instead of letting the text spill out.',
      imageQuery: 'teacher explaining a lesson',
      youtube: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Computational thinking video',
        channelTitle: 'Teacher channel',
        thumbnailData: `data:image/png;base64,${Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lS0uVwAAAABJRU5ErkJggg==',
          'base64'
        ).toString('base64')}`,
      },
    }],
    images: [null],
  });
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  assert.ok(buffer.length > 10_000);
});
