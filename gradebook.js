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

// The full students × assessments matrix for one class.
function buildGradebook(userId, rosterId) {
  const rs = roster.getRoster(userId, rosterId);
  if (!rs) return null;
  const students = rs.students || [];

  const asgs = assignments.listTeacherAssignments(userId).filter(a => a.rosterId === rosterId);
  const gms = games.listTeacherGames(userId).filter(g => g.rosterId === rosterId);

  const assessments = [];
  const cells = {}; // studentId -> { assessmentId -> { mark, max, pct } }
  students.forEach(s => { cells[s.id] = {}; });

  for (const a of asgs) {
    const byStu = Object.fromEntries(assignments.getSubmissions(a.id).map(x => [x.studentId, x]));
    const pcts = [];
    students.forEach(s => {
      const sub = byStu[s.id];
      if (!sub) return;
      const max = sub.maxMarks || 0, pct = pctOf(sub.totalMarks, max);
      cells[s.id][a.id] = { mark: sub.totalMarks, max, pct };
      pcts.push(pct);
    });
    assessments.push({ id: a.id, kind: 'assignment', type: a.type, title: a.title, at: a.createdAt, average: mean(pcts), done: pcts.length });
  }

  for (const g of gms) {
    const byStu = Object.fromEntries(games.getResults(g.id).map(x => [x.studentId, x]));
    const pcts = [];
    students.forEach(s => {
      const r = byStu[s.id];
      if (!r) return;
      const max = r.total || 0, pct = pctOf(r.score, max);
      cells[s.id][g.id] = { mark: r.score, max, pct };
      pcts.push(pct);
    });
    assessments.push({ id: g.id, kind: 'game', type: 'game', title: g.lessonTitle, at: g.createdAt, average: mean(pcts), done: pcts.length });
  }

  assessments.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const rows = students.map(s => {
    const c = cells[s.id];
    const pcts = Object.values(c).map(x => x.pct);
    return { studentId: s.id, name: s.name, cells: c, average: mean(pcts), done: pcts.length };
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

module.exports = { listClasses, buildGradebook, toWorkbook };
