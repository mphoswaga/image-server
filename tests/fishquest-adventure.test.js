const test=require('node:test'),assert=require('node:assert/strict');
const Board=require('../public/fishquest-board-state'),Story=require('../public/fishquest-board-story');
const students=Array.from({length:12},(_,i)=>({name:'Learner '+i,studentId:String(i),team:i%2})),questions=[{question:'Where?',options:['Ocean','Sky'],correctIndex:0}];
function complete(s,correct=true){let steps=0;while(s.phase!=='ended'&&steps++<200){
 if(s.phase==='question')Board.answer(s,correct?0:1);
 else if(s.phase==='reveal')Board.next(s);
 else if(s.phase==='supply_choice')Board.supply(s,'energy');
 else if(s.phase==='event_choice')Board.choose(s,Story.choices(s).find(o=>o.enabled).id);
 else Board.advance(s);
 }assert.equal(s.phase,'ended');return s}
test('marine adventure spreads four encounters across equal learner turns and preserves every fish',()=>{
 const s=Board.create(students,questions,2,1,true);assert.equal(s.rounds,12);assert.equal(s.story.version,2);
 assert.deepEqual(s.story.milestones.map(m=>m.at),[3,6,9,12]);complete(s);
 assert.deepEqual(s.story.completed,['current','shark','rescue','net']);assert.equal(s.story.history.length,8);assert.equal(s.answers.length,12);assert.equal(s.players.length,12);
 assert.ok(s.players.every(p=>p.food===2));assert.ok(s.story.guardians.every(Boolean));
 assert.ok(s.food.every(f=>f>=0));assert.ok(s.story.energy.every(e=>e>=0&&e<=12));assert.equal(Story.awards(s).length,2);
});
test('even a tiny school or every incorrect answer still reaches all encounters safely',()=>{
 const s=Board.create(students.slice(0,1),questions,2,1,true);complete(s,false);
 assert.deepEqual(s.story.completed,['current','shark','rescue','net']);assert.equal(s.answers.length,1);assert.equal(s.story.history.length,4);
 assert.ok(s.story.history.every(h=>h.safe));assert.equal(s.players.length,1);
});
test('supplies are earned once, persist across refresh, and a scout unlocks the next safe passage',()=>{
 const s=Board.create(students,questions,2,1,true);Board.advance(s);
 s.answers=[0,2].map(player=>({player,correct:true}));s.turn=4;Board.answer(s,0);Board.next(s);assert.equal(s.phase,'supply_choice');
 const restored=JSON.parse(JSON.stringify(s));assert.equal(Board.supply(restored,'invalid'),false);restored.paused=true;assert.equal(Board.supply(restored,'scout'),false);restored.paused=false;
 assert.equal(Board.supply(restored,'scout'),true);assert.equal(Board.supply(restored,'feed'),false);assert.equal(restored.story.scouts[0],true);
 Board.advance(restored);assert.equal(restored.phase,'event_choice');
 const before=restored.food[0];assert.equal(Board.choose(restored,'scouted'),true);assert.equal(Board.choose(restored,'scouted'),false);assert.equal(restored.food[0],before);assert.equal(restored.story.scouts[0],false);
 const final=JSON.parse(JSON.stringify(restored));Board.advance(final);assert.equal(final.story.history.length,1);
});
test('energy and food costs are explicit, unaffordable choices cannot be submitted, and rewards cap energy',()=>{
 const s=Board.create(students,questions,2,1,true);s.turn=3;Story.afterTurn(s);Board.advance(s);s.story.energy[0]=0;s.food[0]=0;
 assert.equal(Board.choose(s,'ride'),false);assert.equal(s.phase,'event_choice');assert.equal(Board.choose(s,'rocks'),true);assert.equal(s.story.energy[0],1);
 s.phase='supply_choice';s.turn=0;s.story.energy[0]=11;assert.equal(Board.supply(s,'energy'),true);assert.equal(s.story.energy[0],12);
});
