// Animated GIFs for slides, from GIPHY.
//
// Slots into the existing image picker as another source rather than a separate
// feature: a searched GIF is downloaded into the same media library as an
// Unsplash photo, gets a library entry of the same shape, and is placed on a
// slide by the same set-image call. pptxgenjs embeds a .gif like any other
// image, and PowerPoint and Google Slides both animate it on the slide.
//
// TWO RULES, both non-negotiable for a classroom product:
//
//   rating=g on every request. This is a teacher tool whose output goes on a
//   projector in front of children; the rating is hardcoded here rather than
//   passed in, so no caller can weaken it.
//
//   GIPHY attribution travels with the entry. Their terms require the mark
//   wherever results are shown, so `credit` is filled in the same way the
//   Unsplash fetcher fills the photographer.
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';

function giphyKey() {
  return process.env.GIPHY_API_KEY || '';
}

// Whether the picker should offer GIFs at all. Without a key the button stays
// hidden rather than offering a search that can only fail.
function giphyConfigured() {
  return !!giphyKey();
}

// Search only — nothing downloaded. Used to fill the picker grid, where the
// teacher looks before choosing, so downloading every result would be waste.
//
// Returns a STATUS as well as the results, because "no GIFs" has several
// causes and they need different words in front of a teacher. The one that
// matters commercially is rate_limited: a beta key allows 100 calls an hour
// across the whole app, and without this the button would just quietly stop
// working and nobody would know why.
async function searchGifs({ query, limit = 12 }) {
  const key = giphyKey();
  if (!key) return { gifs: [], status: 'not_configured' };
  const q = String(query || '').trim();
  if (!q) return { gifs: [], status: 'ok' };

  try {
    const res = await axios.get(SEARCH_URL, {
      params: {
        api_key: key,
        q,
        limit: Math.max(1, Math.min(25, limit)),
        rating: 'g',          // see the note at the top of this file
        lang: 'en',
        bundle: 'messaging_non_clips',
      },
      timeout: 15000,
    });
    const gifs = (res.data && Array.isArray(res.data.data) ? res.data.data : [])
      .map(toCandidate)
      .filter(Boolean);
    return { gifs, status: 'ok' };
  } catch (err) {
    // 429 is the hourly cap; GIPHY also answers 403 once a beta key is over
    // its allowance, so both are reported as the same thing to the teacher.
    const code = err.response && err.response.status;
    if (code === 429 || code === 403) {
      console.warn(`GIPHY rate limit reached (HTTP ${code}) searching "${q}" — the beta key allows 100 calls an hour.`);
      return { gifs: [], status: 'rate_limited' };
    }
    console.log(`GIPHY search failed for "${q}": ${err.message}`);
    return { gifs: [], status: 'unavailable' };
  }
}

// The two sizes that matter: a small still-ish preview for the grid, and the
// full GIF that goes on the slide. GIPHY's `downsized` is capped at ~2MB, which
// keeps a deck from ballooning when a teacher picks several.
function toCandidate(gif) {
  const images = (gif && gif.images) || {};
  const full = images.downsized_medium || images.downsized || images.original;
  const preview = images.fixed_width_downsampled || images.fixed_width_small || images.preview_gif || full;
  if (!full || !full.url) return null;
  return {
    id: gif.id,
    title: String(gif.title || '').replace(/\s*GIF\s*$/i, '').trim(),
    previewUrl: preview.url,
    url: full.url,
    width: Number(full.width) || null,
    height: Number(full.height) || null,
    credit: {
      name: (gif.user && (gif.user.display_name || gif.user.username)) || 'GIPHY',
      link: gif.url || 'https://giphy.com',
    },
  };
}

// Download a chosen GIF into the media library, returning an entry of the same
// shape the Unsplash fetcher returns so every downstream consumer — the deck
// builder, the library index, the picker grid — treats it identically.
async function saveGif({ gif, subject, topic, publicDir }) {
  if (!gif || !gif.url) return null;
  const sub = String(subject || 'search');
  const top = String(topic || 'general');
  const folder = path.join(publicDir, sub, top);
  fs.mkdirSync(folder, { recursive: true });

  const slug = String(gif.title || 'gif').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'gif';
  let filename, filepath, n = 1;
  do {
    filename = `${sub}_${top}_gif_${slug}${n > 1 ? '-' + n : ''}.gif`;
    filepath = path.join(folder, filename);
    n++;
  } while (fs.existsSync(filepath));

  try {
    const data = await axios.get(gif.url, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(filepath, Buffer.from(data.data));
  } catch (err) {
    console.log(`GIPHY download failed for "${gif.title || gif.id}": ${err.message}`);
    return null;
  }

  return {
    subject: sub,
    topic: top,
    filename,
    relpath: path.posix.join(sub, top, filename),
    tags: [sub, top.replace(/-/g, ' ')],
    caption: gif.title || '',
    keywords: String(gif.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    source: 'giphy',
    animated: true,
    credit: gif.credit,
    addedAt: new Date().toISOString(),
  };
}

module.exports = { searchGifs, saveGif, giphyConfigured };
