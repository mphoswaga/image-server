const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, validateGame } = require('../moonquest');
const { generateQuestions } = require('../moonquest-ai');
function fixture() {
  const regions = ['a','b','c'].map((id,i) => ({ id, label:'Region '+id, points:[[i*.3,0],[i*.3+.2,0],[i*.3+.2,.2],[i*.3,.2]] }));
  return { title:'Test mission',grade:'Grade 2',reviewed:true,diagrams:[{id:'body',asset:'00000000-0000-0000-0000-000000000000',regions}],questions:Array.from({length:5},(_,i)=>({id:'q'+i,diagramId:'body',prompt:'Question '+i,concept:'Identify a sense',accepted:['a'],explanation:'A is correct.'})),timing:{choose:30,discuss:20,reconsider:8} };
}
function setup(t, count=10) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moonquest-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let now=100000;
  const store=createStore(dir,()=>now);const game=store.saveGame('teacher',fixture());const s=store.createSession('teacher',game.id,{id:'class',name:'Class',students:Array.from({length:count},(_,i)=>({id:'s'+i,name:'Student '+i}))});
  for(let i=0;i<count;i++)store.join(s.id,'s'+i);
  const cmd=(action,body={})=>store.command(s.id,'teacher',action,{seq:store.session(s.id).seq,...body});
  const answer=(i,region='a',eventId='e'+Math.random())=>{const live=store.session(s.id);return store.answer(s.id,'s'+i,{round:live.round,phase:live.phase,regionId:region,eventId});};
  return {store,game,id:s.id,dir,cmd,answer,clock:()=>now,step:ms=>{now+=ms;}};
}
test('requires reviewed, valid questions and bounded image coordinates',()=>{
  const g=fixture();assert.equal(validateGame(g).questions.length,5);
  assert.throws(()=>validateGame({...g,reviewed:false}),/Review/);
  g.diagrams[0].regions[0].points[0][0]=-1;assert.throws(()=>validateGame(g),/inside/);
});
test('first and final choices survive refresh without leaking keys or learner identities',t=>{
  const {store,id,cmd,answer}=setup(t);cmd('next');cmd('open');answer(0,'b');
  const publicView=store.snapshot(id,'board');assert.equal(publicView.question.accepted,undefined);assert.equal(publicView.stats,null);assert.equal(publicView.learners,undefined);assert.equal(publicView.queue,undefined);
  assert.equal(store.snapshot(id,'student','s0').mine.first,'b');cmd('advance');assert.throws(()=>answer(0,'a'),/closed/);
  cmd('advance');answer(0,'a');cmd('advance');const revealed=store.snapshot(id,'board');assert.deepEqual(revealed.question.accepted,['a']);assert.equal(revealed.stats.improved,1);assert.equal(revealed.stats.unanswered,9);
  const report=store.report(id,'teacher');assert.equal(report.students[0].rounds[0].initial,'Region b');assert.equal(report.students[0].rounds[0].revised,'Region a');assert.throws(()=>store.report(id,'other'),/another/);
});
test('timer rejects late answers, locks discussion, and pause preserves remaining time',t=>{
  const {store,id,cmd,answer,step}=setup(t);cmd('next');cmd('open');step(10000);cmd('pause');step(90000);assert.throws(()=>answer(0),/closed/);cmd('pause');
  assert.equal(store.snapshot(id,'student','s0').phase,'choose');step(20001);assert.throws(()=>answer(0),/closed/);assert.equal(store.snapshot(id,'board').phase,'discuss');
  step(20001);assert.equal(store.snapshot(id,'board').phase,'reconsider');step(8001);assert.equal(store.snapshot(id,'board').phase,'reveal');
});
test('duplicate submissions are idempotent even after stage closes',t=>{
  const {store,id,cmd,answer}=setup(t);cmd('next');cmd('open');answer(0,'a','same');answer(0,'a','same');cmd('advance');
  store.answer(id,'s0',{eventId:'same',round:0,phase:'choose',regionId:'a'});
  assert.equal(store.session(id).rounds[0].events.length,1);
});
test('strict greater-than 70 percent trigger and unanswered denominator',t=>{
  const a=setup(t);a.cmd('next');a.cmd('open');for(let i=0;i<10;i++)a.answer(i,i<7?'b':'a');a.cmd('advance');a.cmd('advance');assert.equal(a.store.session(a.id).queue.length,0);
  const b=setup(t);b.cmd('next');b.cmd('open');for(let i=0;i<4;i++)b.answer(i,'b');b.cmd('advance');b.cmd('advance');b.cmd('advance');
  const queue=b.store.session(b.id).queue;assert.equal(queue.length,1);assert.equal(queue[0].lowParticipation,true);assert.equal(b.store.stats(b.store.session(b.id)).unanswered,6);
});
test('delayed challenge preserves answer key and waits two other rounds',t=>{
  const {store,id,cmd,answer}=setup(t);cmd('next');cmd('open');for(let i=0;i<10;i++)answer(i,'b');cmd('advance');cmd('advance');
  const q=store.session(id).queue[0];store.review(id,'teacher',q.id,{prompt:'A different situation',explanation:'A remains correct',accepted:['b']});
  assert.throws(()=>cmd('challenge',{queueId:q.id}),/two other/);
  for(let i=0;i<2;i++){cmd('next');cmd('open');cmd('advance');cmd('advance');cmd('advance');}
  cmd('challenge',{queueId:q.id});const s=store.session(id);assert.equal(s.rounds[3].question.parentId,'q0');assert.deepEqual(s.rounds[3].question.accepted,['a']);assert.equal(s.queue[0].status,'asked');
});
test('server restart restores paused with acknowledged answers and immutable game snapshot',t=>{
  const {store,game,id,dir,cmd,answer,clock}=setup(t);cmd('next');cmd('open');answer(0,'b');store.saveGame('teacher',{...game,title:'Changed later'});
  const restarted=createStore(dir,clock);const state=restarted.snapshot(id,'student','s0');assert.equal(state.paused,true);assert.equal(state.recovered,true);assert.equal(state.mine.first,'b');assert.equal(state.title,'Test mission');
  assert.throws(()=>restarted.saveGame('other',{...game,title:'Stolen'}),/another/);
});
test('late learner joins next round, not current response count',t=>{
  const {store,id,cmd}=setup(t);let s=store.session(id);s.students.push({id:'late',name:'Late learner'});store.saveSession(s);cmd('next');store.join(id,'late');
  assert.equal(store.snapshot(id,'student','late').canAnswer,false);cmd('open');cmd('advance');cmd('advance');cmd('advance');cmd('next');assert.equal(store.snapshot(id,'student','late').canAnswer,true);
});
test('AI validates fixed answer key and sends only anonymous evidence',async()=>{
  const g=fixture();let sent;
  const ai={chat:{completions:{create:async args=>{sent=args;return {choices:[{message:{content:JSON.stringify({questions:[{...g.questions[0],prompt:'New context'}]})}}]};}}}};
  const q=await generateQuestions({...g,original:g.questions[0],evidence:{correct:2,wrong:8}},ai);assert.equal(q[0].prompt,'New context');assert.ok(sent.messages.at(-1).content.includes('"wrong":8'));
  const bad={chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify({questions:[{...g.questions[0],accepted:['b']}]})}}]})}}};
  await assert.rejects(generateQuestions({...g,original:g.questions[0]},bad),/changed the answer key/);
});
test('QR test entry claims independent practice seats, resumes and never joins a live class',t=>{
  const {store,game,id}=setup(t);
  const testRoom=store.createSession('teacher',game.id,null,true);
  const key='00000000-0000-0000-0000-000000000001';
  assert.throws(()=>store.joinPractice(id,key),/not an active/);
  const a=store.joinPractice(testRoom.id,key);
  assert.deepEqual(store.joinPractice(testRoom.id,key),a);
  const b=store.joinPractice(testRoom.id,'00000000-0000-0000-0000-000000000002');
  assert.notEqual(a.studentId,b.studentId);
  assert.equal(store.session(testRoom.id).rosterId,null);
  for(let i=3;i<=6;i++)store.joinPractice(testRoom.id,'00000000-0000-0000-0000-00000000000'+i);
  assert.throws(()=>store.joinPractice(testRoom.id,'00000000-0000-0000-0000-000000000007'),/six practice/);
  store.command(testRoom.id,'teacher','end',{seq:store.session(testRoom.id).seq});
  assert.throws(()=>store.joinPractice(testRoom.id,key),/not an active/);
});
