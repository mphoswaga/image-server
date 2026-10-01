const {test}=require('node:test');const assert=require('node:assert/strict');
const {finalizeLessonPlan,buildPrompt}=require('../lesson-plan');const {reviewObjectives}=require('../lesson-objective-review');
const objectives='3SW.03 Know that device use can be monitored.\n3TC.07 Use keywords to search for information in a search tool.';
const supplied=['I can think of important words related to my topic.','I can type keywords into a search tool.','I can choose helpful results.'];
test('generated missing-objective criteria survive finalization without replacing supplied wording',()=>{
 const added='I can explain that activity on my device may be monitored.';
 const p=finalizeLessonPlan({sections:[],successCriteria:[...supplied,added]},{objectives,suppliedSuccessCriteria:supplied});
 assert.deepEqual(p.successCriteria,[...supplied,added]);assert.deepEqual(p.addedSuccessCriteria,[added]);assert.deepEqual(finalizeLessonPlan(p,{objectives,suppliedSuccessCriteria:supplied}).successCriteria,p.successCriteria);
 const prompt=buildPrompt({subject:'ICT',topic:'Search',grade:'Grade 2',objectives,successCriteria:supplied});assert.match(prompt,/LEARNING OBJECTIVES TAKE PRIORITY/);assert.doesNotMatch(prompt,/without rewriting or adding/);
});
test('independent coverage review returns omissions and timing conflicts for regeneration',async()=>{
 const ai={chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify({coverage:objectives.split('\n').map((objective,i)=>({objective,deferred:false,criterion:i?'I can search':'',teaching:'Model',practice:'Task',check:'Exit response'})),timingValid:false,timingIssues:['15 minute game overlaps 15 minutes of modelling and practice']})}}]})}}};
 const issues=await reviewObjectives(ai,{sections:[]},{objectives,model:'test'});assert.equal(issues.length,2);assert.match(issues[0],/3SW.03/);assert.match(issues[1],/overlaps/);
});
test('incomplete review cannot silently pass a missing objective',async()=>{
 const ai={chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify({coverage:[],timingValid:false,timingIssues:[]})}}]})}}};
 assert.ok((await reviewObjectives(ai,{},{objectives,model:'test'})).length);
});

test('supplied criteria without I can are not duplicated or rewritten',()=>{
 const supplied=['SC 1: Open a folder independently.'];
 const p=finalizeLessonPlan({sections:[],successCriteria:[...supplied,'I can explain monitoring.']},{suppliedSuccessCriteria:supplied});
 assert.deepEqual(p.successCriteria,[...supplied,'I can explain monitoring.']);
});

test('standalone Gradual Release headings do not accumulate generic fallback stages',()=>{
 const p={sections:[{heading:'Main Activity',content:'I Do\nModel keywords.\nWe Do\nChoose keywords.\nYou Do Together\nSearch in pairs.\nYou Do Alone\nSearch independently.'}],successCriteria:supplied};
 const first=finalizeLessonPlan(p,{suppliedSuccessCriteria:supplied,teachingModelId:'gradual_release'});
 const second=finalizeLessonPlan(first,{suppliedSuccessCriteria:supplied,teachingModelId:'gradual_release'});
 assert.equal(second.sections[0].content,first.sections[0].content);
 assert.doesNotMatch(second.sections[0].content,/Model the target skill/);
});
