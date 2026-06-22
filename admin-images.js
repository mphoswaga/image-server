// Admin: fetch new images from Unsplash for a subject/topic, caption each with
// the vision model (so every image carries context), and return library entries
// ready to be indexed.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { captionImage } = require('./caption-library');

const PUBLIC_DIR = path.join(__dirname, 'public');
const slug = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function addImages({ subject, topic, count = 10, onProgress }) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not set — add it to .env.');
  subject = slug(subject); topic = slug(topic);
  if (!subject || !topic) throw new Error('Subject and topic are required.');
  count = Math.min(30, Math.max(1, parseInt(count, 10) || 10));

  const folder = path.join(PUBLIC_DIR, subject, topic);
  fs.mkdirSync(folder, { recursive: true });
  const existing = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.jpg')).length;

  const added = [];
  let page = 1;
  while (added.length < count) {
    let photos;
    try {
      const res = await axios.get('https://api.unsplash.com/search/photos', {
        params: { query: `${subject} ${topic} education`, per_page: 30, page, orientation: 'landscape' },
        headers: { Authorization: `Client-ID ${key}` }, timeout: 15000,
      });
      photos = res.data.results;
    } catch (err) {
      throw new Error('Unsplash search failed: ' + (err.response?.data?.errors?.[0] || err.message));
    }
    if (!photos || !photos.length) break; // no more results

    for (const photo of photos) {
      if (added.length >= count) break;
      const n = existing + added.length + 1;
      const filename = `${subject}_${topic}_${String(n).padStart(3, '0')}.jpg`;
      const filepath = path.join(folder, filename);
      if (fs.existsSync(filepath)) continue;
      try {
        const img = await axios.get(photo.urls.regular, { responseType: 'arraybuffer', timeout: 30000 });
        fs.writeFileSync(filepath, Buffer.from(img.data));
      } catch { continue; }

      // Caption for context (don't fail the whole add if one caption errors).
      let caption = '', keywords = [];
      try { const c = await captionImage(filepath); caption = c.caption; keywords = c.keywords; } catch { /* leave uncaptioned */ }

      added.push({
        subject, topic, filename,
        relpath: path.posix.join(subject, topic, filename),
        tags: [subject, topic.replace(/-/g, ' ')],
        caption, keywords,
        credit: photo.user ? { name: photo.user.name, link: photo.user.links?.html } : undefined,
        source: 'unsplash-admin',
      });
      if (onProgress) onProgress(added.length, count);
    }
    page++;
    if (page > 10) break; // safety
  }
  return added;
}

module.exports = { addImages };
