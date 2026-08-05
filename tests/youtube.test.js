const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId, normalizeVideoId, normalizeVideo, embedUrl, searchQuery, lessonTerms, relevance, isoDurationToSeconds, suggestVideos, thumbnailDataUrl } = require('../youtube');

test('YouTube parser accepts common video URL formats', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}?si=example`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube-nocookie.com/embed/${id}`), id);
  assert.equal(normalizeVideoId(id), id);
});

test('YouTube parser rejects non-YouTube and malformed links', () => {
  assert.equal(extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractVideoId('not a url'), null);
  assert.equal(normalizeVideoId('short'), null);
});

test('normalized video stores safe canonical and embed URLs', () => {
  const video = normalizeVideo('https://youtu.be/dQw4w9WgXcQ', { title: ' Fractions  ', startSeconds: 12 });
  assert.equal(video.videoId, 'dQw4w9WgXcQ');
  assert.equal(video.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(video.embedUrl, embedUrl('dQw4w9WgXcQ', 12));
  assert.equal(video.title, 'Fractions');
});

test('suggestion query includes teaching context without exposing student data', () => {
  const q = searchQuery({ subject: 'science', topic: 'water-cycle', grade: 'Grade 5', title: 'The Water Cycle', bullets: ['Evaporation turns water into vapour.'] });
  assert.match(q, /science/);
  assert.match(q, /water/);
  assert.match(q, /Grade 5/);
  assert.doesNotMatch(q, /-/); // slugs are de-hyphenated before searching
});

test('search terms come from what the slide teaches, not the internal topic slug', () => {
  // A themed lesson name is meaningful in LessonScope and invisible on YouTube;
  // the bullets name the concepts a video should actually be about.
  const terms = lessonTerms({
    topic: 'data-cafe',
    title: 'I Do: Introduction to Spreadsheets',
    bullets: ['Row — a horizontal line of cells in a spreadsheet.', 'Column — a vertical line of cells in a spreadsheet.'],
  });
  assert.ok(terms.includes('spreadsheet'), `expected 'spreadsheet' in ${JSON.stringify(terms)}`);
  assert.ok(terms.includes('cells'), `expected 'cells' in ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes('cafe'), 'themed topic name should not drive the search');
  // Teaching-model jargon must never become a search term.
  assert.ok(!terms.some(t => ['introduction', 'reflect', 'lesson', 'today'].includes(t)), JSON.stringify(terms));
});

test('lesson terms fall back to the topic when the slide has no usable content', () => {
  assert.deepEqual(lessonTerms({ topic: 'photosynthesis', title: '', bullets: [] }), ['photosynthesis']);
});

test('relevance is measured against the lesson, not assumed', () => {
  const terms = ['spreadsheet', 'cells', 'rows'];
  const good = relevance({ title: 'Spreadsheet basics: rows, columns and cells', description: '' }, terms);
  assert.equal(good.score, 1);
  assert.deepEqual(good.hits, terms);
  const bad = relevance({ title: 'WHY I HATE MATH #Shorts', description: 'funny skit' }, terms);
  assert.equal(bad.score, 0);
  assert.deepEqual(bad.hits, []);
});

test('Shorts and over-long videos are excluded by duration', () => {
  assert.equal(isoDurationToSeconds('PT5S'), 5);
  assert.equal(isoDurationToSeconds('PT4M13S'), 253);
  assert.equal(isoDurationToSeconds('PT1H2M'), 3720);
  assert.equal(isoDurationToSeconds('garbage'), 0);
});

test('suggestions fail safely when the YouTube API is not configured', async () => {
  const previous = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    const result = await suggestVideos({ subject: 'science', topic: 'water cycle' });
    assert.deepEqual(result, { suggestions: [], configured: false, message: 'YouTube suggestions are not configured yet.' });
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previous;
  }
});

test('thumbnailDataUrl stores a small thumbnail as a data URL', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: new Map([['content-type', 'image/jpeg']]),
    arrayBuffer: async () => Buffer.from('fake-jpeg'),
  });
  try {
    const data = await thumbnailDataUrl(normalizeVideo('https://youtu.be/dQw4w9WgXcQ'));
    assert.equal(data, `data:image/jpeg;base64,${Buffer.from('fake-jpeg').toString('base64')}`);
  } finally {
    global.fetch = oldFetch;
  }
});
