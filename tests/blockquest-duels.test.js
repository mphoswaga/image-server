const test=require('node:test'),assert=require('node:assert/strict'),duels=require('../blockquest-duels');
const game={id:'g',questions:[{question:'Pictures?',options:['Screen','Mouse'],correctIndex:0},{question:'Type?',options:['Keyboard','Speaker'],correctIndex:0}]};
function setup(count=4,extra={}){const students=Array.from({length:count},(_,i)=>({id:'s'+i,name:'Learner '+i}));return duels.create(game,{students,teams:[{name:'Blue',members:students.filter((_,i)=>i%2===0).map(p=>p.id)},{name:'Pink',members:students.filter((_,i)=>i%2).map(p=>p.id)}],minutes:3,rounds:2,rosterId:'r',...extra},1000);}
function start(s){for(const p of Object.values(s.players))p.joined=true;duels.pairRound(s,1000);duels.tick(s,7000);}
test('pairs opposite teams, preserves fair offers, rotates opponents and supports three or five minutes',()=>{
 const s=setup();start(s);assert.equal(s.phase,'running');assert.equal(s.roundEndsAt,187000);const previous=s.matchups.map(m=>[m.a,m.b].sort().join('|'));
 for(const m of s.matchups){const a=s.players[m.a],b=s.players[m.b];assert.notEqual(a.team,b.team);assert.deepEqual(a.run.questions,b.run.questions);assert.equal(a.run.deadline-7000,20000);for(const p of [a,b])duels.action(s,p.id,{action:'answer',run:p.run.id,revision:p.run.revision,choice:0},8000);assert.deepEqual(a.run.choices,b.run.choices);}
 duels.tick(s,187000);assert.equal(s.phase,'matchup');assert.equal(s.roundNumber,2);assert.ok(s.matchups.every(m=>!previous.includes([m.a,m.b].sort().join('|'))));assert.equal(s.resultsUntil,191000);duels.tick(s,197000);duels.tick(s,377000);assert.equal(s.phase,'ended');assert.equal(s.lastRound.length,2);
 const five=setup(2,{minutes:5});start(five);assert.equal(five.roundEndsAt-7000,300000);assert.throws(()=>setup(2,{minutes:4}));
});
test('learners progress independently; replayed or invalid moves cannot award points',()=>{
 const s=setup();start(s);const p=s.players.s0,other=s.players.s1,r=p.run,revision=r.revision;
 duels.action(s,p.id,{action:'answer',run:r.id,revision,choice:0},8000);assert.equal(r.phase,'choose');assert.equal(other.run.phase,'answer');assert.equal(r.teams[0].points,100);
 assert.throws(()=>duels.action(s,p.id,{action:'answer',run:r.id,revision,choice:0},8000));assert.throws(()=>duels.action(s,p.id,{action:'move',run:r.id,revision:r.revision,shape:'FAKE'},8000));
 duels.action(s,p.id,{action:'place',run:r.id,revision:r.revision},8100);assert.equal(r.teams[0].points,110);duels.tick(s,9200);assert.equal(r.phase,'answer');assert.equal(r.answers.length,1);assert.equal(other.run.answers.length,0);
 const view=duels.view(s,p.id);assert.equal(view.run.questions,undefined);assert.equal(view.run.pieceRounds,undefined);assert.equal(view.run.question.correctIndex,undefined);assert.equal(view.players,undefined);assert.equal(view.opponent.answers,undefined);
});
test('pause freezes duel and answer clocks, odd classes keep playing and late learners join next round',()=>{
 const s=setup(5);for(const p of Object.values(s.players))p.joined=p.id!=='s4';duels.pairRound(s,1000);duels.tick(s,7000);s.players.s4.joined=true;assert.equal(s.players.s4.run,null);
 duels.pause(s,8000);assert.equal(s.phase,'paused');duels.tick(s,50000);assert.equal(s.players.s0.run.answers.length,0);duels.pause(s,18000);assert.equal(s.roundEndsAt,197000);assert.equal(s.players.s0.run.deadline,37000);
 duels.tick(s,197000);assert.equal(s.matchups.length,3);assert.ok(s.matchups.some(m=>m.b.startsWith('computer-')));duels.tick(s,207000);assert.ok(s.players.s4.run);duels.tick(s,212000);assert.ok(s.computer.run.answers.length>0);
});
test('question banks repeat for practice while round totals and top ten stay bounded',()=>{
 const s=setup(12);start(s);const p=s.players.s0;
 for(let i=0;i<3;i++){const r=p.run;duels.action(s,p.id,{action:'answer',run:r.id,revision:r.revision,choice:1},8000+i*3000);duels.tick(s,10500+i*3000);}
 assert.equal(p.run.answers.length,3);assert.equal(p.run.phase,'answer');assert.equal(duels.view(s,p.id).top10.length,10);duels.finishRound(s,20000,true);assert.equal(s.phase,'ended');assert.equal(p.answers.length,3);assert.equal(p.run,null);
});

test('completed duel results remain visible before the next opponent starts, including across pause',()=>{
 const s=setup(2);start(s);const p=s.players.s0;duels.action(s,p.id,{action:'answer',run:p.run.id,revision:p.run.revision,choice:0},8000);duels.tick(s,s.roundEndsAt);
 assert.equal(s.lastRound[0].winnerId,p.id);assert.equal(s.resultsUntil,191000);assert.equal(s.transitionAt,197000);assert.equal(duels.view(s,p.id,false,187100).resultsUntil,191000);
 duels.pause(s,188000);duels.pause(s,198000);assert.equal(s.resultsUntil,201000);assert.equal(s.transitionAt,207000);duels.tick(s,206999);assert.equal(s.phase,'matchup');duels.tick(s,207000);assert.equal(s.phase,'running');
});
