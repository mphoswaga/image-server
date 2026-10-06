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
  if(profile && profile.teams.length===2){
   const assignments={},missing=[];profile.teams.forEach((t,i)=>t.members.forEach(m=>assignments[m.id]=i));
   const counts=[0,0];Object.values(assignments).forEach(i=>counts[i]++);
   for(const st of session.students)if(assignments[st.id]===undefined){const side=counts[0]<=counts[1]?0:1;assignments[st.id]=side;counts[side]++;missing.push(st.id);}
   session.duels.teams=assignments;session.teamSetup={source:profile.source,needsReview:missing.length};
  }else session.teamSetup={source:profile?'New balanced MoonQuest sides (saved class has '+profile.teams.length+' teams)':'New balanced teams',needsReview:session.students.length};
  const counts=[0,0];
  const savedGroups=(profile?.teams||[]).map(t=>{const side=counts[0]<=counts[1]?0:1;counts[side]+=t.members.length;return {id:t.id,name:t.name,count:t.members.length,side};});
  session.teamSetup={...session.teamSetup,requiresChoice:true,choice:null,savedGroups};
  store.saveSession(session);return session;
 }
 function chooseMoon(store,session,roster,groupSides){
  if(session.test||!session.duels||session.phase!=='lobby'||session.joinOpen!==false)throw Error('Choose teams before opening sign-in.');
  const profile=load(session.teacherId,roster);
  if(!profile)throw Error('No saved class teams are available. Create two random teams instead.');
  if(!groupSides||Object.keys(groupSides).length!==profile.teams.length||profile.teams.some(t=>![0,1].includes(groupSides[t.id])))throw Error('Choose a MoonQuest side for every saved team.');
  const assignments={},counts=[0,0],allowed=new Set(session.students.map(s=>s.id));
  for(const t of profile.teams)for(const m of t.members)if(allowed.has(m.id)){assignments[m.id]=groupSides[t.id];counts[groupSides[t.id]]++;}
  if(counts.some(n=>!n))throw Error('Place at least one saved team with learners on each side.');
  let added=0;
  for(const st of session.students)if(assignments[st.id]===undefined){const side=counts[0]<=counts[1]?0:1;assignments[st.id]=side;counts[side]++;added++;}
  session.duels.teams=assignments;
  session.teamSetup={...session.teamSetup,choice:'saved',source:'Saved class teams grouped into MoonQuest sides',needsReview:added,savedGroups:profile.teams.map(t=>({id:t.id,name:t.name,count:t.members.length,side:groupSides[t.id]}))};
  store.saveSession(session);return session;
 }
 function rememberMoon(session,roster){
  if(session.test||!session.duels)return;
  save(session.teacherId,roster,[0,1].map(i=>({name:'Team '+(i+1),members:session.students.filter(st=>session.duels.teams[st.id]===i)})),'Saved class teams');
 }
 return {load,save,applyMoon,chooseMoon,rememberMoon};
}
module.exports={createTeamProfiles};
