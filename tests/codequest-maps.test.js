const test=require('node:test'),assert=require('node:assert/strict'),Maps=require('../codequest-maps'),C=require('../public/codequest-core'),E=require('../codequest-engine');
test('5,000 seeded layouts meet difficulty, round-trip, block-budget and freshness checks',()=>{
 for(let level=1;level<=5;level++){const recent=[],seen=new Set(),codes=new Set();for(let i=0;i<1000;i++){const {map,proof}=Maps.generate({level,seed:'batch:'+level+':'+i,exclude:recent.slice(-100)});assert.ok(proof.ok);assert.ok(Maps.validate(map,level).ok);assert.equal(map.id,Maps.fingerprint(map));assert.ok(!seen.has(map.id),'Repeated generated layout');assert.ok(C.run(map,proof.solution).success);assert.ok(proof.solution.length<=32);assert.ok(proof.solution.every(b=>map.blocks.includes(b.op)));assert.ok(proof.metrics.steps<=31);if(level>=3)assert.ok(proof.metrics.longestStraight>=2);recent.push(map.id);seen.add(map.id);codes.add(proof.solution.map(b=>b.op).join(','));}assert.ok(codes.size>=(level===1?6:12),'Only cosmetic route variation');}
});
test('fallbacks are validated, deterministic and avoid the previous 100 layouts',()=>{
 for(let level=1;level<=5;level++){const excluded=[];for(let i=0;i<110;i++){const value=Maps.generate({level,seed:'fallback-test:'+i,attempts:0,exclude:excluded.slice(-100)});assert.equal(value.source,'fallback');assert.ok(value.proof.ok);assert.ok(!excluded.slice(-100).includes(value.map.id));excluded.push(value.map.id);}const a=Maps.generate({level,seed:'stable-seed'}),b=Maps.generate({level,seed:'stable-seed'});assert.deepEqual(a.map,b.map);assert.notEqual(Maps.generate({level,seed:'stable-seed',exclude:[a.map.id]}).map.id,a.map.id);}
});
test('invalid, disconnected, overcrowded and blocked layouts are rejected',()=>{
 const {map}=Maps.generate({level:3,seed:'invalid'}),alter=fn=>{const m=structuredClone(map);fn(m);assert.equal(Maps.validate(m,3).ok,false);};
 for(const m of [null,{},3,{...map,start:[-1,0,0]},{...map,chest:[9,0]}])assert.equal(Maps.validate(m,3).ok,false);
 alter(m=>m.chest=m.start.slice(0,2));alter(m=>m.rocks.push(m.chest));alter(m=>m.rocks.push(m.rocks[0]||m.water[0]));alter(m=>m.water=[[0,0],[5,5]]);alter(m=>m.blocks=['repeat']);alter(m=>{m.rocks=[];m.water=[];});alter(m=>m.rocks=[[2,0],[2,1],[2,2],[2,3],[2,4],[2,5]]);
 assert.throws(()=>Maps.generate({level:0}));assert.throws(()=>Maps.generate({attempts:10000}));
});
test('classmates share one map, later rounds are fresh, and saved maps survive serialization',()=>{
 const students=Array.from({length:25},(_,i)=>({id:'p'+i,name:'Pirate '+i})),s=E.create({students,seconds:60,rounds:5},0),seen=[];students.forEach(p=>s.players[p.id].joined=true);
 for(let round=1;round<=5;round++){const now=round*100000;E.start(s,now);seen.push(s.map.id);const teacher=E.view(s,null,true,now);assert.equal(teacher.mission.difficulty,round);assert.equal(teacher.mission.solution,undefined);assert.equal(teacher.mission.proof,undefined);for(const p of students)assert.deepEqual(E.view(s,p.id,false,now).mission,teacher.mission);const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(E.view(restored,'p0',false,now).mission,s.map);const solution=C.solve(s.map);E.tick(s,s.buildAt);for(const p of students)E.action(s,p.id,{action:'ready',round,revision:0,program:solution},s.buildAt+1);E.tick(s,s.launchAt);assert.ok(Object.values(s.players).every(p=>p.result.success));E.tick(s,s.replayEnd);}
 assert.equal(new Set(seen).size,5);assert.deepEqual(s.recentMaps,seen);
 const next=E.create({students,seconds:60,rounds:1,recentMaps:seen},1000000);students.forEach(p=>next.players[p.id].joined=true);E.start(next,1000000);assert.ok(!seen.includes(next.map.id));
});
test('early generated rounds enforce the available blocks without changing saved code',()=>{
 const students=[{id:'a',name:'A'},{id:'b',name:'B'}],s=E.create({students,seconds:60,rounds:3},0);students.forEach(p=>s.players[p.id].joined=true);E.start(s,1000);E.tick(s,s.buildAt);assert.throws(()=>E.action(s,'a',{action:'save',round:1,revision:0,program:[{op:'repeat',count:2,body:[{op:'move'}]}]},s.buildAt+1),/later round/);assert.deepEqual(s.players.a.program,[]);assert.equal(s.players.a.revision,0);
 s.round=2;s.phase='results';E.start(s,100000);E.tick(s,s.buildAt);assert.doesNotThrow(()=>E.action(s,'a',{action:'save',round:3,revision:0,program:[{op:'repeat',count:2,body:[{op:'move'}]}]},s.buildAt+1));
});
