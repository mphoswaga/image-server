const {test}=require('node:test');const assert=require('node:assert/strict');const core=require('../public/colonyquest-core');
test('teacher supply deductions clamp at zero and preserve assessment records',()=>{
 const team={id:'a',food:5,sticks:3,leaves:2,attempts:4,correct:3};const session={phase:'question',teams:[team]};
 for(const resource of ['food','sticks','leaves']) {assert.ok(core.deductTeamResource(session,'a',10,resource)>0);assert.equal(team[resource],0);}
 assert.equal(team.attempts,4);assert.equal(team.correct,3);assert.equal(session.events.length,3);
 assert.throws(()=>core.deductTeamResource(session,'a',-1,'food'));
 assert.throws(()=>core.deductTeamResource(session,'a',2,'workers'));
 session.phase='ended';assert.throws(()=>core.deductTeamResource(session,'a',2,'food'));
});
