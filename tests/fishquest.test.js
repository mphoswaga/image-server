const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FishMatch, CONFIG } = require('../fishquest');

function fixture() {
  let now = 1_000_000, saves = 0;
  const game = { id:'fq1', fishquest:{ durationMinutes:5, lateJoin:true }, questions:[
    { question:'Two plus two?', options:['3','4','5','6'], correctIndex:1 },
    { question:'The sky is?', options:['Blue','Square'], correctIndex:0 },
  ] };
  const match = new FishMatch(game, { now:()=>now, random:()=>.5, persist:()=>saves++ });
  const a=match.join({studentId:'A',name:'Amina'}),b=match.join({studentId:'B',name:'Ben'}),c=match.join({studentId:'C',name:'Cara'});
  match.start(); now += CONFIG.protectionMs + 1;
  return { match,a,b,c,game,advance:n=>now+=n,saves:()=>saves };
}

test('server owns movement and clamps impossible input', () => {
  const f=fixture(),x=f.a.x;
  f.match.input(f.a.id,{seq:1,x:999,y:0}); f.advance(100);f.match.tick();
  assert.ok(f.a.x > x); assert.ok(f.a.x-x <= 19);
  f.match.input(f.a.id,{seq:1,x:-1,y:0});f.advance(100);f.match.tick();
  assert.ok(f.a.x >= x);
});

test('one collision creates one private question and locks both fish', () => {
  const f=fixture();f.a.mass=200;f.b.mass=100;f.a.x=f.b.x=900;f.a.y=f.b.y=700;
  const interaction=f.match.claim(f.a,f.b);
  assert.ok(interaction);assert.equal(f.a.lock,interaction.id);assert.equal(f.b.lock,interaction.id);
  assert.equal(f.match.claim(f.c,f.b),null);
  assert.equal(f.match.snapshot(f.a.id).question.prompt,'Two plus two?');
  assert.equal(f.match.snapshot(f.b.id).question,undefined);
  assert.equal(f.match.snapshot(f.c.id).question,undefined);
});

test('correct answer rewards once and safely respawns the victim', () => {
  const f=fixture();f.a.mass=200;f.b.mass=100;f.a.x=f.b.x=900;f.a.y=f.b.y=700;
  const interaction=f.match.claim(f.a,f.b),before=f.a.mass;
  f.advance(500);f.match.answer(f.a.id,{interactionId:interaction.id,choice:1});
  const score=f.a.score,mass=f.a.mass;
  assert.equal(score,75);assert.ok(mass>before);assert.ok(f.b.respawnAt>0);assert.equal(f.a.attempts.length,1);
  f.match.answer(f.a.id,{interactionId:interaction.id,choice:1});
  assert.equal(f.a.score,score);assert.equal(f.a.mass,mass);assert.equal(f.a.attempts.length,1);
  f.advance(CONFIG.respawnMs+1);f.match.tick();assert.equal(f.b.respawnAt,0);assert.ok(f.b.protectedUntil>0);
});

test('wrong answer releases both fish without rewarding attacker', () => {
  const f=fixture();f.a.mass=200;f.b.mass=100;f.a.x=f.b.x=900;f.a.y=f.b.y=700;
  const interaction=f.match.claim(f.a,f.b);f.match.answer(f.a.id,{interactionId:interaction.id,choice:0});
  assert.equal(f.a.score,0);assert.equal(f.a.lock,null);assert.equal(f.b.lock,null);assert.ok(f.b.protectedUntil>0);
  assert.deepEqual(f.match.education(f.a),{correct:0,answered:1,coverage:1,total:2});
});

test('timeout, disconnect and teacher end cannot leave a learner locked', () => {
  const f=fixture();f.a.mass=200;f.b.mass=100;f.a.x=f.b.x=900;f.a.y=f.b.y=700;
  let interaction=f.match.claim(f.a,f.b);f.advance(CONFIG.questionMs+1);f.match.tick();
  assert.equal(interaction.status,'timeout');assert.equal(f.a.lock,null);assert.equal(f.b.lock,null);
  f.advance(CONFIG.cooldownMs+CONFIG.escapeMs+1);interaction=f.match.claim(f.a,f.b);assert.ok(interaction);
  f.match.disconnect(f.b.id);assert.equal(interaction.status,'cancelled');assert.equal(f.a.lock,null);
  f.b.connected=true;f.advance(CONFIG.cooldownMs+CONFIG.escapeMs+1);interaction=f.match.claim(f.a,f.b);assert.ok(interaction);
  f.match.end('teacher');assert.equal(f.match.state.phase,'ended');assert.equal(interaction.status,'cancelled');assert.equal(f.a.lock,null);
});

test('reconnect resets stale input sequence and snapshot does not expose answers', () => {
  const f=fixture();f.match.input(f.a.id,{seq:99,x:1,y:0});f.match.disconnect(f.a.id);
  const same=f.match.join({studentId:'A',name:'Amina'});assert.equal(same.id,f.a.id);assert.equal(same.seq,-1);
  f.match.input(same.id,{seq:0,x:-1,y:0});assert.equal(same.dx,-1);
  const json=JSON.stringify(f.match.snapshot(same.id));assert.equal(json.includes('correctIndex'),false);
});

test('FishQuest is offered beside the existing student game choices', () => {
  const play = fs.readFileSync(path.join(__dirname, '..', 'public', 'play.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(play, /class="game-pick" data-game="fishquest"/);
  assert.match(play, /location\.href='\/fishquest-play\/'\+GAME_ID/);
  assert.match(dashboard, /Open FishQuest live room/);
});

test('teacher previews are not blocked by stale learner sessions', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const live = fs.readFileSync(path.join(__dirname, '..', 'fishquest-live.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'fishquest-client.js'), 'utf8');

  assert.ok(server.indexOf('const teacherTok') < server.indexOf('const gameTok'));
  assert.match(live, /__TEACHER_TEST__:/);
  assert.match(live, /Open the FishQuest live room from My games first/);
  assert.match(client, /err\.status === 401 \|\| err\.status === 403/);
});
