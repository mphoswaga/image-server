const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerFishBoardAssets } = require('../fishquest-board-assets');
async function start(t, directory) {
  const app = express(), { version } = registerFishBoardAssets(app, directory);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  return { base: 'http://127.0.0.1:' + server.address().port, version };
}
test('board serves a complete matching asset set and never caches its entry page', async t => {
  const { base, version } = await start(t);
  const res = await fetch(base + '/fishquest-board.html?game=existing');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('cloudflare-cdn-cache-control'), 'no-store');
  const html = await res.text();
  assert.ok(html.includes('data-build="' + version + '"'));
  const paths = [...html.matchAll(/(?:src|href)="(\/fishquest-board-assets\/[^\"]+)"/g)].map(m => m[1]);
  assert.equal(paths.length, 10);
  for (const assetPath of paths) {
    assert.ok(assetPath.includes('/' + version + '/'));
    const asset = await fetch(base + assetPath);
    assert.equal(asset.status, 200);
    const name = assetPath.split('/').pop();
    assert.equal(await asset.text(), fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'));
  }
  assert.equal((await fetch(base + '/fishquest-board-assets/' + version + '/unknown.js')).status, 404);
});
test('changing a script or stylesheet changes every asset URL, including across cached deployments', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-assets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['fishquest-board.html', 'fishquest-board.css', 'fishquest-growth.js', 'fishquest-art.js', 'fishquest-board-adventure.js', 'fishquest-board-scenes.js', 'fishquest-board-story.js', 'fishquest-board-state.js', 'fishquest-board-motion.js', 'fishquest-board-swim.js', 'fishquest-board.js']) {
    fs.copyFileSync(path.join(__dirname, '../public', name), path.join(dir, name));
  }
  const old = await start(t, dir);
  fs.appendFileSync(path.join(dir, 'fishquest-board.css'), '\n/* new release */');
  const next = await start(t, dir);
  assert.notEqual(old.version, next.version);
  // Running processes keep their original snapshot, even if files change on disk.
  const oldCss = await fetch(old.base + '/fishquest-board-assets/' + old.version + '/fishquest-board.css');
  assert.ok(!(await oldCss.text()).includes('/* new release */'));
  const html = await (await fetch(next.base + '/fishquest-board.html')).text();
  assert.ok(!html.includes(old.version));
  assert.ok(html.includes('/' + next.version + '/fishquest-board.js'));
});
