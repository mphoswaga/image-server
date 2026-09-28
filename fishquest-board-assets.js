'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Snapshot one matching set of board assets at startup. Content-addressed paths
// bypass browser/CDN copies of the old unversioned files after a deployment.
function registerFishBoardAssets(app, publicDir = path.join(__dirname, 'public')) {
  const files = ['fishquest-board.css', 'fishquest-growth.js', 'fishquest-art.js',
    'fishquest-board-adventure.js', 'fishquest-board-scenes.js', 'fishquest-board-story.js', 'fishquest-board-state.js', 'fishquest-board-motion.js', 'fishquest-board-swim.js', 'fishquest-board.js'];
  const assets = new Map(files.map(name => [name, fs.readFileSync(path.join(publicDir, name))]));
  const template = fs.readFileSync(path.join(publicDir, 'fishquest-board.html'), 'utf8');
  const hash = crypto.createHash('sha256').update(template);
  for (const [name, bytes] of assets) hash.update(name).update(bytes);
  const version = hash.digest('hex').slice(0, 12);
  let html = template;
  for (const name of files) html = html.replaceAll('/' + name, '/fishquest-board-assets/' + version + '/' + name);
  html = html.replace('id="boardBuild"', 'id="boardBuild" data-build="' + version + '"')
    .replace('Ocean build', 'Ocean build ' + version.slice(0, 7));

  app.get('/fishquest-board.html', (_req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('CDN-Cache-Control', 'no-store');
    res.set('Cloudflare-CDN-Cache-Control', 'no-store');
    res.type('html').send(html);
  });
  app.get('/fishquest-board-assets/' + version + '/:file', (req, res) => {
    const bytes = assets.get(req.params.file);
    if (!bytes) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(req.params.file.endsWith('.css') ? 'css' : 'js').send(bytes);
  });
  return { version };
}
module.exports = { registerFishBoardAssets };
