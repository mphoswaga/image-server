const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('slow smartboard saves keep only the latest pending snapshot',async()=>{
 const source=fs.readFileSync('public/colonyquest.js','utf8');const start=source.indexOf('  let pendingSave =');const end=source.indexOf('  function freshestSession',start);
 const sent=[],release=[];let local=0;const label={};
 const ctx={session:{turn:0},saveChain:Promise.resolve(),saveLocal:()=>local++,$:()=>label,request:async(_,options)=>{sent.push(JSON.parse(options.body).session);await new Promise(r=>release.push(r));}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const finished=ctx.saveState();for(let i=1;i<=20;i++){ctx.session={turn:i};ctx.saveState();}
 assert.equal(sent.length,1);assert.equal(local,21);release.shift()();await new Promise(r=>setImmediate(r));assert.equal(sent.length,2);assert.equal(sent[1].turn,20);release.shift()();assert.equal(await finished,true);assert.equal(label.textContent,'Saved');
});
