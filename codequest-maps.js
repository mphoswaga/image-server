// Server-only island generation. Every accepted layout is replayed through the
// same interpreter used by learners; solutions are never included in the map.
const crypto=require('node:crypto'),C=require('./public/codequest-core');
const rules=[
 {moves:[2,3],turns:[0,1],bends:[0,0],steps:[7,11],obstacles:[3,4],rocks:2},
 {moves:[3,4],turns:[1,2],bends:[1,1],steps:[11,13],obstacles:[5,6],rocks:4},
 {moves:[4,5],turns:[1,3],bends:[1,2],steps:[15,17],obstacles:[7,8],rocks:6},
 {moves:[5,7],turns:[2,4],bends:[2,3],steps:[19,23],obstacles:[9,10],rocks:8},
 {moves:[7,9],turns:[2,5],bends:[2,4],steps:[25,31],obstacles:[11,12],rocks:10}
];
const titles=['First treasure','Around the reef','Hidden lagoon','Smuggler’s bend','Captain’s challenge'];
const dirs=[[0,-1],[1,0],[0,1],[-1,0]],key=p=>p.slice(0,2).join(','),inside=p=>p.every(v=>Number.isInteger(v)&&v>=0&&v<6),range=(n,r)=>n>=r[0]&&n<=r[1];
function random(seed){let x=crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0);return ()=>{x+=0x6d2b79f5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const pick=(r,a)=>a[Math.floor(r()*a.length)];
function shuffled(r,a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function fingerprint(m){return crypto.createHash('sha256').update(JSON.stringify({size:m.size,start:m.start,chest:m.chest,rocks:[...m.rocks].map(key).sort(),water:[...m.water].map(key).sort()})).digest('hex').slice(0,24);}
function connected(cells){if(!cells.length)return true;const set=new Set(cells.map(key)),seen=new Set([key(cells[0])]),queue=[cells[0]];for(let i=0;i<queue.length;i++)for(const [dx,dy]of dirs){const p=[queue[i][0]+dx,queue[i][1]+dy],k=key(p);if(set.has(k)&&!seen.has(k)){seen.add(k);queue.push(p);}}return seen.size===set.size;}
function validate(m,level=1){
 const errors=[],r=rules[level-1];if(!r)return {ok:false,errors:['Unknown difficulty.']};
 if(!m||m.size!==6||!Array.isArray(m.start)||m.start.length!==3||!inside(m.start.slice(0,2))||!Number.isInteger(m.start[2])||m.start[2]<0||m.start[2]>3||!Array.isArray(m.chest)||m.chest.length!==2||!inside(m.chest)||!Array.isArray(m.rocks)||!Array.isArray(m.water))return {ok:false,errors:['Invalid map shape.']};
 const obstacles=[...m.rocks,...m.water];if(obstacles.some(p=>!Array.isArray(p)||p.length!==2||!inside(p)))return {ok:false,errors:['Obstacle outside the island.']};
 const blocked=new Set(obstacles.map(key));if(blocked.size!==obstacles.length)errors.push('Obstacles overlap.');if(key(m.start)===key(m.chest)||blocked.has(key(m.start))||blocked.has(key(m.chest)))errors.push('Ship or treasure overlaps.');if(!range(obstacles.length,r.obstacles))errors.push('Too much or too little clutter.');
 const land=[];for(let y=0;y<6;y++)for(let x=0;x<6;x++)if(!blocked.has(key([x,y])))land.push([x,y]);if(!connected(land))errors.push('Unreachable pockets of land.');if(m.rocks.length<r.rocks)errors.push('Not enough rocks for this difficulty.');if(!connected(m.water))errors.push('Water should form one readable patch.');
 if(errors.length)return {ok:false,errors};
 if(m.requireReturn!==undefined&&typeof m.requireReturn!=='boolean')return {ok:false,errors:['Invalid treasure goal.']};
 const unrestricted={...m};delete unrestricted.blockLimit;delete unrestricted.repeatRequired;const returnMap={...unrestricted,requireReturn:true},solution=C.solve(returnMap);let result;try{result=C.run(returnMap,solution);}catch{errors.push('Solution exceeds the coding limits.');}
 if(!result?.success||!solution.length){errors.push('No safe treasure-and-return solution.');return {ok:false,errors};}
 const arrival=result.frames.findIndex(f=>f.x===m.chest[0]&&f.y===m.chest[1]);
 const outward=result.frames.slice(1,arrival+1);
 const moves=outward.filter(f=>f.event==='move'),turns=outward.filter(f=>['left','right'].includes(f.event)).length;
 let bends=0,longest=0,run=0,previous;for(const f of outward){if(f.event==='move'){if(previous!==undefined&&previous!==f.d)bends++;previous=f.d;run++;longest=Math.max(longest,run);}else run=0;}
 if(!range(moves.length,r.moves)||!range(turns,r.turns)||!range(bends,r.bends)||!range(result.steps,r.steps))errors.push('Route is outside this difficulty.');
 if(level>=3&&longest<2)errors.push('No useful repeat opportunity.');
 const nearby=obstacles.filter(p=>result.frames.some(f=>Math.abs(p[0]-f.x)+Math.abs(p[1]-f.y)===1)).length;if(level>=2&&nearby<2)errors.push('Obstacles do not create meaningful route choices.');
 const expected=level<3?['move','left','right','collect']:['move','left','right','collect','repeat'];if(!Array.isArray(m.blocks)||expected.some(op=>!m.blocks.includes(op))||m.blocks.some(op=>!expected.includes(op)))errors.push('Wrong blocks for this difficulty.');
 let goalSolution=m.requireReturn===false?C.solve(unrestricted):solution;const goalResult=C.run(unrestricted,goalSolution);if(!goalResult.success)errors.push('Selected goal cannot be completed.');let blockLimit;if(m.generatorVersion>=3&&level>=3){const compressed=C.compact(goalSolution),cost=C.blockCount(compressed);if(cost>=goalSolution.length)errors.push('This Repeat stage needs a route with useful compression.');else{blockLimit=Math.min(goalSolution.length-1,cost+1);goalSolution=compressed;if(m.blockLimit!==undefined&&m.blockLimit!==blockLimit)errors.push('Incorrect block allowance.');if(m.repeatRequired===false)errors.push('This stage requires Repeat.');}}else if(m.blockLimit!==undefined||m.repeatRequired)errors.push('Early stages must retain their normal allowance.');
 return {ok:!errors.length,errors,solution:goalSolution,blockLimit,metrics:{moves:moves.length,turns,bends,steps:result.steps,goalSteps:goalResult.steps,longestStraight:longest,obstacles:obstacles.length,nearby}};
}
function base(level,start,chest,rocks,water){return {title:titles[level-1],hint:'Collect the treasure and bring it back to the ship. Follow your pirate’s direction arrow.',size:6,start,chest,rocks,water,blocks:level<3?['move','left','right','collect']:['move','left','right','collect','repeat'],difficulty:level,generatorVersion:3};}
function candidate(level,r){
 const rule=rules[level-1],edge=[];for(let i=0;i<6;i++){edge.push([0,i],[5,i],[i,0],[i,5]);}const start=pick(r,edge),path=[start],distance=rule.moves[0]+Math.floor(r()*(rule.moves[1]-rule.moves[0]+1));
 for(let i=0;i<distance;i++){let options=dirs.map(([dx,dy],d)=>({p:[path.at(-1)[0]+dx,path.at(-1)[1]+dy],d})).filter(o=>inside(o.p)&&!path.some(p=>key(p)===key(o.p))&&!path.slice(0,-1).some(p=>Math.abs(p[0]-o.p[0])+Math.abs(p[1]-o.p[1])===1));if(!options.length)return null;if(level===1&&i){const last=[path.at(-1)[0]-path.at(-2)[0],path.at(-1)[1]-path.at(-2)[1]];options=options.filter(o=>dirs[o.d][0]===last[0]&&dirs[o.d][1]===last[1]);if(!options.length)return null;}path.push(pick(r,options).p);}
 const first=dirs.findIndex(([dx,dy])=>start[0]+dx===path[1][0]&&start[1]+dy===path[1][1]);
 const facing=(first+(level===1?pick(r,[0,0,1,3]):0))%4,protectedCells=new Set(path.map(key)),free=[];for(let y=0;y<6;y++)for(let x=0;x<6;x++)if(!protectedCells.has(key([x,y])))free.push([x,y]);
 const count=rule.obstacles[0]+Math.floor(r()*(rule.obstacles[1]-rule.obstacles[0]+1));const obstacles=shuffled(r,free).slice(0,count);
 // Select a connected subset for water, with remaining obstacles rendered as rocks.
 const water=[obstacles[0]],remaining=obstacles.slice(1),target=1;while(water.length<target){const index=remaining.findIndex(p=>water.some(w=>Math.abs(w[0]-p[0])+Math.abs(w[1]-p[1])===1));if(index<0)break;water.push(remaining.splice(index,1)[0]);}
 return base(level,[...start,facing],path.at(-1),remaining,water);
}
// Validated fallback templates are transformed, then decorated away from their
// protected solution. Independent seeds work even if primary randomness stalls.
const fallbackTemplates=[
 {start:[0,4,1],chest:[2,4],rocks:[[2,2]],water:[[5,0]]},
 {start:[0,4,1],chest:[2,3],rocks:[[0,3],[1,3],[4,2]],water:[[5,0]]},
 {start:[4,0,2],chest:[2,3],rocks:[[1,3],[2,1]],water:[[2,4]]},
 {start:[0,5,0],chest:[5,5],rocks:[[0,3],[1,5]],water:[[3,0]]},
 {start:[3,5,1],chest:[1,0],rocks:[[3,2],[0,2],[1,1],[2,1]],water:[[5,2]]}
];
function fallback(level,index){const t=fallbackTemplates[level-1],turn=index%4,flip=!!(Math.floor(index/4)%2),r=random('fallback:'+level+':'+index),rotate=p=>{let [x,y]=p;if(flip)x=5-x;for(let n=0;n<turn;n++)[x,y]=[5-y,x];return [x,y];};const direction=((flip?(4-t.start[2])%4:t.start[2])+turn)%4;
 const m=base(level,[...t.start],t.chest,t.rocks,t.water);m.blocks=level<3?['move','left','right','collect']:['move','left','right','collect','repeat'];const solution=C.solve(m),path=new Set(C.run(m,solution).frames.map(f=>key([f.x,f.y]))),blocked=new Set([...t.rocks,...t.water].map(key)),free=[];for(let y=0;y<6;y++)for(let x=0;x<6;x++)if(!path.has(key([x,y]))&&!blocked.has(key([x,y])))free.push([x,y]);
 const needed=rules[level-1].obstacles[0]-blocked.size;const extras=shuffled(r,free).slice(0,Math.max(0,needed)+Math.floor(r()*(rules[level-1].obstacles[1]-Math.max(blocked.size,rules[level-1].obstacles[0])+1)));return base(level,[...rotate(t.start),direction],rotate(t.chest),[...t.rocks,...extras].map(rotate),t.water.map(rotate));
}
function generate({level=1,seed=crypto.randomUUID(),exclude=[],attempts=160,requireReturn=true}={}){
 if(typeof requireReturn!=='boolean')throw Error('Choose a valid treasure goal.');
 if(!Number.isInteger(level)||!rules[level-1])throw Error('Choose an island difficulty from 1 to 5.');if(!Number.isInteger(attempts)||attempts<0||attempts>500)throw Error('Invalid generation limit.');
 const excluded=new Set(exclude),r=random(seed);let rejected=0;
 for(let i=0;i<attempts;i++){const map=candidate(level,r);if(!map)continue;map.requireReturn=requireReturn;const proof=validate(map,level);if(!proof.ok){rejected++;continue;}const id=fingerprint(map);if(excluded.has(id))continue;return {map:{...map,id,...(proof.blockLimit?{blockLimit:proof.blockLimit,repeatRequired:true}:{})},proof,source:'generated',rejected};}
 // Enumerate fallback variants in a seed-specific order; never accept an
 // excluded or unchecked map. Fail safely if no validated replacement remains.
 const offset=crypto.createHash('sha256').update(String(seed)).digest().readUInt16LE(0);
 for(let i=0;i<512;i++){const map={...fallback(level,offset+i),requireReturn},proof=validate(map,level);if(!proof.ok)continue;const id=fingerprint(map);if(!excluded.has(id))return {map:{...map,id,...(proof.blockLimit?{blockLimit:proof.blockLimit,repeatRequired:true}:{})},proof,source:'fallback',rejected};}
 throw Error('A fresh safe island could not be prepared. Please try starting the round again.');
}
module.exports={generate,validate,fingerprint,rules,random};
