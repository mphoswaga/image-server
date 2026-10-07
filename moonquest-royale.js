// Lives derive only from revealed rounds, so reconnects cannot replay a penalty.
function standings(s, right) {
  const rows = Object.keys(s.members).filter(id => !(s.removedStudents || []).includes(id)).map(id => {
    let lives=3, correct=0;
    for(const r of s.rounds) {
      if(!r.revealedAt || !r.expected.includes(id) || lives===0) continue;
      const a=r.answers[id];
      if(a && right(r.question,a.final??a.first)) correct++; else lives--;
    }
    return {id,name:s.students.find(st=>st.id===id)?.name||'Festival hero',lives,correct,absent:!!s.members[id].absent};
  });
  return rows.sort((a,b)=>b.lives-a.lives||b.correct-a.correct||a.name.localeCompare(b.name));
}
module.exports={standings};
