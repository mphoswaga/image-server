const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-practice-live-'));
const live = require('../practice-live');

test('a teacher room uses a short code and exposes no ownership secrets', () => {
  const room = live.createRoom({ teacherId: 'teacher-1', activityId: 'g2-pointer-control' });
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.equal(room.status, 'open');
  assert.equal(room.activity.id, 'g2-pointer-control');
  assert.equal(room.activity.missionCount, 8);
  assert.equal('teacherId' in room, false);
  assert.equal('participants' in room, false);
});

test('nicknames are temporary, cleaned and made distinct inside one room', () => {
  const room = live.createRoom({ teacherId: 'teacher-2' });
  const first = live.joinRoom(room.code, '  Linh  ');
  const second = live.joinRoom(room.code, 'Linh');
  const third = live.joinRoom(room.code, 'Linh');
  assert.equal(first.participant.name, 'Linh');
  assert.equal(second.participant.name, 'Linh 2');
  assert.equal(third.participant.name, 'Linh 3');
  assert.ok(first.token.length > 20);
  assert.equal(JSON.stringify(first.room).includes(first.token), false);
  assert.throws(() => live.joinRoom(room.code, '---'), /first name or nickname/i);
});

test('live checkpoints are ordered, idempotent and cap client scores', () => {
  const room = live.createRoom({ teacherId: 'teacher-3' });
  const joined = live.joinRoom(room.code, 'Mia');
  const payload = {
    checkpointId: 'mia-signal-trail',
    stepId: 'move-pointer',
    evidence: { action: 'pointer_enter', target: 'blue-star' },
    arcadeScore: 999999,
  };
  const first = live.checkpointRoom(room.code, joined.token, payload);
  assert.equal(first.participant.missionsCompleted, 1);
  assert.equal(first.participant.score, 1300);
  assert.equal(first.participant.rank, 1);
  const retry = live.checkpointRoom(room.code, joined.token, payload);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.participant.missionsCompleted, 1);
  assert.throws(() => live.checkpointRoom(room.code, joined.token, {
    checkpointId: 'skip',
    stepId: 'double-click',
    evidence: { action: 'double_click', target: 'blue-folder' },
  }), /Reactor Rush/i);
});

test('only the owning teacher can close a live room', () => {
  const room = live.createRoom({ teacherId: 'teacher-4' });
  assert.throws(() => live.closeRoom(room.code, 'teacher-other'), /another teacher/i);
  const closed = live.closeRoom(room.code, 'teacher-4');
  assert.equal(closed.status, 'closed');
  assert.throws(() => live.getRoom(room.code), /not found/i);
});

test('the server and both screens expose the live-room contract', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  const teacher = fs.readFileSync(path.join(__dirname, '..', 'practice-teacher.html'), 'utf8');
  assert.match(server, /app\.post\('\/api\/practice\/live-sessions', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.post\('\/api\/practice\/live-sessions\/:code\/join', requirePracticeEnabled/);
  assert.match(server, /app\.post\('\/api\/practice\/live-sessions\/:code\/checkpoints', requirePracticeEnabled/);
  assert.match(player, /id="roomCodeInput"/);
  assert.match(player, /async function saveLiveCheckpoint\(payload\)/);
  assert.match(teacher, /Start live room/);
  assert.match(teacher, /\/api\/practice\/live-sessions/);
});
