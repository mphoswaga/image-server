const test = require('node:test');
const assert = require('node:assert/strict');
const { send, decode, MAX_BUFFER } = require('../fishquest-transport');

function socket() {
  return { readyState:1, bufferedAmount:0, sent:[], terminated:false,
    send(value, callback) { this.sent.push(JSON.parse(value)); callback(); },
    close(code) { this.closed=code; }, terminate() { this.terminated=true; } };
}

test('slow clients drop old snapshots and recover with the newest state', () => {
  const ws=socket(); ws.bufferedAmount=MAX_BUFFER+1;
  assert.equal(send(ws,{revision:1},1000),false);
  assert.equal(send(ws,{revision:2},5000),false);
  assert.equal(ws.sent.length,0);
  ws.bufferedAmount=0;
  assert.equal(send(ws,{revision:3},6000),true);
  assert.deepEqual(ws.sent,[{revision:3}]);
  ws.bufferedAmount=MAX_BUFFER+1;
  send(ws,{},7000);send(ws,{},17000);
  assert.equal(ws.terminated,true);
});

test('send failures cannot escape into the match loop', () => {
  const ws=socket();ws.send=()=>{throw Error('closed');};
  assert.equal(send(ws,{}),false);assert.equal(ws.terminated,true);
  const asyncWs=socket();asyncWs.send=(_,cb)=>cb(Error('broken pipe'));
  send(asyncWs,{});assert.equal(asyncWs.terminated,true);
});

test('malformed, oversized and excessive input cannot enter the simulation', () => {
  for(const raw of ['null','[]','1','"input"','{'])assert.equal(decode(socket(),Buffer.from(raw)),null);
  const big=socket();assert.equal(decode(big,Buffer.alloc(4097)),null);assert.equal(big.closed,1009);
  const ws=socket();
  for(let i=0;i<80;i++)assert.deepEqual(decode(ws,Buffer.from('{"type":"input"}'),1000),{type:'input'});
  assert.equal(decode(ws,Buffer.from('{}'),1000),null);assert.equal(ws.closed,1008);
  assert.deepEqual(decode(ws,Buffer.from('{}'),2000),{});
});
