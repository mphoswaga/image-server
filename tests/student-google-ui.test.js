const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('student Google sign-in is exposed on every learner entry surface', () => {
  const start = read('public/start.html');
  const shared = read('public/student-google.js');
  assert.match(start, /Continue with Google/);
  assert.match(start, /\/api\/student\/google\/link/);
  assert.match(shared, /\/api\/student\/auth\/providers/);
  for (const file of ['public/play.html', 'public/assignment.html', 'public/fishquest.html']) {
    const html = read(file);
    assert.match(html, /data-student-google/);
    assert.match(html, /student-google\.js/);
  }
});

test('student Google OAuth links to an existing learner instead of creating a second record', () => {
  const server = read('image-server.js');
  assert.match(server, /type: 'student-social-link'/);
  assert.match(server, /studentAccount\.findByIdentity/);
  assert.match(server, /studentAccount\.verifyPin\(studentId, pin\)/);
  assert.match(server, /studentAccount\.linkIdentity\(studentId, pending\)/);
  assert.match(server, /issueStudentToken\(linked\.studentId/);
});

test('teachers can manage bulk, individual and Google learner access', () => {
  const dashboard = read('public/index.html');
  const server = read('image-server.js');
  assert.match(dashboard, /Student access/);
  assert.match(dashboard, /Create \$\{missing\} missing PIN/);
  assert.match(dashboard, /Replace all PINs/);
  assert.match(dashboard, /pin-custom-input/);
  assert.match(server, /app\.post\('\/api\/roster\/:rosterId\/pins'/);
  assert.match(server, /requestedPin/);
  assert.match(server, /app\.delete\('\/api\/roster\/:rosterId\/student\/:studentId\/google'/);
});
