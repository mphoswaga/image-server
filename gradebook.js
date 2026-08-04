// Cross-assessment marks aggregation: pulls a teacher's assignments and games
// together into one class gradebook (students × assessments), plus the numbers
// teachers actually ask for — per-student and per-assessment averages, a class
// average, and who hasn't done each thing yet.
//
// A gradebook is per class (roster). Free-form assignments/games (no rosterId)
// have no fixed student list, so they're excluded — they can't be gradebooked.
const XLSX = require('xlsx');
const games = require('./games');
const assignments = require('./assignments');
const roster = require('./roster');

// The classes a teacher can open a gradebook for, with how much is in each.
function listClasses(userId) {
  const rosters = roster.listRosters(userId);
  const asgs = assignments.listTeacherAssignments(userId);
  const gms = games.listTeacherGames(userId);
  return rosters.map(r => ({
    rosterId: r.id,
    name: r.name,
    students: r.count,
    assignments: asgs.filter(a => a.rosterId === r.id).length,
    games: gms.filter(g => g.rosterId === r.id).length,
  })).filter(c => c.assignments + c.games > 0 || c.students > 0);
}

// A percentage in [0,1] from a mark/max, guarding divide-by-zero.
const pctOf = (mark, max) => (max > 0 ? mark / max : 0);
const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const sid = value => roster.normalizeStudentId(value);

// The full students × assessments matrix for one class.
function buildGradebook(userId, rosterId) {
  const rs = roster.getRoster(userId, rosterId);
  if (!rs) return null;
  const students = rs.students || [];

  const asgs = assignments.listTeacherAssignments(userId).filter(a => a.rosterId === rosterId);
  const gms = games.listTeacherGames(userId).filter(g => g.rosterId === rosterId);

  const assessments = [];
  const cells = {}; // studentId -> { assessmentId -> { mark, max, pct } }
  students.forEach(s => { cells[sid(s.id)] = {}; });

  for (const a of asgs) {
    const byStu = Object.fromEntries(assignments.getSubmissions(a.id).map(x => [sid(x.studentId), x]));
    const pcts = [];
    students.forEach(s => {
      const studentId = sid(s.id);
      const sub = byStu[studentId];
      if (!sub) return;
      const max = sub.maxMarks || 0, pct = pctOf(sub.totalMarks, max);
      cells[studentId][a.id] = { mark: sub.totalMarks, max, pct };
      pcts.push(pct);
    });
    assessments.push({ id: a.id, kind: 'assignment', type: a.type, title: a.title, at: a.createdAt, average: mean(pcts), done: pcts.length });
  }

  for (const g of gms) {
    const byStu = Object.fromEntries(games.getResults(g.id).map(x => [sid(x.studentId), x]));
    const pcts = [];
    students.forEach(s => {
      const studentId = sid(s.id);
      const r = byStu[studentId];
      if (!r) return;
      const max = r.total || 0, pct = pctOf(r.score, max);
      cells[studentId][g.id] = { mark: r.score, max, pct };
      pcts.push(pct);
    });
    assessments.push({ id: g.id, kind: 'game', type: 'game', title: g.lessonTitle, at: g.createdAt, average: mean(pcts), done: pcts.length });
  }

  assessments.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const rows = students.map(s => {
    const studentId = sid(s.id);
    const c = cells[studentId];
    const pcts = Object.values(c).map(x => x.pct);
    return { studentId, name: s.name, cells: c, average: mean(pcts), done: pcts.length };
  });

  const classAverage = mean(rows.map(r => r.average).filter(x => x != null));
  return { rosterId, name: rs.name, students, assessments, rows, classAverage };
}

// Export the matrix as an .xlsx workbook (marks as "3/8", plus an average %).
function toWorkbook(gb) {
  const header = ['Student', ...gb.assessments.map(a => a.title), 'Average %'];
  const body = gb.rows.map(r => [
    r.name,
    ...gb.assessments.map(a => { const c = r.cells[a.id]; return c ? `${c.mark}/${c.max}` : ''; }),
    r.average != null ? Math.round(r.average * 100) : '',
  ]);
  const footer = ['Class average', ...gb.assessments.map(a => a.average != null ? Math.round(a.average * 100) + '%' : ''), gb.classAverage != null ? Math.round(gb.classAverage * 100) : ''];
  const ws = XLSX.utils.aoa_to_sheet([header, ...body, [], footer]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Marks');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ── Shared helpers for the external (/api/v1) API ──────────────────────────
// A single student's assessment history across games AND assignments, as a
// flat list of comparable rows. `teacherIds` scopes the search (one teacher
// for an OAuth token, all teachers for an admin key). Also surfaces the
// student's display name (rosters are the only place names live).
function gatherStudentResults(teacherIds, studentId) {
  studentId = sid(studentId);
  const rows = [];
  let name = null;
  for (const tid of teacherIds) {
    for (const g of games.listTeacherGames(tid)) {
      for (const r of games.getResults(g.id)) {
        if (sid(r.studentId) !== studentId) continue;
        if (r.name && !name) name = r.name;
        rows.push({ kind: 'game', assessmentId: g.id, title: g.lessonTitle, subject: g.subject || null, topic: g.topic || null,
          mark: r.score, max: r.total, percentage: r.total > 0 ? Math.round((r.score / r.total) * 100) : 0, at: r.at });
      }
    }
    for (const a of assignments.listTeacherAssignments(tid)) {
      for (const sub of assignments.getSubmissions(a.id)) {
        if (sid(sub.studentId) !== studentId) continue;
        if (sub.name && !name) name = sub.name;
        rows.push({ kind: 'assignment', type: a.type, assessmentId: a.id, title: a.title, subject: a.subject || null, topic: a.topic || null,
          mark: sub.totalMarks, max: sub.maxMarks, percentage: sub.maxMarks > 0 ? Math.round((sub.totalMarks / sub.maxMarks) * 100) : 0, at: sub.submittedAt || a.createdAt });
      }
    }
  }
  // roster name fallback (a student may have results under a display name only)
  if (!name) {
    for (const tid of teacherIds) {
      for (const rs of roster.listRosters(tid)) {
        const full = roster.getRoster(tid, rs.id);
        const s = full && full.students.find(x => sid(x.id) === studentId);
        if (s) { name = s.name; break; }
      }
      if (name) break;
    }
  }
  rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return { name, rows };
}

// A performance summary purpose-built for report-comment generation: an
// overall average plus per-subject strengths and weaknesses (which topics the
// student does best/worst in), across games and assignments together.
function summarizeStudent(rows) {
  const pct = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const overall = {
    averagePercentage: pct(rows.map(r => r.percentage)),
    assessmentsCompleted: rows.length,
    gamesPlayed: rows.filter(r => r.kind === 'game').length,
    assignmentsCompleted: rows.filter(r => r.kind === 'assignment').length,
  };
  const bySubjectMap = {};
  for (const r of rows) {
    const subj = r.subject || 'general';
    (bySubjectMap[subj] ||= { subject: subj, pcts: [], topics: {} });
    bySubjectMap[subj].pcts.push(r.percentage);
    const t = r.topic || r.title || 'general';
    (bySubjectMap[subj].topics[t] ||= []).push(r.percentage);
  }
  const bySubject = Object.values(bySubjectMap).map(s => {
    const topicAvgs = Object.entries(s.topics).map(([topic, ps]) => ({ topic, percentage: pct(ps) }));
    topicAvgs.sort((a, b) => b.percentage - a.percentage);
    return {
      subject: s.subject,
      averagePercentage: pct(s.pcts),
      assessments: s.pcts.length,
      strongest: topicAvgs[0] || null,
      weakest: topicAvgs.length > 1 ? topicAvgs[topicAvgs.length - 1] : null,
    };
  }).sort((a, b) => b.averagePercentage - a.averagePercentage);
  return { overall, bySubject };
}

// Per-teacher list of assignment result rows (mirrors the games shape used by
// the existing /api/v1 endpoints), so assignments can be folded in alongside.
function assignmentResultRows(teacherId) {
  const out = [];
  for (const a of assignments.listTeacherAssignments(teacherId)) {
    for (const sub of assignments.getSubmissions(a.id)) {
      out.push({
        kind: 'assignment', type: a.type, assignmentId: a.id, rosterId: a.rosterId || null,
        studentId: sub.studentId, subject: a.subject || null, topic: a.topic || null, title: a.title,
        score: sub.totalMarks, total: sub.maxMarks,
        percentage: sub.maxMarks > 0 ? Math.round((sub.totalMarks / sub.maxMarks) * 100) : 0,
        at: sub.submittedAt || a.createdAt,
      });
    }
  }
  return out;
}

module.exports = { listClasses, buildGradebook, toWorkbook, gatherStudentResults, summarizeStudent, assignmentResultRows };
