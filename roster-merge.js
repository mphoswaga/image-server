const fs = require('fs');
const path = require('path');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const roster = require('./roster');
const assignments = require('./assignments');
const games = require('./games');

const usersDir = () => path.join(DATA_DIR, 'users');
const rosterDir = teacherId => path.join(usersDir(), teacherId, 'rosters');
const rosterPath = (teacherId, rosterId) => path.join(rosterDir(teacherId), `${rosterId}.json`);
const classKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const studentKey = record => (record.students || []).map(student => roster.normalizeStudentId(student.id)).filter(Boolean).sort().join('|');

function activitySummary(teacherId, rosterId) {
  const assessmentRecords = assignments.listTeacherAssignments(teacherId).filter(item => item.rosterId === rosterId);
  const gameRecords = games.listTeacherGames(teacherId).filter(item => games.hasRoster(item, rosterId));
  const submissions = assessmentRecords.reduce((sum, item) => sum + assignments.getSubmissions(item.id).length, 0);
  const gameResults = gameRecords.reduce((sum, item) => sum + games.getResults(item.id).filter(result => !result.rosterId || result.rosterId === rosterId).length, 0);
  return {
    assessments: assessmentRecords.length,
    assessmentIds: assessmentRecords.map(item => item.id),
    submissions,
    games: gameRecords.length,
    gameIds: gameRecords.map(item => item.id),
    gameResults,
  };
}

function richness(summary) {
  return summary.submissions * 100000 + summary.assessments * 1000 + summary.gameResults * 10 + summary.games;
}

function mergeStudents(keeper, duplicate) {
  const byId = new Map((keeper.students || []).map(student => [roster.normalizeStudentId(student.id), { ...student }]));
  for (const student of duplicate.students || []) {
    const id = roster.normalizeStudentId(student.id);
    const current = byId.get(id) || { id };
    const currentName = String(current.name || '');
    const incomingName = String(student.name || '');
    const currentLooksMachine = !currentName || currentName === id || currentName.includes('@');
    const incomingLooksHuman = incomingName && incomingName !== id && !incomingName.includes('@');
    byId.set(id, {
      ...student,
      ...current,
      id,
      name: currentLooksMachine && incomingLooksHuman ? incomingName : currentName || incomingName || id,
      ...(current.gender || student.gender ? { gender: current.gender || student.gender } : {}),
    });
  }
  return [...byId.values()];
}

function combineRosterData(keeper, duplicate) {
  const weights = { ...(duplicate.gradebookWeights || {}), ...(keeper.gradebookWeights || {}) };
  const excluded = [...new Set([...(duplicate.gradebookExcludedIds || []), ...(keeper.gradebookExcludedIds || [])].map(String))];
  return {
    ...duplicate,
    ...keeper,
    students: mergeStudents(keeper, duplicate),
    gradebookWeights: weights,
    gradebookExcludedIds: excluded,
    mergedRosterIds: [...new Set([...(keeper.mergedRosterIds || []), ...(duplicate.mergedRosterIds || []), duplicate.id])],
    mergedAt: new Date().toISOString(),
  };
}

function exactDuplicateGroups(teacherId) {
  const records = roster.listRosters(teacherId).map(item => roster.getRoster(teacherId, item.id)).filter(Boolean);
  const groups = new Map();
  for (const record of records) {
    const key = `${classKey(record.name)}\u001f${studentKey(record)}`;
    if (!classKey(record.name) || !studentKey(record)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].filter(group => group.length > 1);
}

function mergeExactDuplicateRosters({ dryRun = false } = {}) {
  if (!fs.existsSync(usersDir())) return [];
  const reports = [];
  for (const teacherId of fs.readdirSync(usersDir())) {
    const dir = rosterDir(teacherId);
    if (!fs.existsSync(dir)) continue;
    for (const group of exactDuplicateGroups(teacherId)) {
      const ranked = group.map(record => ({ record, activity: activitySummary(teacherId, record.id) }))
        .sort((a, b) => richness(b.activity) - richness(a.activity) || String(a.record.createdAt || '').localeCompare(String(b.record.createdAt || '')));
      let keeper = ranked[0].record;
      const keptActivityBefore = ranked[0].activity;
      for (const candidate of ranked.slice(1)) {
        const duplicate = candidate.record;
        const merged = combineRosterData(keeper, duplicate);
        const report = {
          teacherId,
          className: keeper.name,
          keptRosterId: keeper.id,
          archivedRosterId: duplicate.id,
          keptBefore: keptActivityBefore,
          archivedBefore: candidate.activity,
          movedAssignments: candidate.activity.assessmentIds,
          movedGames: candidate.activity.gameIds,
          students: merged.students.length,
          dryRun,
        };
        if (!dryRun) {
          writeJsonAtomic(rosterPath(teacherId, keeper.id), merged);
          assignments.reassignRoster(teacherId, duplicate.id, keeper.id, merged.students);
          games.reassignRoster(teacherId, duplicate.id, keeper.id);
          const archiveDir = path.join(dir, '_merged');
          fs.mkdirSync(archiveDir, { recursive: true });
          fs.renameSync(rosterPath(teacherId, duplicate.id), path.join(archiveDir, `${duplicate.id}.json`));
        }
        reports.push(report);
        keeper = merged;
      }
    }
  }
  return reports;
}

module.exports = { activitySummary, exactDuplicateGroups, mergeExactDuplicateRosters };
