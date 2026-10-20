const {test}=require('node:test');const assert=require('node:assert/strict');const core=require('../public/colonyquest-core');
const make=()=>core.createTeam({members:['a','b','c','d'].map(id=>({id,name:id}))},0);
test('random selection covers every learner before repeating and avoids consecutive repeats at cycle boundaries',()=>{
 const team=make();let last;
 for(let cycle=0;cycle<5;cycle++){
  const selected=[];
  for(let i=0;i<4;i++){const p=core.pickLearner(team,undefined,()=>0.7);assert.notEqual(p.id,last);last=p.id;selected.push(p.id);}
  assert.equal(new Set(selected).size,4);
 }
});
test('rotation survives normalization, keeps teams separate, and blocks manual repeats',()=>{
 let team=make();const first=core.pickLearner(team,undefined,()=>0.4);
 assert.equal(core.pickLearner(team,first.id),null);
 const session=core.normalizeSession({teams:[team],selectedTurn:3,selectedLearnerId:first.id});
 team=session.teams[0];assert.equal(session.selectedLearnerId,first.id);assert.equal(session.selectedTurn,3);
 const rest=Array.from({length:3},()=>core.pickLearner(team).id);assert.ok(!rest.includes(first.id));assert.equal(new Set(rest).size,3);
 assert.equal(core.pickLearner(make(),first.id).id,first.id);
});
test('empty and single-learner teams remain usable',()=>{
 assert.equal(core.pickLearner({members:[]}),null);
 const team={members:[{id:'a',name:'A'}]};assert.equal(core.pickLearner(team).id,'a');assert.equal(core.pickLearner(team).id,'a');
});
