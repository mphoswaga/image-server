// Persistent student games. A game is created from a finished lesson and lives
// on its own (independent of the in-memory deck), so the shareable link keeps
// working. Each game stores its summary + questions; results are appended per
// student. All under DATA_DIR/games so it survives redeploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const GAMES_DIR = path.join(DATA_DIR, 'games');
const ROOMS_PATH = path.join(GAMES_DIR, '_rooms.json');
const gamePath = id => path.join(GAMES_DIR, `${id}.json`);
const resultsPath = id => path.join(GAMES_DIR, `${id}.results.json`);
const isGameFile = f => f.endsWith('.json') && !f.endsWith('.results.json') && f !== '_rooms.json';

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

function createGame({ teacherId, teacherName, lessonTitle, subject, topic, grade, game, rosterId }) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const id = crypto.randomUUID().slice(0, 8); // short + shareable
  const roomCode = genRoomCode();
  const rec = {
    id, teacherId, teacherName: teacherName || '',
    lessonTitle: lessonTitle || topic, subject, topic, grade,
    roomCode,
    rosterId: rosterId || null,
    summary: game.summary || { overview: game.overview || '', concepts: game.concepts || [] },
    questions: game.questions || [],
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(gamePath(id), rec);
  // Register room code in the index.
  const rooms = loadRooms();
  rooms[roomCode] = id;
  saveRooms(rooms);
  return rec;
}

function getGame(id) {
  try { return JSON.parse(fs.readFileSync(gamePath(String(id)), 'utf8')); } catch { return null; }
}

function loadResults(id) {
  try { return JSON.parse(fs.readFileSync(resultsPath(String(id)), 'utf8')); } catch { return []; }
}

// Upsert a student's attempt — keep latest quiz score, keep BEST arcade score per game type.
function recordResult(id, { studentId, name, score, total, answers, arcadeScore, gameType }) {
  const results = loadResults(id);
  const at = new Date().toISOString();
  const existing = results.find(r => r.studentId === studentId);
  if (existing) {
    const as = existing.arcadeScores || {};
    if (gameType) as[gameType] = Math.max(as[gameType] || 0, arcadeScore || 0);
    Object.assign(existing, { name, score, total, answers, at, attempts: (existing.attempts || 1) + 1, arcadeScores: as, gameType });
  } else {
    const arcadeScores = {};
    if (gameType) arcadeScores[gameType] = arcadeScore || 0;
    results.push({ studentId, name, score, total, answers, at, attempts: 1, arcadeScores, gameType: gameType || null });
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
      roomCode: g.roomCode || null, rosterId: g.rosterId || null,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = { createGame, getGame, recordResult, getResults, getHighScores, listTeacherGames, getRoomCode };
