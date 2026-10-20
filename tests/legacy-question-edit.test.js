const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-edit-'));process.env.DATA_DIR=dir;
const a=require('../assignments');
test('saved learner work locks legacy edits and invalid answers do not persist',()=>{
 try{
 const rec=a.createAssignment({teacherId:'teacher',type:'quiz',data:{title:'Quiz',mcq:[{question:'Question',options:['a','b'],correctIndex:0}]}});
 const payload={version:1,...rec.content};
 assert.throws(()=>a.updateLegacyContent(rec.id,{...payload,questions:[{...payload.questions[0],correctIndex:8}]}));
 assert.equal(a.getAssignment(rec.id).content.questions[0].correctIndex,0);
 a.saveDraft(rec.id,{studentId:'S1',answers:{q0:0}});
 assert.equal(a.legacyContentEditable(a.getAssignment(rec.id)),false);
 assert.throws(()=>a.updateLegacyContent(rec.id,payload),/learner work/);
 assert.equal(a.getDraft(rec.id,'S1').answers.q0,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
