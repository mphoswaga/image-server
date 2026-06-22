// On-demand gap-filler: when the library has no good match for a slide's
// imageQuery, fetch a fresh photo from Unsplash, save it into the library
// folder, and return a library entry for it (so it can be cached + reused).
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function fetchUnsplashImage({ query, subject, topic, publicDir }) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null; // no key → caller falls back to a library image

  let photo;
  try {
    const res = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query, per_page: 5, orientation: 'landscape' },
      headers: { Authorization: `Client-ID ${key}` },
      timeout: 15000,
    });
    photo = res.data.results && res.data.results[0];
  } catch (err) {
    console.log(`Unsplash search failed for "${query}": ${err.message}`);
    return null;
  }
  if (!photo) return null;

  const folder = path.join(publicDir, subject, topic);
  fs.mkdirSync(folder, { recursive: true });

  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  let filename, filepath, n = 1;
  do {
    filename = `${subject}_${topic}_gen_${slug}${n > 1 ? '-' + n : ''}.jpg`;
    filepath = path.join(folder, filename);
    n++;
  } while (fs.existsSync(filepath));

  try {
    const img = await axios.get(photo.urls.regular, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(filepath, Buffer.from(img.data));
  } catch (err) {
    console.log(`Unsplash download failed for "${query}": ${err.message}`);
    return null;
  }

  return {
    subject,
    topic,
    filename,
    relpath: path.posix.join(subject, topic, filename),
    tags: [subject, topic.replace(/-/g, ' ')],
    // caption is known for free — it's what we searched for, enriched by Unsplash's own description
    caption: photo.description || photo.alt_description || query,
    keywords: query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
    source: 'unsplash-ondemand',
    credit: photo.user ? { name: photo.user.name, link: photo.user.links && photo.user.links.html } : undefined,
  };
}

module.exports = { fetchUnsplashImage };
