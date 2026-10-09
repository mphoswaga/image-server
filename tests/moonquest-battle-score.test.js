const {test}=require('node:test');
const assert=require('node:assert/strict');
const {phase,tracks}=require('../public/moonquest-battle-score');
test('battle score follows shared phases for players and spectators',()=>{
 for(const eliminated of [false,true]){
  const s={royale:{eliminated},phase:'lobby'};
  assert.equal(phase(s,1000),'waiting');
  s.phase='matchup';assert.equal(phase(s,1000),'matchup');
  s.phase='choose';s.deadline=26000;assert.equal(phase(s,1000),'answering');assert.equal(phase(s,21000),'urgent');
  s.deadline+=10000;assert.equal(phase(s,21000),'answering');
  s.paused=true;assert.equal(phase(s,25000),'paused');
  s.paused=false;s.phase='reveal';assert.equal(phase(s,25000),'reveal');
  s.phase='ended';assert.equal(phase(s,25000),'finale');
 }
});
test('original arrangements have distinct rhythms and bounded scheduling',()=>{
 assert.ok(tracks.urgent.beat<tracks.answering.beat);
 for(const t of Object.values(tracks)){assert.ok(t.beat>=200);assert.ok(t.beat<=1100);assert.ok(t.label);}
 assert.notDeepEqual(tracks.matchup.notes,tracks.answering.notes);
 assert.notDeepEqual(tracks.reveal.notes,tracks.answering.notes);
});
