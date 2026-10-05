const test = require('node:test');
const assert = require('node:assert/strict');
const { sourcesFromPlan, outlineIssues, deckIssues, generateAlignedDeck } = require('../lesson-deck-alignment');
const { describeGame, gamePrompt } = require('../game-teaching-guide');
const plan = '## LO\n4CS.05 Compare file sizes.\n## Intro\nPredict the smallest file.\n## Activities\nUse text 10 KB, photo 2 MB, audio 3 MB, video 10 MB, game 200 MB. Play MoonQuest at minutes 40–55. Complete an independent check.\n## Plenary\nReflect and improve.';
const sources = sourcesFromPlan(plan);
const step = (id, sourceId, start, end, kind='model') => ({ id, title:id, kind, stageId:'i_do', sourceIds:[sourceId], sourceQuote:sources.find(s=>s.id===sourceId).content, objectiveIds:['S1'], startMinute:start,endMinute:end,task:id,resource:'text' });
const outline = { objectives:['Compare file sizes'], steps:[step('a','S2',0,10,'intro'),step('b','S3',10,40),step('c','S3',40,55,'game'),step('d','S3',55,60,'independent'),step('e','S4',60,70,'reflection')], warnings:['Independent check may need more time.'], blockers:[], externalResources:['Prepare a playable MoonQuest diagram.'] };
const opts = { slideCount:5,durationMinutes:70,game:{startMinute:40,durationMinutes:15} };
const slide = (s) => ({stepId:s.id,title:s.title,stageId:s.stageId,bullets:['Compare the example files.'],speakerNotes:'Ask why. Support: sentence starter. Check the actual example sizes.',example:'',vocab:[],shortcuts:[],worked:{task:'',steps:[]},visual:{type:'none',items:[]},table:{headers:[],rows:[],caption:''}});
test('outline validates source references, full duration, game placement and coverage',()=>{
 assert.deepEqual(outlineIssues(outline,sources,opts),[]);
 for(const mutate of [o=>o.steps.reverse(),o=>o.steps[2].startMinute=41,o=>o.steps[0].sourceIds=['unknown'],o=>o.steps[4].sourceIds=['S3']]){
  const copy=structuredClone(outline);mutate(copy);assert.ok(outlineIssues(copy,sources,opts).length);
 }
});
test('checks reject missing resources, conflicting render fields and reordered slides',()=>{
 const slides=outline.steps.map(slide);assert.deepEqual(deckIssues(slides,outline),[]);
 assert.ok(deckIssues(slides.slice().reverse(),outline).length);
 const copy=structuredClone(outline);copy.steps[0].resource='table';assert.ok(deckIssues(slides,copy).length);
 slides[0].table={headers:['File','Size'],rows:[['Video','10 MB']],caption:'Example sizes'};
 assert.deepEqual(deckIssues(slides,copy),[]);
 slides[0].worked.steps=['Old hidden instructions'];assert.ok(deckIssues(slides,copy).length);
});
test('game guides distinguish modes and avoid invented timer guarantees',()=>{
 assert.match(describeGame({mode:'moonquest'}).gameplay,/rabbit/i);
 assert.match(describeGame({mode:'colonyquest',playMode:'multiplayer'}).gameplay,/individual colonies/i);
 assert.match(describeGame({mode:'fishquest',playMode:'smartboard'}).gameplay,/smartboard/i);
 assert.doesNotMatch(gamePrompt({mode:'moonquest'}),/35 seconds/);
 assert.throws(()=>describeGame({mode:'fishquest',playMode:'duels'}));
});
test('aligned deck follows approved steps without appending an activity and retries failed review',async()=>{
 let calls=0, reviews=0;
 const slides=await generateAlignedDeck({callModel:async(schema,name)=>{
  calls++;if(name==='lesson_alignment_outline_review_v1')return {issues:[]};if(name==='lesson_outline_v1')return structuredClone(outline);
  if(name==='lesson_alignment_review_v1')return {issues:++reviews===1?['Restore video 10 MB.']:[]};
  return {slides:outline.steps.map(slide)};
 },slideSchema:{properties:{}},subject:'ICT',topic:'File sizes',grade:'Grade 3',slideCount:5,extras:{lessonPlanText:plan,teachingModelId:'gradual_release',lessonSettings:{durationMinutes:70,game:{mode:'moonquest',startMinute:40,durationMinutes:15,lesson:1}}}});
 assert.equal(calls,6);assert.equal(slides.length,7);
 assert.deepEqual(slides.slice(2).map(s=>s.alignment.id),['a','b','c','d','e']);
 assert.match(slides[0].lessonReview.externalResources[0],/diagram/);
 assert.match(slides[4].speakerNotes,/40–55/);
});
test('unresolved contradictions fail before a deck is presented',async()=>{
 await assert.rejects(()=>generateAlignedDeck({callModel:async()=>({...outline,blockers:['The two objectives conflict.']}),slideSchema:{properties:{}},slideCount:5,extras:{lessonPlanText:plan}}),/Review the lesson/);
});
test('explicit post-game independent work cannot drift before the selected game',()=>{
 const orderedSources=sourcesFromPlan(plan.replace('Complete an independent check.','After the game, review. You Do Alone: complete an independent check.'));
 const bad=structuredClone(outline);bad.steps[1].title='Independent matching';bad.steps[1].kind='independent';
 assert.ok(outlineIssues(bad,orderedSources,opts).some(e=>e.includes('AFTER')));
 assert.deepEqual(outlineIssues(outline,orderedSources,opts),[]);
});
test('detailed section timings override misleading heading durations',()=>{
 const timed=sourcesFromPlan(plan.replace('## Intro\n','## Intro (15m)\nTime: 10 minutes\n').replace('## Activities\n','## Activities (45m)\nTime: 50 minutes\n').replace('## Plenary\n','## Plenary\nTime: 10 minutes\n'));
 const bad=structuredClone(outline);bad.steps[3].endMinute=55;bad.steps[4].startMinute=55;
 assert.ok(outlineIssues(bad,timed,opts).some(e=>e.includes('section time')));
});
test('single-slide regeneration keeps its required step and rejects a moved task',async()=>{
 const {regenerateAlignedSlide}=require('../lesson-deck-alignment');let writes=0;
 const result=await regenerateAlignedSlide({callModel:async(_schema,name)=> name==='aligned_slide_review_v1'?{issues:[]}:{...slide(outline.steps[2]),stepId:++writes===1?'different-step':'c'},slideSchema:{properties:{}},alignment:outline.steps[2],lessonPlanText:plan,lessonSettings:{game:{mode:'moonquest'}},topic:'Files'});
 assert.equal(writes,2);assert.equal(result.alignment.id,'c');assert.match(result.speakerNotes,/40–55/);
});
test('a repeatedly invalid draft fails instead of returning a best-effort deck',async()=>{
 let drafts=0;
 await assert.rejects(()=>generateAlignedDeck({callModel:async(_schema,name)=>{
  if(name==='lesson_outline_v1')return structuredClone(outline);
  if(name==='lesson_alignment_outline_review_v1')return {issues:[]};
  drafts++;return {slides:[]};
 },slideSchema:{properties:{}},slideCount:5,extras:{lessonPlanText:plan,teachingModelId:'gradual_release',lessonSettings:{durationMinutes:70,game:{mode:'moonquest',startMinute:40,durationMinutes:15}}}}),/did not pass/);
 assert.equal(drafts,3);
});
test('only opted-in normal lessons use the new generator',async()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path'),{createRequire}=require('module');const file=path.join(__dirname,'../content.js');const real=createRequire(file);
 async function run(flag,purpose,planText){let calls=0;const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,console,process:{env:{OPENAI_API_KEY:'test',LESSON_PLAN_DECKS:flag}},require:name=>name==='./cache'?{wrap:async(_n,_i,fn)=>fn()}:name==='./lesson-deck-alignment'?{generateAlignedDeck:async()=>{calls++;return ['aligned'];}}:name==='./ai-client'?{client:()=>({chat:{completions:{create:async()=>{throw new Error('legacy-path')}}}})}:real(name)},{filename:file});
  try{await module.exports.generateContent('ICT','Files',5,'Grade 3','clear','',{lessonPurpose:purpose,lessonPlanText:planText});}catch(e){assert.match(e.message,/legacy-path/);}
  return calls;
 }
 assert.equal(await run('1','lesson',plan),1);
 for(const args of [['0','lesson',plan],['1','project',plan],['1','test',plan],['1','lesson','']])assert.equal(await run(...args),0);
});
test('schedule compiler reserves the game and post-game work within approved phase lengths',()=>{
 const {scheduleFromPlan}=require('../lesson-deck-alignment');
 const timed=sourcesFromPlan(plan.replace('## Intro\n','## Intro (15m)\nTime: 10 minutes\n').replace('## Activities\n','## Activities (45m)\nTime: 50 minutes\n').replace('Complete an independent check.','After the game, discuss. You Do Alone: complete an independent check.').replace('## Plenary\n','## Plenary\nTime: 10 minutes\n'));
 const bad=structuredClone(outline);bad.steps[3].startMinute=20;bad.steps[3].endMinute=25;bad.steps=[...bad.steps.slice(0,2),bad.steps[3],bad.steps[2],bad.steps[4]];
 const compiled=scheduleFromPlan(bad,timed,opts);assert.deepEqual(outlineIssues(compiled,timed,opts),[]);assert.equal(compiled.steps.find(s=>s.kind==='game').startMinute,40);assert.equal(compiled.steps.find(s=>s.kind==='independent').startMinute,55);assert.ok(compiled.warnings.some(w=>w.includes('Only 5 minutes')));assert.equal(bad.steps[2].startMinute,20);
});
test('explicit charts and assessment checkpoints are individually required',()=>{
 const {planRequirements}=require('../lesson-deck-alignment');
 const sources=sourcesFromPlan('## Activities\nShow chart/cards with examples: text 10 KB, photo 2 MB.\nCheck again: Order text, audio and video cards.\nStudent self-check and improvement: Correct your explanation.');
 const requirements=planRequirements(sources);assert.equal(requirements.length,3);assert.equal(requirements[0].resource,'table');
 const issues=outlineIssues({steps:[{...step('x','S1',0,70),objectiveIds:[],requirementIds:['R1'],resource:'external'}]},sources,{slideCount:1,durationMinutes:70,requirements});assert.ok(issues.some(i=>i.includes('actual table')));assert.ok(issues.some(i=>i.includes('Include R2')));assert.ok(issues.some(i=>i.includes('Include R3')));
});
test('criteria references are linked only when the task explicitly uses them',()=>{
 const {linkExplicitCriteria}=require('../lesson-deck-alignment');
 const sc=[...sources,{id:'S5',heading:'SC',content:'I can compare sizes.'}];
 const draft=structuredClone(outline);draft.steps[4].task='Review success criteria and explain your comparison.';
 const linked=linkExplicitCriteria(draft,sc);
 assert.ok(linked.steps[4].sourceIds.includes('S5'));
 assert.ok(!linked.steps[0].sourceIds.includes('S5'));
 assert.ok(!draft.steps[4].sourceIds.includes('S5'));
});
test('requirement mapping keeps self-correction after the game even with a generic title',()=>{
 const {scheduleFromPlan,planRequirements}=require('../lesson-deck-alignment');
 const timed=sourcesFromPlan(plan.replace('## Intro\n','## Intro\nTime: 10 minutes\n').replace('## Activities\n','## Activities\nTime: 50 minutes\n').replace('Complete an independent check.','After the game, review. You Do Alone: complete an independent check.\nStudent self-check and improvement: Revise your explanation.').replace('## Plenary\n','## Plenary\nTime: 10 minutes\n'));
 const requirements=planRequirements(timed), draft=structuredClone(outline);
 draft.steps.splice(2,0,{...step('fix','S3',20,23,'check'),title:'Fix and Improve: Self and Partner',task:'Revise your reason.',requirementIds:['R1']});
 const settings={...opts,slideCount:6,requirements};
 assert.ok(outlineIssues(draft,timed,settings).some(e=>e.includes('self-correction')));
 const compiled=scheduleFromPlan(draft,timed,settings);
 assert.ok(compiled.steps.find(s=>s.id==='fix').startMinute>=compiled.steps.find(s=>s.kind==='independent').endMinute);
 assert.deepEqual(outlineIssues(compiled,timed,settings),[]);
});
