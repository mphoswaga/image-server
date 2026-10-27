const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-move-'));
const roster = require('../roster');
const { createProfiles } = require('../student-profiles');
test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));
function setup() {
 const teacher = 'teacher-' + Math.random().toString(36).slice(2);
 const source = roster.saveRoster(teacher, { name:'2B1', students:[{id:'s1',name:'Mai',gender:'female'}] });
 const target = roster.saveRoster(teacher, { name:'2B2', students:[{id:'s2',name:'An'}] });
 return {teacher,source,target};
}
test('move persists one membership and stable identity, remembers old class and supports moving back',()=>{
 const {teacher,source,target}=setup();
 roster.moveStudent(teacher,source.id,' s1 ',target.id);
 assert.equal(roster.getRoster(teacher,source.id).students.length,0);
 const moved=roster.findStudentInRoster(teacher,target.id,'S1');
 assert.equal(moved.name,'Mai');assert.equal(moved.gender,'female');assert.equal(moved.id,'S1');
 assert.deepEqual(moved.previousClasses,[{id:source.id,name:'2B1'}]);
 roster.moveStudent(teacher,target.id,'S1',source.id);
 assert.equal(roster.getRoster(teacher,target.id).students.length,1);
 assert.equal(roster.getRoster(teacher,source.id).students.length,1);
});
test('invalid, duplicate, cross-teacher and same-class moves never remove membership',()=>{
 const {teacher,source,target}=setup();
 const duplicate=roster.saveRoster(teacher,{name:'Duplicate',students:source.students});
 for(const destination of [source.id,duplicate.id,'../escape','missing'])
   assert.throws(()=>roster.moveStudent(teacher,source.id,'S1',destination));
 assert.throws(()=>roster.moveStudent('other',source.id,'S1',target.id));
 assert.throws(()=>roster.moveStudent(teacher,source.id,'missing',target.id));
 assert.equal(roster.getRoster(teacher,source.id).students.length,1);
 assert.equal(roster.getRoster(teacher,target.id).students.length,1);
});
test('profile keeps historical submitted work without listing old outstanding tasks',()=>{
 const {teacher,source,target}=setup();
 roster.moveStudent(teacher,source.id,'S1',target.id);
 const records=[{id:'done',rosterId:source.id,status:'published'}, {id:'old-missing',rosterId:source.id,status:'published'}];
 const profiles=createProfiles({roster,assignments:{listTeacherAssignments:()=>records,getAssignment:id=>records.find(a=>a.id===id),getSubmission:id=>id==='done'?{}:null,getDraft:()=>null},games:{listTeacherGames:()=>[]},gradebook:{gatherStudentResults:()=>({rows:[]}),teacherSubmissionResult:()=>({mark:40,max:50}),questionEvidenceForSubmission:()=>[]},practice:{listActivities:()=>[],teacherResults:()=>[]}});
 const profile=profiles.profile(teacher,'S1');
 assert.deepEqual(profile.classes,[{id:target.id,name:'2B2'}]);
 assert.equal(profile.activities.length,1);assert.equal(profile.activities[0].score,40);assert.equal(profile.activities[0].className,'2B1');
});
