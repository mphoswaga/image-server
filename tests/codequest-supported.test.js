const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../codequest-engine'),C=require('../public/codequest-core'),R=require('../codequest-report');
const students=[{id:'a',name:'A'},{id:'b',name:'B'}];
const setup=(options={})=>E.create({students,preview:true,staged:false,seconds:60,rounds:5,grade:'Grade 2B1',challengeMode:'auto',...options},0);
test('Grade 2 defaults to normal duels; Grade 3 retains all challenges; teacher can override',()=>{
 for(const grade of ['Grade 2','Grade 2B1','2B3','Year 2'])assert.equal(setup({grade}).challengeMode,'off');
 const higher=setup({grade:'Grade 3'});assert.equal(higher.challengeMode,'full');higher.round=3;E.start(higher,1000);assert.equal(higher.challenge.kind,'simplify');
 assert.equal(setup({challengeMode:'full'}).challengeMode,'full');assert.throws(()=>setup({challengeMode:'invalid'}),/challenge/);
});
test('normal Grade 2 duels keep working routes open without a forced Repeat budget',()=>{
 const s=setup();for(let round=1;round<=5;round++){E.start(s,round*1000);const m=E.view(s,'a',false).mission;assert.equal(s.challenge,null);assert.equal(m.blockLimit,undefined);assert.equal(m.repeatRequired,false);assert.ok(C.run(m,C.solve(m)).success);}
});
test('supported mode has one simple challenge near the end, with extra time and no hard limit',()=>{
 const s=setup({challengeMode:'supported'});const found=[];
 for(let round=1;round<=5;round++){E.start(s,round*1000);if(!s.challenge)continue;found.push(round);assert.equal(s.challenge.supported,true);assert.equal(s.roundSeconds,120);assert.equal(s.deadline-s.buildAt,120000);assert.deepEqual(s.challenge.reference.slice(0,3),[{op:'move'},{op:'move'},{op:'move'}]);assert.equal(E.view(s,'a',false).mission.blockLimit,undefined);}
 assert.deepEqual(found,[4]);
 const short=setup({challengeMode:'supported',rounds:2});E.start(short,0);assert.equal(short.challenge,null);
});
test('longer working code can be submitted; shorter Repeat solutions earn a bonus in the saved report',()=>{
 for(const shortened of [false,true]){const s=setup({challengeMode:'supported'});s.round=3;E.start(s,1000);const program=shortened?C.compact(s.challenge.reference):s.challenge.reference;
 for(const id of ['a','b'])E.action(s,id,{action:'ready',round:4,revision:0,program},2000);
 assert.equal(s.phase,'replay');assert.equal(s.players.a.result.success,true);assert.equal(s.players.a.result.bonusSimplified,shortened);assert.equal(R.build(s).learners[0].voyages[0].result.success,true);assert.equal(R.build(s).learners[0].voyages[0].mission.blockLimit,undefined);}
});
test('extra supported time is reflected accurately in report elapsed time and survives a restart',()=>{
 const s=setup({challengeMode:'supported',seconds:180});s.round=3;E.start(s,1000);assert.equal(s.roundSeconds,210);const copy=JSON.parse(JSON.stringify(s));E.action(copy,'a',{action:'ready',round:4,revision:0,program:copy.challenge.reference},201000);E.tick(copy,copy.deadline);assert.equal(R.build(copy).learners.find(p=>p.id==='a').voyages[0].elapsed,200);
});
