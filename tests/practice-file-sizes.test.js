const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('File Lab uses the supplied examples and corrected video size everywhere', () => {
  const html = fs.readFileSync(path.join(root, 'file-types-sizes-practice.html'), 'utf8');

  for (const example of ['100 B', '600 KB', '5 MB', '1 GB', '1 TB']) {
    assert.match(html, new RegExp(example.replace(' ', '\\s')));
  }
  assert.match(html, /B, KB, MB, GB and TB/);
  assert.match(html, /type:'Video'.*size:1000000000/);
  assert.match(html, /name:'Video',mb:1000/);
  assert.match(html, /Which example is the video\?'.*'1 GB'/);
  assert.match(html, /id="buildPhoneFill"/);
  assert.match(html, /id="storePhoneFill"/);
  assert.match(html, /paintPhone\('store',total\*1e6,2000000000,icons\)/);
  assert.match(html, /Your pretend phone holds <b>2 GB<\/b>/);
  assert.match(html, /teacherControlled=true/);
  assert.match(html, /controlledPages=\['explore','build','store','quiz'\]/);
  assert.match(html, /room\.controlledStage/);
  assert.doesNotMatch(html, /video 3 MB|Video',mb:3\b|The video card is 3 MB/i);
});

test('File Lab script compiles and the activity is linked through gated Practice routes', () => {
  const html = fs.readFileSync(path.join(root, 'file-types-sizes-practice.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(script, 'inline activity script should exist');
  assert.doesNotThrow(() => new vm.Script(script[1]));

  const server = fs.readFileSync(path.join(root, 'image-server.js'), 'utf8');
  const learner = fs.readFileSync(path.join(root, 'practice.html'), 'utf8');
  const teacher = fs.readFileSync(path.join(root, 'practice-teacher.html'), 'utf8');
  assert.match(server, /app\.get\('\/student\/practice\/file-sizes', requirePracticeEnabled/);
  assert.match(server, /app\.get\('\/practice\/file-sizes', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.patch\('\/api\/practice\/live-sessions\/:code\/stage', requirePracticeEnabled, requireAuth/);
  assert.match(learner, /href="\/student\/practice\/file-sizes"/);
  assert.match(learner, /payload\.room\.activity&&payload\.room\.activity\.id==='file-types-sizes'/);
  assert.match(teacher, /href="\/practice\/file-sizes"/);
  assert.match(teacher, /<option value="file-types-sizes">File Types and Sizes Lab<\/option>/);
  assert.match(teacher, /id="fileLabNext"/);
});
