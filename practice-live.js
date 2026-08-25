// Temporary, teacher-owned practice rooms. These are intentionally separate
// from permanent student evidence: a room stores only a short nickname and
// mission progress, then expires after one school day.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const practice = require('./practice');

const LIVE_DIR = path.join(DATA_DIR, 'practice', 'live-sessions');
const ROOM_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

const MISSION_GOALS = Object.freeze({
  'move-pointer': 8,
  'single-click': 8,
  'double-click': 6,
  'context-command': 5,
  'drag-drop': 5,
  'scroll-find': 4,
  'copy-paste-menu': 3,
  'keyboard-defense': 5,
  'copy-paste-shortcut': 3,
  'key-patrol': 8,
  'word-blaster': 7,
  'capital-charge': 5,
  'sentence-engine': 2,
  'repair-bay': 5,
});

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

function scoreForGoal(goal) {
  let score = 0;
  for (let combo = 1; combo <= goal; combo += 1) score += 100 + Math.min(5, combo - 1) * 20;
  return score;
}

function maximumScore(activity, completedSteps) {
  return activity.steps.slice(0, completedSteps).reduce((sum, step) => (
    sum + scoreForGoal(MISSION_GOALS[step.id] || 1)
  ), 0);
}

function progressFor(participant, activityId, room) {
  participant.activityProgress = participant.activityProgress || {};
  if (!participant.activityProgress[room.activityId]) {
    participant.activityProgress[room.activityId] = {
      currentStepIndex: participant.currentStepIndex || 0,
      status: participant.status || 'in_progress',
      checkpoints: participant.checkpoints || [],
      score: participant.score || 0,
      completedAt: participant.completedAt || null,
    };
  }
  if (!participant.activityProgress[activityId]) {
    participant.activityProgress[activityId] = {
      currentStepIndex: 0,
      status: 'in_progress',
      checkpoints: [],
      score: 0,
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
        status: active.status || 'in_progress',
      };
    })
    .sort((a, b) => b.totalMissionsCompleted - a.totalMissionsCompleted || b.score - a.score || a.name.localeCompare(b.name))
    .map((participant, index) => ({ ...participant, rank: index + 1 }));
}

function publicRoom(room) {
  const activity = practice.getActivity(room.activityId, room.activityVersion);
  return {
    code: room.code,
    status: roomIsOpen(room) ? 'open' : 'closed',
    activity: activity ? {
      id: activity.id,
      version: activity.version,
      title: activity.title,
      gradeBand: activity.gradeBand,
      missionCount: activity.steps.length,
    } : null,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    participantCount: (room.participants || []).length,
    leaderboard: publicLeaderboard(room),
  };
}

function createRoom({ teacherId, activityId = 'g2-pointer-control', ttlMs = DEFAULT_TTL_MS }) {
  if (teacherRooms(teacherId).length) {
    throw Object.assign(new Error('End the current live room before starting another one.'), { code: 'room_exists' });
  }
  const activity = practice.getActivity(activityId);
  if (!activity) throw Object.assign(new Error('Practice activity not found.'), { code: 'activity_not_found' });
  const now = Date.now();
  const safeTtl = Math.max(30 * 60 * 1000, Math.min(MAX_TTL_MS, Number(ttlMs) || DEFAULT_TTL_MS));
  const room = {
    code: generateCode(),
    teacherId: String(teacherId || ''),
    activityId: activity.id,
    activityVersion: activity.version,
    status: 'open',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + safeTtl).toISOString(),
    participants: [],
  };
  saveRoom(room);
  return publicRoom(room);
}

function joinRoom(code, nickname) {
  const room = requireOpenRoom(code);
  const requestedName = cleanName(nickname);
  if (!/\p{L}/u.test(requestedName)) {
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
    tokenHash: tokenHash(token),
    score: 0,
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
        completedAt: null,
      },
    },
  };
  room.participants.push(participant);
  saveRoom(room);
  return { room: publicRoom(room), participant: { id: participant.id, name: participant.name }, token };
}

function findParticipant(room, token) {
  const hash = tokenHash(token);
  return (room.participants || []).find((participant) => (
    participant.tokenHash && crypto.timingSafeEqual(Buffer.from(participant.tokenHash), Buffer.from(hash))
  ));
}

function checkpointRoom(code, token, input = {}) {
  const room = requireOpenRoom(code);
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
  const submittedScore = Math.max(0, Number.parseInt(input.arcadeScore, 10) || 0);
  progress.score = Math.max(progress.score || 0, Math.min(submittedScore, maximumScore(activity, nextStepIndex)));
  progress.currentStepIndex = nextStepIndex;
  progress.status = nextStepIndex >= activity.steps.length ? 'completed' : 'in_progress';
  participant.updatedAt = new Date().toISOString();
  progress.checkpoints.push({ checkpointId, stepId: expected.id, completedAt: participant.updatedAt });
  if (progress.status === 'completed') progress.completedAt = participant.updatedAt;
  participant.score = Object.values(participant.activityProgress).reduce((sum, item) => sum + (item.score || 0), 0);
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
      .map(publicRoom);
  } catch { return []; }
}

function closeRoom(code, teacherId) {
  const room = loadRoom(code);
  if (!room) throw Object.assign(new Error('Practice room not found.'), { code: 'room_not_found' });
  if (room.teacherId !== String(teacherId || '')) throw Object.assign(new Error('This room belongs to another teacher.'), { code: 'forbidden' });
  room.status = 'closed';
  room.expiresAt = new Date().toISOString();
  const result = publicRoom(room);
  try { fs.unlinkSync(roomPath(room.code)); } catch {}
  return result;
}

module.exports = {
  normalizeCode,
  cleanName,
  createRoom,
  joinRoom,
  checkpointRoom,
  getRoom,
  teacherRooms,
  closeRoom,
};
