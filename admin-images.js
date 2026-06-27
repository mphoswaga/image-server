// Admin: fetch new images from Unsplash for a subject/topic, caption each with
// the vision model (so every image carries context), and return library entries
// ready to be indexed.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { captionImage } = require('./caption-library');

const PUBLIC_DIR = path.join(__dirname, 'public');
const slug = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function addImages({ subject, topic, count = 10, query, onProgress, skipCaption = false }) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not set — add it to .env.');
  subject = slug(subject); topic = slug(topic);
  if (!subject || !topic) throw new Error('Subject and topic are required.');
  count = Math.min(30, Math.max(1, parseInt(count, 10) || 10));

  const folder = path.join(PUBLIC_DIR, subject, topic);
  fs.mkdirSync(folder, { recursive: true });
  const existing = fs.readdirSync(folder).filter(f => f.toLowerCase().endsWith('.jpg')).length;

  const searchQuery = (query && String(query).trim()) || `${subject} ${topic} education`;
  console.log(`[addImages] ${subject}/${topic} — searching Unsplash for: "${searchQuery}"`);

  const added = [];
  let page = 1;
  let downloadFails = 0;
  while (added.length < count) {
    let photos;
    try {
      const res = await axios.get('https://api.unsplash.com/search/photos', {
        params: { query: searchQuery, per_page: 30, page, orientation: 'landscape' },
        headers: { Authorization: `Client-ID ${key}` }, timeout: 15000,
      });
      photos = res.data.results;
    } catch (err) {
      throw new Error('Unsplash search failed: ' + (err.response?.data?.errors?.[0] || err.message));
    }
    if (!photos || !photos.length) {
      console.log(`[addImages] Unsplash returned 0 photos on page ${page} — stopping.`);
      break;
    }
    console.log(`[addImages] page ${page}: ${photos.length} photos from Unsplash`);

    for (const photo of photos) {
      if (added.length >= count) break;
      const n = existing + added.length + 1;
      const filename = `${subject}_${topic}_${String(n).padStart(3, '0')}.jpg`;
      const filepath = path.join(folder, filename);
      if (fs.existsSync(filepath)) continue;
      try {
        const img = await axios.get(photo.urls.regular, { responseType: 'arraybuffer', timeout: 30000 });
        fs.writeFileSync(filepath, Buffer.from(img.data));
      } catch (e) {
        downloadFails++;
        console.log(`[addImages] download failed (${downloadFails}): ${e.message}`);
        continue;
      }

      // Caption for context — skip during automatic deck generation to avoid adding
      // 10+ vision API calls (and seconds) to the generation request latency.
      let caption = '', keywords = [];
      if (!skipCaption) {
        try { const c = await captionImage(filepath); caption = c.caption; keywords = c.keywords; } catch { /* leave uncaptioned */ }
      }

      added.push({
        subject, topic, filename,
        relpath: path.posix.join(subject, topic, filename),
        tags: [subject, topic.replace(/-/g, ' ')],
        caption, keywords,
        credit: photo.user ? { name: photo.user.name, link: photo.user.links?.html } : undefined,
        source: 'unsplash-admin',
        addedAt: new Date().toISOString(),
      });
      if (onProgress) onProgress(added.length, count);
    }
    page++;
    if (page > 10) break; // safety
  }
  console.log(`[addImages] done: ${added.length} saved, ${downloadFails} download failures`);
  return added;
}

// Fetch images from Wikimedia Commons (free, no key needed, educational content).
async function fetchWikimediaImages({ subject, topic, count = 8, query } = {}) {
  subject = slug(subject || 'search');
  topic   = slug(topic   || 'general');
  count   = Math.min(20, Math.max(1, parseInt(count, 10) || 8));

  const folder = path.join(PUBLIC_DIR, subject, topic);
  fs.mkdirSync(folder, { recursive: true });
  const existing = fs.readdirSync(folder).filter(f => f.startsWith('wm_')).length;

  // Wikimedia Commons returns scanned PDFs when queries contain educational context
  // words or become too long. Strip those words and cap at 3 terms so the search
  // stays focused on the visual concept rather than attracting document results.
  const searchQ = ((query && String(query).trim()) || `${subject.replace(/-/g,' ')} ${topic.replace(/-/g,' ')}`)
    .replace(/\b(education|school|classroom|students?|learn(?:ing)?|grade\s+\d+|internet|diagram|advantages?|disadvantages?|types?\s+of|using|what\s+is|complete|setup)\b/gi, '')
    .replace(/\s{2,}/g, ' ').trim()
    .split(/\s+/).slice(0, 3).join(' ');

  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrnamespace: '6',
    gsrsearch: searchQ, gsrlimit: String(Math.min(count * 4, 50)),
    prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '1280',
    format: 'json', origin: '*',
  });

  let pages;
  try {
    const res = await axios.get(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'LessonCope/1.0 (educational slide generator)' },
      timeout: 15000,
    });
    pages = Object.values(res.data?.query?.pages || {});
  } catch (err) {
    console.error('Wikimedia search failed:', err.message);
    return [];
  }

  const added = [];
  for (const page of pages) {
    if (added.length >= count) break;
    const ii = page.imageinfo?.[0];
    if (!ii) continue;
    if (!['image/jpeg', 'image/png'].includes(ii.mime)) continue;
    if (ii.width && ii.height && ii.width < ii.height) continue; // skip portrait
    if ((ii.thumbwidth || ii.width || 0) < 300) continue;        // skip tiny
    const url = ii.thumburl || ii.url;
    if (!url) continue;

    const n = existing + added.length + 1;
    const ext = ii.mime === 'image/png' ? 'png' : 'jpg';
    const filename = `wm_${subject}_${topic}_${String(n).padStart(3, '0')}.${ext}`;
    const filepath = path.join(folder, filename);
    if (fs.existsSync(filepath)) continue;

    // Small delay between Wikimedia downloads to avoid 429 rate-limiting.
    if (added.length > 0) await new Promise(r => setTimeout(r, 400));
    try {
      const img = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 30000,
        headers: {
          'User-Agent': 'LessonCope/1.0 (educational tool; mphoeduc@gmail.com)',
          'Referer': 'https://commons.wikimedia.org/',
        },
      });
      fs.writeFileSync(filepath, Buffer.from(img.data));
    } catch (e) {
      if (e.response?.status === 429) await new Promise(r => setTimeout(r, 1500));
      continue;
    }

    let caption = '', keywords = [];
    try { const c = await captionImage(filepath); caption = c.caption; keywords = c.keywords; } catch {}

    added.push({
      subject, topic, filename,
      relpath: path.posix.join(subject, topic, filename),
      tags: [subject, topic.replace(/-/g, ' ')],
      caption, keywords,
      source: 'wikimedia',
      addedAt: new Date().toISOString(),
    });
  }
  return added;
}

module.exports = { addImages, fetchWikimediaImages };
