const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'blockquest-rules-'));
const core=require('../public/blockquest-core'),{register}=require('../blockquest');
test.after(()=>fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true}));
test('server awards a multi-row combo once, freezes its scene during pause and keeps learning evidence separate',()=>{
 const routes={};const game={id:'game',teacherId:'owner',questions:[{question:'First',options:['Yes','No'],correctIndex:0},{question:'Second',options:['Yes','No'],correctIndex:0}]};
 const app={get:(url,...handlers)=>routes.get=handlers.at(-1),post:(url,...handlers)=>routes.post=handlers.at(-1)};
 register({app,games:{getGame:()=>game,getRosterIds:()=>[],recordResult:()=>{}},roster:{},requireGameAccess(){},gameSessionCanAccess:()=>true});
 const call=(method,body={})=>{let result,status=200;routes[method]({params:{id:'game'},query:{},userId:'owner',body},{json:r=>{result=r;},status:n=>{status=n;return {json:r=>{result=r;}};}});return {status,...result};};
 const originalNow=Date.now;let now=100000;Date.now=()=>now;
 try{
  let s=call('post',{action:'start'});s=call('post',{action:'answer',revision:s.revision,choice:0});s=call('post',{action:'next',revision:s.revision});
  const file=path.join(process.env.DATA_DIR,'blockquest',fs.readdirSync(path.join(process.env.DATA_DIR,'blockquest'))[0]);
  const stored=JSON.parse(fs.readFileSync(file));stored.choices=['O','I','T'];stored.pieceRounds[0]=['O','I','T'];stored.teams[0].lines=1;
  stored.teams[0].board=core.empty();for(const y of [8,9])stored.teams[0].board[y]=['T','T','T','T','T','T',null,null];fs.writeFileSync(file,JSON.stringify(stored));
  const revision=s.revision;s=call('post',{action:'place',revision,shape:'O',rotation:0,column:6});
  assert.equal(s.teams[0].points,260);assert.equal(s.teams[0].lines,3);assert.deepEqual(s.lastAward,{points:260,bonus:50});assert.equal(s.readyAt-now,2700);assert.equal(s.answers.filter(a=>a.correct).length,1);
  assert.equal(call('post',{action:'place',revision,shape:'O',rotation:0,column:6}).status,400);
  now+=700;s=call('post',{action:'pause',revision:s.revision});const pausedAt=s.pausedAt;now+=6000;
  s=call('post',{action:'pause',revision:s.revision});assert.equal(now-s.placementStartedAt,700);assert.equal(s.readyAt-now,2000);
  assert.equal(call('post',{action:'next',revision:s.revision}).status,400);now=s.readyAt;s=call('post',{action:'next',revision:s.revision});assert.equal(s.turn,1);
  s=call('post',{action:'answer',revision:s.revision,choice:0});s=call('post',{action:'next',revision:s.revision});assert.deepEqual(s.choices,['O','I','T']);assert.equal(s.pieceRounds,undefined);assert.equal(s.teams[0].points,260);assert.ok(pausedAt);
 }finally{Date.now=originalNow;}
});
