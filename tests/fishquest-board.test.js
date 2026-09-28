const test=require('node:test'),assert=require('node:assert/strict');
const {create,answer,next}=require('../public/fishquest-board-state');
const students=Array.from({length:25},(_,i)=>({name:'Learner '+i,studentId:String(i),team:i%2}));
const questions=[{question:'Where?',options:['Here','There'],correctIndex:0}];
test('every learner receives an equal turn and a correct answer feeds the team exactly once',()=>{
 const s=create(students,questions,2);
 for(let i=0;i<25;i++){
  assert.equal(s.players[s.turn%25].studentId,String(i));
  assert.equal(answer(s,0),true);assert.equal(answer(s,0),false);next(s);
 }
 assert.equal(s.phase,'ended');assert.equal(s.answers.length,25);
 assert.equal(s.food.reduce((a,b)=>a+b),125);assert.ok(s.players.every(p=>p.food===2));
 assert.equal(answer(s,0),false);assert.equal(next(s),false);
});
test('pause, incorrect answers, invalid choices and refresh preserve progress',()=>{
 const s=create(students,questions,2);s.paused=true;assert.equal(answer(s,0),false);
 s.paused=false;assert.equal(answer(s,5),false);answer(s,1);
 assert.deepEqual(s.food,[0,0]);s.paused=true;assert.equal(next(s),false);
 const restored=JSON.parse(JSON.stringify(s));restored.paused=false;next(restored);assert.equal(restored.turn,1);
});
test('a longer question set gives everyone the same number of turns',()=>{
 assert.equal(create(students,Array(30).fill(questions[0]),2).rounds,50);
 assert.throws(()=>create([],questions,2));assert.throws(()=>create([{name:'A',team:4}],questions,2));
});
test('smartboard endpoint returns all assigned rosters only to owner, without writing marks',async t=>{
 const express=require('express'),{createFishQuestLive}=require('../fishquest-live');
 const game={id:'board',teacherId:'owner',questions,fishquest:{}},app=express();
 let writes=0;
 createFishQuestLive({app,games:{getGame:()=>game,getRosterIds:()=>['r1','r2'],normalizeStudentId:String,recordResult:()=>writes++},roster:{getRoster:(owner,id)=>({name:id,students:[{id:id+'s',name:'Learner '+id}]})},requireAuth:(req,res,next)=>{req.userId=req.headers['x-user'];next()},requireGameAccess:(_,__,next)=>next(),jwtSecret:'test'});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/api/game/board/fishquest/smartboard';
 assert.equal((await fetch(url,{headers:{'x-user':'other'}})).status,403);
 const response=await fetch(url,{headers:{'x-user':'owner'}});assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.attendance.length,2);assert.equal(body.classes.length,2);assert.equal(writes,0);
});
test('unique fish grow from personal and shared food without growing the opposing team',()=>{
 const s=create(students,questions,2);
 assert.equal(new Set(s.players.map(p=>p.variant)).size,25);
 assert.ok(s.players.every(p=>p.mass===100));
 answer(s,0);
 assert.equal(s.players[0].mass,190);
 assert.equal(s.players[1].mass,100);
 assert.ok(s.players[2].mass>100);
 assert.equal(Math.round(s.players.reduce((sum,p)=>sum+p.mass-100,0)),225);
 const masses=s.players.map(p=>p.mass);answer(s,0);assert.deepEqual(s.players.map(p=>p.mass),masses);
});
test('all growth stages use the live FishQuest thresholds and keep a safe visual size',()=>{
 const growth=require('../public/fishquest-growth');
 assert.deepEqual([100,160,280,450,650,800].map(growth.evolution),['minnow','reef','hunter','shark','orca','whale']);
 assert.equal(growth.evolution(649),'shark');assert.equal(growth.scale(100),1);
 assert.ok(growth.scale(10000)<=1.85);
 assert.equal(growth.progress(800).fraction,1);
 const s=create(students.slice(0,4),questions,2,4);
 while(s.phase!=='ended'){answer(s,0);next(s);}
 assert.ok(s.players.every(p=>growth.evolution(p.mass)==='whale'));
});
test('old board sessions recover growth once and preserve their existing rewards',()=>{
 const {upgrade}=require('../public/fishquest-board-state');
 const s=create(students,questions,2);answer(s,0);
 delete s.growthVersion;s.players.forEach(p=>{delete p.variant;delete p.mass});
 const food=s.food.slice();upgrade(s);
 assert.equal(s.players[0].mass,190);assert.deepEqual(s.food,food);
 const masses=s.players.map(p=>p.mass);upgrade(s);assert.deepEqual(s.players.map(p=>p.mass),masses);
});
test('story waits for equal learner turns, handles both threats, and ends at the sanctuary',()=>{
 const Story=require('../public/fishquest-board-story');
 const s=require('../public/fishquest-board-story').startLegacy(create(students.slice(0,4),questions,2,1));
 assert.equal(s.rounds,8);assert.equal(s.phase,'intro');assert.equal(answer(s,0),false);
 const {advance,choose}=require('../public/fishquest-board-state');
 advance(s);
 for(let i=0;i<4;i++){answer(s,0);next(s)}
 assert.equal(s.phase,'event_warning');assert.equal(s.story.event.kind,'shark');
 assert.equal(s.answers.length,4);s.paused=true;assert.equal(advance(s),false);s.paused=false;advance(s);
 const captain=Story.current(s).captain;assert.equal(captain.studentId,'2');
 const food=s.food[0];assert.equal(choose(s,'stand'),true);
 assert.equal(s.food[0],food-Math.ceil(food*.4));assert.equal(choose(s,'stand'),false);
 assert.equal(s.players.length,4);assert.equal(s.answers.length,4);
 const restored=JSON.parse(JSON.stringify(s));advance(restored);choose(restored,'hide');advance(restored);
 assert.equal(restored.phase,'question');assert.deepEqual(restored.story.completed,['shark']);
 for(let i=0;i<4;i++){answer(restored,0);next(restored);if(restored.phase==='swim_break')advance(restored)}
 assert.equal(restored.phase,'event_warning');assert.equal(restored.story.event.kind,'net');
 advance(restored);choose(restored,'shelter');advance(restored);choose(restored,'sprint');advance(restored);
 assert.equal(restored.phase,'ended');assert.equal(restored.story.history.length,4);
 assert.equal(restored.players.length,4);assert.equal(restored.answers.length,8);
});
test('threat choices reject unaffordable spending and protect a fully grown school',()=>{
 const {advance,choose}=require('../public/fishquest-board-state');
 const s=require('../public/fishquest-board-story').startLegacy(create(students.slice(0,2),questions,2,1));advance(s);
 for(let i=0;i<2;i++){answer(s,1);next(s)}
 advance(s);assert.equal(choose(s,'distract'),false);assert.equal(s.phase,'event_choice');
 s.players.forEach(p=>p.mass=450);s.food[0]=20;assert.equal(choose(s,'stand'),true);
 assert.equal(s.food[0],20);assert.equal(s.story.event.result.safe,true);
});
test('question clock expires once without awarding food and starts fresh for the next learner',()=>{
 const Board=require('../public/fishquest-board-state'),s=create(students,questions,2,1,false,20);
 assert.equal(Board.tick(s,19999),false);assert.equal(s.remainingMs,1);
 assert.equal(Board.tick(s,1),true);assert.equal(s.phase,'reveal');
 assert.equal(s.answers[0].choice,null);assert.equal(s.answers[0].timedOut,true);
 assert.deepEqual(s.food,[0,0]);assert.ok(s.players.every(p=>p.mass===100));
 assert.equal(Board.tick(s,50000),false);assert.equal(answer(s,0),false);assert.equal(s.answers.length,1);
 next(s);assert.equal(s.remainingMs,20000);assert.equal(s.turn,1);assert.equal(answer(s,0),true);
});
test('pause and saved question retain remaining time; old sessions default to thirty seconds',()=>{
 const {tick}=require('../public/fishquest-board-state'),s=create(students,questions,2,1,false,45);
 tick(s,12000);s.paused=true;tick(s,90000);assert.equal(s.remainingMs,33000);
 const restored=JSON.parse(JSON.stringify(s));restored.paused=false;tick(restored,32999);assert.equal(restored.phase,'question');tick(restored,1);assert.equal(restored.phase,'reveal');
 delete s.remainingMs;delete s.questionSeconds;s.paused=false;tick(s,1000);assert.equal(s.remainingMs,29000);
 tick(s,-10);tick(s,NaN);assert.equal(s.remainingMs,29000);
 assert.throws(()=>create(students,questions,2,1,false,0));
});

test('exploration breaks pause safely and never interrupt shark or net milestones',()=>{
 const {advance}=require('../public/fishquest-board-state'),s=require('../public/fishquest-board-story').startLegacy(create(students,questions,2,1));advance(s);
 for(let i=0;i<6;i++){answer(s,0);next(s)}
 assert.equal(s.phase,'swim_break');assert.equal(answer(s,0),false);s.paused=true;assert.equal(advance(s),false);
 const restored=JSON.parse(JSON.stringify(s));restored.paused=false;assert.equal(advance(restored),true);assert.equal(restored.phase,'question');assert.equal(restored.turn,6);assert.equal(restored.remainingMs,30000);
});
