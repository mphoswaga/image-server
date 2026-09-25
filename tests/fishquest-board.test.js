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
