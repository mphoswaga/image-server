const {test}=require('node:test'),assert=require('node:assert/strict');const {ColonyMatch}=require('../colonyquest-multiplayer');
test('duel introduction holds questions for five seconds then releases full question time',()=>{
 const now=Date.now(),m=new ColonyMatch({id:'vs',questions:[{question:'Q',options:['A','B'],correctIndex:0}]},{duels:true,storyEnabled:false,now});
 const a=m.join({studentId:'a',name:'Mia'},now),b=m.join({studentId:'b',name:'Leo'},now);m.start(now);
 assert.equal(m.state.duels.stage,'intro');assert.equal(m.state.duels.stageUntil,now+5000);assert.equal(a.phase,'duelIntro');
 m.tick(now+4000);assert.equal(m.state.duels.stage,'intro');
 m.tick(now+5000);assert.equal(m.state.duels.stage,'playing');assert.equal(a.phase,'answer');assert.equal(b.phase,'answer');assert.equal(a.deadline,now+5000+m.state.questionSeconds*1000);
});
