// Class-level membership only. Game scores, attendance and learner rosters stay separate.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {DATA_DIR,writeJsonAtomic}=require('./storage');
function createTeamProfiles(root=DATA_DIR){
 const directory=path.join(root,'class-game-teams');
 const file=(teacherId,rosterId)=>path.join(directory,crypto.createHash('sha256').update(JSON.stringify([teacherId,rosterId])).digest('hex')+'.json');
 function read(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 function normalized(teams,students){
  const allowed=new Set(students.map(s=>String(s.id))), seen=new Set();
  return teams.map((t,i)=>({id:'team-'+(i+1),name:String(t.name||'Team '+(i+1)).slice(0,80),colorIndex:i,members:(t.members||[]).filter(m=>{const id=String(m.id);if(!allowed.has(id))return false;if(seen.has(id))throw Error('A learner is assigned to more than one team.');seen.add(id);return true;}).map(m=>({id:String(m.id)}))}));
 }
 function save(teacherId,roster,teams,source='Teacher setup'){
  const clean=normalized(teams,roster.students);
  if(clean.length<2||clean.length>6||clean.filter(t=>t.members.length).length<2)throw Error('Keep learners in at least two teams.');
  fs.mkdirSync(directory,{recursive:true});const profile={teacherId,rosterId:roster.id,teams:clean,source,updatedAt:Date.now()};writeJsonAtomic(file(teacherId,roster.id),profile);return profile;
 }
 function load(teacherId,roster){
  const saved=read(file(teacherId,roster.id));
  if(saved)return {...saved,teams:normalized(saved.teams,roster.students)};
  const dir=path.join(root,'games');if(!fs.existsSync(dir))return null;
  const candidates=[];
  for(const f of fs.readdirSync(dir)){
   if(!f.endsWith('.json')||f.includes('.results.')||f.includes('.colonyquest.')||f==='_rooms.json')continue;
   const g=read(path.join(dir,f));if(g?.teacherId!==teacherId)continue;
   const session=read(path.join(dir,g.id+'.colonyquest.json'));
   for(const [teams,time] of [[g.colonyquest?.teams,g.createdAt],[session?.teams,session?.updatedAt]]){
    if(!Array.isArray(teams))continue;
    const clean=normalized(teams,roster.students),matched=clean.reduce((n,t)=>n+t.members.length,0);
    if(clean.filter(t=>t.members.length).length>=2)candidates.push({teams:clean,matched,updatedAt:Date.parse(time)||0,source:'Saved ColonyQuest teams'});
   }
  }
  candidates.sort((a,b)=>b.matched-a.matched||b.updatedAt-a.updatedAt);return candidates[0]||null;
 }
 function applyMoon(store,session,roster){
  if(session.test||!session.duels)return session;
  const profile=load(session.teacherId,roster);
  if(profile){
   if(profile.teams.length!==2)throw Error('This class has more than two saved teams. MoonQuest needs two sides; review the class teams before starting a duel.');
   const assignments={},missing=[];profile.teams.forEach((t,i)=>t.members.forEach(m=>assignments[m.id]=i));
   const counts=[0,0];Object.values(assignments).forEach(i=>counts[i]++);
   for(const st of session.students)if(assignments[st.id]===undefined){const side=counts[0]<=counts[1]?0:1;assignments[st.id]=side;counts[side]++;missing.push(st.id);}
   session.duels.teams=assignments;session.teamSetup={source:profile.source,needsReview:missing.length};
  }else session.teamSetup={source:'New balanced teams',needsReview:session.students.length};
  store.saveSession(session);return session;
 }
 function rememberMoon(session,roster){
  if(session.test||!session.duels)return;
  save(session.teacherId,roster,[0,1].map(i=>({name:'Team '+(i+1),members:session.students.filter(st=>session.duels.teams[st.id]===i)})),'Saved class teams');
 }
 return {load,save,applyMoon,rememberMoon};
}
module.exports={createTeamProfiles};
