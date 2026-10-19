const {test}=require('node:test');
const assert=require('node:assert/strict');
const {addOutcomeSlide,periodIntent,reflectionIssues,includeReflectionQuestions}=require('../lesson-learning');
const {planSchema}=require('../lesson-plan');
const {getTeachingModel}=require('../teaching-models');
test('outcome follows starter and preserves all existing content and timing',()=>{
 const slides=[{type:'title',title:'Search'},{type:'objectives',title:'Objectives'},{type:'content',title:'Starter',alignment:{kind:'intro',startMinute:0,endMinute:5}},{type:'content',title:'Model'}];
 const result=addOutcomeSlide(slides,'By the end of this lesson, you will be able to choose useful keywords.');
 assert.equal(result[3].title,'Lesson outcome');assert.equal(result[4],slides[3]);assert.equal(result[2],slides[2]);assert.equal(slides.length,4);
 assert.equal(addOutcomeSlide(result,'Updated outcome').filter(s=>s.title==='Lesson outcome').length,1);
 assert.equal(addOutcomeSlide(slides,''),slides);
 assert.equal(addOutcomeSlide(slides,'Explain safe searching','test')[3].assessmentProtected,true);
});
test('only explicitly selected reflection periods change behaviour; formal assessments are unchanged',()=>{
 assert.equal(periodIntent({}),'teach');
 const input={sequenceEnabled:true,sequenceLessonPurposes:['teach','reflect'],sequenceLessonNumber:2};
 assert.equal(periodIntent(input),'reflect');assert.equal(periodIntent({...input,lessonPurpose:'test'}),'teach');assert.equal(periodIntent({...input,lessonPurpose:'project'}),'teach');assert.equal(periodIntent({...input,sequenceEnabled:false}),'teach');
 assert.equal(periodIntent({...input,sequenceEnabled:'false'}),'teach');
 assert.ok(planSchema(getTeachingModel('standard')).required.includes('learningOutcome'));
});
test('reflection check requires real questions and valid answers; teacher key follows independent questions without changing headings',()=>{
 const q={question:'Which keyword is most specific?',options:['Animals','Tree frogs','Things'],correctIndex:1,explanation:'Tree frogs narrows the topic.',objective:'Use keywords to search.'};
 assert.deepEqual(reflectionIssues([q],1),[]);assert.ok(reflectionIssues([{...q,correctIndex:7}],1).length);assert.ok(reflectionIssues([q],2).length);
 const original={sections:[{heading:'Starter',content:'Recall searching'},{heading:'Main Activity',content:'Answer independently'}],reflectionCheck:[q]};
 const {plan,issues}=includeReflectionQuestions(original);assert.deepEqual(issues,[]);assert.deepEqual(plan.sections.map(s=>s.heading),original.sections.map(s=>s.heading));assert.match(plan.sections[1].content,/Teacher answer key/);assert.equal(original.sections[1].content,'Answer independently');
});
