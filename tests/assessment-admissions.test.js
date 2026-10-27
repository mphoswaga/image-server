const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'admissions-'));
const roster=require('../roster'),assignments=require('../assignments');
test.after(()=>fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true}));
function fixture(){
 const teacherId='teacher-'+Math.random().toString(36).slice(2);
 const r=roster.saveRoster(teacherId,{name:'2B1',students:[{id:'s1',name:'Original'},{id:'s2',name:'New learner'}]});
 const a=assignments.createAssessment({teacherId,rosterId:r.id,rosterSnapshot:r.students.slice(0,1),data:{title:'Test',subject:'ICT',grade:'Grade 2',assessmentType:'test',totalMarks:1,objectives:[{id:'know',text:'Identify computer devices'}],deliveryMode:'live',sections:[{id:'theory',objectiveIds:['know'],type:'mcq',title:'Theory',items:[{id:'q1',prompt:'Which device shows pictures?',options:['Monitor','Keyboard'],correctIndex:0,marks:1}]}]}});
 return {teacherId,r,a};
}
test('late admission appends selected current learners, preserves content and delivery, and is idempotent',()=>{
 const {teacherId,r,a}=fixture();
 assignments.updateDelivery(a.id,'start');
 assignments.saveDraft(a.id,{studentId:'S1',name:'Original',answers:{q1:0}});
 const before=assignments.getAssignment(a.id),draft=assignments.getDraft(a.id,'S1');
 assert.deepEqual(assignments.addAssessmentLearners(a.id,teacherId,['s2']),{added:1});
 const saved=assignments.getAssignment(a.id);
 assert.equal(saved.rosterSnapshot.length,2);assert.deepEqual(saved.content,a.content);assert.deepEqual(saved.delivery,before.delivery);assert.deepEqual(assignments.getDraft(a.id,'S1'),draft);
 assert.equal(assignments.learnerSectionProgress(saved,null).index,0);
 assert.equal(saved.learnerAdmissions[0].mode,'catch-up');assert.deepEqual(saved.learnerAdmissions[0].studentIds,['S2']);
 assert.deepEqual(assignments.addAssessmentLearners(a.id,teacherId,['s2']),{added:0});
});
test('forged identities, foreign teachers and departed learners cannot be admitted',()=>{
 const {teacherId,r,a}=fixture();
 assert.throws(()=>assignments.addAssessmentLearners(a.id,'stranger',['s2']));
 assert.throws(()=>assignments.addAssessmentLearners(a.id,teacherId,['s2','forged']));
 assert.equal(assignments.getAssignment(a.id).rosterSnapshot.length,1);
 roster.removeStudent(teacherId,r.id,'s2');
 assert.throws(()=>assignments.addAssessmentLearners(a.id,teacherId,['s2']));
 assert.equal(assignments.getAssignment(a.id).rosterSnapshot.length,1);
});
test('roster removal archives membership and keeps the published test cohort intact',()=>{
 const {teacherId,r,a}=fixture();
 assert.throws(()=>roster.removeStudent('stranger',r.id,'s1'));
 roster.removeStudent(teacherId,r.id,'s1');
 const saved=roster.getRoster(teacherId,r.id);
 assert.deepEqual(saved.students.map(s=>s.id),['S2']);assert.equal(saved.formerStudents[0].id,'S1');
 assert.equal(roster.findStudentInRoster(teacherId,r.id,'S1'),null);
 assert.equal(assignments.getAssignment(a.id).rosterSnapshot[0].id,'S1');
 assert.throws(()=>roster.removeStudent(teacherId,r.id,'S1'));
});

test('released results refuse cohort changes',()=>{
 const {teacherId,a}=fixture();
 // Use the public release operation to keep lifecycle validation in play.
 assignments.releaseResults(a.id,true);
 assert.throws(()=>assignments.addAssessmentLearners(a.id,teacherId,['s2']));
 assert.equal(assignments.getAssignment(a.id).rosterSnapshot.length,1);
});

test('departed learners retain a historical profile without current class membership',()=>{
 const {teacherId,r,a}=fixture();
 assignments.updateDelivery(a.id,'start');
 assignments.saveDraft(a.id,{studentId:'S1',name:'Original',answers:{q1:0}});
 roster.removeStudent(teacherId,r.id,'S1');
 const profiles=require('../student-profiles').createProfiles({roster,assignments,games:require('../games'),gradebook:require('../gradebook'),practice:{listActivities:()=>[],teacherResults:()=>[]}});
 const profile=profiles.profile(teacherId,'S1');
 assert.deepEqual(profile.classes,[]);assert.equal(profile.previousClasses[0].id,r.id);
 assert.equal(profile.activities[0].key,'assignment:'+a.id);assert.equal(profile.activities[0].status,'In progress');
});
