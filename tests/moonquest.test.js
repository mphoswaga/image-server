const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, validateGame } = require('../moonquest');
const { generateQuestions } = require('../moonquest-ai');
function fixture() {
  const regions = ['a','b','c'].map((id,i) => ({ id, label:'Region '+id, points:[[i*.3,0],[i*.3+.2,0],[i*.3+.2,.2],[i*.3,.2]] }));
  return { title:'Test mission',grade:'Grade 2',reviewed:true,diagrams:[{id:'body',asset:'00000000-0000-0000-0000-000000000000',regions}],questions:Array.from({length:5},(_,i)=>({id:'q'+i,diagramId:'body',prompt:'Question '+i,concept:'Identify a sense',accepted:['a'],explanation:'A is correct.'})),timing:{automatic:false,choose:30,discuss:20,reconsider:8} };
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
function automatic(t,count=2) {
  const f=setup(t,count);let s=f.store.session(f.id);
  s.game.timing={automatic:true,choose:12,discuss:15,reconsider:5,reveal:10};f.store.saveSession(s);return f;
}
test('automatic round opens immediately, keeps discussion time and finishes without teacher clicks',t=>{
  const f=automatic(t);f.cmd('next');assert.equal(f.store.snapshot(f.id,'board').phase,'choose');
  f.answer(0);assert.throws(()=>f.answer(0,'b'),/first choice/);f.answer(1);
  assert.equal(f.store.snapshot(f.id,'board').phase,'discuss');
  assert.throws(()=>f.answer(0),/closed/);f.step(14999);assert.equal(f.store.snapshot(f.id,'board').phase,'discuss');
  f.step(1);assert.equal(f.store.snapshot(f.id,'board').phase,'reconsider');
  f.answer(0);f.answer(1);assert.equal(f.store.snapshot(f.id,'board').phase,'reconsider');
  f.step(5000);assert.equal(f.store.snapshot(f.id,'board').phase,'reveal');
  f.step(10000);assert.equal(f.store.snapshot(f.id,'board').round,1);
  for(let round=1;round<5;round++){
    f.answer(0);f.answer(1);f.step(15000);f.store.snapshot(f.id,'board');f.step(5000);f.store.snapshot(f.id,'board');f.step(10000);f.store.snapshot(f.id,'board');
  }
  assert.equal(f.store.snapshot(f.id,'board').phase,'ended');assert.equal(f.store.report(f.id,'teacher').rounds.length,5);
});
test('automatic teaching pause retains evidence and resumes reveal before next question',t=>{
  const f=automatic(t);f.cmd('next');f.answer(0,'b');f.answer(1,'b');f.step(15000);f.store.snapshot(f.id,'board');f.step(5000);
  const v=f.store.snapshot(f.id,'teacher');assert.equal(v.teachingPause,'misconception');assert.equal(v.paused,true);assert.equal(v.stats.wrong,2);
  f.step(60000);assert.equal(f.store.snapshot(f.id,'board').phase,'reveal');f.cmd('pause');f.step(9999);assert.equal(f.store.snapshot(f.id,'board').phase,'reveal');f.step(1);assert.equal(f.store.snapshot(f.id,'board').round,1);
});
test('live dashboard distribution is teacher-only until reveal and missing responses trigger support',t=>{
  const f=automatic(t);f.cmd('next');f.answer(0,'b');
  assert.equal(f.store.snapshot(f.id,'teacher').liveStats.distribution.b,1);
  for(const role of ['board','student']){const v=f.store.snapshot(f.id,role,'s0');assert.equal(v.liveStats,undefined);assert.equal(v.stats,null);assert.equal(v.learners,undefined);}
  f.step(12000);f.store.snapshot(f.id,'board');f.step(15000);f.store.snapshot(f.id,'board');f.answer(0,'a');f.step(5000);
  const v=f.store.snapshot(f.id,'board');assert.equal(v.teachingPause,'participation');assert.equal(v.stats.unanswered,1);assert.equal(v.stats.improved,1);
});
test('automatic rounds insert only reviewed follow-ups after two intervening rounds',t=>{
  const f=automatic(t);f.cmd('next');f.answer(0,'b');f.answer(1,'b');f.step(15000);f.store.snapshot(f.id,'board');f.step(5000);f.store.snapshot(f.id,'board');
  const q=f.store.session(f.id).queue[0];f.store.review(f.id,'teacher',q.id,{prompt:'Reviewed new context',explanation:'Reason'});f.cmd('pause');f.step(10000);f.store.snapshot(f.id,'board');
  for(let i=0;i<2;i++){f.answer(0);f.answer(1);f.step(15000);f.store.snapshot(f.id,'board');f.step(5000);f.store.snapshot(f.id,'board');f.step(10000);f.store.snapshot(f.id,'board');}
  assert.equal(f.store.snapshot(f.id,'board').question.prompt,'Reviewed new context');assert.equal(f.store.session(f.id).queue[0].status,'asked');
});
test('new sessions upgrade older saved games to bounded automatic timing, explicit manual is preserved',t=>{
  const f=setup(t);const game={...f.game,timing:{choose:30,discuss:20,reconsider:8}};f.store.saveGame('teacher',game);
  const s=f.store.createSession('teacher',game.id,null,true);assert.deepEqual(s.game.timing,{automatic:true,choose:35,discuss:20,reconsider:8,flow:'single',reveal:8});
  const saved=f.store.read('game',game.id);f.store.saveGame('teacher',{...saved,timing:{automatic:false,choose:30,discuss:20,reconsider:8}});
  assert.equal(f.store.createSession('teacher',game.id,null,true).game.timing.automatic,false);
});
test('automatic restart and pause preserve stage time and saved first choices',t=>{
  const f=automatic(t);f.cmd('next');f.answer(0,'b');f.step(3000);f.cmd('pause');f.step(60000);f.cmd('pause');
  assert.equal(f.store.snapshot(f.id,'board').deadline-f.clock(),9000);
  const restart=createStore(f.dir,f.clock);const v=restart.snapshot(f.id,'student','s0');assert.equal(v.paused,true);assert.equal(v.mine.first,'b');
  restart.command(f.id,'teacher','pause',{seq:v.seq});assert.equal(restart.snapshot(f.id,'board').deadline-f.clock(),9000);
});
test('automatic rooms with nobody included pause instead of looping or losing results',t=>{
  const f=automatic(t);f.cmd('next');f.answer(0);f.answer(1);f.step(15000);f.store.snapshot(f.id,'board');f.step(5000);f.store.snapshot(f.id,'board');
  f.cmd('absent',{studentId:'s0',absent:true});f.cmd('absent',{studentId:'s1',absent:true});f.step(10000);
  assert.equal(f.store.snapshot(f.id,'teacher').teachingPause,'attendance');
  assert.equal(f.store.report(f.id,'teacher').rounds[0].stats.correct,2);
  f.cmd('absent',{studentId:'s0',absent:false});f.cmd('pause');f.step(10000);assert.equal(f.store.snapshot(f.id,'board').expected,1);
});
test('automatic QR rehearsal counts actual devices rather than unclaimed simulation seats',t=>{
  const f=setup(t);const g=f.store.saveGame('teacher',{...f.game,timing:{automatic:true}});const room=f.store.createSession('teacher',g.id,null,true);
  for(const st of room.students)f.store.join(room.id,st.id);
  const first=f.store.joinPractice(room.id,'00000000-0000-0000-0000-000000000001');
  const second=f.store.joinPractice(room.id,'00000000-0000-0000-0000-000000000002');
  const s=f.store.session(room.id);assert.equal(Object.keys(s.members).length,2);
  f.store.command(room.id,'teacher','next',{seq:s.seq});
  for(const id of [first.studentId,second.studentId])f.store.answer(room.id,id,{round:0,phase:'choose',regionId:'a',eventId:id});
  assert.equal(f.store.snapshot(room.id,'board').phase,'choose');assert.equal(f.store.snapshot(room.id,'board').expected,2);
});
test('starting automatic play before anyone joins does not trap the lobby in pause',t=>{
  const f=setup(t);const g=f.store.saveGame('teacher',{...f.game,timing:{automatic:true}});const s=f.store.createSession('teacher',g.id,{id:'new',name:'New class',students:[{id:'new',name:'New'}]});
  assert.throws(()=>f.store.command(s.id,'teacher','next',{seq:s.seq}),/Wait for learners/);
  assert.equal(f.store.snapshot(s.id,'teacher').paused,false);
});
test('cinematic introduction is synchronized, pausable, and starts the first round automatically',t=>{
  const f=automatic(t);f.cmd('launch');assert.equal(f.store.snapshot(f.id,'board').phase,'intro');
  assert.equal(f.store.snapshot(f.id,'student','s0').question,null);
  f.step(8000);f.cmd('pause');assert.equal(f.store.snapshot(f.id,'board').introElapsedMs,8000);
  f.step(60000);assert.equal(f.store.snapshot(f.id,'board').introElapsedMs,8000);
  f.cmd('pause');f.step(16000);assert.equal(f.store.snapshot(f.id,'board').phase,'choose');
  assert.equal(f.store.snapshot(f.id,'board').round,0);
});
test('intro skip is teacher-owned and roll call contains status without individual answers',t=>{
  const f=automatic(t);f.cmd('launch');assert.throws(()=>f.store.command(f.id,'other','skip-intro',{seq:f.store.session(f.id).seq}),/another teacher/);
  f.cmd('skip-intro');f.answer(0,'b');const view=f.store.snapshot(f.id,'board');
  assert.deepEqual(view.crew,[{name:'Student 0',answered:true,confirmed:false},{name:'Student 1',answered:false,confirmed:false}]);
  assert.equal(view.stats,null);assert.equal(view.learners,undefined);assert.equal(f.store.snapshot(f.id,'student','s0').crew,undefined);
  assert.equal(f.store.snapshot(f.id,'teacher').learners[0].choice,undefined);
});

function single(t,count=10) { const f=setup(t,count);const s=f.store.session(f.id);s.game.timing={automatic:true,flow:'single',choose:35,reveal:8};f.store.saveSession(s);return f; }
test('single timer keeps 35 seconds even with all answers, locks changes, and preserves both attempts',t=>{
  const f=single(t,2);f.cmd('next');f.answer(0,'b');f.answer(1,'a');
  assert.equal(f.store.snapshot(f.id,'board').phase,'choose');assert.throws(()=>f.answer(0,'a'),/locked/);
  f.step(34000);assert.equal(f.store.snapshot(f.id,'board').phase,'choose');
  f.store.answer(f.id,'s0',{round:0,phase:'choose',regionId:'a',changeConfirmed:true,eventId:'revision'});
  assert.equal(f.store.snapshot(f.id,'student','s0').mine.first,'b');
  f.step(1000);const v=f.store.snapshot(f.id,'board');assert.equal(v.phase,'reveal');assert.equal(v.paused,false);assert.equal(v.stats.improved,1);
  assert.throws(()=>f.answer(0,'b'),/closed/);f.step(8000);assert.equal(f.store.snapshot(f.id,'board').round,1);
});
test('class meeting is strictly above 30 percent of included learners and waits for teacher',t=>{
  for(const wrong of [3,4]){
    const f=single(t);f.cmd('next');for(let i=0;i<10;i++)f.answer(i,i<wrong?'b':'a');f.step(35000);
    const v=f.store.snapshot(f.id,'board');assert.equal(v.paused,wrong>3);assert.equal(v.stats.wrong,wrong);
    if(wrong>3){assert.equal(v.teachingPause,'misconception');f.step(300000);assert.equal(f.store.snapshot(f.id,'student','s0').teachingPause,'misconception');assert.throws(()=>f.store.command(f.id,'other','continue-meeting',{seq:v.seq}),/another/);f.cmd('continue-meeting');assert.equal(f.store.snapshot(f.id,'board').round,1);assert.equal(f.store.snapshot(f.id,'board').paused,false);}
  }
  const f=single(t);f.cmd('next');f.answer(0,'b');f.step(35000);const v=f.store.snapshot(f.id,'board');assert.equal(v.stats.unanswered,9);assert.equal(v.paused,false); // Missing responses are not wrong answers.
});
test('alternative correct areas require one answer, all mode requires an exact complete set',t=>{
  const f=single(t,2);const s=f.store.session(f.id);s.game.questions[0].accepted=['a','b'];s.game.questions[1].accepted=['a','b'];s.game.questions[1].answerMode='all';f.store.saveSession(s);f.cmd('next');
  let v=f.store.snapshot(f.id,'student','s0');assert.equal(v.question.selectionCount,1);assert.equal(v.question.accepted,undefined);
  f.answer(0,'b');f.answer(1,'a');f.step(35000);assert.equal(f.store.snapshot(f.id,'board').stats.correct,2);f.step(8000);
  v=f.store.snapshot(f.id,'student','s0');assert.equal(v.question.selectionCount,2);assert.equal(v.question.accepted,undefined);
  assert.throws(()=>f.answer(0,'a'),/Choose 2/);
  const send=(id,ids,event)=>f.store.answer(f.id,id,{round:1,phase:'choose',regionIds:ids,eventId:event});
  assert.throws(()=>send('s0',['a','a'],'dup'),/different/);send('s0',['b','a'],'correct');send('s1',['a','c'],'wrong');f.step(35000);
  v=f.store.snapshot(f.id,'board');assert.equal(v.stats.correct,1);assert.equal(v.stats.wrong,1);assert.equal(f.store.snapshot(f.id,'student','s0').myCorrect,true);assert.equal(f.store.snapshot(f.id,'student','s1').myCorrect,false);
  assert.equal(f.store.report(f.id,'teacher').students[0].rounds[1].revised,'Region b + Region a');
});
