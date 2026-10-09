// Lives derive only from revealed rounds, so reconnects cannot replay a penalty.
function standings(s, right) {
  const rows = Object.keys(s.members).filter(id => !(s.removedStudents || []).includes(id)).map(id => {
    let lives=3, correct=0, responseTime=0;
    for(const r of s.rounds) {
      if(!r.revealedAt || !r.expected.includes(id) || lives===0) continue;
      const a=r.answers[id];
      if(a && right(r.question,a.final??a.first)) {correct++;responseTime+=Math.max(0,(r.events.filter(e=>e.studentId===id).at(-1)?.at??r.startedAt)-r.startedAt);} else lives--;
    }
    return {id,name:s.students.find(st=>st.id===id)?.name||'Festival hero',lives,correct,responseTime,absent:!!s.members[id].absent};
  });
  return rows.sort((a,b)=>b.lives-a.lives||b.correct-a.correct||a.responseTime-b.responseTime||a.name.localeCompare(b.name));
}
module.exports={standings};

function pair(ids) {
  const shuffled=require('crypto').randomInt;
  ids=[...ids];
  for(let i=ids.length-1;i>0;i--){const j=shuffled(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
  const groups=[];
  while(ids.length){groups.push(ids.splice(0,ids.length===3?3:2));}
  return groups;
}
function matches(s,players,right) {
  const r=s.rounds[s.round];
  return (r?.royaleGroups||[]).map(ids=>{
    const members=ids.map(id=>players.find(p=>p.id===id)).filter(Boolean);
    if(!r.revealedAt)return {players:members};
    const correct=members.filter(p=>r.answers[p.id]&&right(r.question,r.answers[p.id].final??r.answers[p.id].first));
    const time=id=>r.events.filter(e=>e.studentId===id).at(-1)?.at??Infinity;
    const fastest=Math.min(...correct.map(p=>time(p.id)));
    return {players:members.map(p=>({...p,lostLife:!correct.some(c=>c.id===p.id)})),winners:correct.filter(p=>time(p.id)===fastest).map(p=>p.id)};
  });
}
function advice(s,studentId,now) {
  const r=s.rounds[s.round];
  if(!r||s.phase!=='choose'||now-r.startedAt<10000)return null;
  const votes=Object.entries(r.fanVotes||{}).filter(([id,v])=>v.target===studentId&&s.members[id]&&!s.members[id].absent&&!(s.removedStudents||[]).includes(id));
  const counts={};for(const [,v] of votes)for(const id of v.regionIds)counts[id]=(counts[id]||0)+1;
  const max=Math.max(0,...Object.values(counts));
  return {fans:votes.map(([id])=>s.students.find(p=>p.id===id)?.name||'Fan'),suggestions:Object.entries(counts).map(([id,count])=>({id,percent:Math.round(count/votes.length*100),leading:count===max}))};
}
Object.assign(module.exports,{pair,matches,advice});
