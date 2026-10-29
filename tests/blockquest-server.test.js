const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'blockquest-rules-'));
const core=require('../public/blockquest-core'),{register}=require('../blockquest');let serial=0;
test.after(()=>fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true}));
function fixture(){
 const routes={},game={id:'game-'+(++serial),teacherId:'owner',questions:[{question:'First',sourceIndex:0,options:['Yes','No'],correctIndex:0},{question:'Second',sourceIndex:1,options:['Yes','No'],correctIndex:0}]};
 const app={get:(url,...handlers)=>routes[url.endsWith('/voice')?'voice':'get']=handlers.at(-1),post:(url,...handlers)=>routes.post=handlers.at(-1)};
 register({app,games:{getGame:()=>game,getRosterIds:()=>[],recordResult:()=>{}},roster:{},requireGameAccess(){},gameSessionCanAccess:()=>true});
 const call=(method,body={},query={})=>{let result,status=200;routes[method]({params:{id:game.id},query,userId:'owner',body},{json:r=>{result=r;},status:n=>{status=n;return {json:r=>{result=r;}};}});return {status,...result};};
 const file=path.join(process.env.DATA_DIR,'blockquest',crypto.createHash('sha256').update(game.id+':teacher:owner:board').digest('hex')+'.json');
 return {call,file,routes,game};
}
function clock(fn){const saved=Date.now;let now=100000;Date.now=()=>now;try{fn({now:()=>now,set:v=>now=v,add:v=>now+=v});}finally{Date.now=saved;}}
test('combo is awarded once, pause freezes its scene and learning marks stay separate',()=>clock(time=>{
 const {call,file}=fixture();let s=call('post',{action:'start'});s=call('post',{action:'answer',revision:s.revision,choice:0});assert.equal(s.phase,'choose');
 const stored=JSON.parse(fs.readFileSync(file));stored.choices=['O','I','T'];stored.pieceRounds[0]=['O','I','T'];stored.falling={shape:'O',rotation:0,column:6,y:0,lastStepAt:time.now()};stored.teams[0].lines=1;
 stored.teams[0].board=core.empty();for(const y of [8,9])stored.teams[0].board[y]=['T','T','T','T','T','T',null,null];fs.writeFileSync(file,JSON.stringify(stored));
 const revision=s.revision;s=call('post',{action:'place',revision});assert.equal(s.teams[0].points,360);assert.equal(s.teams[0].lines,3);assert.equal(s.teams[0].correctCount,1);assert.deepEqual(s.lastAward,{points:260,bonus:50});assert.equal(s.readyAt-time.now(),2700);assert.equal(s.answers.filter(a=>a.correct).length,1);
 assert.equal(call('post',{action:'place',revision}).status,400);time.add(700);s=call('post',{action:'pause',revision:s.revision});time.add(6000);s=call('post',{action:'pause',revision:s.revision});assert.equal(time.now()-s.placementStartedAt,700);assert.equal(s.readyAt-time.now(),2000);
 time.set(s.readyAt);s=call('get').state;assert.equal(s.turn,1);s=call('post',{action:'answer',revision:s.revision,choice:0});assert.deepEqual(s.choices,['O','I','T']);assert.equal(s.pieceRounds,undefined);assert.equal(s.teams[0].points,360);
}));
test('question timer starts immediately, expires once and automatically calls the next learner',()=>clock(time=>{
 const {call}=fixture();let s=call('post',{action:'start'});assert.equal(s.deadline-time.now(),20000);assert.ok(s.learner);const original=s.revision;
 time.add(20000);s=call('get').state;assert.equal(s.phase,'feedback');assert.equal(s.answers.length,1);assert.equal(s.answers[0].choice,-1);assert.equal(s.lastAnswer.timedOut,true);assert.equal(s.teams[0].points,0);
 assert.equal(call('post',{action:'answer',revision:original,choice:0}).status,400);assert.equal(call('get').state.answers.length,1);
 time.add(2500);s=call('get').state;assert.equal(s.phase,'answer');assert.equal(s.active,1);assert.equal(s.deadline-time.now(),20000);
}));
test('earned blocks fall from the top and auto-lock within 15 seconds without extra clicks',()=>clock(time=>{
 const {call}=fixture();let s=call('post',{action:'start'});time.add(3000);s=call('post',{action:'answer',revision:s.revision,choice:0});assert.equal(s.phase,'choose');assert.equal(s.deadline-time.now(),15000);assert.equal(s.falling.y,0);assert.equal(s.teams[0].points,100);
 time.add(1500);s=call('get').state;assert.equal(s.falling.y,1);s=call('post',{action:'pause',revision:s.revision});const remaining=s.deadline-time.now();time.add(10000);s=call('post',{action:'pause',revision:s.revision});assert.equal(s.deadline-time.now(),remaining);assert.equal(s.falling.y,1);
 time.set(s.deadline);s=call('get').state;assert.equal(s.phase,'placing');assert.equal(s.teams[0].points,110);assert.equal(s.teams[0].board.flat().filter(Boolean).length,4);
 time.set(s.readyAt);s=call('get').state;assert.equal(s.phase,'answer');assert.equal(s.active,1);assert.equal(s.teams[0].points,110);
}));

test('narration reads only the current question and rejects stale turns',async()=>{
 const module=require('../assessment-narration'),original=module.createNarration;const spoken=[];
 module.createNarration=()=>async(owner,text)=>{spoken.push({owner,text});return Buffer.from('voice');};
 let f;try{f=fixture();}finally{module.createNarration=original;}
 const s=f.call('post',{action:'start'});let status=200,body;
 const res={status(code){status=code;return this;},set(){return this;},type(){return this;},send(value){body=value;return this;},json(value){body=value;return this;}};
 const req={params:{id:f.game.id},query:{run:s.id,turn:'0'},userId:'owner'};
 await f.routes.voice(req,res);assert.equal(status,200);assert.deepEqual(spoken,[{owner:'owner',text:'First'}]);assert.ok(Buffer.isBuffer(body));
 await f.routes.voice({...req,query:{run:s.id,turn:'1'}},res);assert.equal(status,409);assert.equal(spoken.length,1);
});

test('teacher can restart an unfinished run but stale runs and learners cannot reset it',()=>clock(time=>{
 const {call,routes,game}=fixture();let s=call('post',{action:'start'});const old=s.id;
 s=call('post',{action:'answer',revision:s.revision,choice:0});assert.equal(s.teams[0].points,100);
 assert.equal(call('post',{action:'start'}).status,400);
 assert.equal(call('post',{action:'restart',run:'stale-run'}).status,400);
 time.add(20000);s=call('post',{action:'restart',run:old});assert.equal(s.status,200);assert.notEqual(s.id,old);assert.equal(s.turn,0);assert.equal(s.phase,'answer');assert.equal(s.answers.length,0);assert.equal(s.deadline-time.now(),20000);assert.ok(s.teams.every(t=>t.points===0&&t.board.flat().every(c=>!c)));
 assert.equal(call('post',{action:'restart',run:old}).status,400);
 let status;routes.post({params:{id:game.id},query:{},gameSession:{studentId:'child'},body:{action:'restart',run:s.id}},{status(n){status=n;return this;},json(){}});assert.equal(status,400);assert.equal(call('get').state.id,s.id);
}));

test('smartboard testing uses a separate run with sample teams and no learner marks',()=>{
 const {call}=fixture();const real=call('post',{action:'start'});
 let demo=call('post',{action:'start'},{test:'1'});assert.equal(demo.preview,true);assert.equal(demo.mode,'board');assert.equal(demo.teams.length,2);assert.ok(demo.teams.every(t=>t.names.every(n=>n.endsWith('(demo)'))));assert.notEqual(demo.id,real.id);
 demo=call('post',{action:'answer',revision:demo.revision,choice:0},{test:'1'});assert.equal(demo.phase,'choose');demo=call('post',{action:'finish',revision:demo.revision},{test:'1'});assert.equal(demo.phase,'ended');assert.equal(demo.saved,false);
 assert.equal(call('get').state.id,real.id);assert.equal(call('get').state.answers.length,0);
});
