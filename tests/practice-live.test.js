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

test('live leaderboard score is reduced by mistakes and slow active time', () => {
  const room = live.createRoom({ teacherId: 'teacher-performance' });
  const joined = live.joinRoom(room.code, 'Nia');
  const result = live.checkpointRoom(room.code, joined.token, {
    checkpointId: 'nia-pointer',
    stepId: 'move-pointer',
    evidence: { action:'pointer_enter', target:'blue-star' },
    baseScore: 1300,
    correctInputs: 8,
    mistakes: 4,
    activeSeconds: 70,
  });
  assert.ok(result.participant.score < 1300);
  assert.equal(result.participant.accuracyPercent, 67);
  assert.equal(result.participant.mistakes, 4);
  assert.equal(result.participant.activeSeconds, 70);
});

test('a Foundation live participant continues into Grade 3 without rejoining', () => {
  const room = live.createRoom({ teacherId: 'teacher-worlds', activityId: 'g2-pointer-control' });
  const joined = live.joinRoom(room.code, 'Tara');
  const foundation = [
    ['move-pointer', 'pointer_enter', 'blue-star'],
    ['single-click', 'single_click', 'green-circle'],
    ['double-click', 'double_click', 'blue-folder'],
    ['context-command', 'context_command', 'archive-open'],
    ['drag-drop', 'drag_drop', 'homework-folder'],
    ['scroll-find', 'scroll_find', 'gold-star'],
    ['copy-paste-menu', 'context_copy_paste', 'relay-console'],
    ['keyboard-defense', 'type_word', 'byte-signal'],
  ];
  for (const [stepId, action, target] of foundation) {
    live.checkpointRoom(room.code, joined.token, {
      checkpointId: `tara-${stepId}`,
      activityId: 'g2-pointer-control',
      stepId,
      evidence: { action, target },
      arcadeScore: 999999,
    });
  }
  const grade3 = live.checkpointRoom(room.code, joined.token, {
    checkpointId: 'tara-rapid-relay',
    activityId: 'g3-keyboard-kingdom',
    stepId: 'copy-paste-shortcut',
    evidence: { action: 'shortcut_copy_paste', target: 'shortcut-console' },
    arcadeScore: 360,
  });
  assert.equal(grade3.participant.activityId, 'g3-keyboard-kingdom');
  assert.equal(grade3.participant.missionsCompleted, 1);
  assert.equal(grade3.participant.totalMissionsCompleted, 9);
  assert.equal(grade3.participant.missionCount, 6);
  assert.ok(grade3.participant.score > 360);
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
