// YouTube URL handling and teacher-reviewed suggestion helpers.
// We store a video id, never a downloaded copy of the video.

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

function hostIsYouTube(hostname) {
  return YOUTUBE_HOSTS.has(String(hostname || '').toLowerCase().replace(/\.$/, ''));
}

function extractVideoId(value) {
  if (!value || typeof value !== 'string') return null;
  let url;
  try { url = new URL(value.trim()); }
  catch { return null; }
  if (!/^https?:$/.test(url.protocol) || !hostIsYouTube(url.hostname)) return null;
  const host = url.hostname.toLowerCase();
  if (host.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] || null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'watch') return url.searchParams.get('v');
  if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') return parts[1] || null;
  return url.searchParams.get('v');
}

function isValidVideoId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id);
}

function normalizeVideoId(value) {
  const id = extractVideoId(value) || (isValidVideoId(value) ? value : null);
  return isValidVideoId(id) ? id : null;
}

function canonicalUrl(id) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

function embedUrl(id, startSeconds = 0) {
  const start = Math.max(0, Math.floor(Number(startSeconds) || 0));
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}${start ? `?start=${start}` : ''}`;
}

function thumbnailUrl(id) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

function cleanText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 180) || fallback;
}

function normalizeVideo(value, extra = {}) {
  const id = normalizeVideoId(value);
  if (!id) return null;
  return {
    type: 'youtube',
    videoId: id,
    url: canonicalUrl(id),
    embedUrl: embedUrl(id, extra.startSeconds),
    thumbnail: thumbnailUrl(id),
    title: cleanText(extra.title, 'YouTube video'),
    channelTitle: cleanText(extra.channelTitle, 'YouTube'),
    duration: cleanText(extra.duration),
    description: cleanText(extra.description),
    // No default claim: a video is only described as matching the lesson when
    // something actually checked that it does.
    reason: cleanText(extra.reason, ''),
    startSeconds: Math.max(0, Math.floor(Number(extra.startSeconds) || 0)),
    thumbnailData: typeof extra.thumbnailData === 'string' ? extra.thumbnailData : null,
  };
}

async function thumbnailDataUrl(video, { maxBytes = 900_000 } = {}) {
  const url = typeof video === 'string' ? thumbnailUrl(video) : video && video.thumbnail;
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch YouTube thumbnail (${res.status}).`);
  const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(contentType)) throw new Error('YouTube thumbnail was not an image.');
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) throw new Error('YouTube thumbnail was too large.');
  const buffer = Buffer.from(arrayBuffer);
  return `data:${contentType === 'image/jpg' ? 'image/jpeg' : contentType};base64,${buffer.toString('base64')}`;
}

// Words that say nothing about the subject matter. The teaching-model jargon
// matters most: a stage label like "I Do" or "Reflect", or a themed lesson name,
// is meaningful inside LessonScope and meaningless to YouTube.
const STOP_WORDS = new Set(('a about above after again against all am an and any are as at be because been before being below ' +
  'between both but by can cannot could did do does doing down during each few for from further had has have having he her ' +
  'here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our out over ' +
  'own same she should so some such than that the their them then there these they this those through to too under until ' +
  'up very was we were what when where which while who whom why will with you your').split(' '));
const TEACHING_JARGON = new Set(('activity alone card challenge check class continued discuss exit explore focus guided ' +
  'independent intro introduction learn learning lesson objective objectives outcome outcomes pair pairs partner plenary ' +
  'practice practise practicing practising recap reflect reflection review slide starter student students success task ' +
  'teacher today together ' +
  'understand understanding warm work ' +
  // Common adjectives and fillers that survive stop-word removal but say
  // nothing about the subject matter ("Why is GOOD formatting IMPORTANT?").
  'good bad best better important easy hard simple different same big small large little new old many much more less ' +
  'first last next another correct right wrong able ' +
  // Generic verbs that carry no subject matter on their own.
  'use uses used using make makes made get gets got put puts take takes show shows shown call called turn turns ' +
  'form forms give gives find finds know knows need needs want wants say says tell tells look looks come comes').split(' '));

const deslug = value => String(value || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

// The most informative words in the lesson's own text, most frequent first.
function keyTerms(text, limit = 5) {
  const freq = new Map();
  deslug(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !TEACHING_JARGON.has(w) && !/^\d+$/.test(w))
    .forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
  // Rank by frequency, then by length DESCENDING: when everything appears once
  // (the common case for a few bullets) the longer word is the more specific
  // one — "evaporation" tells a search engine far more than "falls".
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  // Collapse morphological near-duplicates so they don't burn two slots
  // ("format"/"formatting", "cell"/"cells"), keeping the shorter, more general
  // form — that is the better thing to search for.
  const kept = [];
  for (const [word] of ranked) {
    const stem = word.slice(0, 4);
    const dupeAt = kept.findIndex(k => k.slice(0, 4) === stem && (word.startsWith(k) || k.startsWith(word)));
    if (dupeAt >= 0) { if (word.length < kept[dupeAt].length) kept[dupeAt] = word; continue; }
    if (kept.length >= limit) continue;
    kept.push(word);
  }
  return kept;
}

// Build the terms a video must actually be about. Driven by what the lesson
// TEACHES (slide title, bullets, objectives) rather than the internal topic
// slug — a themed topic name like "data-cafe" is invisible to YouTube, while
// the bullets naming "spreadsheet", "rows" and "columns" are what to search.
function lessonTerms({ topic = '', title = '', bullets = [], objectives = '' } = {}) {
  const content = [title, Array.isArray(bullets) ? bullets.join(' ') : bullets, objectives].join(' ');
  const terms = keyTerms(content, 5);
  return terms.length ? terms : keyTerms(topic, 3);
}

function searchQuery({ subject = '', topic = '', grade = '', title = '', bullets = [], objectives = '' } = {}) {
  const terms = lessonTerms({ topic, title, bullets, objectives });
  // The lesson stage ("I Do", "Reflect") is deliberately excluded — it is
  // internal teaching vocabulary and only pollutes the search.
  return [deslug(subject), terms.join(' '), deslug(grade), 'explained for students']
    .map(x => x.trim()).filter(Boolean).join(' ');
}

function isoDurationToSeconds(value) {
  const m = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

// How much a result actually overlaps the lesson. Returns the matched terms so
// the UI can say what the match was instead of asserting one.
function relevance(video, terms) {
  if (!terms.length) return { score: 0, hits: [] };
  const hay = `${video.title || ''} ${video.description || ''}`.toLowerCase();
  const hits = terms.filter(term => hay.includes(term));
  return { score: hits.length / terms.length, hits };
}

function isoDurationToLabel(value) {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return '';
  const h = Number(match[1] || 0), m = Number(match[2] || 0), s = Number(match[3] || 0);
  return h ? `${h}h ${m}m` : `${m}m ${s}s`;
}

// A usable lesson clip: long enough to teach something (excludes Shorts, which
// dominated results and are almost never suitable) and short enough to play in
// class.
const MIN_VIDEO_SECONDS = 60, MAX_VIDEO_SECONDS = 30 * 60;

async function suggestVideos({ subject, topic, grade, title, bullets, objectives, limit = 5 } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { suggestions: [], configured: false, message: 'YouTube suggestions are not configured yet.' };
  const max = Math.min(8, Math.max(1, Number(limit) || 5));
  const query = searchQuery({ subject, topic, grade, title, bullets, objectives });
  const terms = lessonTerms({ topic, title, bullets, objectives });
  // Over-fetch so duration and relevance filtering still leave enough to show.
  const searchParams = new URLSearchParams({
    key: apiKey, part: 'snippet', q: query, type: 'video', safeSearch: 'strict',
    videoEmbeddable: 'true', videoSyndicated: 'true', maxResults: String(Math.min(25, max * 4)), relevanceLanguage: 'en',
  });
  const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
  const searchData = await searchRes.json().catch(() => ({}));
  if (!searchRes.ok) throw new Error(searchData.error?.message || 'YouTube search failed.');
  const ids = (searchData.items || []).map(item => item.id && item.id.videoId).filter(Boolean);
  if (!ids.length) return { suggestions: [], configured: true, query };

  const detailParams = new URLSearchParams({ key: apiKey, part: 'snippet,contentDetails,status', id: ids.join(',') });
  const detailRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`);
  const detailData = await detailRes.json().catch(() => ({}));
  if (!detailRes.ok) throw new Error(detailData.error?.message || 'YouTube video details failed.');
  const scored = (detailData.items || [])
    .filter(item => item.status?.embeddable !== false)
    .filter(item => {
      const secs = isoDurationToSeconds(item.contentDetails?.duration);
      return secs >= MIN_VIDEO_SECONDS && secs <= MAX_VIDEO_SECONDS;
    })
    .map(item => {
      const snippet = item.snippet || {};
      const { score, hits } = relevance({ title: snippet.title, description: snippet.description }, terms);
      return {
        score, hits,
        video: normalizeVideo(item.id, {
          title: snippet.title,
          channelTitle: snippet.channelTitle,
          description: snippet.description,
          duration: isoDurationToLabel(item.contentDetails?.duration),
          // Say what the overlap actually is. Previously every result carried a
          // canned "Matches <grade> <subject> content about <topic>." regardless
          // of what it was about — a claim nothing had checked.
          reason: hits.length ? `Mentions ${hits.slice(0, 3).join(', ')}.` : '',
        }),
      };
    })
    .filter(entry => entry.video && entry.score > 0) // must genuinely overlap the lesson
    .sort((a, b) => b.score - a.score);

  const suggestions = scored.slice(0, max).map(entry => entry.video);
  return {
    suggestions, configured: true, query, terms,
    message: suggestions.length ? undefined : 'No videos matched this lesson closely enough. Try pasting a link instead.',
  };
}

module.exports = { extractVideoId, normalizeVideoId, normalizeVideo, canonicalUrl, embedUrl, thumbnailUrl, thumbnailDataUrl, searchQuery, lessonTerms, keyTerms, relevance, isoDurationToSeconds, suggestVideos };
