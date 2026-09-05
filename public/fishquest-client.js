(() => {
  const $ = id => document.getElementById(id);
  const GAME_ID = location.pathname.split('/').filter(Boolean).pop();
  let meta, socket, state, scene, rendererStarting = false, me, reconnects = 0, seq = 0, ticket = '', reconnectTimer;
  const keys = new Set(); let touch = { x: 0, y: 0 }, entities = new Map(), foods = new Map(), lastEvent = null, qTimer;
  function show(id) { document.querySelectorAll('.screen').forEach(el => el.classList.toggle('show', el.id === id)); }
  async function json(url, options) { const r = await fetch(url, options); const d = await r.json().catch(() => ({})); if (!r.ok) { const e = Error(d.error || 'Please try again.'); e.status = r.status; throw e; } return d; }
  async function load() {
    try {
      meta = await json(`/api/game/${GAME_ID}`); $('nameLabel').textContent = meta.hasRoster ? 'Student ID' : 'Your name';
      $('roomTitle').textContent = meta.lessonTitle || 'FishQuest'; await getTicket();
    } catch (err) { if (err.status === 401 || err.status === 403) show('join'); else wait(err.message); }
  }
  function wait(message) { show('waiting'); $('waitText').textContent = message || 'Waiting for your teacher to open the ocean...'; }
  $('retryButton').onclick = load;
  $('joinForm').onsubmit = async event => {
    event.preventDefault(); const button = $('joinButton'); button.disabled = true; $('joinError').textContent = '';
    try {
      const studentId = $('studentId').value.trim();
      await json(`/api/game/${GAME_ID}/enter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId, name: studentId, pin: $('pin').value }) });
      meta = await json(`/api/game/${GAME_ID}`); $('roomTitle').textContent = meta.lessonTitle || 'FishQuest'; await getTicket();
    } catch (err) { $('joinError').textContent = err.message; } finally { button.disabled = false; }
  };
  async function getTicket() {
    try { ticket = (await json(`/api/game/${GAME_ID}/fishquest/ticket`, { method: 'POST' })).token; connect(); }
    catch (err) { wait(err.message); }
  }
  function connect() {
    clearTimeout(reconnectTimer); show('arena'); $('connection').textContent = 'Connecting to the ocean...';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; socket = new WebSocket(`${protocol}//${location.host}/ws/fishquest`);
    socket.onopen = () => { reconnects = 0; socket.send(JSON.stringify({ type: 'auth', token: ticket })); $('connection').textContent = 'Live with your class'; };
    socket.onmessage = event => { const m = JSON.parse(event.data); if (m.type === 'state') apply(m.state); if (m.type === 'error') toast(m.error, false); };
    socket.onclose = event => {
      if (state && state.phase === 'ended') return;
      $('connection').textContent = 'Reconnecting... your progress is safe';
      if (event.code === 4003) { wait('Your room changed. Join again to continue.'); return; }
      reconnectTimer = setTimeout(() => getTicket(), Math.min(8000, 500 * 2 ** reconnects++));
    };
  }
  function apply(next) {
    state = next; me = state.players.find(p => p.id === state.me); if (!me) return;
    if (!scene && !rendererStarting) startRenderer();
    $('mass').textContent = me.mass; $('score').textContent = me.score;
    $('teacherWait').hidden = state.phase !== 'lobby';
    if (state.phase === 'ended') return finish();
    renderState(); renderQuestion();
    if (state.event && state.event.id !== lastEvent) { lastEvent = state.event.id; const mine = state.event.attacker === state.me; if (state.event.outcome === 'correct' && mine) toast('Correct! You grew bigger!', true); else if (state.event.outcome === 'incorrect' && mine) toast('Not this time. Keep exploring!', false); else if (state.event.outcome === 'timeout' && mine) toast('Time ran out. Keep going!', false); else if (state.event.outcome === 'correct') toast('Splash! You are safely back.', false); }
  }
  function startRenderer() {
    rendererStarting = true;
    new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: innerWidth, height: innerHeight, backgroundColor: '#073b58', scale: { mode: Phaser.Scale.RESIZE }, scene: { preload() { this.load.image('lagoon', '/assets/fishquest/lagoon.png'); }, create() { scene = this; rendererStarting = false; const bg = this.add.image(1200, 800, 'lagoon').setDisplaySize(2400, 1600).setDepth(-5); bg.setAlpha(.93); this.cameras.main.setBounds(0, 0, 2400, 1600); renderState(); }, update() { animate(); } } });
  }
  function fishTexture(variant) {
    const key = `fish-${variant}`; if (scene.textures.exists(key)) return key;
    const colors = [0xff7657, 0x53e0cf, 0xffce4a, 0x9e75ea, 0x43a9ff], g = scene.make.graphics({ add: false });
    g.fillStyle(colors[variant % colors.length]); g.fillTriangle(2, 25, 22, 8, 22, 42); g.fillEllipse(40, 25, 45, 30); g.fillStyle(0xffffff); g.fillCircle(50, 20, 5); g.fillStyle(0x0b2845); g.fillCircle(52, 20, 2); g.generateTexture(key, 65, 50); g.destroy(); return key;
  }
  function renderState() {
    if (!scene) return;
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id); let e = entities.get(p.id);
      if (!e) { const sprite = scene.add.image(p.x, p.y, fishTexture(p.variant)); const label = scene.add.text(p.x, p.y - 34, p.name, { font: 'bold 15px Arial', color: '#ffffff', stroke: '#052c48', strokeThickness: 4 }).setOrigin(.5); e = { sprite, label, tx: p.x, ty: p.y }; entities.set(p.id, e); if (p.id === state.me) scene.cameras.main.startFollow(sprite, true, .08, .08); }
      e.tx = p.x; e.ty = p.y; const scale = Math.sqrt(p.mass / 100); e.sprite.setScale(scale); e.sprite.setAlpha(p.respawning ? .2 : p.protected ? .72 : 1); e.label.setText(p.name).setAlpha(p.respawning ? .3 : 1);
    }
    for (const [id, e] of entities) if (!seen.has(id)) { e.sprite.destroy(); e.label.destroy(); entities.delete(id); }
    const foodSeen = new Set();
    for (const [id, x, y] of state.food) { foodSeen.add(id); let f = foods.get(id); if (!f) { f = scene.add.circle(x, y, 6, [0xffeb65,0x70f0dc,0xff8d79][id%3]).setStrokeStyle(2,0xffffff,.65); foods.set(id,f); } f.setPosition(x,y).setVisible(true); }
    for (const [id,f] of foods) if (!foodSeen.has(id)) f.setVisible(false);
  }
  function animate() {
    if (!state || !scene) return;
    for (const e of entities.values()) { e.sprite.x += (e.tx-e.sprite.x)*.22; e.sprite.y += (e.ty-e.sprite.y)*.22; e.label.setPosition(e.sprite.x,e.sprite.y-34*e.sprite.scaleY); e.sprite.rotation=Math.sin(performance.now()/280+e.sprite.x)*.025; }
    if (me) scene.cameras.main.setZoom(Math.max(.58, Math.min(1.05, 1.02 - (me.mass-100)/1600)));
  }
  function renderQuestion() {
    const q = state.question; $('question').hidden = !q; clearInterval(qTimer); if (!q) return;
    $('prompt').textContent = q.prompt; $('options').innerHTML = '';
    q.options.forEach((option, choice) => { const b = document.createElement('button'); b.className='option'; b.textContent=option; b.onclick=()=>{ document.querySelectorAll('.option').forEach(x=>x.disabled=true); socket.send(JSON.stringify({ type:'answer', interactionId:q.id, choice })); }; $('options').appendChild(b); });
    const update=()=>{ $('qtime').textContent=`${Math.max(0,Math.ceil((q.expiresAt-Date.now())/1000))} seconds left`; }; update();qTimer=setInterval(update,250);
  }
  function finish() {
    show('ended'); const order=[...state.players].sort((a,b)=>b.score-a.score), place=order.findIndex(p=>p.id===state.me)+1;
    $('rank').textContent = place ? `You finished number ${place} of ${order.length}` : 'Adventure complete'; $('finalScore').textContent = `${me.score} points`;
    const p=state.personal||{}; $('learning').textContent = p.answered ? `You answered ${p.correct} of ${p.answered} questions correctly and explored ${p.coverage} different questions.` : 'You collected plankton and practised navigating the ocean.';
  }
  function toast(text, good) { const el=$('toast');el.textContent=text;el.className=`toast show ${good?'good':'bad'}`;setTimeout(()=>el.className='toast',2200); }
  addEventListener('keydown', e => { if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(e.key)) { keys.add(e.key.toLowerCase()); e.preventDefault(); } });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  const pad=$('touch'), dot=$('touchDot'); function moveTouch(e){const r=pad.getBoundingClientRect(),x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2),l=Math.max(1,Math.hypot(x,y)),m=Math.min(r.width*.32,l);touch={x:x/l,y:y/l};dot.style.transform=`translate(${touch.x*m}px,${touch.y*m}px)`;}
  pad.onpointerdown=e=>{pad.setPointerCapture(e.pointerId);moveTouch(e)};pad.onpointermove=e=>{if(pad.hasPointerCapture(e.pointerId))moveTouch(e)};pad.onpointerup=pad.onpointercancel=()=>{touch={x:0,y:0};dot.style.transform=''};
  setInterval(()=>{if(!socket||socket.readyState!==1||!state||state.phase!=='running'||state.question)return;let x=(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0),y=(keys.has('arrowdown')||keys.has('s')?1:0)-(keys.has('arrowup')||keys.has('w')?1:0);if(!x&&!y){x=touch.x;y=touch.y}socket.send(JSON.stringify({type:'input',seq:seq++,x,y}));},50);
  setInterval(()=>{if(!state)return;const left=state.endsAt?Math.max(0,state.endsAt-Date.now()):0;$('time').textContent=state.phase==='lobby'?'Lobby':`${Math.floor(left/60000)}:${String(Math.floor(left/1000)%60).padStart(2,'0')}`;},250);
  load();
})();
