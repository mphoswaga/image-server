const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'..','practice.html'),'utf8');
test('failed room polling retains the learner identity and allows another poll',async()=>{
  let calls=0;
  const context=vm.createContext({liveRoom:{code:'ABCDEF'},liveParticipant:{id:'learner'},liveParticipantToken:'token',
    checkpointRequest:async()=>{calls++;throw Error('offline');},setSave:()=>{}});
  vm.runInContext(source.slice(source.indexOf('    let refreshingLiveRoom='),source.indexOf('    async function joinLiveRoom()')),context);
  await vm.runInContext('refreshLiveRoom()',context);
  await vm.runInContext('refreshLiveRoom()',context);
  assert.equal(calls,2);
  assert.equal(context.liveRoom.code,'ABCDEF');
  assert.equal(context.liveParticipantToken,'token');
  assert.equal(context.liveParticipant.id,'learner');
});
test('mistakes remain recoverable when audio and narration throw',()=>{
  const feedback={}; let effects=0;
  const context=vm.createContext({paused:false,phase:'independent',independentSaved:false,roundLocked:false,
    stats:{attempts:0,mistakes:0},combo:4,updateHud:()=>{},$:()=>feedback,
    performance:{now:()=>1000},console:{warn:()=>{}},setByteState:()=>{},
    playCue:()=>{effects++;throw Error('audio unavailable');},narrate:()=>{throw Error('speech unavailable');}});
  vm.runInContext(source.slice(source.indexOf('    let lastMistakeEffect='),source.indexOf('    function showRoomClearCard()')),context);
  for(let i=0;i<100;i++) assert.doesNotThrow(()=>vm.runInContext("registerWrong('Try the next key')",context));
  assert.equal(context.stats.mistakes,100);
  assert.equal(effects,1);
  assert.equal(feedback.textContent,'Try the next key');
  context.paused=true;vm.runInContext("registerWrong('ignored')",context);
  assert.equal(context.stats.mistakes,100);
});
function harness() {
  const timers = new Map();
  const events = {};
  const button = {dataset:{retry:'1'}};
  let id=0;
  const context = vm.createContext({
    AbortController, paused:false, liveRoom:null, navigator:{onLine:true},
    $:()=>button, window:{addEventListener:(name,fn)=>events[name]=fn},
    setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},
    clearTimeout:key=>timers.delete(key), fetch:async()=>({json:async()=>({ok:true})}),
    calls:0, performCheckpointSave:async()=>{context.calls++;}
  });
  vm.runInContext(source.slice(source.indexOf('    async function checkpointRequest('),source.indexOf('    async function performCheckpointSave(')),context);
  return {context,timers,events,button,run:code=>vm.runInContext(code,context)};
}
test('checkpoint saves are single-flight and block during pause or room closure',async()=>{
  const h=harness();let resolve;
  h.context.performCheckpointSave=()=>{h.context.calls++;return new Promise(r=>resolve=r);};
  const pending=h.run('saveCheckpoint()');
  await h.run('saveCheckpoint()'); assert.equal(h.context.calls,1);
  resolve();await pending;
  h.context.paused=true;await h.run('saveCheckpoint()');assert.equal(h.context.calls,1);
  h.context.paused=false;h.context.liveRoom={status:'closed'};
  await h.run('saveCheckpoint()');assert.equal(h.context.calls,1);
});
test('retry backoff is bounded, waits offline, and restarts on reconnect',async()=>{
  const h=harness();
  h.run('retryCheckpointSoon()');assert.equal([...h.timers.values()][0].delay,2000);
  h.context.navigator.onLine=false;[...h.timers.values()][0].fn();assert.equal(h.context.calls,0);
  h.context.navigator.onLine=true;h.events.online();
  [...h.timers.values()][0].fn();await Promise.resolve();assert.equal(h.context.calls,1);
  h.run('checkpointRetryCount=5; retryCheckpointSoon()');assert.equal(h.timers.size,0);
  h.events.online();assert.equal([...h.timers.values()][0].delay,2000);
  h.button.dataset.retry=undefined;
  [...h.timers.values()][0].fn();assert.equal(h.context.calls,1);
});
test('request timeout aborts stalled network requests and clears its timer',async()=>{
  const h=harness();
  h.context.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  const pending=h.run("checkpointRequest('/test',{})");
  assert.equal([...h.timers.values()][0].delay,15000);
  [...h.timers.values()][0].fn();await assert.rejects(pending,/aborted/);
  assert.equal(h.timers.size,0);
});
