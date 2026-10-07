const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../moonquest');
test('battle royale lives persist, eliminated learners cannot answer and spectators never see unrevealed choices',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'royale-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createStore(dir,()=>100000);
 const game=store.saveGame('t',{title:'Royale',reviewed:true,diagrams:[{id:'d',asset:'00000000-0000-0000-0000-000000000000',regions:['a','b'].map((id,i)=>({id,label:id,points:[[i*.4,0],[i*.4+.2,0],[i*.4+.2,.2]]}))}],questions:Array.from({length:5},(_,i)=>({id:'q'+i,diagramId:'d',prompt:'Choose',concept:'Identify',accepted:['a'],explanation:'A'}))});
 const s=store.createSession('t',game.id,{id:'c',name:'Class',students:[0,1,2].map(i=>({id:'s'+i,name:'Student '+i}))},false,'royale');
 for(let i=0;i<3;i++)store.join(s.id,'s'+i);
 const cmd=action=>store.command(s.id,'t',action,{seq:store.session(s.id).seq});
 for(let round=0;round<3;round++){
 cmd('next');for(let i=0;i<3;i++)store.answer(s.id,'s'+i,{eventId:`${round}-${i}`,phase:'choose',round,regionId:i===0?'b':'a'});
 assert.ok(store.snapshot(s.id,'student','s0').royale.players.every(p=>!p.selection));cmd('advance');if(store.session(s.id).paused)cmd('pause');
 }
 let v=store.snapshot(s.id,'student','s0');assert.equal(v.royale.me.lives,0);assert.equal(v.royale.eliminated,true);
 assert.equal(createStore(dir,()=>100000).snapshot(s.id,'student','s0').royale.me.lives,0);
 cmd('next');assert.throws(()=>store.answer(s.id,'s0',{eventId:'forged',phase:'choose',round:3,regionId:'a'}),/watching/);
 assert.equal(store.snapshot(s.id,'student','s0').canAnswer,false);
 assert.equal(store.report(s.id,'t').students[0].rounds[3].expected,false);
 cmd('end');assert.deepEqual(store.snapshot(s.id,'board').royale.winners.sort(),['s1','s2']);
});
