const test = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId, normalizeVideoId, normalizeVideo, embedUrl, searchQuery, suggestVideos } = require('../youtube');

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
  assert.equal(searchQuery({ subject: 'science', topic: 'water cycle', grade: 'Grade 5', stage: 'Explore' }), 'science water cycle Grade 5 Explore educational lesson');
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
