const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('Byte companions are installed on student and teacher surfaces', () => {
  for (const file of ['public/index.html','practice-teacher.html','public/start.html','public/join.html','public/my-work.html','public/assignment.html','public/play.html']) {
    const html = fs.readFileSync(path.join(root,file),'utf8');
    assert.match(html,/data-byte-ui="(student|teacher)"/);
    assert.match(html,/src="\/byte-feedback.js"/);
    assert.match(html,/href="\/byte-feedback.css"/);
  }
});
test('Every companion state references an existing asset', () => {
  const css = fs.readFileSync(path.join(root,'public/byte-feedback.css'),'utf8');
  const assets = [...css.matchAll(/url\('(\/assets\/[^']+)'\)/g)];
  assert.equal(new Set(assets.map(m=>m[1])).size,4);
  for (const [,asset] of assets) assert.ok(fs.existsSync(path.join(root,'public',asset)));
});
