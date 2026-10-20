const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ColonyMatch}=require('../colonyquest-multiplayer');
const game={id:'individual',lessonTitle:'Habitats',questions:Array.from({length:3},(_,i)=>({question:'Q'+i,options:['Yes','No'],correctIndex:0,explanation:'Why yes'}))};
function room(storyEnabled=false){const m=new ColonyMatch(game,{now:0,pacing:'individual',storyEnabled});const a=m.join({studentId:'a',name:'A'},0),b=m.join({studentId:'b',name:'B'},0);m.start(0);return {m,a,b};}
test('correct feedback and upgrade are immediate; next question does not wait for rivals',()=>{
 const {m,a,b}=room();m.answer(a.id,0,0,100);
 assert.equal(m.snapshot(a.id,false,100).phase,'upgrade');assert.equal(m.snapshot(b.id,false,100).phase,'answer');
 assert.equal(m.snapshot(b.id,false,100).question.correctIndex,undefined);
 m.upgrade(a.id,0,'food',null,200);m.tick(2700);
 assert.equal(a.round,1);assert.equal(b.round,0);assert.equal(m.snapshot(a.id,false,2700).question.question,'Q1');
 assert.throws(()=>m.answer(a.id,0,0,2800),/finished/);
 assert.equal(m.report().questions[0].correct,1);
});
test('incorrect and unanswered questions show correction then advance once',()=>{
 const {m,a,b}=room();m.answer(a.id,0,1,100);const s=m.snapshot(a.id,false,100);
 assert.equal(s.phase,'reveal');assert.equal(s.question.correctIndex,0);assert.equal(s.me.correct,false);
 assert.throws(()=>m.upgrade(a.id,0,'food',null,200),/closed/);
 m.tick(3100);assert.equal(a.round,1);m.tick(25000);
 assert.equal(b.phase,'reveal');assert.equal(b.answers.length,0);m.tick(28000);assert.equal(b.round,1);
 assert.equal(m.report().questions[0].answered,1);
});
test('pausing and recovery preserve each deadline and shared world clock',()=>{
 const {m,a,b}=room();m.answer(a.id,0,0,100);m.pause(1000);
 const aRemaining=a.personalRemaining,bRemaining=b.personalRemaining;
 assert.throws(()=>m.answer(b.id,0,0,1200),/closed/);
 assert.throws(()=>m.upgrade(a.id,0,'food',null,1200),/closed/);
 m.resume(20000);assert.equal(a.deadline,20000+aRemaining);assert.equal(b.deadline,20000+bRemaining);
 const restored=new ColonyMatch(game,{state:structuredClone(m.state),now:20001});restored.restore(20001);
 assert.equal(restored.state.phase,'paused');assert.equal(restored.player(a.id).phase,'upgrade');
 restored.join({studentId:'a'},21000);restored.resume(22000);assert.equal(restored.player(a.id).round,0);
});
test('disconnection freezes a personal question without blocking connected peers',()=>{
 const {m,a,b}=room();a.connected=false;m.tick(1000);const remaining=a.personalRemaining;
 m.tick(5000);assert.equal(a.personalRemaining,remaining);
 m.join({studentId:'a'},9000);assert.equal(a.deadline,9000+remaining);
 m.answer(a.id,0,0,9000);assert.equal(a.phase,'upgrade');
 m.answer(b.id,0,0,10000);assert.equal(b.phase,'upgrade');
});
test('finishing exposes colonies to watch, never rival answers or extra upgrades',()=>{
 const {m,a,b}=room();let time=100;
 for(let round=0;round<3;round++){m.answer(a.id,round,0,time);m.upgrade(a.id,round,'food',null,time+1);m.tick(time+2501);time+=2600;}
 const s=m.snapshot(a.id,false,time);assert.equal(s.phase,'spectating');assert.equal(s.spectators[0].id,b.id);
 assert.equal(s.spectators[0].colony,undefined);
 const watched=m.snapshot(a.id,false,time,null,b.id).watching;
 assert.equal(watched.id,b.id);assert.equal(watched.colony.name,b.colony.name);
 assert.equal(watched.answers,undefined);assert.equal(watched.question,undefined);
 assert.equal(m.snapshot(a.id,false,time,null,'another-room').watching,undefined);
 assert.equal(s.spectators[0].answers,undefined);assert.equal(s.spectators[0].question,undefined);
 assert.equal(m.snapshot(b.id,false,time).spectators,undefined);
 const workers=a.colony.workers;m.upgrade(a.id,2,'workers',null,time);assert.equal(a.colony.workers,workers);assert.equal(a.upgrades.length,3);
});
test('all original questions complete before automatic finish; teacher finish preserves blanks',()=>{
 const {m,a,b}=room();let time=100;
 for(let round=0;round<3;round++){
  for(const p of [a,b]){m.answer(p.id,round,0,time);m.upgrade(p.id,round,'food',null,time+1);}
  m.tick(time+2501);time+=2600;
 }
 assert.equal(m.state.phase,'ended');assert.equal(m.report().learners[0].answered,3);
 const other=room();other.m.answer(other.a.id,0,0,100);other.m.end(101);assert.equal(other.m.report().learners[1].answered,0);
});
test('shared threats use active world time, not the fastest learners round',()=>{
 const {m,a,b}=room(true);const t=m.state.deadline;m.tick(t);assert.equal(m.state.phase,'answer');
 m.state.encounters=[{key:'dry',at:1000},{key:'rain',at:2000}];
 m.answer(a.id,0,0,t+100);m.tick(t+1000);
 assert.equal(m.state.world.dryOccurred,true);assert.equal(b.round,0);
 assert.equal(m.snapshot(a.id,false,t+1000).story.key,'dry');assert.equal(m.snapshot(b.id,false,t+1000).story.key,'dry');
 assert.equal(m.snapshot(b.id,false,t+1000).phase,'answer');assert.equal(m.snapshot(b.id,false,t+1000).question.correctIndex,undefined);
 m.pause(t+1100);const elapsed=m.state.elapsedMs;m.tick(t+26000);assert.equal(m.state.elapsedMs,elapsed);
});

test('raid protection uses shared seconds rather than different personal question numbers',()=>{
 const {m,a,b}=room();a.colony.soldiers=4;b.colony.food=30;
 m.answer(a.id,0,0,100);assert.equal(m.raidAllowed(a,b).allowed,true);
 m.upgrade(a.id,0,'raid',b.id,101);
 assert.equal(b.protectedUntilMs,20000);
 m.state.elapsedMs=19999;assert.equal(m.raidAllowed(a,b).allowed,false);
 m.state.elapsedMs=30000;a.colony.raidAway=0;a.colony.raidReturnMs=0;
 assert.equal(m.raidAllowed(a,b).allowed,false);
 m.state.elapsedMs=60000;assert.equal(m.raidAllowed(a,b).allowed,true);
 b.phase='spectating';assert.equal(m.raidAllowed(a,b).allowed,false);
});

test('NPC colonies can still defend raids after their questions end, while real finishers remain protected',()=>{
 const {m,a,b}=room();a.colony.soldiers=3;b.colony.food=20;b.phase='spectating';
 assert.equal(m.raidAllowed(a,b).allowed,false);
 b.npc=true;assert.equal(m.raidAllowed(a,b).allowed,true);
 m.answer(a.id,0,0,100);m.upgrade(a.id,0,'raid',b.id,101);
 assert.equal(m.state.events.at(-1).kind,'raid');
 assert.ok(a.colony.raidAway>0);
 assert.match(m.raidAllowed(a,b).reason,/returning:.*s left/);
 a.colony.raidAway=0;a.colony.raidReturnMs=0;
 assert.match(m.raidAllowed(a,b).reason,/recovering:.*s left/);
 m.state.elapsedMs=61000;assert.equal(m.raidAllowed(a,b).allowed,true);
});
