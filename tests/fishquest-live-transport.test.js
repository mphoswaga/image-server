const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const express = require('express');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fq-transport-'));
process.env.DATA_DIR = temp;
const { createFishQuestLive } = require('../fishquest-live');

test('30 real connections survive invalid messages, replacement, pause and resume', { timeout:40000 }, async t => {
  const game={id:'live-test',teacherId:'owner',fishquest:{durationMinutes:10,lateJoin:true},questions:[{question:'Yes?',options:['Yes','No'],correctIndex:0}]};
  const app=express(),server=http.createServer(app),sockets=[];
  let resultWrites=0;
  const live=createFishQuestLive({app,games:{getGame:()=>game,getRosterIds:()=>[],normalizeStudentId:s=>s,recordResult:()=>{ if (++resultWrites===1) throw Error('temporary storage failure'); }},roster:{},requireAuth:(_,__,next)=>next(),requireGameAccess:(_,__,next)=>next(),jwtSecret:'test-secret'});
  const wss=live.attach(server);
  t.after(async()=>{
    for(const ws of wss.clients)ws.terminate();
    for(const ws of sockets)ws.terminate();
    await new Promise(resolve=>wss.close(resolve));
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const match=live.openMatch(game),url=`ws://127.0.0.1:${server.address().port}/ws/fishquest`;
  async function join(studentId){
    const ws=new WebSocket(url);sockets.push(ws);ws.states=[];
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')ws.states.push(m.state);});
    await once(ws,'open');
    const first=once(ws,'message');
    ws.send(JSON.stringify({type:'auth',token:jwt.sign({type:'fishquest',gameId:game.id,studentId,name:studentId},'test-secret')}));
    await first;return ws;
  }
  const learners=await Promise.all(Array.from({length:30},(_,i)=>join(`S${i}`)));
  match.start();
  for(const [i,ws] of learners.entries()){
    ws.send('null');ws.send('[]');ws.send('{broken');
    ws.send(JSON.stringify({type:'input',seq:1,x:i%2?1:-1,y:0}));
  }
  await new Promise(resolve=>setTimeout(resolve,350));
  for(const ws of learners){assert.equal(ws.readyState,WebSocket.OPEN);assert.equal(ws.states.at(-1).phase,'running');assert.equal(ws.states.at(-1).players.length,30);}
  const closed=once(learners[0],'close'),replacement=await join('S0');
  assert.equal((await closed)[0],4002);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(match.state.players.find(p=>p.studentId==='S0').connected,true);
  match.pause();
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(replacement.states.at(-1).phase,'paused');
  match.resume();
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(replacement.states.at(-1).phase,'running');
  const oversizedClosed=once(learners[1],'close');learners[1].send('x'.repeat(5000));
  await oversizedClosed;
  assert.equal(replacement.readyState,WebSocket.OPEN);
  match.state.players[0].attempts.push({questionIndex:0,choice:0,correct:true,outcome:'correct'});
  match.end('time');
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(replacement.states.at(-1).phase,'ended');
  await new Promise(resolve=>setTimeout(resolve,5100));
  assert.equal(resultWrites,2);
  assert.ok(match.state.resultsSavedAt);
});

test('a live lobby can select one assigned class without unassigning the others', async t => {
  const game={id:'class-choice',teacherId:'owner',rosterIds:['2A','2B'],fishquest:{durationMinutes:10,lateJoin:true,playMode:'live'},questions:[{question:'Yes?',options:['Yes','No'],correctIndex:0}]};
  const records={
    '2A':{id:'2A',name:'Grade 2A',students:[{id:'A1',name:'Amina'}]},
    '2B':{id:'2B',name:'Grade 2B',students:[{id:'B1',name:'Ben'}]},
  };
  const app=express();app.use(express.json());
  const requireAuth=(req,_res,next)=>{req.userId='owner';req.user={name:'Teacher'};next()};
  const requireGameAccess=(req,_res,next)=>{req.gameSession={gameId:game.id,studentId:req.headers['x-student'],name:req.headers['x-student'],rosterId:req.headers['x-roster']};next()};
  createFishQuestLive({app,games:{getGame:()=>game,getRosterIds:g=>g.rosterIds,normalizeStudentId:s=>String(s).toUpperCase(),recordResult:()=>{}},roster:{getRoster:(_teacher,id)=>records[id]||null},requireAuth,requireGameAccess,gameSessionCanAccess:()=>true,jwtSecret:'test-secret'});
  const server=http.createServer(app);
  t.after(async()=>{await new Promise(resolve=>server.close(resolve))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/game/${game.id}/fishquest`;
  const opened=await fetch(`${base}/open`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rosterIds:['2A']})});
  assert.equal(opened.status,200);
  const payload=await opened.json();
  assert.deepEqual(payload.sessionRosterIds,['2A']);
  assert.deepEqual(payload.attendance.map(item=>item.name),['Amina']);
  assert.deepEqual(game.rosterIds,['2A','2B']);
  const excluded=await fetch(`${base}/ticket`,{method:'POST',headers:{'x-student':'B1','x-roster':'2B'}});
  assert.equal(excluded.status,403);
  assert.match((await excluded.json()).error,/not playing/i);
  const included=await fetch(`${base}/ticket`,{method:'POST',headers:{'x-student':'A1','x-roster':'2A'}});
  assert.equal(included.status,200);
  assert.ok((await included.json()).token);
});
