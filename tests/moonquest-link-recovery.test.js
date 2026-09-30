const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const os=require('os');const path=require('path');const {recoverAnalysisLink}=require('../moonquest-link-recovery');
test('targeted link recovery preserves data and grants, runs once, and respects later withdrawal',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mq-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s={id:'bf66cc8f-3a2a-4f21-bce2-e567b013869a',teacherId:'3c302479-d532-4f02-b80b-c0e9c5cf7084',observer:{hash:'a'.repeat(64)},rounds:[{answers:{learner:'unchanged'}}]};let saves=0;
 const store={dir,session:id=>{assert.equal(id,s.id);return s;},saveSession:()=>saves++};
 assert.equal(recoverAnalysisLink(store),false);fs.writeFileSync(path.join(dir,`session-${s.id}.json`),'{}');
 s.teacherId='other';assert.equal(recoverAnalysisLink(store),false);s.teacherId='3c302479-d532-4f02-b80b-c0e9c5cf7084';
 assert.equal(recoverAnalysisLink(store),true);assert.equal(s.observer.hashes.length,2);assert.ok(s.observer.hashes.includes('a'.repeat(64)));assert.equal(s.rounds[0].answers.learner,'unchanged');assert.equal(recoverAnalysisLink(store),false);delete s.observer;assert.equal(recoverAnalysisLink(store),false);assert.equal(s.observer,undefined);assert.equal(saves,1);
});
