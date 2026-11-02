/* Shared deterministic pirate interpreter. No evaluation of learner code. */
(function(root,factory){if(typeof module==='object')module.exports=factory();else root.CodeQuest=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const missions=[
 {title:'First treasure',hint:'Your pirate starts facing right (→). Reach the chest, collect it, then return to the ship.',size:6,start:[0,4,1],chest:[3,4],rocks:[[2,2],[3,2],[4,2]],water:[[0,0],[1,0],[5,0],[5,1]],blocks:['move','left','right','collect','repeat']},
 {title:'Around the reef',hint:'The reef blocks the direct route. Find a safe path to the chest and home.',size:6,start:[0,4,1],chest:[4,3],rocks:[[2,4],[2,3],[2,2]],water:[[0,0],[1,0],[5,0],[5,1]],blocks:['move','left','right','collect','repeat']},
 {title:'Hidden lagoon',hint:'Cross the island without stepping into the lagoon. Bring the treasure home.',size:6,start:[0,5,0],chest:[4,1],rocks:[[2,1],[2,2],[2,3],[4,4]],water:[[0,0],[1,0],[3,3],[4,3]],blocks:['move','left','right','collect','repeat']},
 {title:'Smuggler’s bend',hint:'Plan each turn carefully. A shorter successful voyage wins the duel.',size:6,start:[0,5,1],chest:[5,1],rocks:[[1,4],[2,4],[3,2],[3,1]],water:[[0,0],[1,0],[4,4]],blocks:['move','left','right','collect','repeat']},
 {title:'Captain’s challenge',hint:'Use repeat blocks to keep your program tidy. Return the chest to your ship.',size:6,start:[0,5,0],chest:[5,0],rocks:[[1,3],[2,3],[3,3],[4,1]],water:[[0,0],[1,0],[4,4],[5,4]],blocks:['move','left','right','collect','repeat']}
 ];
 const at=(a,x,y)=>a.some(p=>p[0]===x&&p[1]===y);
 function normalize(program){if(!Array.isArray(program)||program.length>32)throw Error('Use up to 32 blocks.');let count=0;
  const walk=(list,depth)=>list.map(b=>{if(!b||!['move','left','right','collect','repeat'].includes(b.op))throw Error('Choose a coding block.');if(++count>40)throw Error('Too many blocks.');if(b.op!=='repeat')return {op:b.op};if(depth||!Array.isArray(b.body)||!b.body.length||b.body.length>8||!Number.isInteger(b.count)||b.count<2||b.count>5)throw Error('Repeat 2–5 times with 1–8 simple blocks inside.');return {op:'repeat',count:b.count,body:walk(b.body,depth+1)};});
  return walk(program,0);
 }
 function expand(program){const out=[];normalize(program).forEach((b,i)=>{if(b.op==='repeat')for(let n=0;n<b.count;n++)b.body.forEach(c=>out.push({op:c.op,block:i}));else out.push({op:b.op,block:i});});if(out.length>64)throw Error('Your program can run up to 64 actions.');return out;}
 // Count authored blocks, including the Repeat container and each child once.
 function blockCount(program){return normalize(program).reduce((n,b)=>n+1+(b.op==='repeat'?b.body.length:0),0);}
 function checkBudget(m,program){const count=blockCount(program);if(m.blockLimit!==undefined){if(!Number.isInteger(m.blockLimit)||m.blockLimit<1||m.blockLimit>40)throw Error('Invalid island block limit.');if(count>m.blockLimit)throw Error('Use up to '+m.blockLimit+' blocks on this island. Use Repeat to shorten your code.');}return count;}
 // Single-action loops match the controls available to young learners.
 function compact(program){const plain=expand(program).map(b=>({op:b.op})),out=[];for(let i=0;i<plain.length;){let end=i+1;while(end<plain.length&&plain[end].op===plain[i].op)end++;let remaining=end-i;while(remaining){const count=Math.min(5,remaining);if(count>=3&&plain[i].op!=='collect')out.push({op:'repeat',count,body:[{op:plain[i].op}]});else for(let j=0;j<count;j++)out.push({op:plain[i].op});remaining-=count;}i=end;}return out;}
 function run(m,program){checkBudget(m,program);const ops=expand(program);let [x,y,d]=m.start,carrying=false,reason=m.requireReturn===false?'Reach the treasure and use Collect.':'Return the treasure to your ship.',success=false;const frames=[{x,y,d,carrying,block:-1,event:'start'}];
  for(const step of ops){let event=step.op;if(step.op==='left')d=(d+3)%4;else if(step.op==='right')d=(d+1)%4;else if(step.op==='collect'){if(at([m.chest],x,y)&&!carrying)carrying=true;else{reason='Collect only when you are standing on the chest.';event='miss';}}
   else {const [dx,dy]=[[0,-1],[1,0],[0,1],[-1,0]][d],nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=m.size||ny>=m.size||at(m.rocks,nx,ny)||at(m.water,nx,ny)){reason='Your pirate met an obstacle. Change the route and try again.';frames.push({x,y,d,carrying,block:step.block,event:'blocked'});break;}x=nx;y=ny;}
   frames.push({x,y,d,carrying,block:step.block,event});if(carrying&&(m.requireReturn===false||x===m.start[0]&&y===m.start[1])){success=true;reason=m.requireReturn===false?'Treasure collected!':'Treasure safely aboard!';break;}
  }
  return {success,carrying,steps:frames.length-1,reason,frames};
 }
 function compare(a,b){if(a.success!==b.success)return a.success?1:-1;if(a.success&&a.steps!==b.steps)return a.steps<b.steps?1:-1;return 0;}
 // Shortest-action route for map validation and labelled computer pirates.
 function solve(m){const q=[{x:m.start[0],y:m.start[1],d:m.start[2],c:false,p:[]}],seen=new Set();for(let i=0;i<q.length;i++){const n=q[i],key=[n.x,n.y,n.d,n.c].join();if(seen.has(key))continue;seen.add(key);if(n.c&&(m.requireReturn===false||n.x===m.start[0]&&n.y===m.start[1]))return m.blockLimit===undefined?n.p:compact(n.p);
  for(const op of ['move','left','right','collect']){const v={...n,p:[...n.p,{op}]};if(op==='left')v.d=(v.d+3)%4;else if(op==='right')v.d=(v.d+1)%4;else if(op==='collect'){if(n.c||!at([m.chest],n.x,n.y))continue;v.c=true;}else{const z=[[0,-1],[1,0],[0,1],[-1,0]][n.d];v.x+=z[0];v.y+=z[1];if(v.x<0||v.y<0||v.x>=m.size||v.y>=m.size||at(m.rocks,v.x,v.y)||at(m.water,v.x,v.y))continue;}q.push(v);}}
 return [];}
 return {missions,normalize,expand,run,compare,solve,at,blockCount,checkBudget,compact};
});
