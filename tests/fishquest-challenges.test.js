const {test}=require('node:test'),assert=require('node:assert/strict');
const {FishMatch}=require('../fishquest');
function setup(mass=800){let now=100000;const m=new FishMatch({id:'whales',fishquest:{durationMinutes:10},questions:[{question:'Choose yes',options:['Yes','No'],correctIndex:0}]},{now:()=>now});const a=m.join({studentId:'a',name:'A'}),b=m.join({studentId:'b',name:'B'});m.start();now+=6000;m.state.food=[];Object.assign(a,{x:500,y:500,mass});Object.assign(b,{x:550,y:500,mass});return {m,a,b,advance:n=>now+=n};}
test('whales answer independently, keep their size, and cannot farm duplicate rewards',()=>{
 const {m,a,b,advance}=setup();m.tick();const qa=m.snapshot(a.id).question,qb=m.snapshot(b.id).question;
 assert.equal(qa.kind,'whale');assert.equal(qa.id,qb.id);assert.deepEqual(qa.options,qb.options);assert.equal(qb.canAnswer,true);
 m.answer(a.id,{interactionId:qa.id,choice:0});assert.equal(a.score,75);assert.equal(a.lock,null);assert.equal(b.lock,qa.id);assert.equal(a.mass,800);assert.equal(m.snapshot(a.id).event.outcome,'correct');
 m.answer(a.id,{interactionId:qa.id,choice:0});assert.equal(a.score,75);
 m.answer(b.id,{interactionId:qa.id,choice:0});assert.equal(b.score,75);assert.equal(b.mass,800);assert.equal(b.attempts.length,1);
 m.tick();assert.equal(m.state.interactions.length,1);advance(15001);m.tick();assert.equal(m.state.interactions.length,2);
});
test('incorrect, timeouts and pause use each learner own result',()=>{
 const {m,a,b,advance}=setup();m.tick();const q=m.snapshot(a.id).question;
 m.answer(a.id,{interactionId:q.id,choice:1});assert.equal(a.score,0);
 m.pause();advance(60000);m.tick();assert.equal(b.attempts.length,0);m.resume();advance(30001);m.tick();
 assert.equal(a.attempts.length,1);assert.equal(b.attempts[0].outcome,'timeout');assert.equal(b.score,0);
});
test('pearl questions reach small fish and preserve grades on ending',()=>{
 const {m,a,b,advance}=setup(100);b.x=1600;advance(45000);m.tick();const q=m.snapshot(a.id).question;
 assert.equal(q.kind,'pearl');assert.equal(q.canAnswer,true);assert.equal(q.correctIndex,undefined);
 m.answer(a.id,{interactionId:q.id,choice:0});assert.equal(a.score,35);assert.equal(a.mass,120);
 m.end();assert.equal(a.attempts.length,1);assert.equal(b.attempts[0].outcome,'cancelled');assert.equal(m.education(b).answered,0);
});
test('disconnect cancels only unanswered challenge results',()=>{
 const {m,a,b}=setup();m.tick();const q=m.snapshot(a.id).question;m.answer(a.id,{interactionId:q.id,choice:0});m.disconnect(b.id);
 assert.equal(a.score,75);assert.equal(a.attempts.length,1);assert.equal(b.lock,null);assert.equal(b.attempts[0].outcome,'cancelled');
});
test('whales remain whales when hunger reduces size',()=>{const {m,a,advance}=setup();m.state.players[1].x=1600;a.hungryMs=150000;advance(100);m.tick();assert.equal(a.mass,800);});
test('a full class of 25 whales continues answering, including the unpaired learner',()=>{
 let now=1e6;
 const m=new FishMatch({id:'class',fishquest:{durationMinutes:10},questions:[{question:'Yes?',options:['Yes','No'],correctIndex:0}]},{now:()=>now});
 for(let i=0;i<25;i++)m.join({studentId:String(i),name:'Learner '+i});m.start();m.state.food=[];
 for(const [i,p] of m.state.players.entries())Object.assign(p,{mass:800,x:500+(i%5)*50,y:500+Math.floor(i/5)*50,protectedUntil:0});
 for(let frame=0;frame<1200;frame++){
  now+=50;m.tick();
  for(const p of m.state.players){if(p.lock){const q=m.snapshot(p.id).question;m.answer(p.id,{interactionId:q.id,choice:0});}}
 }
 assert.ok(m.state.players.every(p=>p.mass>=800&&p.attempts.length>0&&p.score>0));
 assert.ok(m.state.players.some(p=>p.attempts.some(a=>a.trigger==='pearl')));
 for(const p of m.state.players)assert.equal(p.attempts.length,new Set(p.attempts.map(a=>a.interactionId)).size);
});
