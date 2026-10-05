const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// Exercise the same edit functions used by download and persistent workspaces
// without starting the HTTP server or loading real teacher data.
const source=fs.readFileSync(path.join(__dirname,'../image-server.js'),'utf8');
const context=vm.createContext({clip:(s,n)=>String(s||'').slice(0,n)});
vm.runInContext(source.slice(source.indexOf('function editedLessonTable('),source.indexOf('async function deckPptxBuffer(')),context);
vm.runInContext(source.slice(source.indexOf('function applyWorkspaceDeckEdits('),source.indexOf('function workspaceDeckSnapshots(')),context);
function deck(){return {slides:[{title:'Examples',bullets:[],alignment:{version:1,id:'example'},table:{headers:['File','Size'],rows:[['Video','10 MB']],caption:'Illustrative sizes'}}]};}
const edit={index:0,table:{headers:['File','Size'],rows:[['Video','12 MB']]}};
test('table changes survive both workspace saving and PowerPoint download edits',()=>{
 for(const fn of ['applyDeckEdits','applyWorkspaceDeckEdits']){
  const d=deck();context[fn](d,[edit]);assert.equal(d.slides[0].table.rows[0][1],'12 MB');assert.equal(d.slides[0].table.caption,'Illustrative sizes');assert.equal(d.slides[0].alignment.teacherEdited,true);
  edit.table.rows[0][1]='13 MB';assert.equal(d.slides[0].table.rows[0][1],'12 MB');edit.table.rows[0][1]='12 MB';
 }
});
test('invalid table changes are rejected without replacing the table',()=>{
 for(const fn of ['applyDeckEdits','applyWorkspaceDeckEdits']){const d=deck();assert.throws(()=>context[fn](d,[{index:0,table:{headers:['File'],rows:[['Video']]}}]),/dimensions/);assert.equal(d.slides[0].table.rows[0][1],'10 MB');}
});
test('workspace table edits cannot change protected assessment phases',()=>{
 const d=deck();d.slides[0].assessmentProtected=true;context.applyWorkspaceDeckEdits(d,[edit]);assert.equal(d.slides[0].table.rows[0][1],'10 MB');
});
test('a failed aligned export leaves saved slide edits untouched',async()=>{
 let fail=true;
 const isolated=vm.createContext({cloneWorkspaceValue:structuredClone,safeAnimate:b=>b,rebuildDeck:()=>({write:async()=>Buffer.from('export')}),require:()=>({validateAlignedExport:()=>{if(fail)throw new Error('export rejected');}})});
 vm.runInContext(source.slice(source.indexOf('function editedLessonTable('),source.indexOf('function deckFilename(')),isolated);
 const d=deck();await assert.rejects(()=>isolated.deckPptxBuffer(d,[edit]),/export rejected/);
 assert.equal(d.slides[0].table.rows[0][1],'10 MB');assert.equal(d.slides[0].alignment.teacherEdited,undefined);
 fail=false;await isolated.deckPptxBuffer(d,[edit]);assert.equal(d.slides[0].table.rows[0][1],'12 MB');
});
