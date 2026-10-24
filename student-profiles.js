// Teacher-scoped learner directory. Never use the global student-account lookup here.
function createProfiles({ roster, assignments, games, gradebook, practice }) {
  const norm = roster.normalizeStudentId;
  function directory(teacherId) {
    const students = new Map();
    for (const summary of roster.listRosters(teacherId)) {
      const record = roster.getRoster(teacherId, summary.id);
      for (const learner of record?.students || []) {
        const id = norm(learner.id);
        if (!students.has(id)) students.set(id, { id, name: learner.name, gender: learner.gender || null, classes: [] });
        students.get(id).classes.push({ id: record.id, name: record.name });
      }
    }
    return [...students.values()].sort((a,b) => a.name.localeCompare(b.name));
  }
  function profile(teacherId, studentId) {
    const student = directory(teacherId).find(s => s.id === norm(studentId));
    if (!student) return null;
    const classIds = new Set(student.classes.map(c => c.id));
    const activities = [];
    for (const summary of assignments.listTeacherAssignments(teacherId)) {
      const a = assignments.getAssignment(summary.id);
      if (!a || !classIds.has(a.rosterId) || a.status === 'draft') continue;
      const submission = assignments.getSubmission(a.id, student.id);
      const draft = !submission && assignments.getDraft(a.id, student.id);
      const work = submission || draft;
      const result = submission && gradebook.teacherSubmissionResult(a, submission);
      activities.push({ key: 'assignment:' + a.id, kind: a.assessmentType || a.type || 'assignment', title: a.title,
        subject: a.subject, topic: a.topic, className: student.classes.find(c=>c.id===a.rosterId)?.name,
        status: result ? 'Marked' : submission ? 'Awaiting marking' : draft ? 'In progress' : 'Not submitted',
        score: result ? result.mark : null, total: result ? result.max : a.totalMarks || null,
        at: work?.submittedAt || work?.updatedAt || a.createdAt,
        evidence: work ? gradebook.questionEvidenceForSubmission(a, work) : [] });
    }
    // Reuse the canonical aggregation so smartboard and MoonQuest records are included.
    const recorded = gradebook.gatherStudentResults([teacherId], student.id);
    for (const row of recorded.rows || []) {
      if (row.kind !== 'game') continue;
      const game = games.getGame(row.assessmentId);
      if (game && !games.getRosterIds(game).some(id=>classIds.has(id))) continue;
      const result = game && games.getResults(game.id).find(r=>norm(r.studentId)===student.id);
      activities.push({ key: 'game:'+row.assessmentId, kind: 'game', title: row.title, subject: row.subject,
        status: 'Completed', score: row.mark, total: row.max, at: row.at,
        evidence: game && result ? gradebook.gameQuestionEvidence(game,result) : [] });
    }
    for (const game of games.listTeacherGames(teacherId)) {
      if (!games.getRosterIds(game).some(id=>classIds.has(id)) || activities.some(a=>a.key==='game:'+game.id)) continue;
      activities.push({ key:'game:'+game.id, kind:'game', title:game.lessonTitle || game.topic,
        subject:game.subject, status:'No recorded result', score:null, total:null, at:game.createdAt, evidence:[] });
    }
    const catalog = new Map(practice.listActivities().map(a=>[a.id,a]));
    for (const result of practice.teacherResults([student.id])) {
      activities.push({ key:'practice:'+result.activityId+':'+(result.id||result.updatedAt), kind:'practice',
        title:catalog.get(result.activityId)?.title || result.activityId, subject:'ICT',
        status:result.status==='completed'?'Completed':'In progress', score:result.status==='completed'?result.score:null,
        total:result.baseScore || null, at:result.completedAt || result.updatedAt,
        evidence:(result.checkpoints||[]).map(c=>({item:c.title||c.label||c.id||'Checkpoint',studentResponse:c.status||'',score:c.score??null,total:c.total??null})) });
    }
    activities.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
    return { ...student, activities };
  }
  return { directory, profile };
}
module.exports = { createProfiles };
