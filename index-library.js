// Builds public/library.json — a flat index of every image in the library.
// Run: node index-library.js
const fs = require('fs');
const path = require('path');

const LIBRARY_DIR = path.join(__dirname, 'public');
const OUTPUT = path.join(LIBRARY_DIR, 'library.json');

function buildIndex() {
  // Preserve any existing captions/keywords so re-indexing never wipes the
  // (expensive) vision-captioning work. Keyed by relpath.
  const existing = {};
  if (fs.existsSync(OUTPUT)) {
    try {
      for (const img of JSON.parse(fs.readFileSync(OUTPUT, 'utf8')).images || []) {
        if (img.caption) existing[img.relpath] = img;
      }
    } catch { /* corrupt/old index — just rebuild fresh */ }
  }

  const images = [];
  const subjects = fs.readdirSync(LIBRARY_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const subject of subjects) {
    const subjectDir = path.join(LIBRARY_DIR, subject);
    const topics = fs.readdirSync(subjectDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const topic of topics) {
      const topicDir = path.join(subjectDir, topic);
      const files = fs.readdirSync(topicDir).filter(f => f.endsWith('.jpg'));
      for (const filename of files) {
        const relpath = path.posix.join(subject, topic, filename);
        const prior = existing[relpath];
        images.push({
          subject,
          topic,
          filename,
          // path relative to public/ — usable both on disk and as a URL
          relpath,
          tags: [subject, topic.replace(/-/g, ' ')],
          // carry forward caption/keywords if we already have them
          ...(prior ? { caption: prior.caption, keywords: prior.keywords, source: prior.source } : {}),
        });
      }
    }
  }

  const index = {
    generatedAt: new Date().toISOString(),
    count: images.length,
    subjects: [...new Set(images.map(i => i.subject))].sort(),
    images,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(index, null, 2));
  console.log(`Indexed ${images.length} images across ${index.subjects.length} subjects -> ${OUTPUT}`);
}

buildIndex();
