const {test}=require('node:test');const assert=require('node:assert/strict');const core=require('../public/colonyquest-core');
test('walls progressively protect food and outer rooms from the board swarm',()=>{
 for(let defense=0;defense<5;defense++){
  const team=core.createTeam({},0);Object.assign(team,{food:100,defense,pantryBuilt:true,territory:2});
  const workers=team.workers;const result=core.applySpiderSwarm(team);
  assert.equal(result.foodLost,40-defense*10);assert.equal(result.roomsLost,defense<2?1:0);
  assert.equal(team.workers,workers);assert.ok(core.colonyRooms(team).some(r=>r.id==='nursery'));
  const restored=core.normalizeSession({teams:[team]});assert.equal(core.colonyRooms(restored.teams[0]).length,core.colonyRooms(team).length);
 }
});
test('queen-only colonies lose only a portion of food and retain materials and ants',()=>{
 const team=core.createTeam({},0);Object.assign(team,{food:20,sticks:7,leaves:5,soldiers:2});
 const before=structuredClone(team);core.applySpiderSwarm(team);
 assert.ok(team.food>0 && team.food<before.food);
 for(const key of ['workers','soldiers','sticks','leaves','territory'])assert.equal(team[key],before[key]);
});
test('swarm damage is opt-in for smartboard and saved visuals do not reapply damage',()=>{
 const team=core.createTeam({},0);team.food=100;team.pantryBuilt=true;team.territory=2;
 const beforeTeams=[structuredClone(team)];core.applyEvent([team],'predator',{swarm:true});
 const s=core.normalizeSession({teams:[team],events:[{key:'predator',automatic:true,beforeTeams}]});
 assert.equal(s.teams[0].food,60);assert.equal(s.events[0].beforeTeams[0].food,100);
 assert.equal(core.colonyRooms(s.events[0].beforeTeams[0]).length,2);
 const other=structuredClone(beforeTeams[0]);core.applyEvent([other],'predator');assert.equal(other.food,88);assert.equal(other.territory,2);
});
