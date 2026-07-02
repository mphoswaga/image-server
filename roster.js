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

// Find a Student ID across EVERY teacher's rosters (a Student ID is only
// unique within one teacher's classes, not school-wide) — powers the
// no-login "my work" lookup: a student types their ID once and sees every
// class/roster it appears in, across however many teachers use this ID.
function findStudentAcrossAllTeachers(studentId) {
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return [];
  const matches = [];
  for (const teacherId of fs.readdirSync(usersDir)) {
    const dir = rosterDir(teacherId);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const s = r.students.find(s => s.id === studentId);
        if (s) matches.push({ teacherId, rosterId: r.id, rosterName: r.name, name: s.name });
      } catch {}
    }
  }
  return matches;
}

// Find student within a specific roster. Returns { id, name } or null.
function findStudentInRoster(teacherId, rosterId, studentId) {
  const r = getRoster(teacherId, rosterId);
  if (!r) return null;
  return r.students.find(s => s.id === studentId) || null;
}

// ── File parsing (CSV + Excel) for roster import ────────────────────────────

const xlsx = require('xlsx');

// Header-name patterns that suggest a student-ID column.
const ID_PATTERNS = /^(student[\s_-]?id|stud[\s_-]?id|learner[\s_-]?id|pupil[\s_-]?id|roll[\s_-]?no|reg[\s_-]?no|admission[\s_-]?no|id|no|number|student[\s_-]?no|learner[\s_-]?no)$/i;
// Header-name patterns that suggest a display-name column.
const NAME_PATTERNS = /^(full[\s_-]?name|first[\s_-]?name|last[\s_-]?name|given[\s_-]?name|student[\s_-]?name|learner[\s_-]?name|pupil[\s_-]?name|surname|name|display[\s_-]?name)$/i;

function detectIdCol(headers) {
  return headers.find(h => ID_PATTERNS.test(h.trim())) || null;
}

function detectNameCol(headers) {
  return headers.find(h => NAME_PATTERNS.test(h.trim())) || null;
}

// Parse a Buffer into { headers, rows, totalRows, detectedIdCol, detectedNameCol }.
// Supports .xlsx, .xls (via SheetJS) and CSV / TSV / plain text.
function parseRosterFile(buffer, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  let headers, rows;

  if (ext === 'xlsx' || ext === 'xls') {
    const wb = xlsx.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!data.length) throw new Error('Spreadsheet appears to be empty.');
    headers = data[0].map(h => String(h == null ? '' : h).trim()).filter(h => h !== '');
    if (!headers.length) throw new Error('Could not read column headers from the spreadsheet.');
    rows = data.slice(1)
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = String(row[i] == null ? '' : row[i]).trim(); });
        return obj;
      })
      .filter(r => headers.some(h => r[h]));
  } else {
    // CSV / TSV / TXT
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('File is empty.');
    const sep = lines[0].includes('\t') ? '\t' : ',';
    headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim());
    rows = lines.slice(1).map(line => {
      const cells = line.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] || ''; });
      return obj;
    }).filter(r => headers.some(h => r[h]));
  }

  const detectedIdCol = detectIdCol(headers) || headers[0] || null;
  const detectedNameCol = detectNameCol(headers) || (headers.length > 1 ? headers[1] : null);

  return { headers, rows, totalRows: rows.length, detectedIdCol, detectedNameCol };
}

// Convert parsed rows to [{ id, name }] using teacher-confirmed column choices.
function buildStudentsFromMapping(rows, idCol, nameCol) {
  const out = [];
  for (const row of rows) {
    const id = (row[idCol] || '').trim();
    const name = nameCol ? (row[nameCol] || '').trim() : '';
    if (id) out.push({ id, name: name || id });
  }
  return out;
}

module.exports = {
  saveRoster, getRoster, listRosters, deleteRoster,
  findStudent, findStudentInRoster, findStudentAcrossAllTeachers, parseCSV,
  parseRosterFile, buildStudentsFromMapping,
};
