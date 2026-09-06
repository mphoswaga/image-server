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

test('plankton grows a fish gradually before fish meals give a larger jump', () => {
  const f=fixture();
  f.a.mass=100;f.b.mass=100;f.a.protectedUntil=0;f.b.protectedUntil=0;
  for(const food of f.match.state.food)food.readyAt=Infinity;
  f.match.state.food[0]={id:0,x:f.a.x,y:f.a.y,readyAt:0};
  f.advance(100);f.match.tick();
  const planktonGrowth=f.a.mass-100;
  assert.ok(planktonGrowth>0&&planktonGrowth<=CONFIG.foodGrowth);
  assert.equal(f.match.claim(f.a,f.b),null);
  f.a.mass=120;f.a.x=f.b.x=900;f.a.y=f.b.y=700;
  const before=f.a.mass,interaction=f.match.claim(f.a,f.b);
  f.match.answer(f.a.id,{interactionId:interaction.id,choice:1});
  assert.ok(f.a.mass-before>planktonGrowth);
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

test('pause freezes the match and resume preserves remaining match and question time', () => {
  const f=fixture();f.a.mass=200;f.b.mass=100;f.a.x=f.b.x=900;f.a.y=f.b.y=700;
  const interaction=f.match.claim(f.a,f.b),endsAt=f.match.state.endsAt,expiresAt=interaction.expiresAt,x=f.a.x;
  f.match.input(f.a.id,{seq:1,x:1,y:0});f.match.pause();f.advance(15000);f.match.tick();
  assert.equal(f.a.x,x);assert.equal(f.match.state.phase,'paused');assert.equal(f.match.snapshot(f.a.id).pausedAt,f.match.state.pausedAt);
  f.match.resume();assert.equal(f.match.state.endsAt,endsAt+15000);assert.equal(interaction.expiresAt,expiresAt+15000);
  assert.equal(f.match.state.pausedAt,null);assert.equal(f.match.state.phase,'running');
});

test('a full 25-learner class survives sustained movement, mistakes and reconnects', () => {
  let now=2_000_000;
  const game={id:'class25',fishquest:{durationMinutes:10,lateJoin:true},questions:[{question:'Safe?',options:['Yes','No'],correctIndex:0}]};
  const match=new FishMatch(game,{now:()=>now,random:Math.random,persist:()=>{}}),players=[];
  for(let i=0;i<25;i++)players.push(match.join({studentId:`S${i}`,name:`Learner ${i+1}`}));
  match.start();now+=CONFIG.protectionMs+1;
  for(let frame=0;frame<300;frame++){
    for(const [i,p] of players.entries())match.input(p.id,{seq:frame,x:Math.sin(frame+i),y:Math.cos(frame-i)});
    now+=50;match.tick();
  }
  const attacker=players[0],victim=players[1];attacker.mass=200;victim.mass=100;attacker.protectedUntil=victim.protectedUntil=0;attacker.cooldownUntil=0;attacker.x=victim.x=500;attacker.y=victim.y=500;
  const interaction=match.claim(attacker,victim);match.answer(attacker.id,{interactionId:interaction.id,choice:1});
  match.disconnect(attacker.id);const restored=match.join({studentId:'S0',name:'Learner 1'});
  assert.equal(restored.id,attacker.id);assert.equal(restored.lock,null);assert.equal(restored.connected,true);
  assert.equal(match.state.players.length,25);assert.equal(match.snapshot(restored.id).players.length,25);
});

test('homework NPCs offer small prey and larger fish bump without locking the learner', () => {
  let now=3_000_000;
  const game={id:'solo',fishquest:{durationMinutes:10,lateJoin:true,playMode:'homework'},questions:[{question:'Pick yes',options:['Yes','No'],correctIndex:0}]};
  const match=new FishMatch(game,{now:()=>now,random:()=>.4,persist:()=>{}}),learner=match.join({studentId:'S1',name:'Sam'});
  match.addNpcs();match.start(1);now+=CONFIG.protectionMs+1;learner.protectedUntil=0;
  const small=match.state.players.find(p=>p.npc&&p.mass===80),large=match.state.players.find(p=>p.npc&&p.mass===460);
  learner.x=small.x=400;learner.y=small.y=400;
  const encounter=match.claim(learner,small);assert.ok(encounter);assert.equal(match.snapshot(learner.id).question.prompt,'Pick yes');
  match.answer(learner.id,{interactionId:encounter.id,choice:0});assert.ok(learner.mass>CONFIG.initialMass);assert.equal(learner.lock,null);
  now+=CONFIG.cooldownMs+1;learner.protectedUntil=0;learner.mass=120;learner.score=20;learner.x=large.x=600;learner.y=large.y=600;
  match.bump(large,learner);assert.equal(learner.mass,CONFIG.initialMass);assert.equal(learner.score,5);assert.equal(learner.lock,null);
  const event=match.snapshot(learner.id).event;assert.equal(event.outcome,'bumped');assert.equal(event.victim,learner.id);
});

test('FishQuest homework settings create a private NPC ocean per learner', () => {
  const gamesSource=fs.readFileSync(path.join(__dirname,'..','games.js'),'utf8');
  const live=fs.readFileSync(path.join(__dirname,'..','fishquest-live.js'),'utf8');
  assert.match(gamesSource,/playMode: config\.playMode === 'homework'/);
  assert.match(live,/soloKey\(game\.id, identity\.studentId\)/);
  assert.match(live,/match\.addNpcs\(\);match\.start\(1\)/);
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
  assert.match(live, /teacherPreview && \(!match \|\| match\.state\.phase === 'ended'\)/);
  assert.match(client, /err\.status === 401 \|\| err\.status === 403/);
});

test('FishQuest launch never reuses a stale browser client', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'fishquest.html'), 'utf8');
  assert.match(server, /app\.get\('\/fishquest-client\.js'[\s\S]*Cache-Control', 'no-store, max-age=0'/);
  assert.match(page, /fishquest-client\.js\?v=\d+/);
});

test('a teacher can launch a private FishQuest practice match directly', () => {
  const live = fs.readFileSync(path.join(__dirname, '..', 'fishquest-live.js'), 'utf8');
  assert.match(live, /openMatch\(game, \{ preview: true \}\)/);
  assert.match(live, /match\.addNpcs\(\);match\.start\(1\)/);
  assert.match(live, /!teacherPreview && match\.state\.preview/);
  assert.match(live, /openMatch\(game, \{ replacePreview: true \}\)/);
});

test('FishQuest answer buttons remain mounted while live state updates arrive', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'fishquest-client.js'), 'utf8');
  assert.match(client, /renderedQuestionId === q\.id/);
  assert.match(client, /renderedQuestionId = q\.id/);
  assert.match(client, /socket\.readyState !== WebSocket\.OPEN/);
  assert.match(client, /answer_ack/);
  assert.match(client, /answer did not reach the ocean/);
});

test('FishQuest game feel stays local, optional, and motion-safe', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'fishquest.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'fishquest-client.js'), 'utf8');
  assert.match(page, /id="soundToggle"/);
  assert.match(page, /id="musicToggle"/);
  assert.match(page, /prefers-reduced-motion:reduce/);
  assert.match(client, /ls-fishquest-audio-v1/);
  assert.match(client, /function growthRipple/);
  assert.match(client, /function syncMusic/);
  assert.match(client, /me\.score > previousMe\.score/);
});
