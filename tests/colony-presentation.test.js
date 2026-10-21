const {test}=require('node:test');const assert=require('node:assert/strict');
const p=require('../public/colony-presentation');
test('shared creature poses alternate clearly and limit reduced motion',()=>{
 assert.equal(p.creaturePose('bird',0).frame,0);assert.equal(p.creaturePose('bird',.2).frame,1);
 assert.equal(p.creaturePose('spider',.2).frame,1);assert.notEqual(p.creaturePose('bird',0,true).frame,p.creaturePose('bird',.6,true).frame);
 for(let t=0;t<4;t+=.1)assert.ok(Math.abs(p.creaturePose('bird',t,true).bob)<=.008);
});
test('raid introduction and result leave the action clear in both modes',()=>{
 assert.equal(p.raidBeat(0).moment,'versus');assert.equal(p.raidBeat(.3).moment,'');assert.equal(p.raidBeat(.6).phase,'clash');assert.equal(p.raidBeat(.8).moment,'result');
 assert.ok(Math.abs(p.raidBeat(1).travel)<1e-9);assert.ok(p.raidDuration(true)<p.raidDuration(false));
});
test('result uses recorded transfer and winner without changing scores',()=>{
 const e={attackerName:'Boys',targetName:'Girls',success:false,stolen:0,targetFoodChange:5};const before=JSON.stringify(e);
 assert.equal(p.raidResult(e).winner,'Girls');assert.match(p.raidResult(e).detail,/protected.*\+5/);assert.equal(JSON.stringify(e),before);
 assert.equal(p.raidResult({...e,success:true,stolen:3}).detail,'3 food carried home');
});
