require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const BASE_DIR = path.join(os.homedir(), 'Downloads', 'teaching-images');
const IMAGES_PER_TOPIC = 50;

const SUBJECTS = {
  ict: ['computers', 'coding', 'internet', 'software', 'hardware', 'programming', 'technology'],
  maths: ['numbers', 'geometry', 'fractions', 'algebra', 'statistics', 'measurement'],
  english: ['reading', 'writing', 'grammar', 'vocabulary', 'literature', 'speaking']
};

async function downloadImage(url, filepath) {
  const response = await axios({ url, responseType: 'stream' });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function fetchAndDownloadImages(subject, topic) {
  console.log(`\n Searching for: ${subject} - ${topic}`);
  const folderPath = path.join(BASE_DIR, subject, topic.replace(/\s+/g, '-'));
  fs.mkdirSync(folderPath, { recursive: true });

  const existingCount = fs.readdirSync(folderPath).filter(f => f.endsWith('.jpg')).length;
  if (existingCount >= IMAGES_PER_TOPIC) {
    console.log(`Already have ${existingCount} images for ${subject} - ${topic}, skipping.`);
    return;
  }
  if (existingCount > 0) {
    console.log(`Resuming from ${existingCount} existing images.`);
  }

  let downloaded = existingCount;
  let page = 1;
  while (downloaded < IMAGES_PER_TOPIC) {
    const response = await axios.get('https://api.unsplash.com/search/photos', {
      params: {
        query: `${subject} ${topic} education`,
        per_page: 30,
        page: page,
        orientation: 'landscape'
      },
      headers: {
        Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`
      }
    });
    const photos = response.data.results;
    if (!photos.length) break;
    for (const photo of photos) {
      if (downloaded >= IMAGES_PER_TOPIC) break;
      const filename = `${subject}_${topic.replace(/\s+/g, '-')}_${String(downloaded + 1).padStart(3, '0')}.jpg`;
      const filepath = path.join(folderPath, filename);
      if (fs.existsSync(filepath)) {
        console.log(`Skipping (exists): ${filename}`);
        downloaded++;
        continue;
      }
      try {
        await downloadImage(photo.urls.regular, filepath);
        console.log(`Downloaded: ${filename}`);
        downloaded++;
      } catch (err) {
        console.log(`Failed: ${filename}`);
      }
    }
    page++;
  }
  console.log(`\nDone! ${downloaded} images for ${subject} - ${topic}`);
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('\nUsage: node agent.js <subject> <topic|all>');
    console.log('Example: node agent.js maths fractions');
    console.log('Example: node agent.js maths all');
    return;
  }
  const subject = args[0].toLowerCase();
  const topic = args.slice(1).join(' ').toLowerCase();
  if (!SUBJECTS[subject]) {
    console.log(`Subject "${subject}" not found. Available: ${Object.keys(SUBJECTS).join(', ')}`);
    return;
  }
  if (topic === 'all') {
    const topics = SUBJECTS[subject];
    console.log(`\nRunning all ${topics.length} topics for "${subject}": ${topics.join(', ')}`);
    for (const t of topics) {
      await fetchAndDownloadImages(subject, t);
    }
  } else {
    await fetchAndDownloadImages(subject, topic);
  }
}

run();
