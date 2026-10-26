const {test}=require('node:test'),assert=require('node:assert/strict');const {prepare}=require('../fishquest-food-delta');
test('food deltas retain a full reconnect baseline and do not advance on dropped sends',()=>{
 const ws={foodDeltas:true},state={matchId:'one',food:[[1,20,30],[2,40,50]]};
 let p=prepare(ws,state);assert.deepEqual(p.state.food,state.food);p.commit();
 p=prepare(ws,{...state,food:[[2,60,70],[3,80,90]]});assert.deepEqual(p.state.foodDelta,{remove:[1],upsert:[[2,60,70],[3,80,90]]});
 const retry=prepare(ws,{...state,food:[[2,60,70],[3,80,90]]});assert.deepEqual(retry.state,p.state);retry.commit();
 assert.deepEqual(prepare(ws,{...state,food:[[2,60,70],[3,80,90]]}).state.foodDelta,{remove:[],upsert:[]});
 assert.ok(prepare(ws,{...state,matchId:'two'}).state.food);assert.ok(prepare({},state).state.food);assert.ok(prepare({foodDeltas:true},state).state.food);
});
test('stationary full-class ocean substantially reduces food payload',()=>{
 const state={matchId:'one',food:Array.from({length:871},(_,i)=>[i,i*3,i*2])},ws={foodDeltas:true};prepare(ws,state).commit();
 assert.ok(JSON.stringify(prepare(ws,state).state).length<JSON.stringify(state).length/20);
});
