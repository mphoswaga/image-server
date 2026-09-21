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
const isIndividuallyGradedGame = game => game.mode !== 'colonyquest';
const FINAL_ASSESSMENT_GRADE_SOURCES = new Set(['auto', 'teacher', 'ai-confirmed']);

// Releasing controls only what learners can see. A complete, valid item-level
// mark is official teacher evidence as soon as it is saved, so LessonScope and
// TeacherScope analysis must not downgrade it merely because it is hidden from
// learners. This helper is retained for record locking and release history.
function isFinalisedAssessment(record) {
  if (!record) return false;
  if (record.type !== 'assessment') return true;
  return record.resultsReleased === true
    && record.status === 'finalised'
    && Boolean(String(record.finalisedAt || '').trim());
}

function isAssessmentOnRecord(record) {
  if (!record || record.type !== 'assessment') return true;
  return record.teacherMarked === true || isFinalisedAssessment(record);
}

// Return one canonical score for a submission, or null while any assessment
// item still needs a teacher decision. Assessment totals are rebuilt from the
// item grades rather than trusting a possibly stale submission total.
function teacherSubmissionResult(record, sub) {
  if (!record || !sub) return null;
  if (record.type !== 'assessment') {
    const mark = Number(sub.totalMarks) || 0;
    const max = Number(sub.maxMarks) || 0;
    return { mark, max };
  }
  const questions = record.content && Array.isArray(record.content.questions)
    ? record.content.questions
    : [];
  if (!questions.length) return null;

  let mark = 0;
  let itemTotal = 0;
  for (const question of questions) {
    const grade = (sub.grades || {})[question.id];
    const awarded = Number(grade && grade.marksAwarded);
    const available = Number(question.marks);
    if (!grade || !FINAL_ASSESSMENT_GRADE_SOURCES.has(grade.source)
      || grade.marksAwarded == null || grade.marksAwarded === ''
      || !Number.isFinite(awarded) || !Number.isFinite(available)
      || available <= 0 || awarded < 0 || awarded > available) return null;
    mark += awarded;
    itemTotal += available;
  }

  const configuredTotal = Number(record.totalMarks);
  if (Number.isFinite(configuredTotal) && configuredTotal > 0 && configuredTotal !== itemTotal) return null;
  return { mark, max: configuredTotal > 0 ? configuredTotal : itemTotal };
}

function assignmentRecord(summary) {
  return assignments.getAssignment(summary.id) || summary;
}

function objectiveEvidenceForSubmission(record, sub) {
  if (!record || record.type !== 'assessment') return [];
  const objectiveText = new Map((record.objectives || []).map(objective => [objective.id, objective.text]));
  return (record.content && Array.isArray(record.content.questions) ? record.content.questions : []).flatMap(question => {
    const grade = (sub.grades || {})[question.id] || {};
    if (!FINAL_ASSESSMENT_GRADE_SOURCES.has(grade.source)) return [];
    const teacherConfirmed = grade.source === 'teacher' || grade.source === 'ai-confirmed';
    return (question.objectiveIds || []).map(objectiveId => ({
      objectiveId, objective: objectiveText.get(objectiveId) || objectiveId,
      sectionId: question.sectionId || null, section: question.sectionTitle || null,
      itemId: question.id, item: question.question, evidenceType: question.kind,
      score: Number(grade.marksAwarded) || 0, total: question.marks,
      percentage: question.marks > 0 ? Math.round(((Number(grade.marksAwarded) || 0) / question.marks) * 100) : 0,
      teacherConfirmed, automaticallyMarked: grade.source === 'auto',
      source: grade.source, at: record.finalisedAt || sub.submittedAt || record.createdAt,
    }));
  });
}

function boundedText(value, max = 700) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function submittedAnswer(sub, question, index) {
  const answers = sub && sub.answers;
  if (Array.isArray(answers)) return answers[index];
  if (answers && typeof answers === 'object') return answers[question.id];
  return undefined;
}

function answerDisplay(question, answer) {
  if (answer === undefined || answer === null || answer === '') return '';
  if (question.kind === 'mcq' && Array.isArray(question.options)) {
    const selectedIndex = Number(answer);
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < question.options.length) {
      return boundedText(question.options[selectedIndex], 500);
    }
  }
  return boundedText(answer, 500);
}

// Question-level evidence is deliberately separate from objective evidence:
// every covered item survives the LessonScope -> TeacherScope sync, even when
// a teacher did not map that item to a tracker objective. Unmarked responses
// remain coverage-only evidence and therefore cannot inflate progress.
function questionEvidenceForSubmission(record, sub) {
  if (!record || !sub) return [];
  const questions = record.content && Array.isArray(record.content.questions)
    ? record.content.questions
    : [];
  const objectiveText = new Map((record.objectives || []).map(objective => [objective.id, objective.text]));
  return questions.map((question, index) => {
    const answer = submittedAnswer(sub, question, index);
    const grade = (sub.grades || {})[question.id] || (sub.observationGrades || {})[question.id] || {};
    const available = Number(question.marks);
    let awarded = grade.marksAwarded === null || grade.marksAwarded === undefined || grade.marksAwarded === ''
      ? NaN
      : Number(grade.marksAwarded);
    let source = boundedText(grade.source, 80);
    let automaticallyMarked = source === 'auto';

    if (!Number.isFinite(awarded) && question.kind === 'mcq' && Number.isInteger(Number(answer))) {
      awarded = Number(answer) === Number(question.correctIndex) ? available : 0;
      source = 'auto';
      automaticallyMarked = true;
    }
    const scored = Number.isFinite(available) && available > 0 && Number.isFinite(awarded);
    const score = scored ? Math.max(0, Math.min(available, awarded)) : null;
    const expectedAnswer = question.kind === 'mcq' && Array.isArray(question.options)
      ? question.options[Number(question.correctIndex)]
      : question.answerKey;
    const objectiveIds = Array.isArray(question.objectiveIds) ? question.objectiveIds : [];
    return {
      itemId: question.id || `question-${index + 1}`,
      item: boundedText(question.question, 700),
      sectionId: question.sectionId || null,
      section: question.sectionTitle || null,
      evidenceType: question.kind || 'text',
      objectiveIds,
      objectives: objectiveIds.map(id => objectiveText.get(id) || id),
      attempted: answer !== undefined && answer !== null && answer !== '' || scored,
      attemptCount: answer !== undefined && answer !== null && answer !== '' || scored ? 1 : 0,
      supportUsed: false,
      studentResponse: answerDisplay(question, answer),
      expectedAnswer: boundedText(expectedAnswer, 500),
      score,
      total: Number.isFinite(available) && available > 0 ? available : null,
      percentage: scored ? Math.round((score / available) * 100) : null,
      correct: scored ? score === available : null,
      teacherConfirmed: source === 'teacher' || source === 'ai-confirmed',
      automaticallyMarked,
      source: source || 'submitted',
      rationale: boundedText(grade.rationale, 500),
      at: record.finalisedAt || sub.submittedAt || record.createdAt,
    };
  }).filter(item => item.item);
}

function gameQuestionEvidence(game, result) {
  if (!game || !result || !Array.isArray(game.questions)) return [];
  return game.questions.map((question, index) => {
    const answer = Array.isArray(result.answers) ? result.answers[index]
      : result.answers && typeof result.answers === 'object' ? result.answers[index] ?? result.answers[`q${index}`] : undefined;
    const selectedIndex = Number(answer);
    const attempted = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < (question.options || []).length;
    const correct = attempted ? selectedIndex === Number(question.correctIndex) : null;
    const fishAttempts = Array.isArray(result.fishquest && result.fishquest.attempts)
      ? result.fishquest.attempts.filter(item => Number(item.questionIndex) === index)
      : [];
    return {
      itemId: `question-${index + 1}`,
      item: boundedText(question.question, 700),
      evidenceType: 'mcq',
      attempted,
      attemptCount: fishAttempts.length || (attempted ? 1 : 0),
      supportUsed: fishAttempts.some(item => item.outcome === 'timeout'),
      studentResponse: attempted ? boundedText(question.options[selectedIndex], 500) : '',
      expectedAnswer: boundedText((question.options || [])[Number(question.correctIndex)], 500),
      score: attempted ? (correct ? 1 : 0) : null,
      total: attempted ? 1 : null,
      percentage: attempted ? (correct ? 100 : 0) : null,
      correct,
      teacherConfirmed: false,
      automaticallyMarked: true,
      source: 'auto',
      rationale: boundedText(question.explanation, 500),
      at: result.at || game.createdAt,
    };
  }).filter(item => item.item);
}

const classNameKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const rosterStudentIds = record => new Set((record && record.students || []).map(student => roster.normalizeStudentId(student.id)).filter(Boolean));
function equivalentClassRosters(left, right) {
  if (!left || !right || classNameKey(left.name) !== classNameKey(right.name)) return false;
  const a = rosterStudentIds(left), b = rosterStudentIds(right);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const id of a) if (b.has(id)) shared += 1;
  const union = new Set([...a, ...b]).size;
  return shared === a.size && shared === b.size
    || shared >= 5 && shared / Math.min(a.size, b.size) >= 0.8 && shared / union >= 0.7;
}

function relatedClassRosters(allRosters, selected) {
  const related = [selected];
  const included = new Set([selected.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of allRosters) {
      if (included.has(candidate.id) || !related.some(item => equivalentClassRosters(item, candidate))) continue;
      included.add(candidate.id);
      related.push(candidate);
      changed = true;
    }
  }
  return related;
}

// The classes a teacher can open a gradebook for, with how much is in each.
function listClasses(userId) {
  const rosters = roster.listRosters(userId).map(item => roster.getRoster(userId, item.id)).filter(Boolean);
  const asgs = assignments.listTeacherAssignments(userId)
    .filter(assignment => assignment.type !== 'assessment' || assignment.teacherMarked || assignment.resultsReleased);
  const gms = games.listTeacherGames(userId).filter(isIndividuallyGradedGame);
  const consumed = new Set();
  const classes = [];
  for (const r of rosters) {
    if (consumed.has(r.id)) continue;
    const group = relatedClassRosters(rosters, r);
    group.forEach(item => consumed.add(item.id));
    const rosterIds = new Set(group.map(item => item.id));
    const studentIds = new Set(group.flatMap(item => (item.students || []).map(student => sid(student.id))));
    const assignmentCount = new Set(asgs.filter(a => rosterIds.has(a.rosterId)).map(a => a.id)).size;
    const gameCount = new Set(gms.filter(g => [...rosterIds].some(id => games.hasRoster(g, id))).map(g => g.id)).size;
    classes.push({
      rosterId: r.id,
      rosterIds: [...rosterIds],
      name: r.name,
      students: studentIds.size,
      assignments: assignmentCount,
      games: gameCount,
    });
  }
  return classes.filter(c => c.assignments + c.games > 0 || c.students > 0);
}

// A percentage in [0,1] from a mark/max, guarding divide-by-zero.
const pctOf = (mark, max) => (max > 0 ? mark / max : 0);
const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const sid = value => roster.normalizeStudentId(value);
const weightedMean = entries => {
  const usable = entries.filter(entry => entry && entry.pct != null && entry.weight > 0);
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  return totalWeight ? usable.reduce((sum, entry) => sum + entry.pct * entry.weight, 0) / totalWeight : null;
};

// The full students × assessments matrix for one class.
function buildGradebook(userId, rosterId) {
  const rs = roster.getRoster(userId, rosterId);
  if (!rs) return null;
  const allRosters = roster.listRosters(userId).map(item => roster.getRoster(userId, item.id)).filter(Boolean);
  const relatedRosters = relatedClassRosters(allRosters, rs);
  const rosterIds = new Set(relatedRosters.map(record => record.id));
  const studentsById = new Map();
  for (const record of relatedRosters) {
    for (const student of record.students || []) {
      const studentId = sid(student.id);
      if (!studentId) continue;
      const existing = studentsById.get(studentId);
      studentsById.set(studentId, existing ? { ...student, ...existing } : student);
    }
  }
  const students = [...studentsById.values()];
  const excludedIds = new Set(relatedRosters.flatMap(record => (record.gradebookExcludedIds || []).map(String)));
  const weights = {};
  for (const record of [...relatedRosters].reverse()) {
    for (const [id, weight] of Object.entries(record.gradebookWeights || {})) {
      const normalized = Math.min(10, Math.max(0, Number(weight)));
      if (id && Number.isFinite(normalized)) weights[String(id)] = normalized;
    }
  }
  for (const id of excludedIds) if (!(id in weights)) weights[id] = 0;
  const weightFor = id => {
    const key = String(id);
    return key in weights ? weights[key] : 1;
  };

  const asgs = assignments.listTeacherAssignments(userId)
    .filter(a => rosterIds.has(a.rosterId))
    .map(a => ({ summary: a, record: assignmentRecord(a) }))
    .filter(({ record }) => isAssessmentOnRecord(record));
  // ColonyQuest records team/class evidence. It must not create blank or
  // manufactured individual marks in a learner gradebook.
  const gms = games.listTeacherGames(userId).filter(g => [...rosterIds].some(id => games.hasRoster(g, id)) && isIndividuallyGradedGame(g));

  const assessments = [];
  const cells = {}; // studentId -> { assessmentId -> { mark, max, pct } }
  students.forEach(s => { cells[sid(s.id)] = {}; });

  for (const { summary: a, record } of asgs) {
    const byStu = Object.fromEntries(assignments.getSubmissions(a.id).map(x => [sid(x.studentId), x]));
    const pcts = [];
    students.forEach(s => {
      const studentId = sid(s.id);
      const sub = byStu[studentId];
      if (!sub) return;
      const result = teacherSubmissionResult(record, sub);
      if (!result) return;
      const { mark, max } = result;
      const pct = pctOf(mark, max);
      cells[studentId][a.id] = { mark, max, pct };
      pcts.push(pct);
    });
    const weight = weightFor(a.id);
    assessments.push({ id: a.id, kind: 'assignment', type: a.type, title: a.title, weight, excluded: weight <= 0,
      provisional: false,
      teacherMarked: record.type === 'assessment' ? !!record.teacherMarked : true,
      officialRecordedAt: record.type === 'assessment' ? (record.teacherMarkedAt || null) : (record.createdAt || a.createdAt || null),
      learnerVisible: assignments.isReleased(record),
      at: record.type === 'assessment' ? (record.finalisedAt || record.createdAt || a.createdAt) : a.createdAt,
      average: mean(pcts), done: pcts.length });
  }

  for (const g of gms) {
    const byStu = Object.fromEntries(games.getResults(g.id)
      .filter(result => !result.rosterId || rosterIds.has(result.rosterId))
      .map(x => [sid(x.studentId), x]));
    const pcts = [];
    students.forEach(s => {
      const studentId = sid(s.id);
      const r = byStu[studentId];
      if (!r) return;
      const max = r.total || 0, pct = pctOf(r.score, max);
      cells[studentId][g.id] = { mark: r.score, max, pct };
      pcts.push(pct);
    });
    const weight = weightFor(g.id);
    assessments.push({ id: g.id, kind: 'game', type: 'game', title: g.lessonTitle, weight, excluded: weight <= 0, at: g.createdAt, average: mean(pcts), done: pcts.length });
  }

  assessments.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const rows = students.map(s => {
    const studentId = sid(s.id);
    const c = cells[studentId];
    const weighted = Object.entries(c).map(([id, x]) => ({ pct: x.pct, weight: weightFor(id) }));
    const done = weighted.filter(entry => entry.pct != null && entry.weight > 0).length;
    return { studentId, name: s.name, cells: c, average: weightedMean(weighted), done };
  });

  const classAverage = mean(rows.map(r => r.average).filter(x => x != null));
  return { rosterId, rosterIds: [...rosterIds], name: rs.name, students, assessments, rows, classAverage, excludedIds: Object.keys(weights).filter(id => weights[id] === 0), weights };
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
    for (const g of games.listTeacherGames(tid).filter(isIndividuallyGradedGame)) {
      for (const r of games.getResults(g.id)) {
        if (sid(r.studentId) !== studentId) continue;
        if (r.name && !name) name = r.name;
        rows.push({ kind: 'game', assessmentId: g.id, title: g.lessonTitle, subject: g.subject || null, topic: g.topic || null,
          mark: r.score, max: r.total, percentage: r.total > 0 ? Math.round((r.score / r.total) * 100) : 0, at: r.at });
      }
    }
    for (const a of assignments.listTeacherAssignments(tid)) {
      const record = assignmentRecord(a);
      for (const sub of assignments.getSubmissions(a.id)) {
        if (sid(sub.studentId) !== studentId) continue;
        const result = teacherSubmissionResult(record, sub);
        if (!result) continue;
        if (sub.name && !name) name = sub.name;
        rows.push({ kind: 'assignment', type: a.type, assessmentId: a.id, title: a.title, subject: a.subject || null, topic: a.topic || null,
          assessmentType: record.assessmentType || null, version: record.version || null,
          rosterId: record.rosterId || a.rosterId || null,
          lessonWorkspaceId: record.lessonWorkspaceId || a.lessonWorkspaceId || null,
          unitId: record.unitId || a.unitId || null,
          unitName: record.unitName || a.unitName || null,
          finalisedAt: record.finalisedAt || null,
          provisional: false,
          learnerVisible: assignments.isReleased(record),
          objectiveEvidence: objectiveEvidenceForSubmission(record, sub),
          questionEvidence: questionEvidenceForSubmission(record, sub),
          mark: result.mark, max: result.max, percentage: result.max > 0 ? Math.round((result.mark / result.max) * 100) : 0,
          at: record.type === 'assessment' ? (record.finalisedAt || sub.submittedAt || record.createdAt) : (sub.submittedAt || a.createdAt) });
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
function assignmentProgressRows(teacherId, { includePending = false } = {}) {
  const out = [];
  for (const a of assignments.listTeacherAssignments(teacherId)) {
    const record = assignmentRecord(a);
    for (const sub of assignments.getSubmissions(a.id)) {
      const onRecord = isAssessmentOnRecord(record);
      const result = onRecord ? teacherSubmissionResult(record, sub) : null;
      if (!result && !includePending) continue;
      const finalised = isFinalisedAssessment(record);
      const objectiveEvidence = result ? objectiveEvidenceForSubmission(record, sub) : [];
      const questionEvidence = questionEvidenceForSubmission(record, sub);
      out.push({
        kind: 'assignment', type: a.type, assignmentId: a.id, rosterId: a.rosterId || null,
        studentId: sub.studentId, subject: a.subject || null, topic: a.topic || null, title: a.title,
        assessmentType: record.assessmentType || null, version: record.version || null,
        lessonWorkspaceId: record.lessonWorkspaceId || a.lessonWorkspaceId || null,
        unitId: record.unitId || a.unitId || null,
        unitName: record.unitName || a.unitName || null,
        finalisedAt: record.finalisedAt || null,
        teacherMarked: record.type === 'assessment' ? !!record.teacherMarked : true,
        officialRecordedAt: record.type === 'assessment' ? (record.teacherMarkedAt || null) : (sub.submittedAt || record.createdAt || null),
        provisional: false,
        learnerVisible: assignments.isReleased(record),
        status: result ? (finalised || assignments.isReleased(record) ? 'released' : 'marked')
          : !onRecord ? 'awaiting-teacher-confirmation' : 'awaiting-marking',
        objectiveEvidence,
        questionEvidence,
        mode: a.type === 'homework' ? 'homework' : 'classwork', activityId: `assignment:${a.id}`,
        score: result ? result.mark : null, total: result ? result.max : (record.totalMarks || sub.maxMarks || null),
        percentage: result && result.max > 0 ? Math.round((result.mark / result.max) * 100) : null,
        at: record.type === 'assessment' ? (record.finalisedAt || sub.submittedAt || record.createdAt) : (sub.submittedAt || a.createdAt),
      });
    }
  }
  return out;
}

function assignmentResultRows(teacherId) {
  return assignmentProgressRows(teacherId);
}

module.exports = { listClasses, buildGradebook, toWorkbook, gatherStudentResults, summarizeStudent, assignmentResultRows, assignmentProgressRows, teacherSubmissionResult, isFinalisedAssessment, isAssessmentOnRecord, questionEvidenceForSubmission, gameQuestionEvidence };
