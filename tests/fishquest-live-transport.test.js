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

test('30 real connections survive invalid messages, replacement, pause and resume', { timeout:20000 }, async t => {
  const game={id:'live-test',teacherId:'owner',fishquest:{durationMinutes:10,lateJoin:true},questions:[{question:'Yes?',options:['Yes','No'],correctIndex:0}]};
  const app=express(),server=http.createServer(app),sockets=[];
  let resultWrites=0;
  const live=createFishQuestLive({app,games:{getGame:()=>game,normalizeStudentId:s=>s,recordResult:()=>{ if (++resultWrites===1) throw Error('temporary storage failure'); }},roster:{},requireAuth:(_,__,next)=>next(),requireGameAccess:(_,__,next)=>next(),jwtSecret:'test-secret'});
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
