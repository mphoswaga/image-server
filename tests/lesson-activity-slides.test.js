const test=require('node:test'),assert=require('node:assert/strict');
const {taskIssues,materializeTask}=require('../lesson-activity-slides');
const {deckIssues,planRequirements,sourcesFromPlan}=require('../lesson-deck-alignment');
const {rebuildDeck}=require('../generate');
const Zip=require('pizzip');
const sequence='Open the book → Turn a page → Turn a page → Turn a page → Close the book';
const fixture=()=>({title:'Find useful repeats',bullets:['Highlight repeats.'],speakerNotes:'Allow pupils time to think.',worked:{task:'Old hidden example',steps:['Old answer']},visual:{type:'steps',items:['Old hidden resource']},learnerTask:{required:true,question:'Which action repeats? Rewrite it using Repeat.',stimulus:[sequence],answer:'Repeat “Turn a page” three times. Keep the opening and closing steps.'}});
test('vague task cues and independent steps require an actual learner question',()=>{
 for(const s of [{title:'Find repeats',bullets:['Highlight repeats.']},{title:'What Would You Change?',bullets:['Discuss with a partner.']}])assert.ok(taskIssues(s).length);
 assert.ok(taskIssues({title:'Task'}, {kind:'independent'}).length);
 assert.deepEqual(taskIssues({title:'What is an algorithm?',bullets:['An algorithm is a sequence of instructions.']}),[]);
 assert.deepEqual(taskIssues({title:'Game joining',bullets:['Choose your name.']},{kind:'game'}),[]);
});
test('definitions about solving problems survive task repair unchanged',async()=>{
 const s={title:'What is an algorithm?',bullets:['A set of clear, ordered instructions.','Helps you solve a problem step by step.'],learnerTask:{required:false,question:'',stimulus:[],answer:''}};
 assert.deepEqual(taskIssues(s),[]);
 const result=await require('../lesson-activity-slides').repairTasks({slides:[s],callModel:()=>{throw new Error('An explanation must not be replaced with an exercise.');}});
 assert.equal(result.slides[0],s);
 assert.ok(taskIssues({title:'Your challenge',bullets:['Solve the problem below.']}).length);
});
test('referenced problem data cannot be left in notes or an unspecified worksheet',()=>{
 const s=fixture();s.learnerTask.stimulus=[];s.speakerNotes+=' '+sequence;assert.ok(taskIssues(s).length);
 s.learnerTask.stimulus=[sequence];assert.deepEqual(taskIssues(s),[]);
 s.learnerTask.question='Highlight repeats';assert.ok(taskIssues(s).length);
});
test('creation briefs can be open-ended, while long task text is repaired instead of clipped',()=>{
 const s=fixture();s.learnerTask={required:true,question:'Create an algorithm for packing your school bag in three named sections.',stimulus:[],answer:'Accept logical Collect, Pack and Check sections.'};assert.deepEqual(taskIssues(s),[]);
 s.learnerTask.stimulus=['A'.repeat(161)];assert.ok(taskIssues(s).some(i=>i.includes('fits on screen')));
});
test('task data is editable visible text; answers stay private and competing resources cannot hide it',async()=>{
 const raw=fixture(),s=materializeTask(raw);assert.deepEqual(s.bullets,[raw.learnerTask.question,sequence]);assert.equal(s.layoutHint,'TEXT_HEAVY');assert.equal(s.worked.steps.length,0);assert.equal(s.visual.type,'none');assert.match(s.speakerNotes,/Private task guidance/);assert.doesNotMatch(s.bullets.join(' '),/three times/);
 const deck={grade:'Grade 3',presetId:'sage-split',images:[null],slides:[{...s,type:'content'}]};
 const buffer=await rebuildDeck(deck).write({outputType:'nodebuffer'}),zip=new Zip(buffer);
 const slide=zip.file('ppt/slides/slide1.xml').asText(),notes=zip.file('ppt/notesSlides/notesSlide1.xml').asText();
 assert.match(slide,/Which action repeats/);assert.match(slide,/Close the book/);assert.doesNotMatch(slide,/three times/);assert.match(notes,/three times/);
 assert.deepEqual(raw.bullets,['Highlight repeats.']);
});
test('tables supply task data without duplicate stimulus or hidden question',()=>{
 const s=fixture();s.worked={task:'',steps:[]};s.visual={type:'none',items:[]};s.learnerTask.stimulus=[];s.table={headers:['Step','Instruction'],rows:[['1','Open book'],['2','Turn page']],caption:''};assert.deepEqual(taskIssues(s),[]);const ready=materializeTask(s);assert.match(ready.bullets[0],/Which action/);assert.equal(ready.table.rows.length,2);
});
test('plan extraction reserves explicit classroom exercises as requirements',()=>{
 const requirements=planRequirements(sourcesFromPlan('## Activities\nPredict (5m): Which steps repeat? Read: get bread, spread jam, get bread.\nEdit and Correct (10m): Reorder shoes and socks.\nLearning checkpoint: Rewrite the sequence.'));
 assert.equal(requirements.length,3);assert.match(requirements[0].text,/get bread/);
 const missing={stepId:'p',title:'Practice',bullets:['Discuss your answer.'],speakerNotes:'Ask pupils.'};assert.ok(deckIssues([missing],{steps:[{id:'p',kind:'practice',resource:'text'}]}).some(i=>i.includes('actual learner')));
});
test('focused repair restores missing questions without replacing correct teaching content',async()=>{
 const {repairTasks}=require('../lesson-activity-slides');const correct={title:'What is an algorithm?',bullets:['A clear sequence of instructions.']},missing={title:'What Would You Change?',bullets:['Highlight repeats.'],speakerNotes:'Use the sandwich example.'};let calls=0;
 const result=await repairTasks({slides:[correct,missing],grade:'Grade 3',plan:'Get bread, spread butter, get bread, spread jam.',callModel:async(schema,name,messages)=>{calls++;assert.equal(name,'lesson_activity_questions_v1');assert.deepEqual(schema.properties.tasks.items.properties.learnerTask.properties.required.enum,[true]);assert.match(messages[1].content,/spread butter/);return {tasks:[{id:'slide-1',learnerTask:fixture().learnerTask}]};}});
 assert.equal(calls,1);assert.equal(result.slides[0],correct);assert.equal(result.slides[1].title,missing.title);assert.deepEqual(taskIssues(result.slides[1]),[]);assert.equal(missing.learnerTask,undefined);
});
test('external game instructions remain intact and are not replaced with invented classroom questions',()=>{
 const game={title:'Play FishQuest Game!',instructions:['Open the learner link.','Choose your name.','Answer the game questions.'],learnerTask:{required:false,question:'',stimulus:[],answer:''}};
 assert.deepEqual(taskIssues(game,null,true),[]);assert.equal(materializeTask(game),game);
});
test('identify-repeats exercises must actually contain repetition or explicitly expect none',()=>{
 const s=fixture();s.learnerTask.stimulus=['Wet brush','Apply paste','Brush','Repeat','Rinse mouth'];assert.ok(taskIssues(s).some(i=>i.includes('no repeated action')));
 s.learnerTask.answer='No steps are repeated in this sequence.';assert.deepEqual(taskIssues(s),[]);
});
test('export gate also protects ordinary task slides without alignment metadata',async()=>{
 const s=materializeTask(fixture()),deck={grade:'Grade 3',presetId:'sage-split',images:[null],slides:[{...s,type:'content'}]};const buffer=await rebuildDeck(deck).write({outputType:'nodebuffer'}),zip=new Zip(buffer);
 const {validateAlignedExport}=require('../lesson-deck-export');validateAlignedExport(buffer,deck);zip.file('ppt/slides/slide1.xml',zip.file('ppt/slides/slide1.xml').asText().replace('Which action repeats?','Missing task?'));assert.throws(()=>validateAlignedExport(zip.generate({type:'nodebuffer'}),deck),/lost teaching content/);
});
test('question and all problem data stay together in a full-width task slide',()=>{
 const {paginateSlides}=require('../generate'),{gradeProfile}=require('../grade');const s={...materializeTask(fixture()),type:'content'};s.bullets=[s.learnerTask.question,'Get bread','Spread jam','Eat','Get bread','Spread jam'];const pages=paginateSlides([s],gradeProfile('Grade 3').theme,null);assert.equal(pages.length,1);assert.equal(pages[0]._layout,'task');assert.deepEqual(pages[0].bullets,s.bullets);
});
