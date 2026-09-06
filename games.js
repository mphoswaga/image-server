// Persistent student games. A game is created from a finished lesson and lives
// on its own (independent of the in-memory deck), so the shareable link keeps
// working. Each game stores its summary + questions; results are appended per
// student. All under DATA_DIR/games so it survives redeploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const colonyQuest = require('./public/colonyquest-core');

const GAMES_DIR = path.join(DATA_DIR, 'games');
const ROOMS_PATH = path.join(GAMES_DIR, '_rooms.json');
const gamePath = id => path.join(GAMES_DIR, `${id}.json`);
const resultsPath = id => path.join(GAMES_DIR, `${id}.results.json`);
const colonySessionPath = id => path.join(GAMES_DIR, `${id}.colonyquest.json`);
const isGameFile = f => f.endsWith('.json') && !f.endsWith('.results.json') && !f.endsWith('.colonyquest.json') && f !== '_rooms.json';
const normalizeStudentId = value => String(value || '').trim().replace(/\s+/g, '').toUpperCase();

// 6-char room code using unambiguous chars (no 0/O/1/I/L).
const ROOM_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function genRoomCode() {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) code += ROOM_CHARS[b % ROOM_CHARS.length];
  return code;
}

// Room-code index: { "XK9P4M": "gameId", ... } persisted at ROOMS_PATH.
function loadRooms() {
  try { return JSON.parse(fs.readFileSync(ROOMS_PATH, 'utf8')); } catch { return {}; }
}

function saveRooms(rooms) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  writeJsonAtomic(ROOMS_PATH, rooms);
}

function getRoomCode(code) {
  if (!code) return null;
  const rooms = loadRooms();
  return rooms[String(code).toUpperCase()] || null;
}

function defaultColonyQuestConfig() {
  return {
    ...colonyQuest.normalizeConfig({ teamCount: 4, matchType: 'rounds', rounds: 5, durationMinutes: 15, sound: true }),
    teams: Array.from({ length: 4 }, (_, index) => {
      const team = colonyQuest.createTeam({}, index);
      return { id: team.id, name: team.name, colorIndex: team.colorIndex, members: [] };
    }),
  };
}

function createGame({ teacherId, teacherName, lessonTitle, subject, topic, grade, game, rosterId, cutoffAt, mode }) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const id = crypto.randomUUID().slice(0, 8); // short + shareable
  const normalizedMode = mode === 'fishquest' ? 'fishquest' : mode === 'colonyquest' ? 'colonyquest' : 'arcade';
  const roomCode = normalizedMode === 'colonyquest' ? null : genRoomCode();
  const rec = {
    id, teacherId, teacherName: teacherName || '',
    lessonTitle: lessonTitle || topic, subject, topic, grade,
    roomCode,
    rosterId: rosterId || null,
    cutoffAt: cutoffAt || null,
    mode: normalizedMode,
    fishquest: normalizedMode === 'fishquest' ? { durationMinutes: 10, lateJoin: true, playMode: 'live' } : null,
    colonyquest: normalizedMode === 'colonyquest' ? defaultColonyQuestConfig() : null,
    summary: game.summary || { overview: game.overview || '', concepts: game.concepts || [] },
    questions: game.questions || [],
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(gamePath(id), rec);
  // Register room code in the index.
  const rooms = loadRooms();
  if (roomCode) {
    rooms[roomCode] = id;
    saveRooms(rooms);
  }
  return rec;
}

function getGame(id) {
  try { return JSON.parse(fs.readFileSync(gamePath(String(id)), 'utf8')); } catch { return null; }
}

function loadResults(id) {
  try { return JSON.parse(fs.readFileSync(resultsPath(String(id)), 'utf8')); } catch { return []; }
}

// Upsert a student's attempt — keep latest quiz score, keep BEST arcade score per game type.
function recordResult(id, { studentId, name, score, total, answers, arcadeScore, gameType, resultId, fishquest }) {
  studentId = normalizeStudentId(studentId);
  const results = loadResults(id);
  const at = new Date().toISOString();
  if (resultId && results.some(r => r.resultId === resultId)) return results;
  const existing = results.find(r => normalizeStudentId(r.studentId) === studentId);
  if (existing) {
    const as = existing.arcadeScores || {};
    if (gameType) as[gameType] = Math.max(as[gameType] || 0, arcadeScore || 0);
    const fishquestHistory = fishquest ? [...(existing.fishquestHistory || []), { ...fishquest, resultId, at }].slice(-20) : (existing.fishquestHistory || []);
    Object.assign(existing, { name, score, total, answers, at, attempts: (existing.attempts || 1) + 1, arcadeScores: as, gameType, resultId: resultId || null, fishquest: fishquest || null, fishquestHistory });
  } else {
    const arcadeScores = {};
    if (gameType) arcadeScores[gameType] = arcadeScore || 0;
    results.push({ studentId, name, score, total, answers, at, attempts: 1, arcadeScores, gameType: gameType || null, resultId: resultId || null, fishquest: fishquest || null, fishquestHistory: fishquest ? [{ ...fishquest, resultId, at }] : [] });
  }
  writeJsonAtomic(resultsPath(id), results);
  return results;
}

function getResults(id) { return loadResults(id); }

// Returns the anonymous high score for each game type across all students.
function getHighScores(id) {
  const hs = { car: 0, space: 0, runner: 0 };
  for (const r of loadResults(id)) {
    if (r.arcadeScores) {
      for (const t of ['car', 'space', 'runner']) hs[t] = Math.max(hs[t], r.arcadeScores[t] || 0);
    }
  }
  return hs;
}

function listTeacherGames(teacherId) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  return fs.readdirSync(GAMES_DIR)
    .filter(isGameFile)
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8')); } catch { return null; } })
    .filter(g => g && g.teacherId === teacherId)
    .map(g => ({
      id: g.id, lessonTitle: g.lessonTitle, subject: g.subject, topic: g.topic, grade: g.grade,
      questionCount: (g.questions || []).length, createdAt: g.createdAt, plays: loadResults(g.id).length,
      roomCode: g.roomCode || null, rosterId: g.rosterId || null, cutoffAt: g.cutoffAt || null,
      mode: g.mode || 'arcade',
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function updateGameCutoff(id, cutoffAt) {
  const p = gamePath(String(id));
  if (!fs.existsSync(p)) return null;
  const g = JSON.parse(fs.readFileSync(p, 'utf8'));
  g.cutoffAt = cutoffAt || null;
  writeJsonAtomic(p, g);
  return g;
}

function updateFishQuest(id, config) {
  const p = gamePath(String(id));
  if (!fs.existsSync(p)) return null;
  const g = JSON.parse(fs.readFileSync(p, 'utf8'));
  const durationMinutes = Math.min(30, Math.max(3, Number(config.durationMinutes) || 10));
  g.fishquest = { durationMinutes, lateJoin: config.lateJoin !== false, playMode: config.playMode === 'homework' ? 'homework' : 'live' };
  if (Array.isArray(config.questions)) {
    g.questions = config.questions.map((q, i) => ({
      question: String(q.question || '').trim(),
      options: Array.isArray(q.options) ? q.options.map(v => String(v || '').trim()).slice(0, 4) : [],
      correctIndex: Number(q.correctIndex),
      explanation: String(q.explanation || '').trim(),
    })).filter(q => q.question && q.options.length >= 2 && Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length);
  }
  if (!g.questions.length) throw new Error('Add at least one complete question.');
  writeJsonAtomic(p, g);
  return g;
}

function updateColonyQuest(id, config = {}) {
  const p = gamePath(String(id));
  if (!fs.existsSync(p)) return null;
  const g = JSON.parse(fs.readFileSync(p, 'utf8'));
  const existing = g.colonyquest || defaultColonyQuestConfig();
  const normalized = colonyQuest.normalizeConfig({ ...existing, ...config });
  const requestedTeams = Array.isArray(config.teams) ? config.teams : existing.teams;
  const teams = Array.from({ length: normalized.teamCount }, (_, index) => {
    const source = requestedTeams[index] || {};
    const team = colonyQuest.createTeam(source, index);
    return { id: team.id, name: team.name, colorIndex: team.colorIndex, members: team.members };
  });
  g.colonyquest = { ...normalized, teams };
  if (Array.isArray(config.questions)) {
    g.questions = config.questions.map(q => ({
      question: String(q && q.question || '').trim().slice(0, 500),
      options: Array.isArray(q && q.options) ? q.options.map(value => String(value || '').trim().slice(0, 250)).slice(0, 4) : [],
      correctIndex: Number(q && q.correctIndex),
      explanation: String(q && q.explanation || '').trim().slice(0, 1000),
    })).filter(q => q.question && q.options.filter(Boolean).length >= 2 && Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length && q.options[q.correctIndex]).slice(0, 40);
  }
  if (!g.questions.length) throw new Error('Add at least one complete question.');
  writeJsonAtomic(p, g);
  return g;
}

function getColonyQuestSession(id) {
  try { return JSON.parse(fs.readFileSync(colonySessionPath(String(id)), 'utf8')); }
  catch { return null; }
}

function saveColonyQuestSession(id, session) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const normalized = colonyQuest.normalizeSession(session);
  if (normalized.teams.length < 2) throw new Error('ColonyQuest needs at least two teams.');
  const record = {
    ...normalized,
    updatedAt: new Date().toISOString(),
    summary: normalized.phase === 'ended' ? colonyQuest.sessionSummary(normalized) : null,
  };
  writeJsonAtomic(colonySessionPath(String(id)), record);
  return record;
}

function clearColonyQuestSession(id) {
  const p = colonySessionPath(String(id));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return true;
}

module.exports = {
  createGame, getGame, recordResult, getResults, getHighScores, listTeacherGames, getRoomCode,
  updateGameCutoff, updateFishQuest, updateColonyQuest, getColonyQuestSession,
  saveColonyQuestSession, clearColonyQuestSession, normalizeStudentId,
};
