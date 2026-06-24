// Class roster management. Each teacher can have multiple named rosters.
// Stored at DATA_DIR/users/<teacherId>/rosters/<id>.json.
// A roster contains a list of { id, name } entries — the "id" is the opaque
// Student ID (e.g. STU-99432); the "name" is the real name that stays on the
// teacher's side only, never in the game results database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

function rosterDir(teacherId) {
  return path.join(DATA_DIR, 'users', teacherId, 'rosters');
}

function rosterPath(teacherId, id) {
  return path.join(rosterDir(teacherId), id + '.json');
}

// Parse a CSV string (studentId,name — header row optional).
// Returns [{ id, name }].
function parseCSV(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const id = line.slice(0, comma).trim();
    const name = line.slice(comma + 1).trim().replace(/^"|"$/g, '');
    if (!id || id.toLowerCase() === 'studentid' || id.toLowerCase() === 'id') continue;
    if (id) out.push({ id, name: name || id });
  }
  return out;
}

function saveRoster(teacherId, { name, students, csvText }) {
  fs.mkdirSync(rosterDir(teacherId), { recursive: true });
  const parsedStudents = csvText ? parseCSV(csvText) : (Array.isArray(students) ? students : []);
  if (!parsedStudents.length) throw new Error('No valid students found. Use format: studentId,name');
  const id = crypto.randomUUID().split('-')[0];
  const record = {
    id,
    name: String(name || 'Class roster').trim(),
    students: parsedStudents,
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(rosterPath(teacherId, id), record);
  return record;
}

function getRoster(teacherId, id) {
  try { return JSON.parse(fs.readFileSync(rosterPath(teacherId, id), 'utf8')); }
  catch { return null; }
}

function listRosters(teacherId) {
  const dir = rosterDir(teacherId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { id: r.id, name: r.name, count: r.students.length, createdAt: r.createdAt };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function deleteRoster(teacherId, id) {
  const p = rosterPath(teacherId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// Find a student by ID across all of a teacher's rosters.
// Returns { id, name, rosterId } or null.
function findStudent(teacherId, studentId) {
  const dir = rosterDir(teacherId);
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const s = r.students.find(s => s.id === studentId);
      if (s) return { id: s.id, name: s.name, rosterId: r.id };
    } catch {}
  }
  return null;
}

// Find student within a specific roster. Returns { id, name } or null.
function findStudentInRoster(teacherId, rosterId, studentId) {
  const r = getRoster(teacherId, rosterId);
  if (!r) return null;
  return r.students.find(s => s.id === studentId) || null;
}

module.exports = { saveRoster, getRoster, listRosters, deleteRoster, findStudent, findStudentInRoster, parseCSV };
