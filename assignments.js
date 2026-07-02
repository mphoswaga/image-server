// Persistent online assignments (worksheet/exit-ticket/quiz sent to students to
// complete online) — parallel to games.js but for lesson-pack content instead
// of MCQ-only games. Free-text answers get graded by AI against the teacher's
// answer key; a TEACHER-CONFIRMED verdict is cached per question so a later
// student's exact rephrasing doesn't need a fresh AI call — but an unconfirmed
// AI verdict is never reused on its own, so a bad guess can't silently repeat.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const DIR = path.join(DATA_DIR, 'assignments');
const ROOMS_PATH = path.join(DIR, '_rooms.json');
const recPath = id => path.join(DIR, `${id}.json`);
const subsPath = id => path.join(DIR, `${id}.submissions.json`);
const verdictsPath = id => path.join(DIR, `${id}.verdicts.json`);
const isAssignmentFile = f => f.endsWith('.json') && !f.endsWith('.submissions.json') && !f.endsWith('.verdicts.json') && f !== '_rooms.json';

// 6-char room code using unambiguous chars (no 0/O/1/I/L) — same alphabet as games.js.
const ROOM_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function genRoomCode() {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) code += ROOM_CHARS[b % ROOM_CHARS.length];
  return code;
}

function loadRooms() {
  try { return JSON.parse(fs.readFileSync(ROOMS_PATH, 'utf8')); } catch { return {}; }
}
function saveRooms(rooms) {
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonAtomic(ROOMS_PATH, rooms);
}
function getRoomCode(code) {
  if (!code) return null;
  const rooms = loadRooms();
  return rooms[String(code).toUpperCase()] || null;
}

// Give every question a stable ID + explicit marks + answerKey, regardless of
// pack type, so submissions/grading/verdicts can all key off `questionId`
// instead of array position (which would break if a teacher edits the pack).
function normalizeContent(data, type) {
  let n = 0;
  const nextId = () => `q${n++}`;
  if (type === 'worksheet') {
    const answerKey = data.answerKey || [];
    const questions = (data.questions || []).map((q, i) => ({ id: nextId(), question: q, kind: 'text', marks: 1, answerKey: answerKey[i] || '' }));
    const challenge = data.challenge
      ? { id: nextId(), question: data.challenge, kind: 'text', marks: 2, answerKey: answerKey[(data.questions || []).length] || '' }
      : null;
    return { title: data.title, instructions: data.focus || '', questions: challenge ? [...questions, challenge] : questions };
  }
  if (type === 'exit-ticket') {
    const answerKey = data.answerKey || [];
    const questions = (data.questions || []).map((q, i) => ({ id: nextId(), question: q, kind: 'text', marks: 1, answerKey: answerKey[i] || '' }));
    return { title: data.title, instructions: '', questions };
  }
  // quiz — mcq is already auto-gradable (has correctIndex); shortAnswer already has marks.
  const mcq = (data.mcq || []).map(q => ({ id: nextId(), question: q.question, kind: 'mcq', options: q.options, correctIndex: q.correctIndex, marks: 1 }));
  const shortAnswer = (data.shortAnswer || []).map(q => ({ id: nextId(), question: q.question, kind: 'text', marks: q.marks || 1, answerKey: q.answer || '' }));
  return { title: data.title, instructions: data.instructions || '', questions: [...mcq, ...shortAnswer] };
}

function createAssignment({ teacherId, teacherName, type, subject, topic, grade, data, rosterId, cutoffAt }) {
  fs.mkdirSync(DIR, { recursive: true });
  const id = crypto.randomUUID().slice(0, 8); // short + shareable, same convention as games
  const roomCode = genRoomCode();
  const content = normalizeContent(data, type);
  const rec = {
    id, teacherId, teacherName: teacherName || '',
    type, title: content.title || topic, subject, topic, grade,
    roomCode, rosterId: rosterId || null, cutoffAt: cutoffAt || null,
    content,
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(recPath(id), rec);
  const rooms = loadRooms();
  rooms[roomCode] = id;
  saveRooms(rooms);
  return rec;
}

function getAssignment(id) {
  try { return JSON.parse(fs.readFileSync(recPath(String(id)), 'utf8')); } catch { return null; }
}

function updateAssignmentCutoff(id, cutoffAt) {
  const rec = getAssignment(id);
  if (!rec) return null;
  rec.cutoffAt = cutoffAt || null;
  writeJsonAtomic(recPath(id), rec);
  return rec;
}

// ── Submissions ──────────────────────────────────────────────────────────
function loadSubmissions(id) {
  try { return JSON.parse(fs.readFileSync(subsPath(String(id)), 'utf8')); } catch { return []; }
}
function saveSubmission(id, sub) {
  const subs = loadSubmissions(id);
  const i = subs.findIndex(s => s.studentId === sub.studentId);
  if (i >= 0) subs[i] = sub; else subs.push(sub);
  writeJsonAtomic(subsPath(id), subs);
  return subs;
}
function getSubmissions(id) { return loadSubmissions(id); }
function getSubmission(id, studentId) { return loadSubmissions(id).find(s => s.studentId === studentId) || null; }

// ── Verdict cache: per-question list of gradings, some teacher-confirmed ───
function loadVerdicts(id) {
  try { return JSON.parse(fs.readFileSync(verdictsPath(String(id)), 'utf8')); } catch { return {}; }
}
function saveVerdicts(id, v) {
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonAtomic(verdictsPath(id), v);
}

function normalizeAnswer(text) {
  return String(text || '').toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// Only reuse a CONFIRMED verdict, and only on an exact normalized-text match —
// never guesses off a fuzzy/semantic match. Returns null on a miss (caller
// falls back to a fresh AI grading call).
function findConfirmedVerdict(id, questionId, answerText) {
  const v = loadVerdicts(id);
  const list = v[questionId] || [];
  const norm = normalizeAnswer(answerText);
  if (!norm) return null;
  return list.find(e => e.confirmed && e.normalizedAnswer === norm) || null;
}

// Store a grading result keyed on the exact normalized answer text for this
// question. `confirmed` starts false for a fresh AI verdict — it only becomes
// reusable once a teacher confirms/corrects it (see confirmVerdict below).
function recordVerdict(id, questionId, { answerText, marksAwarded, verdict, rationale, confirmed = false, source = 'ai' }) {
  const v = loadVerdicts(id);
  const list = v[questionId] || (v[questionId] = []);
  const norm = normalizeAnswer(answerText);
  let entry = list.find(e => e.normalizedAnswer === norm);
  if (entry) Object.assign(entry, { marksAwarded, verdict, rationale, confirmed, source });
  else list.push({ normalizedAnswer: norm, marksAwarded, verdict, rationale, confirmed, source });
  saveVerdicts(id, v);
  return entry;
}

function listTeacherAssignments(teacherId) {
  fs.mkdirSync(DIR, { recursive: true });
  return fs.readdirSync(DIR)
    .filter(isAssignmentFile)
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } })
    .filter(a => a && a.teacherId === teacherId)
    .map(a => ({
      id: a.id, type: a.type, title: a.title, subject: a.subject, topic: a.topic, grade: a.grade,
      createdAt: a.createdAt, roomCode: a.roomCode, rosterId: a.rosterId, cutoffAt: a.cutoffAt,
      submissions: loadSubmissions(a.id).length,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = {
  createAssignment, getAssignment, updateAssignmentCutoff, getRoomCode,
  saveSubmission, getSubmissions, getSubmission,
  findConfirmedVerdict, recordVerdict, normalizeAnswer,
  listTeacherAssignments,
};
