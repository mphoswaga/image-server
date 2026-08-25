// Teacher-owned practice rooms are intentionally separate from permanent
// student evidence. Classwork uses an eight-hour lobby/game window; homework
// stays open for seven days. Both expire automatically.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const practice = require('./practice');
const scoring = require('./public/practice-scoring');

const LIVE_DIR = path.join(DATA_DIR, 'practice', 'live-sessions');
const ROOM_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const DEFAULT_CLASSWORK_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_HOMEWORK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function roomPath(code) {
  return path.join(LIVE_DIR, `${normalizeCode(code)}.json`);
}

function normalizeCode(value) {
  return String(value || '').trim().replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6);
}

function cleanName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function cleanRosterName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function normalizeMode(value) {
  return String(value || '').toLowerCase() === 'classwork' ? 'classwork' : 'homework';
}

function normalizeAudioPolicy(value) {
  const policy = value && typeof value === 'object' ? value : {};
  return {
    soundEffects: policy.soundEffects !== false,
    music: policy.music !== false,
    voice: policy.voice !== false,
  };
}

function identityKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function studentIdKey(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function roomPhase(room) {
  if (room.phase === 'lobby' || room.phase === 'playing') return room.phase;
  return 'playing';
}

function rosterSnapshot(value) {
  if (!value || !value.id || !Array.isArray(value.students)) return null;
  return {
    id: String(value.id),
    name: String(value.name || 'Class roster').trim().slice(0, 80),
    students: value.students.map((student) => ({
      id: String(student && student.id || '').trim().slice(0, 120),
      name: cleanRosterName(student && student.name) || String(student && student.id || '').trim().slice(0, 120),
    })).filter((student) => student.id),
  };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function loadRoom(code) {
  try { return JSON.parse(fs.readFileSync(roomPath(code), 'utf8')); }
  catch { return null; }
}

function saveRoom(room) {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  room.updatedAt = new Date().toISOString();
  writeJsonAtomic(roomPath(room.code), room);
  return room;
}

function roomIsOpen(room, now = Date.now()) {
  return Boolean(room && room.status === 'open' && Date.parse(room.expiresAt) > now);
}

function requireOpenRoom(code) {
  const room = loadRoom(code);
  if (!room) throw Object.assign(new Error('That room code was not found.'), { code: 'room_not_found' });
  if (!roomIsOpen(room)) {
    try { fs.unlinkSync(roomPath(room.code)); } catch {}
    throw Object.assign(new Error('That practice room has ended.'), { code: 'room_closed' });
  }
  return room;
}

function generateCode() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bytes = crypto.randomBytes(6);
    let code = '';
    for (const byte of bytes) code += ROOM_CHARS[byte % ROOM_CHARS.length];
    if (!fs.existsSync(roomPath(code))) return code;
  }
  throw new Error('A room code could not be created. Please try again.');
}

function maximumScore(activity, completedSteps) {
  return scoring.maximumBaseScore(activity.steps, completedSteps);
}

function progressFor(participant, activityId, room) {
  participant.activityProgress = participant.activityProgress || {};
  if (!participant.activityProgress[room.activityId]) {
    participant.activityProgress[room.activityId] = {
      currentStepIndex: participant.currentStepIndex || 0,
      status: participant.status || 'in_progress',
      checkpoints: participant.checkpoints || [],
      score: participant.score || 0,
      baseScore: participant.baseScore || participant.score || 0,
      correctInputs: participant.correctInputs || 0,
      mistakes: participant.mistakes || 0,
      activeSeconds: participant.activeSeconds || 0,
      completedAt: participant.completedAt || null,
    };
  }
  if (!participant.activityProgress[activityId]) {
    participant.activityProgress[activityId] = {
      currentStepIndex: 0,
      status: 'in_progress',
      checkpoints: [],
      score: 0,
      baseScore: 0,
      correctInputs: 0,
      mistakes: 0,
      activeSeconds: 0,
      completedAt: null,
    };
  }
  return participant.activityProgress[activityId];
}

function allowedActivity(room, participant, activityId) {
  const wanted = String(activityId || room.activityId);
  if (wanted === room.activityId) return practice.getActivity(room.activityId, room.activityVersion);
  if (room.activityId !== 'g2-pointer-control' || wanted !== 'g3-keyboard-kingdom') return null;
  const foundation = progressFor(participant, room.activityId, room);
  if (foundation.status !== 'completed') return null;
  return practice.getActivity('g3-keyboard-kingdom');
}

function publicLeaderboard(room) {
  return (room.participants || [])
    .map((participant) => {
      const activeActivityId = participant.activeActivityId || room.activityId;
      const activeActivity = practice.getActivity(activeActivityId);
      const active = progressFor(participant, activeActivityId, room);
      const allProgress = Object.values(participant.activityProgress || {});
      return {
        id: participant.id,
        name: participant.name,
        score: allProgress.reduce((sum, item) => sum + (item.score || 0), 0),
        missionsCompleted: active.currentStepIndex || 0,
        totalMissionsCompleted: allProgress.reduce((sum, item) => sum + (item.currentStepIndex || 0), 0),
        missionCount: activeActivity ? activeActivity.steps.length : 0,
        activityId: activeActivityId,
        activityTitle: activeActivity ? activeActivity.title : '',
        accuracyPercent: scoring.summarize({
          baseScore: active.baseScore || active.score || 0,
          correctInputs: active.correctInputs || 0,
          mistakes: active.mistakes || 0,
          activeSeconds: active.activeSeconds || 0,
          targetSeconds: activeActivity ? scoring.targetSecondsForSteps(activeActivity.steps, active.currentStepIndex) : 1,
        }).accuracyPercent,
        mistakes: active.mistakes || 0,
        activeSeconds: active.activeSeconds || 0,
        status: active.status || 'in_progress',
      };
    })
    .sort((a, b) => b.totalMissionsCompleted - a.totalMissionsCompleted || b.score - a.score || a.name.localeCompare(b.name))
    .map((participant, index) => ({ ...participant, rank: index + 1 }));
}

function roomAttendance(room) {
  if (!room.roster || !Array.isArray(room.roster.students)) return [];
  const joined = new Map((room.participants || [])
    .filter((participant) => participant.rosterStudentId)
    .map((participant) => [studentIdKey(participant.rosterStudentId), participant]));
  return room.roster.students.map((student) => {
    const participant = joined.get(studentIdKey(student.id));
    return {
      studentId: student.id,
      name: student.name,
      joined: Boolean(participant),
      joinedAt: participant ? participant.joinedAt : null,
    };
  });
}

function publicRoom(room, { teacherView = false } = {}) {
  const activity = practice.getActivity(room.activityId, room.activityVersion);
  const attendance = teacherView ? roomAttendance(room) : [];
  const result = {
    code: room.code,
    status: roomIsOpen(room) ? 'open' : 'closed',
    mode: normalizeMode(room.mode),
    phase: roomPhase(room),
    activity: activity ? {
      id: activity.id,
      version: activity.version,
      title: activity.title,
      gradeBand: activity.gradeBand,
      missionCount: activity.steps.length,
    } : null,
    createdAt: room.createdAt,
    startedAt: room.startedAt || null,
    expiresAt: room.expiresAt,
    participantCount: (room.participants || []).length,
    audioPolicy: normalizeAudioPolicy(room.audioPolicy),
    roster: room.roster ? { name: room.roster.name, count: room.roster.students.length } : null,
    leaderboard: publicLeaderboard(room),
  };
  if (teacherView) {
    result.attendance = attendance;
    result.joinedRosterCount = attendance.filter((student) => student.joined).length;
    result.absentRosterCount = attendance.filter((student) => !student.joined).length;
  }
  return result;
}

function createRoom({ teacherId, activityId = 'g2-pointer-control', mode = 'homework', roster = null, audioPolicy = null, ttlMs }) {
  if (teacherRooms(teacherId).length) {
    throw Object.assign(new Error('End the current live room before starting another one.'), { code: 'room_exists' });
  }
  const activity = practice.getActivity(activityId);
  if (!activity) throw Object.assign(new Error('Practice activity not found.'), { code: 'activity_not_found' });
  const safeMode = normalizeMode(mode);
  const safeRoster = rosterSnapshot(roster);
  const now = Date.now();
  const defaultTtl = safeMode === 'classwork' ? DEFAULT_CLASSWORK_TTL_MS : DEFAULT_HOMEWORK_TTL_MS;
  const safeTtl = Math.max(30 * 60 * 1000, Math.min(MAX_TTL_MS, Number(ttlMs) || defaultTtl));
  const room = {
    code: generateCode(),
    teacherId: String(teacherId || ''),
    activityId: activity.id,
    activityVersion: activity.version,
    mode: safeMode,
    phase: safeMode === 'classwork' ? 'lobby' : 'playing',
    audioPolicy: normalizeAudioPolicy(audioPolicy),
    roster: safeRoster,
    status: 'open',
    createdAt: new Date(now).toISOString(),
    startedAt: safeMode === 'homework' ? new Date(now).toISOString() : null,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + safeTtl).toISOString(),
    participants: [],
  };
  saveRoom(room);
  return publicRoom(room, { teacherView: true });
}

function joinRoom(code, input) {
  const room = requireOpenRoom(code);
  const requestedValue = typeof input === 'object' && input
    ? String(input.studentId || input.name || '')
    : String(input || '');
  let requestedName = cleanName(requestedValue);
  let rosterStudentId = null;

  if (room.roster && Array.isArray(room.roster.students)) {
    const wanted = identityKey(requestedValue);
    const wantedStudentId = studentIdKey(requestedValue);
    const idMatch = room.roster.students.find((student) => studentIdKey(student.id) === wantedStudentId);
    const nameMatches = room.roster.students.filter((student) => identityKey(student.name) === wanted);
    const matched = idMatch || (nameMatches.length === 1 ? nameMatches[0] : null);
    if (!matched && nameMatches.length > 1) {
      throw Object.assign(new Error('More than one learner has that name. Enter your Student ID.'), { code: 'ambiguous_student' });
    }
    if (!matched) {
      throw Object.assign(new Error(`That learner is not in ${room.roster.name}. Check the Student ID or full roster name.`), { code: 'student_not_in_roster' });
    }
    rosterStudentId = matched.id;
    requestedName = matched.name;
    const existing = (room.participants || []).find((participant) => studentIdKey(participant.rosterStudentId) === studentIdKey(rosterStudentId));
    if (existing) {
      const token = crypto.randomBytes(24).toString('base64url');
      existing.tokenHash = tokenHash(token);
      existing.updatedAt = new Date().toISOString();
      saveRoom(room);
      return { room: publicRoom(room), participant: { id: existing.id, name: existing.name }, token, rejoined: true };
    }
  }
  if (!rosterStudentId && !/\p{L}/u.test(requestedName)) {
    throw Object.assign(new Error('Enter a first name or nickname.'), { code: 'invalid_name' });
  }
  if (room.participants.length >= 100) throw Object.assign(new Error('This practice room is full.'), { code: 'room_full' });

  const usedNames = new Set(room.participants.map((participant) => participant.name.toLocaleLowerCase()));
  let name = requestedName;
  for (let suffix = 2; usedNames.has(name.toLocaleLowerCase()); suffix += 1) {
    const ending = ` ${suffix}`;
    name = `${requestedName.slice(0, 24 - ending.length).trimEnd()}${ending}`;
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const participant = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    name,
    rosterStudentId,
    tokenHash: tokenHash(token),
    score: 0,
    baseScore: 0,
    correctInputs: 0,
    mistakes: 0,
    activeSeconds: 0,
    currentStepIndex: 0,
    status: 'in_progress',
    checkpoints: [],
    joinedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    activeActivityId: room.activityId,
    activityProgress: {
      [room.activityId]: {
        currentStepIndex: 0,
        status: 'in_progress',
        checkpoints: [],
        score: 0,
        baseScore: 0,
        correctInputs: 0,
        mistakes: 0,
        activeSeconds: 0,
        completedAt: null,
      },
    },
  };
  room.participants.push(participant);
  saveRoom(room);
  return { room: publicRoom(room), participant: { id: participant.id, name: participant.name }, token };
}

function startRoom(code, teacherId) {
  const room = requireOpenRoom(code);
  if (room.teacherId !== String(teacherId || '')) {
    throw Object.assign(new Error('This room belongs to another teacher.'), { code: 'forbidden' });
  }
  if (normalizeMode(room.mode) !== 'classwork') return publicRoom(room, { teacherView: true });
  if (roomPhase(room) !== 'playing') {
    room.phase = 'playing';
    room.startedAt = new Date().toISOString();
    saveRoom(room);
  }
  return publicRoom(room, { teacherView: true });
}

function updateRoomAudio(code, teacherId, audioPolicy) {
  const room = requireOpenRoom(code);
  if (room.teacherId !== String(teacherId || '')) {
    throw Object.assign(new Error('This room belongs to another teacher.'), { code: 'forbidden' });
  }
  room.audioPolicy = normalizeAudioPolicy(audioPolicy);
  saveRoom(room);
  return publicRoom(room, { teacherView: true });
}

function findParticipant(room, token) {
  const hash = tokenHash(token);
  return (room.participants || []).find((participant) => (
    participant.tokenHash && crypto.timingSafeEqual(Buffer.from(participant.tokenHash), Buffer.from(hash))
  ));
}

function checkpointRoom(code, token, input = {}) {
  const room = requireOpenRoom(code);
  if (normalizeMode(room.mode) === 'classwork' && roomPhase(room) !== 'playing') {
    throw Object.assign(new Error('Wait for your teacher to start the class game.'), { code: 'room_not_started' });
  }
  const participant = findParticipant(room, token);
  if (!participant) throw Object.assign(new Error('Rejoin the room to continue.'), { code: 'participant_not_found' });
  const activityId = String(input.activityId || room.activityId);
  const activity = allowedActivity(room, participant, activityId);
  if (!activity) {
    throw Object.assign(new Error('Complete Foundation World before continuing to Grade 3.'), { code: 'activity_locked' });
  }
  const progress = progressFor(participant, activity.id, room);
  participant.activeActivityId = activity.id;
  if (progress.status === 'completed') {
    throw Object.assign(new Error('This practice run is already complete.'), { code: 'attempt_complete' });
  }

  const checkpointId = String(input.checkpointId || '').trim().slice(0, 100);
  if (!checkpointId) throw Object.assign(new Error('Checkpoint ID is required.'), { code: 'invalid_checkpoint' });
  if (progress.checkpoints.some((checkpoint) => checkpoint.checkpointId === checkpointId)) {
    return { room: publicRoom(room), participant: publicLeaderboard(room).find((item) => item.id === participant.id), idempotent: true };
  }

  const expected = activity.steps[progress.currentStepIndex];
  if (!expected || String(input.stepId || '') !== expected.id) {
    throw Object.assign(new Error(`Complete ${expected ? expected.title : 'the current mission'} before continuing.`), { code: 'step_out_of_order' });
  }
  const evidence = input.evidence || {};
  if (evidence.action !== expected.action || evidence.target !== expected.target) {
    throw Object.assign(new Error('The required skill action could not be confirmed.'), { code: 'invalid_evidence' });
  }

  const nextStepIndex = progress.currentStepIndex + 1;
  const submittedBaseScore = Math.max(0, Number.parseInt(input.baseScore ?? input.arcadeScore, 10) || 0);
  progress.baseScore = Math.max(progress.baseScore || 0, Math.min(submittedBaseScore, maximumScore(activity, nextStepIndex)));
  progress.correctInputs = Math.min(10000, (progress.correctInputs || 0) + Math.max(0, Number.parseInt(input.correctInputs, 10) || 0));
  progress.mistakes = Math.min(1000, (progress.mistakes || 0) + Math.max(0, Number.parseInt(input.mistakes, 10) || 0));
  progress.activeSeconds = Math.min(7200, (progress.activeSeconds || 0) + Math.max(1, Number.parseInt(input.activeSeconds, 10) || 1));
  progress.score = scoring.summarize({
    baseScore: progress.baseScore,
    correctInputs: progress.correctInputs,
    mistakes: progress.mistakes,
    activeSeconds: progress.activeSeconds,
    targetSeconds: scoring.targetSecondsForSteps(activity.steps, nextStepIndex),
  }).score;
  progress.currentStepIndex = nextStepIndex;
  progress.status = nextStepIndex >= activity.steps.length ? 'completed' : 'in_progress';
  participant.updatedAt = new Date().toISOString();
  progress.checkpoints.push({
    checkpointId,
    stepId: expected.id,
    correctInputs: Math.max(0, Number.parseInt(input.correctInputs, 10) || 0),
    mistakes: Math.max(0, Number.parseInt(input.mistakes, 10) || 0),
    activeSeconds: Math.max(1, Number.parseInt(input.activeSeconds, 10) || 1),
    completedAt: participant.updatedAt,
  });
  if (progress.status === 'completed') progress.completedAt = participant.updatedAt;
  participant.score = Object.values(participant.activityProgress).reduce((sum, item) => sum + (item.score || 0), 0);
  participant.baseScore = Object.values(participant.activityProgress).reduce((sum, item) => sum + (item.baseScore || 0), 0);
  participant.correctInputs = Object.values(participant.activityProgress).reduce((sum, item) => sum + (item.correctInputs || 0), 0);
  participant.mistakes = Object.values(participant.activityProgress).reduce((sum, item) => sum + (item.mistakes || 0), 0);
  participant.activeSeconds = Object.values(participant.activityProgress).reduce((sum, item) => sum + (item.activeSeconds || 0), 0);
  participant.currentStepIndex = progress.currentStepIndex;
  participant.status = progress.status;
  participant.checkpoints = progress.checkpoints;
  participant.completedAt = progress.completedAt;
  saveRoom(room);
  return { room: publicRoom(room), participant: publicLeaderboard(room).find((item) => item.id === participant.id), idempotent: false };
}

function getRoom(code) {
  return publicRoom(requireOpenRoom(code));
}

function teacherRooms(teacherId) {
  try {
    return fs.readdirSync(LIVE_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(LIVE_DIR, name), 'utf8')); }
        catch { return null; }
      })
      .filter((room) => {
        if (!room) return false;
        if (!roomIsOpen(room)) {
          try { fs.unlinkSync(roomPath(room.code)); } catch {}
          return false;
        }
        return room.teacherId === String(teacherId || '');
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((room) => publicRoom(room, { teacherView: true }));
  } catch { return []; }
}

function closeRoom(code, teacherId) {
  const room = loadRoom(code);
  if (!room) throw Object.assign(new Error('Practice room not found.'), { code: 'room_not_found' });
  if (room.teacherId !== String(teacherId || '')) throw Object.assign(new Error('This room belongs to another teacher.'), { code: 'forbidden' });
  room.status = 'closed';
  room.expiresAt = new Date().toISOString();
  const result = publicRoom(room, { teacherView: true });
  try { fs.unlinkSync(roomPath(room.code)); } catch {}
  return result;
}

module.exports = {
  normalizeCode,
  cleanName,
  createRoom,
  joinRoom,
  startRoom,
  updateRoomAudio,
  checkpointRoom,
  getRoom,
  teacherRooms,
  closeRoom,
};
