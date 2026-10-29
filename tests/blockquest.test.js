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
