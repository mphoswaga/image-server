const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const os=require('os');const path=require('path');const {createTeamProfiles}=require('../class-game-teams');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'class-teams-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'games'));return {root,service:createTeamProfiles(root),roster:{id:'class',students:['a','b','c'].map(id=>({id,name:id}))}};}
test('saved class teams are teacher-scoped and survive reload without scores',t=>{const {root,service,roster}=fixture(t);service.save('owner',roster,[{name:'One',members:[{id:'a',score:10}]},{name:'Two',members:[{id:'b'}]}]);assert.equal(service.load('other',roster),null);const saved=createTeamProfiles(root).load('owner',roster);assert.deepEqual(saved.teams[0].members,[{id:'a'}]);assert.throws(()=>service.save('owner',roster,[{members:[{id:'a'}]},{members:[{id:'a'}]}]),/more than one/);});
test('legacy membership is matched by ID, reused with missing learners flagged, and excludes practice',t=>{const {root,service,roster}=fixture(t);fs.writeFileSync(path.join(root,'games/g.json'),JSON.stringify({id:'g',teacherId:'owner',createdAt:'2026-09-01',colonyquest:{teams:[{members:[{id:'a',name:'wrong'}]},{members:[{id:'b'}]}]}}));let saved;const store={saveSession:s=>saved=s};const s={teacherId:'owner',students:roster.students,duels:{teams:{a:1,b:0,c:1}}};service.applyMoon(store,s,roster);assert.equal(saved.duels.teams.a,0);assert.equal(saved.duels.teams.b,1);assert.equal(saved.teamSetup.needsReview,1);service.rememberMoon(saved,roster);assert.equal(service.load('owner',roster).teams.flatMap(t=>t.members).length,3);const practice={test:true,duels:{teams:{p:0}}};service.applyMoon(store,practice,roster);assert.deepEqual(practice,{test:true,duels:{teams:{p:0}}});});

test('multi-team classes open MoonQuest with balanced sides for review without changing saved teams',t=>{
 const {service,roster}=fixture(t);
 for(const count of [3,4,6]){
  roster.students=Array.from({length:25},(_,i)=>({id:'s'+i,name:'Learner '+i}));
  service.save('owner',roster,Array.from({length:count},(_,i)=>({members:roster.students.filter((_,n)=>n%count===i)})));
  const before=service.load('owner',roster);
  const session={teacherId:'owner',students:roster.students,duels:require('../moonquest-duels').create(roster.students)};
  let saved;service.applyMoon({saveSession:s=>saved=s},session,roster);
  assert.equal(saved,session);
  assert.equal(Object.keys(saved.duels.teams).length,25);
  assert.deepEqual([...new Set(Object.values(saved.duels.teams))].sort(),[0,1]);
  assert.equal(Object.values(saved.duels.teams).filter(v=>v===0).length,13);
  assert.equal(saved.teamSetup.needsReview,25);
  assert.match(saved.teamSetup.source,new RegExp(count+' teams'));
  assert.deepEqual(service.load('owner',roster),before);
 }
});
test('teacher groups saved teams intact, adds missing learners and never overwrites the profile',t=>{
 const {service,roster}=fixture(t);roster.students=Array.from({length:9},(_,i)=>({id:'s'+i,name:'Learner '+i}));
 service.save('owner',roster,Array.from({length:4},(_,i)=>({name:'Crew '+i,members:roster.students.slice(i*2,i*2+2)})));
 const before=service.load('owner',roster),session={teacherId:'owner',phase:'lobby',joinOpen:false,students:roster.students,duels:require('../moonquest-duels').create(roster.students)},store={saveSession:()=>{}};
 service.applyMoon(store,session,roster);assert.equal(session.teamSetup.requiresChoice,true);assert.equal(session.teamSetup.choice,null);
 assert.throws(()=>service.chooseMoon(store,session,roster,{'team-1':0}),/every saved team/);
 assert.throws(()=>service.chooseMoon(store,session,roster,{'team-1':0,'team-2':0,'team-3':0,'team-4':0}),/each side/);
 service.chooseMoon(store,session,roster,{'team-1':0,'team-2':1,'team-3':1,'team-4':0});
 assert.deepEqual(Object.values(session.duels.teams),[0,0,1,1,1,1,0,0,0]);assert.equal(session.teamSetup.choice,'saved');assert.equal(session.teamSetup.needsReview,1);
 assert.deepEqual(service.load('owner',roster),before);session.joinOpen=true;assert.throws(()=>service.chooseMoon(store,session,roster,{}),/before opening/);
});
