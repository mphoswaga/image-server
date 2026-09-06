(() => {
  const $ = id => document.getElementById(id);
  const GAME_ID = location.pathname.split('/').filter(Boolean).pop();
  let meta, socket, state, scene, rendererStarting = false, me, reconnects = 0, seq = 0, ticket = '', reconnectTimer, renderedQuestionId = null;
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
    catch (err) { if (err.status === 401 || err.status === 403) { show('join'); $('joinError').textContent = err.message; } else wait(err.message); }
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
  function fishTexture(variant, part = 'body') {
    const key = `fish-${variant}-${part}`;
    if (scene.textures.exists(key)) return key;
    const palettes = [['#ffbd70','#f56a38','#b93230'],['#9cf7de','#24bfa9','#167989'],['#fff0a0','#efb632','#ca6225'],['#e6c6ff','#a275dc','#60429b'],['#9ce9ff','#359cde','#285da5']];
    const [light,base,dark] = palettes[variant % palettes.length];
    const texture = scene.textures.createCanvas(key, 160, 112), c = texture.context;
    c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = '#153950';
    const shade = c.createLinearGradient(0,18,0,95); shade.addColorStop(0,light); shade.addColorStop(.5,base); shade.addColorStop(1,dark); c.fillStyle = shade;
    if (part === 'tail') {
      c.beginPath(); c.moveTo(145,56); c.bezierCurveTo(100,48,68,15,30,12); c.quadraticCurveTo(48,56,30,100); c.bezierCurveTo(70,96,109,63,145,56); c.fill(); c.stroke();
      c.strokeStyle = light; c.lineWidth = 2; for (const y of [28,44,68,84]) { c.beginPath(); c.moveTo(132,56); c.lineTo(48,y); c.stroke(); }
    } else if (part === 'fin') {
      c.beginPath(); c.moveTo(110,30); c.bezierCurveTo(74,25,40,47,35,80); c.quadraticCurveTo(85,87,110,30); c.fill(); c.stroke();
      c.strokeStyle = light; c.beginPath(); c.moveTo(101,36); c.lineTo(49,74); c.stroke();
    } else {
      c.beginPath(); c.moveTo(48,34); c.quadraticCurveTo(63,0,101,18); c.lineTo(116,36); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(83,58,65,38,0,0,Math.PI*2); c.fill(); c.stroke();
      c.save(); c.clip();
      c.fillStyle = '#fff9d8'; c.globalAlpha = .8;
      for (const x of [47,74]) { c.beginPath(); c.moveTo(x,17); c.bezierCurveTo(x-12,44,x+16,70,x+2,103); c.lineTo(x+15,103); c.bezierCurveTo(x+27,70,x+1,42,x+16,17); c.fill(); }
      c.globalAlpha = .23; c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(81,80,53,15,0,0,Math.PI*2); c.fill(); c.restore();
      c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(118,46,15,18,-.12,0,Math.PI*2); c.fill(); c.stroke();
      c.fillStyle = '#113047'; c.beginPath(); c.ellipse(123,47,8,11,0,0,Math.PI*2); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(125,42,3.5,0,Math.PI*2); c.fill();
      c.strokeStyle = '#733f44'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(130,69); c.quadraticCurveTo(139,74,146,66); c.stroke();
      c.strokeStyle = light; c.lineWidth = 4; c.beginPath(); c.ellipse(82,39,28,10,-.15,Math.PI,Math.PI*1.8); c.stroke();
    }
    texture.refresh(); return key;
  }
  function makeFish(p) {
    const tail = scene.add.image(-24,0,fishTexture(p.variant,'tail')).setOrigin(.9,.5).setScale(.32);
    const body = scene.add.image(0,0,fishTexture(p.variant)).setScale(.46);
    const fin = scene.add.image(-2,9,fishTexture(p.variant,'fin')).setOrigin(.68,.28).setScale(.29);
    const sprite = scene.add.container(p.x,p.y,[tail,body,fin]);
    const label = scene.add.text(p.x,p.y-34,p.name,{font:'bold 15px Arial',color:'#ffffff',stroke:'#052c48',strokeThickness:4}).setOrigin(.5);
    return {sprite,label,tail,fin,tx:p.x,ty:p.y,scale:Math.pow(p.mass/100,.65),facing:1,phase:p.variant*1.7};
  }
  function renderState() {
    if (!scene) return;
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id); let e = entities.get(p.id);
      if (!e) { e = makeFish(p); entities.set(p.id,e); if (p.id === state.me) scene.cameras.main.startFollow(e.sprite,true,.08,.08); }
      if (Math.abs(p.x-e.tx)>1) e.facing=p.x>e.tx?1:-1;
      e.tx=p.x; e.ty=p.y; e.scale=Math.pow(p.mass/100,.65); e.locked=p.locked;
      e.sprite.setAlpha(p.respawning ? .2 : p.protected ? .72 : 1); e.label.setText(p.id === state.me ? 'You' : p.name).setAlpha(p.respawning ? .3 : 1);
    }
    for (const [id, e] of entities) if (!seen.has(id)) { e.sprite.destroy(); e.label.destroy(); entities.delete(id); }
    const foodSeen = new Set();
    for (const [id, x, y] of state.food) { foodSeen.add(id); let f = foods.get(id); if (!f) { f = scene.add.circle(x, y, 6, [0xffeb65,0x70f0dc,0xff8d79][id%3]).setStrokeStyle(2,0xffffff,.65); foods.set(id,f); } f.setPosition(x,y).setVisible(true); }
    for (const [id,f] of foods) if (!foodSeen.has(id)) f.setVisible(false);
  }
  function animate() {
    if (!state || !scene) return;
    const dt=Math.min(50,scene.game.loop.delta)/1000, follow=1-Math.exp(-14*dt), t=performance.now()/1000;
    for (const e of entities.values()) {
      const dx=e.tx-e.sprite.x,dy=e.ty-e.sprite.y,speed=Math.min(1,Math.hypot(dx,dy)/16);
      e.sprite.x+=dx*follow; e.sprite.y+=dy*follow;
      e.sprite.scaleY+=(e.scale-e.sprite.scaleY)*(1-Math.exp(-7*dt));
      e.sprite.scaleX+=(e.facing*e.scale-e.sprite.scaleX)*(1-Math.exp(-12*dt));
      const beat=t*(e.locked?3:5+speed*9)+e.phase;
      e.tail.rotation=Math.sin(beat)*(.12+speed*.22); e.tail.scaleX=.32*(.8+Math.cos(beat)*.2);
      e.fin.rotation=Math.sin(beat+1)*.28;
      const tilt=Math.max(-.25,Math.min(.25,dy*.018*e.facing));
      e.sprite.rotation+=(tilt+Math.sin(beat)*.025-e.sprite.rotation)*follow;
      e.label.setPosition(e.sprite.x,e.sprite.y-36*e.sprite.scaleY);
    }
    if (me) scene.cameras.main.setZoom(Math.max(.58, Math.min(1.05, 1.02 - (me.mass-100)/1600)));
  }
  function renderQuestion() {
    const q = state.question;
    if (!q) {
      $('question').hidden = true;
      if (renderedQuestionId) { renderedQuestionId = null; clearInterval(qTimer); $('options').innerHTML = ''; }
      return;
    }
    $('question').hidden = false;
    if (renderedQuestionId === q.id) return;
    renderedQuestionId = q.id; clearInterval(qTimer);
    $('prompt').textContent = q.prompt; $('options').innerHTML = '';
    q.options.forEach((option, choice) => { const b = document.createElement('button'); b.className='option'; b.textContent=option; b.onclick=()=>{ if (!socket || socket.readyState !== WebSocket.OPEN) { toast('Reconnecting. Try that answer again.', false); return; } document.querySelectorAll('.option').forEach(x=>x.disabled=true); socket.send(JSON.stringify({ type:'answer', interactionId:q.id, choice })); }; $('options').appendChild(b); });
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
