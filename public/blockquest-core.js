(function(root,factory){if(typeof module==='object')module.exports=factory();else root.BlockQuest=factory();})(typeof window==='object'?window:globalThis,()=>{
 const ANSWER_MS=20000,BUILD_MS=15000,W=8,H=10,shapes={I:[[0,0],[1,0],[2,0],[3,0]],O:[[0,0],[1,0],[0,1],[1,1]],T:[[0,0],[1,0],[2,0],[1,1]],L:[[0,0],[0,1],[0,2],[1,2]],J:[[1,0],[1,1],[1,2],[0,2]],S:[[1,0],[2,0],[0,1],[1,1]],Z:[[0,0],[1,0],[1,1],[2,1]]};
 const empty=()=>Array.from({length:H},()=>Array(W).fill(null));
 function starter(){const board=empty();board[H-1]=['B','B',null,null,null,null,'B','B'];return board;}
 function cells(key,rotation=0){let c=shapes[key]?.map(p=>p.slice());if(!c)throw Error('Choose a block.');for(let i=0;i<((rotation%4)+4)%4;i++){c=c.map(([x,y])=>[-y,x]);const minX=Math.min(...c.map(p=>p[0])),minY=Math.min(...c.map(p=>p[1]));c=c.map(([x,y])=>[x-minX,y-minY]);}return c;}
 function fits(board,shape,x,y){return shape.every(([dx,dy])=>x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H&&!board[y+dy][x+dx]);}
 function landing(board,key,rotation,x,startY=0){if(!Number.isInteger(x)||!Number.isInteger(startY)||startY<0)return null;const shape=cells(key,rotation);if(!fits(board,shape,x,startY))return null;let y=startY;while(fits(board,shape,x,y+1))y++;return {x,y,cells:shape.map(([dx,dy])=>[x+dx,y+dy])};}
 function hasRoom(board,choices){return choices.some(key=>[0,1,2,3].some(r=>Array.from({length:W},(_,x)=>landing(board,key,r,x)).some(Boolean)));}
 function place(board,key,rotation,x,startY=0){const ghost=landing(board,key,rotation,x,startY);if(!ghost)throw Error('That block does not fit here.');const next=board.map(row=>row.slice());for(const [x,y]of ghost.cells)next[y][x]=key;const cleared=next.flatMap((row,i)=>row.every(Boolean)?[i]:[]);const kept=next.filter((_,i)=>!cleared.includes(i));while(kept.length<H)kept.unshift(Array(W).fill(null));return {board:kept,cleared,points:10+cleared.length*250+comboBonus(cleared.length),bonus:comboBonus(cleared.length)};}
 function choices(random=Math.random){const keys=Object.keys(shapes);for(let i=keys.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[keys[i],keys[j]]=[keys[j],keys[i]];}return keys.slice(0,3);}
 // Equal turn numbers use the same offer, even when a team misses its answer.
 function offer(state,random=Math.random){
  if(state.mechanics===2&&!(state.teams[state.active||0].builds||0))return ['I','O','T'];
  if(state.mode!=='board')return choices(random);
  state.pieceRounds ||= {};
  const round=Math.floor(state.turn/state.teams.length);
  if(!state.pieceRounds[round])state.pieceRounds[round]=choices(random);
  return state.pieceRounds[round].slice();
 }
 function comboBonus(rows){return rows>1?150*rows*(rows-1)/2:0;}
 function sceneTiming(rows){return {duration:rows?3400:1000,settled:rows?2200:1000,mission:2250};}
 function mission(lines){const stage=Math.min(3,Math.max(0,Math.floor(Number(lines)||0)));return {stage,goal:3,complete:stage===3,label:['Launch pad ready','Boosters built','Rocket cabin built','Ready for launch!'][stage]};}
 function rescue(board){return [...Array.from({length:3},()=>Array(W).fill(null)),...board.slice(0,H-3).map(r=>r.slice())];}
 return {ANSWER_MS,BUILD_MS,fits,offer,comboBonus,sceneTiming,mission,W,H,empty,starter,cells,landing,hasRoom,place,choices,rescue};
});
