const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../moonquest');
test('battle royale lives persist, eliminated learners cannot answer and spectators never see unrevealed choices',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'royale-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let now=100000;const store=createStore(dir,()=>now);
 const game=store.saveGame('t',{title:'Royale',reviewed:true,diagrams:[{id:'d',asset:'00000000-0000-0000-0000-000000000000',regions:['a','b'].map((id,i)=>({id,label:id,points:[[i*.4,0],[i*.4+.2,0],[i*.4+.2,.2]]}))}],questions:Array.from({length:5},(_,i)=>({id:'q'+i,diagramId:'d',prompt:'Choose',concept:'Identify',accepted:['a'],explanation:'A'}))});
 const s=store.createSession('t',game.id,{id:'c',name:'Class',students:[0,1,2].map(i=>({id:'s'+i,name:'Student '+i}))},false,'royale');
 for(let i=0;i<3;i++)store.join(s.id,'s'+i);
 const cmd=action=>store.command(s.id,'t',action,{seq:store.session(s.id).seq});
 for(let round=0;round<3;round++){
 cmd('next');now+=4001;store.snapshot(s.id,'board');for(let i=0;i<3;i++)store.answer(s.id,'s'+i,{eventId:`${round}-${i}`,phase:'choose',round,regionId:i===0?'b':'a'});
 assert.ok(store.snapshot(s.id,'student','s0').royale.players.every(p=>!p.selection));cmd('advance');if(store.session(s.id).paused)cmd('pause');
 }
 let v=store.snapshot(s.id,'student','s0');assert.equal(v.royale.me.lives,0);assert.equal(v.royale.eliminated,true);
 assert.equal(createStore(dir,()=>100000).snapshot(s.id,'student','s0').royale.me.lives,0);
 cmd('next');now+=4001;store.snapshot(s.id,'board');assert.throws(()=>store.answer(s.id,'s0',{eventId:'forged',phase:'choose',round:3,regionId:'a'}),/watching/);
 assert.equal(store.snapshot(s.id,'student','s0').canAnswer,false);
 assert.equal(store.report(s.id,'t').students[0].rounds[3].expected,false);
 assert.throws(()=>store.support(s.id,'s1',{round:3,target:'s2',regionIds:['a']}),/Only eliminated/);
 store.support(s.id,'s0',{round:3,target:'s1',regionIds:['b']});
 assert.equal(store.snapshot(s.id,'student','s1').royale.fanAdvice,null);
 now+=10001;
 assert.deepEqual(store.snapshot(s.id,'student','s1').royale.fanAdvice.fans,['Student 0']);
 assert.equal(store.snapshot(s.id,'student','s1').royale.fanAdvice.suggestions[0].id,'b');
 assert.equal(store.session(s.id).rounds[3].answers.s1,undefined);
 assert.throws(()=>store.support(s.id,'s0',{round:2,target:'s1',regionIds:['a']}),/closed/);
 cmd('end');assert.deepEqual(store.snapshot(s.id,'board').royale.winners.sort(),['s1','s2']);
});
test('royale pairs every survivor, with a three-way duel for odd groups and speed deciding only the duel',()=>{
 const royale=require('../moonquest-royale');
 for(const n of [2,3,4,25]){const ids=Array.from({length:n},(_,i)=>'s'+i),groups=royale.pair(ids);assert.deepEqual(groups.flat().sort(),ids.sort());assert.ok(groups.every(g=>g.length===2||g.length===3));}
 const players=[{id:'a',lives:3},{id:'b',lives:3}];
 const s={round:0,rounds:[{royaleGroups:[['a','b']],revealedAt:20,question:{},answers:{a:{first:'yes'},b:{first:'yes'}},events:[{studentId:'a',at:10},{studentId:'b',at:11}]}]};
 const result=royale.matches(s,players,(_,answer)=>answer==='yes')[0];
 assert.deepEqual(result.winners,['a']);assert.ok(result.players.every(p=>!p.lostLife));
});
