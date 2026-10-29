const test=require('node:test'),assert=require('node:assert/strict'),core=require('../public/blockquest-core');
test('all rotations retain four distinct squares and land within board bounds',()=>{
 for(const key of ['I','O','T','L','J','S','Z'])for(let rotation=0;rotation<4;rotation++){
  const cells=core.cells(key,rotation);assert.equal(new Set(cells.map(p=>p.join(','))).size,4);
  for(let x=0;x<8;x++){const ghost=core.landing(core.empty(),key,rotation,x);if(ghost)assert.ok(ghost.cells.every(([x,y])=>x>=0&&x<8&&y>=0&&y<10));}
 }
 assert.equal(core.landing(core.empty(),'I',0,7),null);
});
test('placement clears completed rows with gravity and never changes original board',()=>{
 const board=core.empty();board[9]=['S','S','S','S',null,null,null,null];
 const result=core.place(board,'I',0,4);assert.deepEqual(result.cleared,[9]);assert.equal(result.points,110);assert.ok(result.board.every(r=>r.every(c=>c===null)));assert.equal(board[9][4],null);
});
test('rescue restores space without deleting the entire tower or inventing points',()=>{
 const board=Array.from({length:10},()=>Array(8).fill('O'));assert.equal(core.hasRoom(board,['O','I','T']),false);
 const rescued=core.rescue(board);assert.equal(rescued.length,10);assert.ok(rescued.slice(0,3).every(r=>r.every(c=>!c)));assert.ok(rescued[3].every(Boolean));assert.ok(core.hasRoom(rescued,['O']));
 assert.throws(()=>core.place(board,'O',0,0));assert.equal(core.choices(()=>.5).length,3);assert.equal(new Set(core.choices(()=>.5)).size,3);
});

test('matching team turns share distinct offers and persist through reload without revealing a new draw',()=>{
 const s={mode:'board',turn:0,teams:[{},{}]};let calls=0;
 const first=core.offer(s,()=>{calls++;return .1;});assert.equal(new Set(first).size,3);assert.equal(calls,6);
 const restored=JSON.parse(JSON.stringify(s));restored.turn=1;
 assert.deepEqual(core.offer(restored,()=>{throw Error('must not redraw');}),first);
 first[0]='fake';assert.notEqual(s.pieceRounds[0][0],'fake');
 restored.turn=2;core.offer(restored,()=>.9);restored.turn=3;
 assert.deepEqual(core.offer(restored,()=>{throw Error('must not redraw');}),restored.pieceRounds[1]);
 const missed={mode:'board',turn:1,teams:[{},{}]};const later=core.offer(missed,()=>.5);
 assert.equal(new Set(later).size,3);assert.ok(missed.pieceRounds[0]);
});
test('two rows award the server-calculated combo and preserve settling blocks',()=>{
 const board=core.empty();for(const y of [8,9])board[y]=['T','T','T','T','T','T',null,null];board[7][0]='S';
 const r=core.place(board,'O',0,6);assert.deepEqual(r.cleared,[8,9]);assert.equal(r.bonus,50);assert.equal(r.points,260);assert.equal(r.board[9][0],'S');assert.equal(board[7][0],'S');
 assert.equal(core.comboBonus(0),0);assert.equal(core.comboBonus(1),0);assert.equal(core.comboBonus(4),300);
});
test('rocket mission follows earned rows and the clear scene includes settling and construction',()=>{
 for(let lines=0;lines<5;lines++){const m=core.mission(lines);assert.equal(m.stage,Math.min(3,lines));assert.equal(m.complete,lines>=3);}
 const scene=core.sceneTiming(2);assert.ok(scene.settled<scene.mission);assert.ok(scene.mission+900<=scene.duration);assert.equal(core.sceneTiming(0).duration,1000);
});
