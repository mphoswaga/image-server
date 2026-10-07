// Discover only work assigned to this verified learner's current classes.
function discover(studentId, { roster, games, assignments, moonquest, fish, colony, now = Date.now() }) {
  const live = [], todo = [], seen = new Set();
  const matches = roster.findStudentAcrossAllTeachers(studentId);
  const open = item => !item.cutoffAt || new Date(item.cutoffAt).getTime() > now;
  const add = (list, key, item) => { if (!seen.has(key)) { seen.add(key); list.push(item); } };
  for (const m of matches) {
    for (const summary of games.listTeacherGames(m.teacherId)) {
      const g = games.getGame(summary.id);
      if (!g || !games.hasRoster(g, m.rosterId) || games.isStudentRemoved(g, studentId) || !open(g)) continue;
      const c = colony.getMatch(g.id), f = fish.getMatch(g.id);
      const active = c && c.state.phase !== 'ended' ? 'colony' : f && f.state.phase !== 'ended' ? 'fish' : null;
      const item = { title:g.lessonTitle, subject:g.subject, code:g.roomCode, kind:'game', activity:active, className:m.rosterName || '', id:g.id };
      if (active) add(live,'game:'+g.id,item);
      else if (g.mode !== 'colonyquest' && !games.getResults(g.id).some(r=>roster.normalizeStudentId(r.studentId)===studentId)) add(todo,'game:'+g.id,item);
    }
    for (const a of assignments.listTeacherAssignments(m.teacherId)) {
      if (a.rosterId !== m.rosterId || a.status === 'draft' || a.status === 'finalised' || !open(a) || a.copyNeedsReview || assignments.getSubmission(a.id,studentId)) continue;
      const record=assignments.getAssignment(a.id);
      if (record.type==='assessment' && record.status!=='published') continue;
      const item={id:a.id,title:a.title,subject:a.subject,kind:'assignment',code:a.roomCode};
      if (['closed','marking'].includes(a.delivery?.phase)) continue;
      add(a.delivery?.mode==='live'?live:todo,'assignment:'+a.id,item);
    }
  }
  const teachers=new Set(matches.map(m=>m.teacherId));
  for (const s of moonquest.list('session')) {
    if (!teachers.has(s.teacherId) || s.test || s.phase==='ended' || s.joinOpen===false || (s.removedStudents||[]).includes(studentId)) continue;
    if (!matches.some(m=>m.teacherId===s.teacherId && m.rosterId===s.rosterId) || !s.students.some(st=>st.id===studentId)) continue;
    add(live,'moon:'+s.id,{id:s.id,title:s.game.title,subject:s.game.subject,kind:'moonquest',code:s.code});
  }
  return {live,todo};
}
module.exports={discover};
