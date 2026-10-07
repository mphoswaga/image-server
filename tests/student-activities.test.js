const {test}=require('node:test');
const assert=require('node:assert/strict');
const {discover}=require('../student-activities');
function setup(){
 const g={id:'g',teacherId:'t',rosterId:'c',roomCode:'ABC',lessonTitle:'Maths'};
 const a={id:'a',rosterId:'c',roomCode:'DEF',title:'Task',type:'assessment',status:'published'};
 const s={id:'s',teacherId:'t',rosterId:'c',students:[{id:'S'}],game:{title:'Moon'},code:'0123456789',phase:'lobby'};
 const deps={roster:{findStudentAcrossAllTeachers:()=>[{teacherId:'t',rosterId:'c'}],normalizeStudentId:x=>x},games:{listTeacherGames:()=>[g],getGame:()=>g,hasRoster:(g,id)=>g.rosterId===id,isStudentRemoved:()=>false,getResults:()=>[]},assignments:{listTeacherAssignments:()=>[a],getAssignment:()=>a,getSubmission:()=>null},moonquest:{list:()=>[s]},fish:{getMatch:()=>null},colony:{getMatch:()=>null}};
 return {g,a,s,deps};
}
test('class tasks and open MoonQuest sessions are discoverable without prior submissions',()=>{
 const {deps}=setup();const d=discover('S',deps);assert.equal(d.live[0].kind,'moonquest');assert.equal(d.todo.length,2);assert.equal(JSON.stringify(d).includes('students'),false);
});
test('other classes, removed students, drafts and closed sessions stay private',()=>{
 const {deps,g,a,s}=setup();g.rosterId='other';a.status='draft';s.rosterId='other';assert.deepEqual(discover('S',deps),{live:[],todo:[]});
 g.rosterId='c';deps.games.isStudentRemoved=()=>true;s.rosterId='c';s.removedStudents=['S'];assert.deepEqual(discover('S',deps),{live:[],todo:[]});
 s.removedStudents=[];s.joinOpen=false;assert.equal(discover('S',deps).live.length,0);
});
test('completed tasks leave To do but active multiplayer remains joinable',()=>{
 const {deps,s}=setup();s.phase='ended';deps.games.getResults=()=>[{studentId:'S'}];deps.assignments.getSubmission=()=>({});assert.deepEqual(discover('S',deps),{live:[],todo:[]});
 deps.colony.getMatch=()=>({state:{phase:'lobby'}});assert.equal(discover('S',deps).live[0].activity,'colony');
});
test('expired activities and teacher practice missions are excluded',()=>{
 const {deps,g,a,s}=setup();g.cutoffAt=a.cutoffAt='2000-01-01';s.test=true;assert.deepEqual(discover('S',deps),{live:[],todo:[]});
});
