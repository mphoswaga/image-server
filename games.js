// Persistent student games. A game is created from a finished lesson and lives
// on its own (independent of the in-memory deck), so the shareable link keeps
// working. Each game stores its summary + questions; results are appended per
// student. All under DATA_DIR/games so it survives redeploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const GAMES_DIR = path.join(DATA_DIR, 'games');
const gamePath = id => path.join(GAMES_DIR, `${id}.json`);
const resultsPath = id => path.join(GAMES_DIR, `${id}.results.json`);
const isGameFile = f => f.endsWith('.json') && !f.endsWith('.results.json');

function createGame({ teacherId, teacherName, lessonTitle, subject, topic, grade, game }) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const id = crypto.randomUUID().slice(0, 8); // short + shareable
  const rec = {
    id, teacherId, teacherName: teacherName || '',
    lessonTitle: lessonTitle || topic, subject, topic, grade,
    summary: game.summary || { overview: game.overview || '', concepts: game.concepts || [] },
    questions: game.questions || [],
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(gamePath(id), rec);
  return rec;
}

function getGame(id) {
  try { return JSON.parse(fs.readFileSync(gamePath(String(id)), 'utf8')); } catch { return null; }
}

function loadResults(id) {
  try { return JSON.parse(fs.readFileSync(resultsPath(String(id)), 'utf8')); } catch { return []; }
}

// Upsert a student's attempt — keep their latest score, count attempts.
function recordResult(id, { studentId, name, score, total, answers }) {
  const results = loadResults(id);
  const at = new Date().toISOString();
  const existing = results.find(r => r.studentId === studentId);
  if (existing) {
    Object.assign(existing, { name, score, total, answers, at, attempts: (existing.attempts || 1) + 1 });
  } else {
    results.push({ studentId, name, score, total, answers, at, attempts: 1 });
  }
  writeJsonAtomic(resultsPath(id), results);
  return results;
}

function getResults(id) { return loadResults(id); }

function listTeacherGames(teacherId) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  return fs.readdirSync(GAMES_DIR)
    .filter(isGameFile)
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8')); } catch { return null; } })
    .filter(g => g && g.teacherId === teacherId)
    .map(g => ({
      id: g.id, lessonTitle: g.lessonTitle, subject: g.subject, topic: g.topic, grade: g.grade,
      questionCount: (g.questions || []).length, createdAt: g.createdAt, plays: loadResults(g.id).length,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = { createGame, getGame, recordResult, getResults, listTeacherGames };
