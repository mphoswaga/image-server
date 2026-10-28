const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createNarration,narrationText}=require('../assessment-narration');
test('only question or requested choice text is narrated, never solutions or arbitrary input',()=>{
 const record={content:{questions:[{id:'q1',question:'What is software?',options:['Instructions','Mouse'],correctIndex:0,explanation:'PRIVATE SOLUTION'}]}};
 assert.equal(narrationText(record,'q1'),'What is software?');assert.equal(narrationText(record,'q1','1'),'Mouse');
 assert.throws(()=>narrationText(record,'missing'));assert.throws(()=>narrationText(record,'q1','-1'));assert.throws(()=>narrationText(record,'q1','correctIndex'));
});
test('narration reuses clips and combines simultaneous requests, isolates teachers and invalidates edits',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'speech-'));let calls=0;
 const audio=createNarration({directory,synthesize:async text=>{calls++;await new Promise(r=>setTimeout(r,10));return Buffer.from('audio:'+text);}});
 try{
  const [a,b]=await Promise.all([audio('teacher','Read this'),audio('teacher','Read this')]);assert.deepEqual(a,b);assert.equal(calls,1);
  await audio('teacher','Read this');assert.equal(calls,1);await audio('teacher','Edited question');assert.equal(calls,2);
  await audio('other','Read this');assert.equal(calls,3);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
