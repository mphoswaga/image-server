// Competition is derived from revealed evidence; never mutate assessment marks.
const crypto = require('crypto');
const styles=[{id:'bow',name:'Pink bow'},{id:'scarf',name:'Blue scarf'},{id:'star',name:'Golden star'},{id:'blossom',name:'Peach Blossom'},{id:'explorer',name:'Trail Scout'},{id:'astronomer',name:'Moon Scholar'},{id:'headphones',name:'Festival DJ'},{id:'crown',name:'Lantern Royal'},{id:'leaf',name:'Bamboo Guardian'}];
const names = ['Jade Rabbits', 'Golden Rabbits'];
function create(students) {
  const ids = students.map(s=>s.id);
  for(let i=ids.length-1;i>0;i--){const j=crypto.randomInt(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
  return {teams:Object.fromEntries(ids.map((id,i)=>[id,i%2])),avatars:Object.fromEntries(ids.map((id,i)=>[id,i%3===0?'bow':i%3===1?'scarf':'star']))};
}
function pair(s,expected) {
  const teams=expected.map(id=>s.duels.teams[id]);
  // Absent players can leave unequal crews. Extra members join a group on the
  // other side; no one is dropped and no synthetic opponent is scored.
  const a=expected.filter((id,i)=>teams[i]===0),b=expected.filter((id,i)=>teams[i]===1);
  if(!a.length||!b.length)return expected.map(id=>[id]);
  const groups=Array.from({length:Math.min(a.length,b.length)},()=>[]);
  a.forEach((id,i)=>groups[i%groups.length].push(id));
  b.forEach((id,i)=>groups[(i+s.round)%groups.length].push(id));
  return groups;
}
function score(s,r,right) {
  const out={};
  for(const id of r.expected){const a=r.answers[id];const ok=!!a&&right(r.question,a.final??a.first);const events=r.events.filter(e=>e.studentId===id);out[id]={correct:ok,points:ok?100:0,bonus:0,at:events[0]?.at,eligible:ok&&events.length===1&&!r.question.parentId};}
  for(const storedGroup of r.duelGroups||[]){
    const group=storedGroup.filter(id=>out[id]);
    for(const id of group){const v=out[id],opponents=group.filter(other=>s.duels.teams[other]!==s.duels.teams[id]);if(!v.eligible||!opponents.length)continue;
      const times=group.filter(other=>other!==id&&out[other].eligible).map(other=>out[other].at);
      if(!times.length||v.at<=Math.min(...times)+1000){v.bonus=20;v.points+=20;}
    }
  }
  return out;
}
function snapshot(s,studentId,role,right) {
  if(!s.duels)return null;
  const totals=[0,0],raw=[0,0];let rounds=0;
  for(const r of s.rounds.filter(r=>r.revealedAt)){
    const scores=score(s,r,right);rounds++;
    for(let t=0;t<2;t++){const ids=r.expected.filter(id=>s.duels.teams[id]===t);const sum=ids.reduce((n,id)=>n+scores[id].points,0);raw[t]+=sum;totals[t]+=ids.length?sum/ids.length:0;}
  }
  const view={styles,teams:names.map((name,i)=>({name,points:Math.round(totals[i]*10)/10,rawPoints:raw[i],progress:Math.min(100,totals[i]/(120*s.game.questions.length)*100)})),rounds,winner:totals[0]===totals[1]?null:totals[0]>totals[1]?0:1};
  const round=s.rounds[s.round];
  if(s.phase==='ended'){
    const heroes=new Map();
    for(const r of s.rounds.filter(r=>r.revealedAt)){
      const scores=score(s,r,right);
      for(const id of r.expected){
        if((s.removedStudents||[]).includes(id))continue;
        const st=s.students.find(st=>st.id===id);if(!st)continue;
        const hero=heroes.get(id)||{id,name:st.name,team:s.duels.teams[id],avatar:s.duels.avatars[id]||'scarf',points:0,correct:0};
        hero.points+=scores[id].points;hero.correct+=Number(scores[id].correct);heroes.set(id,hero);
      }
    }
    view.celebration=names.map((name,team)=>{
      const members=[...heroes.values()].filter(h=>h.team===team).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));
      let rank=0;members.forEach((h,i)=>{if(!i||h.points!==members[i-1].points)rank=i+1;h.rank=rank;});
      return {name,team,members,podium:members.filter(h=>h.rank<=3&&h.points>0)};
    });
  }
  if(round){
    const scores=round.revealedAt?score(s,round,right):null;
    view.matchups=(round.duelGroups||[]).filter(g=>role!=='student'||g.includes(studentId)).map((g,index)=>{
      const players=g.filter(id=>round.expected.includes(id)).map(id=>({id,name:s.students.find(st=>st.id===id)?.name||'Festival hero',team:s.duels.teams[id],avatar:s.duels.avatars[id]||'scarf',answered:!!round.answers[id],...(scores?{points:scores[id].points,correct:scores[id].correct}:{})}));
      const best=scores?Math.max(0,...players.map(p=>p.points)):0;
      const winners=scores?players.filter(p=>p.correct&&p.points===best).map(p=>p.id):[];
      return {index,players,...(scores?{winners,reason:!winners.length?'A discovery for our next try':winners.length>1?'Shared victory · equally earned':players.filter(p=>p.correct).length>1?'Correct answer + speed bonus':'Correct answer wins'}:{})};
    });
  }
  if(role==='teacher'&&s.phase==='lobby')view.assignments=s.students.filter(st=>!(s.removedStudents||[]).includes(st.id)).map(st=>({...st,team:s.duels.teams[st.id]}));
  if(role==='student'){
    const r=s.rounds[s.round],group=r?.duelGroups?.find(g=>g.includes(studentId))||[];
    view.me={team:s.duels.teams[studentId],avatar:s.duels.avatars[studentId]||'scarf'};
    view.personal={points:0,correct:0};
    for(const round of s.rounds.filter(r=>r.revealedAt&&r.expected.includes(studentId))){const value=score(s,round,right)[studentId];view.personal.points+=value.points;view.personal.correct+=Number(value.correct);}
    view.opponents=group.filter(id=>r.expected.includes(id)&&s.duels.teams[id]!==view.me.team).map(id=>({name:s.students.find(st=>st.id===id)?.name||'Opponent',avatar:s.duels.avatars[id]||'scarf',team:s.duels.teams[id]}));
    if(r?.revealedAt&&r.expected.includes(studentId)){
      const scores=score(s,r,right),mine=scores[studentId],others=group.filter(id=>scores[id]&&s.duels.teams[id]!==view.me.team).map(id=>scores[id]);
      view.result={points:mine.points,bonus:mine.bonus,outcome:!others.length?'practice':!mine.correct?'learn':others.every(v=>mine.points>v.points)?'win':others.some(v=>v.points>mine.points)?'close':'draw'};
    }
  }
  return view;
}
module.exports={create,pair,score,snapshot,names,styles};
