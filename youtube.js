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
    reason: cleanText(extra.reason, 'Related to this lesson topic.'),
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

function searchQuery({ subject = '', topic = '', grade = '', stage = '' } = {}) {
  return [subject, topic, grade, stage, 'educational lesson']
    .map(x => String(x || '').trim()).filter(Boolean).join(' ');
}

function isoDurationToLabel(value) {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return '';
  const h = Number(match[1] || 0), m = Number(match[2] || 0), s = Number(match[3] || 0);
  return h ? `${h}h ${m}m` : `${m}m ${s}s`;
}

async function suggestVideos({ subject, topic, grade, stage, limit = 5 } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { suggestions: [], configured: false, message: 'YouTube suggestions are not configured yet.' };
  const max = Math.min(8, Math.max(1, Number(limit) || 5));
  const query = searchQuery({ subject, topic, grade, stage });
  const searchParams = new URLSearchParams({
    key: apiKey, part: 'snippet', q: query, type: 'video', safeSearch: 'strict',
    videoEmbeddable: 'true', videoSyndicated: 'true', maxResults: String(max), relevanceLanguage: 'en',
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
  const suggestions = (detailData.items || []).filter(item => item.status?.embeddable !== false).map(item => {
    const snippet = item.snippet || {};
    return normalizeVideo(item.id, {
      title: snippet.title,
      channelTitle: snippet.channelTitle,
      description: snippet.description,
      duration: isoDurationToLabel(item.contentDetails?.duration),
      reason: `Matches ${grade || 'this class'} ${subject || 'lesson'} content about ${topic || 'the selected topic'}.`,
    });
  }).filter(Boolean);
  return { suggestions, configured: true, query };
}

module.exports = { extractVideoId, normalizeVideoId, normalizeVideo, canonicalUrl, embedUrl, thumbnailUrl, thumbnailDataUrl, searchQuery, suggestVideos };
