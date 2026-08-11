// Animated GIFs from GIPHY.
//
// The rule that matters most in a classroom product: rating=g on every single
// request. The output of this app goes on a projector in front of children, so
// the rating is hardcoded in the module rather than passed in by a caller, and
// this file exists to keep it that way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Intercept axios before giphy.js requires it, so nothing leaves the machine.
const calls = [];
let nextResponse = { data: { data: [] } };
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') {
    return {
      get: async (url, config) => { calls.push({ url, config }); return nextResponse; },
    };
  }
  return realLoad.apply(this, arguments);
};
const { searchGifs, giphyConfigured } = require('../giphy.js');
Module._load = realLoad;

const GIF = {
  id: 'abc123',
  title: 'water cycle GIF',
  url: 'https://giphy.com/gifs/abc123',
  user: { display_name: 'Science Channel' },
  images: {
    downsized_medium: { url: 'https://media.giphy.com/full.gif', width: '480', height: '270' },
    fixed_width_downsampled: { url: 'https://media.giphy.com/preview.gif' },
  },
};

test('every search is rated g — the whole point of the module', async () => {
  process.env.GIPHY_API_KEY = 'test-key';
  calls.length = 0;
  nextResponse = { data: { data: [GIF] } };

  await searchGifs({ query: 'water cycle' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.params.rating, 'g', 'a classroom projector is the audience');
  assert.equal(calls[0].url, 'https://api.giphy.com/v1/gifs/search');
});

test('the rating cannot be weakened by a caller', async () => {
  process.env.GIPHY_API_KEY = 'test-key';
  calls.length = 0;
  // searchGifs takes no rating argument at all; passing one changes nothing.
  await searchGifs({ query: 'x', rating: 'r', limit: 3 });
  assert.equal(calls[0].config.params.rating, 'g');
});

test('a result carries what the picker and the slide both need', async () => {
  process.env.GIPHY_API_KEY = 'test-key';
  nextResponse = { data: { data: [GIF] } };
  const [gif] = await searchGifs({ query: 'water cycle' });

  assert.equal(gif.previewUrl, 'https://media.giphy.com/preview.gif', 'a light preview for the grid');
  assert.equal(gif.url, 'https://media.giphy.com/full.gif', 'and the full GIF for the slide');
  assert.equal(gif.title, 'water cycle', 'the trailing "GIF" is noise in a caption');
  // GIPHY's terms require attribution wherever results appear.
  assert.equal(gif.credit.name, 'Science Channel');
  assert.equal(gif.credit.link, 'https://giphy.com/gifs/abc123');
});

test('a result with no usable image is dropped rather than half-shown', async () => {
  process.env.GIPHY_API_KEY = 'test-key';
  nextResponse = { data: { data: [{ id: 'x', images: {} }, GIF] } };
  const gifs = await searchGifs({ query: 'x' });
  assert.equal(gifs.length, 1);
});

test('without a key the feature is simply absent', async () => {
  delete process.env.GIPHY_API_KEY;
  assert.equal(giphyConfigured(), false, 'so the picker hides its GIFs button');
  calls.length = 0;
  assert.deepEqual(await searchGifs({ query: 'water cycle' }), []);
  assert.equal(calls.length, 0, 'and no request is attempted');
});

test('an empty query is not sent to GIPHY', async () => {
  process.env.GIPHY_API_KEY = 'test-key';
  calls.length = 0;
  assert.deepEqual(await searchGifs({ query: '   ' }), []);
  assert.equal(calls.length, 0);
});

test('a GIPHY outage returns nothing rather than breaking the picker', async () => {
  process.env.GIPHY_API_KEY = 'test-key';
  nextResponse = Promise.reject(new Error('503 Service Unavailable'));
  const gifs = await searchGifs({ query: 'x' }).catch(() => 'THREW');
  assert.deepEqual(gifs, [], 'the teacher keeps their other two image sources');
  nextResponse = { data: { data: [] } };
});
