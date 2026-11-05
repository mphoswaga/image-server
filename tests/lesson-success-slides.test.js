const {test}=require('node:test'),assert=require('node:assert/strict');
const {addSuccessCriteriaSlides,criteriaFromPlan,objectivesFromPlan}=require('../lesson-success-slides');
const {rebuildDeck}=require('../generate'),Zip=require('pizzip');
const base=()=>[{type:'title',title:'Algorithms'},{type:'objectives',title:'Learning objectives',bullets:['Identify repeated steps.']},{type:'content',title:'Starter',bullets:['Recall a routine.']},{type:'objectives',title:'Lesson outcome',modelStage:'outcome',bullets:['Explain and improve an algorithm.']},{type:'content',title:'Practice',bullets:['Order the steps.']}];
test('supplied criteria retain wording and order after the outcome, without modifying existing slides',()=>{
 const original=base(),criteria=['I can follow an algorithm.','I can identify repeated steps.'];const result=addSuccessCriteriaSlides(original,{successCriteria:criteria});assert.equal(result[4].title,'Success criteria');assert.deepEqual(result[4].bullets,criteria);assert.equal(result[5],original[4]);assert.equal(original.length,5);assert.equal(result[4].criteriaSource,'plan');assert.deepEqual(addSuccessCriteriaSlides(result,{successCriteria:criteria}),result);
});
test('criteria are extracted from approved markdown and raw uploaded planning formats',()=>{
 for(const text of ['## SC\nI can sort materials.\n## Resources\nCards','SC\t"I can sort materials.\nI can explain my choices."\nResources\tCards','Success criteria\nI can sort materials.\nResources\nCards']){const criteria=criteriaFromPlan(text);assert.ok(criteria.length);assert.match(criteria[0],/^I can sort/);assert.ok(!criteria.join(' ').includes('Cards'));}
});
test('missing criteria are derived from the original objectives with observable verbs and no curriculum codes',()=>{
 const plan='## LO\n3CT.01 Understand the order of algorithm steps.\n3CT.03 Identify repeated steps.\n## Activities\nSort instructions.';
 assert.match(objectivesFromPlan(plan),/3CT.01/);const result=addSuccessCriteriaSlides(base(),{lessonPlanText:plan});const criteria=result.find(s=>s.modelStage==='success_criteria');assert.deepEqual(criteria.bullets,['I can explain the order of algorithm steps.','I can identify repeated steps.']);assert.equal(criteria.criteriaSource,'objectives');
});
test('all criteria remain visible across readable pages and old duplicate criteria slides are replaced',()=>{
 const criteria=Array.from({length:8},(_,i)=>'I can explain example '+(i+1)+'.');const result=addSuccessCriteriaSlides([...base(),{type:'objectives',title:'Success criteria',bullets:['Old criterion']}],{successCriteria:criteria});const pages=result.filter(s=>s.modelStage==='success_criteria');assert.equal(pages.length,3);assert.deepEqual(pages.flatMap(s=>s.bullets),criteria);assert.ok(pages.every(s=>s.bullets.length<=3));
});
test('normal lessons get criteria without an outcome, but test and project decks stay protected',()=>{
 const slides=base().filter(s=>s.modelStage!=='outcome');assert.equal(addSuccessCriteriaSlides(slides,{objectives:'Compare files.'})[2].title,'Success criteria');for(const purpose of ['test','project'])assert.equal(addSuccessCriteriaSlides(slides,{successCriteria:['Private criterion']},purpose),slides);
});
test('success criteria survive the actual PowerPoint export',async()=>{
 const slides=addSuccessCriteriaSlides(base(),{successCriteria:['I can follow the steps.','I can explain a repeated action.']});const buffer=await rebuildDeck({grade:'Grade 3',presetId:'sage-split',slides,images:slides.map(()=>null)}).write({outputType:'nodebuffer'});const zip=new Zip(buffer);const xml=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n=>zip.file(n).asText()).join('\n');assert.match(xml,/Success criteria/i);assert.match(xml,/I can follow the steps/);assert.match(xml,/I can explain a repeated action/);
});
test('success criteria use a full-width page instead of leaving half the slide empty',()=>{
 const {paginateSlides}=require('../generate'),{gradeProfile}=require('../grade');const slide=addSuccessCriteriaSlides(base(),{successCriteria:['I can read and follow step-by-step instructions.','I can find and highlight repeated actions.','I can break a task into smaller sections and improve its steps.']}).find(s=>s.modelStage==='success_criteria');const pages=paginateSlides([slide],gradeProfile('Grade 3').theme,null);assert.equal(pages.length,1);assert.equal(pages[0]._layout,'task');assert.equal(pages[0].bullets.length,3);
});
