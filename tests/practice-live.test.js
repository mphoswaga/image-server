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

test('classwork uses a teacher-controlled lobby and private roster attendance', () => {
  const roster = {
    id: 'grade-2b',
    name: 'Grade 2B',
    students: [
      { id: 'S001', name: 'Amina Ali' },
      { id: 'VS 002', name: 'Bảo Trần' },
    ],
  };
  const room = live.createRoom({ teacherId:'teacher-lobby', mode:'classwork', roster });
  assert.equal(room.mode, 'classwork');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.roster.name, 'Grade 2B');
  assert.equal(room.absentRosterCount, 2);
  assert.throws(() => live.joinRoom(room.code, { name:'Someone Else' }), /not in Grade 2B/i);

  const joined = live.joinRoom(room.code, { name:'s001' });
  assert.equal(joined.participant.name, 'Amina Ali');
  assert.equal('attendance' in joined.room, false);
  const teacherRoom = live.teacherRooms('teacher-lobby')[0];
  assert.equal(teacherRoom.joinedRosterCount, 1);
  assert.deepEqual(teacherRoom.attendance.map((student) => [student.name, student.joined]), [
    ['Amina Ali', true],
    ['Bảo Trần', false],
  ]);

  const accentless = live.joinRoom(room.code, { name:'Bao Tran' });
  assert.equal(accentless.participant.name, 'Bảo Trần');
  const rejoined = live.joinRoom(room.code, { studentId:'vs002' });
  assert.equal(rejoined.rejoined, true);
  assert.equal(rejoined.participant.id, accentless.participant.id);
  assert.equal(live.getRoomForParticipant(room.code, accentless.token).participant.id, accentless.participant.id);
  assert.equal(live.getRoomForParticipant(room.code, rejoined.token).participant.id, accentless.participant.id);
  assert.equal(live.teacherRooms('teacher-lobby')[0].joinedRosterCount, 2);
  assert.throws(() => live.checkpointRoom(room.code, joined.token, {
    checkpointId:'before-start',
    stepId:'move-pointer',
    evidence:{ action:'pointer_enter', target:'blue-star' },
  }), /wait for your teacher/i);
  assert.throws(() => live.startRoom(room.code, 'another-teacher'), /another teacher/i);
  const started = live.startRoom(room.code, 'teacher-lobby');
  assert.equal(started.phase, 'playing');
  assert.ok(started.startedAt);
  assert.throws(() => live.checkpointRoom(room.code, joined.token, {
    checkpointId:'during-countdown',
    stepId:'move-pointer',
    evidence:{ action:'pointer_enter', target:'blue-star' },
  }), /countdown/i);
  const originalNow = Date.now;
  Date.now = () => Date.parse(started.playStartsAt) + 1;
  let checkpoint;
  try {
    checkpoint = live.checkpointRoom(room.code, joined.token, {
      checkpointId:'after-start',
      stepId:'move-pointer',
      evidence:{ action:'pointer_enter', target:'blue-star' },
      baseScore:1300,
    });
  } finally {
    Date.now = originalNow;
  }
  assert.equal(checkpoint.participant.missionsCompleted, 1);
});

test('homework rooms remain self-paced and available beyond one school day', () => {
  const room = live.createRoom({ teacherId:'teacher-homework', mode:'homework' });
  assert.equal(room.mode, 'homework');
  assert.equal(room.phase, 'playing');
  assert.ok(Date.parse(room.expiresAt) - Date.parse(room.createdAt) > 24 * 60 * 60 * 1000);
});

test('teacher audio permissions are public, locked to the owner, and update live', () => {
  const room = live.createRoom({
    teacherId:'teacher-audio',
    audioPolicy:{ soundEffects:true, music:false, voice:false },
  });
  assert.deepEqual(room.audioPolicy, { soundEffects:true, music:false, musicPlayback:'students', voice:false });
  assert.throws(() => live.updateRoomAudio(room.code, 'another-teacher', { music:true }), /another teacher/i);
  const updated = live.updateRoomAudio(room.code, 'teacher-audio', { soundEffects:false, music:true, musicPlayback:'teacher', voice:true });
  assert.deepEqual(updated.audioPolicy, { soundEffects:false, music:true, musicPlayback:'teacher', voice:true });
  assert.deepEqual(live.getRoom(room.code).audioPolicy, updated.audioPolicy);
});

test('classwork defaults music to one teacher computer while homework defaults to student devices', () => {
  const classwork = live.createRoom({ teacherId:'teacher-class-music', mode:'classwork' });
  const homework = live.createRoom({ teacherId:'teacher-home-music', mode:'homework' });
  assert.equal(classwork.audioPolicy.musicPlayback, 'teacher');
  assert.equal(homework.audioPolicy.musicPlayback, 'students');
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

test('leaderboard uses active time to separate equally accurate learners', () => {
  const room = live.createRoom({ teacherId:'teacher-time-ranking' });
  const fast = live.joinRoom(room.code, 'Fast learner');
  const steady = live.joinRoom(room.code, 'Steady learner');
  const slow = live.joinRoom(room.code, 'Slow learner');
  const checkpoint = (joined, checkpointId, activeSeconds) => live.checkpointRoom(room.code, joined.token, {
    checkpointId,
    stepId:'move-pointer',
    evidence:{ action:'pointer_enter', target:'blue-star' },
    baseScore:1300,
    correctInputs:8,
    mistakes:0,
    activeSeconds,
  });
  checkpoint(steady, 'steady-pointer', 30);
  checkpoint(slow, 'slow-pointer', 70);
  checkpoint(fast, 'fast-pointer', 20);
  const teacherRoom = live.teacherRooms('teacher-time-ranking')[0];
  assert.deepEqual(teacherRoom.leaderboard.map((player) => player.name), [
    'Fast learner',
    'Steady learner',
    'Slow learner',
  ]);
  assert.equal(teacherRoom.leaderboard[0].score, teacherRoom.leaderboard[1].score);
  assert.ok(teacherRoom.leaderboard[1].score > teacherRoom.leaderboard[2].score);
});

test('learner room responses never expose classmates performance', () => {
  const room = live.createRoom({ teacherId:'teacher-private-results' });
  const first = live.joinRoom(room.code, 'First learner');
  live.joinRoom(room.code, 'Second learner');
  live.checkpointRoom(room.code, first.token, {
    checkpointId:'private-pointer',
    stepId:'move-pointer',
    evidence:{ action:'pointer_enter', target:'blue-star' },
    baseScore:1300,
    correctInputs:5,
    mistakes:2,
    activeSeconds:25,
  });
  const learnerRoom = live.getRoomForParticipant(room.code, first.token);
  assert.equal(learnerRoom.participant.name, 'First learner');
  assert.equal(typeof learnerRoom.participant.score, 'number');
  assert.deepEqual(learnerRoom.room.leaderboard.map((player) => Object.keys(player).sort()), [
    ['id', 'name'],
    ['id', 'name'],
  ]);
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
    checkpointId: 'tara-keyboard-map',
    activityId: 'g3-keyboard-kingdom',
    stepId: 'keyboard-map',
    evidence: { action: 'find_keys', target: 'anchor-keys' },
    arcadeScore: 360,
  });
  assert.equal(grade3.participant.activityId, 'g3-keyboard-kingdom');
  assert.equal(grade3.participant.missionsCompleted, 1);
  assert.equal(grade3.participant.totalMissionsCompleted, 9);
  assert.equal(grade3.participant.missionCount, 10);
  assert.ok(grade3.participant.score > 360);
});

test('only the owning teacher can close a live room', () => {
  const room = live.createRoom({ teacherId: 'teacher-4' });
  assert.throws(() => live.closeRoom(room.code, 'teacher-other'), /another teacher/i);
  const closed = live.closeRoom(room.code, 'teacher-4');
  assert.equal(closed.status, 'closed');
  assert.equal(closed.endedReason, 'teacher_ended');
  assert.equal(live.getRoom(room.code).status, 'closed');
  assert.throws(() => live.joinRoom(room.code, 'Late learner'), /ended/i);
  assert.equal(live.createRoom({ teacherId:'teacher-4' }).status, 'open');
});

test('classwork duration begins when the teacher starts, not while learners wait', () => {
  const room = live.createRoom({ teacherId:'teacher-timer', mode:'classwork', durationMinutes:15 });
  assert.equal(room.durationMinutes, 15);
  assert.equal(room.gameEndsAt, null);
  const started = live.startRoom(room.code, 'teacher-timer');
  assert.ok(Date.parse(started.playStartsAt) - Date.parse(started.startedAt) >= 4000);
  assert.ok(Date.parse(started.gameEndsAt) - Date.parse(started.playStartsAt) >= 14 * 60 * 1000);
  assert.ok(started.remainingSeconds > 14 * 60);
});

test('teacher pause freezes the shared deadline and blocks learner checkpoints until resume', () => {
  const room = live.createRoom({ teacherId:'teacher-pause', mode:'classwork', durationMinutes:10 });
  const joined = live.joinRoom(room.code, { name:'Amina' });
  const started = live.startRoom(room.code, 'teacher-pause');
  const originalNow = Date.now;
  const playTime = Date.parse(started.playStartsAt) + 10_000;
  Date.now = () => playTime;
  try {
    assert.throws(() => live.setRoomPaused(room.code, 'another-teacher', true), /another teacher/i);
    const paused = live.setRoomPaused(room.code, 'teacher-pause', true);
    assert.equal(paused.phase, 'paused');
    assert.ok(paused.remainingSeconds >= 580 && paused.remainingSeconds <= 591);
    const frozen = paused.remainingSeconds;
    Date.now = () => playTime + 120_000;
    assert.equal(live.getRoomForParticipant(room.code, joined.token).room.remainingSeconds, frozen);
    assert.throws(() => live.checkpointRoom(room.code, joined.token, {
      checkpointId:'while-paused',
      stepId:'move-pointer',
      evidence:{ action:'pointer_enter', target:'blue-star' },
    }), /paused by your teacher/i);
    const resumed = live.setRoomPaused(room.code, 'teacher-pause', false);
    assert.equal(resumed.phase, 'playing');
    assert.ok(Math.abs(Date.parse(resumed.gameEndsAt) - Date.now() - frozen * 1000) < 1000);
  } finally {
    Date.now = originalNow;
  }
});

test('one server deadline closes teacher and learner views and rejects late play', () => {
  const room = live.createRoom({ teacherId:'teacher-shared-clock', mode:'classwork', durationMinutes:10 });
  const joined = live.joinRoom(room.code, { name:'Amina' });
  const started = live.startRoom(room.code, 'teacher-shared-clock');
  const originalNow = Date.now;
  Date.now = () => Date.parse(started.gameEndsAt) + 1;
  try {
    const teacherView = live.teacherRooms('teacher-shared-clock')[0];
    const learnerView = live.getRoomForParticipant(room.code, joined.token);
    assert.equal(teacherView.status, 'closed');
    assert.equal(learnerView.room.status, 'closed');
    assert.equal(teacherView.endedReason, 'time_up');
    assert.equal(learnerView.room.endedReason, 'time_up');
    assert.equal(learnerView.room.remainingSeconds, 0);
    assert.throws(() => live.checkpointRoom(room.code, joined.token, {
      checkpointId:'too-late',
      stepId:'move-pointer',
      evidence:{ action:'pointer_enter', target:'blue-star' },
    }), /ended/i);
  } finally {
    Date.now = originalNow;
  }
});

test('the server and both screens expose the live-room contract', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const player = fs.readFileSync(path.join(__dirname, '..', 'practice.html'), 'utf8');
  const teacher = fs.readFileSync(path.join(__dirname, '..', 'practice-teacher.html'), 'utf8');
  assert.match(server, /app\.post\('\/api\/practice\/live-sessions', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.post\('\/api\/practice\/live-sessions\/:code\/join', requirePracticeEnabled/);
  assert.match(server, /app\.post\('\/api\/practice\/live-sessions\/:code\/start', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.patch\('\/api\/practice\/live-sessions\/:code\/pause', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.patch\('\/api\/practice\/live-sessions\/:code\/audio', requirePracticeEnabled, requireAuth/);
  assert.match(server, /app\.post\('\/api\/practice\/live-sessions\/:code\/checkpoints', requirePracticeEnabled/);
  assert.match(player, /id="roomCodeInput"/);
  assert.match(player, /id="liveLobby"/);
  assert.match(player, /id="soloChoice"/);
  assert.match(player, /id="sfxBtn"/);
  assert.match(player, /id="musicBtn"/);
  assert.match(player, /id="voiceBtn"/);
  assert.match(player, /let voiceEnabled = audioPreferences\.voice === true/);
  assert.match(player, /function scheduleMusicPhrase\(\)/);
  assert.match(player, /audioPermissions\.musicPlayback === 'teacher'/);
  assert.match(player, /Music is playing from your teacher/);
  assert.match(player, /Your teacher switched/);
  assert.match(player, /soloChoice'\)\.hidden=Boolean\(requestedSessionCode\)/);
  assert.match(player, /function liveRoomWaiting\(room=liveRoom\)/);
  assert.match(player, /function runLiveStartCountdown\(room=liveRoom\)/);
  assert.match(player, /function showLiveRoomEnded\(room\)/);
  assert.match(player, /function syncLiveDeadline\(room=liveRoom\)/);
  assert.match(player, /Time is up - finishing the class game/);
  assert.match(player, /async function saveLiveCheckpoint\(payload\)/);
  assert.match(teacher, /Start live room/);
  assert.match(teacher, /Start class game/);
  assert.match(teacher, /id="teacherSfx"/);
  assert.match(teacher, /id="teacherMusic"/);
  assert.match(teacher, /id="teacherMusicSource"/);
  assert.match(teacher, /id="teacherMusicPlay"/);
  assert.match(teacher, /id="liveDuration"/);
  assert.match(teacher, /Final podium/);
  assert.match(teacher, /id="sessionBeacon"/);
  assert.match(teacher, /id="liveTelemetry"/);
  assert.match(teacher, /function scheduleTeacherMusic\(\)/);
  assert.match(teacher, /id="teacherVoice"/);
  assert.match(teacher, /\/api\/practice\/live-sessions/);
});
