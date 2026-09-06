(() => {
  const $ = id => document.getElementById(id);
  const GAME_ID = location.pathname.split('/').filter(Boolean).pop();
  let meta, socket, state, scene, rendererStarting = false, me, reconnects = 0, seq = 0, ticket = '', reconnectTimer, renderedQuestionId = null, answerTimer = null;
  const keys = new Set(); let touch = { x: 0, y: 0 }, entities = new Map(), foods = new Map(), lastEvent = null, qTimer;
  const AUDIO_PREF_KEY = 'ls-fishquest-audio-v1';
  let audioSettings = { sound: true, music: true };
  try { audioSettings = { ...audioSettings, ...JSON.parse(localStorage.getItem(AUDIO_PREF_KEY) || '{}') }; } catch {}
  let audioContext = null, audioUnlocked = false, musicTimer = null, musicNodes = new Set(), lastPlanktonCue = 0, finishSoundPlayed = false;
  const reducedMotion = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function show(id) { document.querySelectorAll('.screen').forEach(el => el.classList.toggle('show', el.id === id)); }
  async function json(url, options) { const r = await fetch(url, options); const d = await r.json().catch(() => ({})); if (!r.ok) { const e = Error(d.error || 'Please try again.'); e.status = r.status; throw e; } return d; }
  function saveAudioSettings() { try { localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify(audioSettings)); } catch {} }
  function ensureAudio() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      if (!audioContext) audioContext = new Context();
      return audioContext;
    } catch { return null; }
  }
  function unlockAudio() {
    const context = ensureAudio();
    if (!context) return Promise.resolve(false);
    const ready = context.state === 'running' ? Promise.resolve() : context.resume();
    return ready.then(() => { audioUnlocked = context.state === 'running'; syncMusic(); return audioUnlocked; }).catch(() => false);
  }
  function tone(frequency, { start = 0, duration = .14, volume = .035, type = 'sine', music = false } = {}) {
    if (!audioUnlocked) return;
    const context = ensureAudio();
    if (!context) return;
    const oscillator = context.createOscillator(), gain = context.createGain(), begins = context.currentTime + start;
    oscillator.frequency.value = frequency; oscillator.type = type;
    gain.gain.setValueAtTime(.001, begins);
    gain.gain.exponentialRampToValueAtTime(volume, begins + Math.min(.06, duration / 3));
    gain.gain.exponentialRampToValueAtTime(.001, begins + duration);
    oscillator.connect(gain).connect(context.destination);
    if (music) { musicNodes.add(oscillator); oscillator.addEventListener('ended', () => musicNodes.delete(oscillator), { once: true }); }
    oscillator.start(begins); oscillator.stop(begins + duration + .03);
  }
  function playCue(kind) {
    if (!audioSettings.sound || !audioUnlocked) return;
    const cues = {
      plankton: [[560, 0, .08, .024, 'sine'], [720, .05, .09, .02, 'sine']],
      correct: [[392, 0, .16, .035, 'triangle'], [523, .12, .2, .04, 'triangle'], [659, .25, .25, .04, 'triangle']],
      wrong: [[185, 0, .17, .032, 'square'], [145, .13, .22, .025, 'square']],
      bump: [[125, 0, .2, .04, 'sawtooth']],
      finish: [[392, 0, .2, .035, 'triangle'], [523, .15, .24, .04, 'triangle'], [659, .32, .28, .04, 'triangle'], [784, .5, .38, .045, 'triangle']],
    };
    for (const [frequency, start, duration, volume, type] of cues[kind] || []) tone(frequency, { start, duration, volume, type });
  }
  function stopMusic() {
    clearTimeout(musicTimer); musicTimer = null;
    for (const node of musicNodes) { try { node.stop(); } catch {} }
    musicNodes.clear();
  }
  function scheduleMusic() {
    if (!audioUnlocked || !audioSettings.music || !state || state.phase !== 'running' || document.hidden) return stopMusic();
    [196, 246.94, 293.66, 246.94].forEach((frequency, index) => {
      tone(frequency, { start: index * 1.6, duration: 2, volume: .011, type: 'sine', music: true });
      tone(frequency / 2, { start: index * 1.6, duration: 2.2, volume: .005, type: 'triangle', music: true });
    });
    musicTimer = setTimeout(scheduleMusic, 6400);
  }
  function syncMusic() {
    if (audioUnlocked && audioSettings.music && state && state.phase === 'running' && !document.hidden) {
      if (!musicTimer) scheduleMusic();
    } else stopMusic();
  }
  function updateAudioControls() {
    for (const [id, stateId, setting, label] of [['soundToggle', 'soundState', 'sound', 'sound effects'], ['musicToggle', 'musicState', 'music', 'music']]) {
      const button = $(id), enabled = audioSettings[setting] !== false;
      if (!button) continue;
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', `Turn ${label} ${enabled ? 'off' : 'on'}`);
      $(stateId).textContent = enabled ? 'On' : 'Off';
    }
  }
  function pulseStat(id) {
    const element = $(id); if (!element) return;
    element.classList.remove('stat-pop'); void element.offsetWidth; element.classList.add('stat-pop');
    setTimeout(() => element.classList.remove('stat-pop'), 420);
  }
  function growthRipple(big = false) {
    if (reducedMotion || !scene || !me) return;
    const fish = entities.get(me.id); if (!fish) return;
    const ring = scene.add.circle(fish.sprite.x, fish.sprite.y, big ? 44 : 30, big ? 0xffd166 : 0x52e5db, 0).setStrokeStyle(big ? 5 : 3, big ? 0xffd166 : 0x52e5db, .95).setDepth(20);
    scene.tweens.add({ targets: ring, scale: big ? 2.8 : 1.8, alpha: 0, duration: big ? 700 : 420, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }
  async function load() {
    try {
      meta = await json(`/api/game/${GAME_ID}`); $('nameLabel').textContent = meta.hasRoster ? 'Student ID' : 'Your name';
      $('roomTitle').textContent = meta.lessonTitle || 'FishQuest'; await getTicket();
    } catch (err) { if (err.status === 401 || err.status === 403) show('join'); else wait(err.message); }
  }
  function wait(message) { stopMusic(); show('waiting'); $('waitText').textContent = message || 'Waiting for your teacher to open the ocean...'; }
  $('retryButton').onclick = load;
  $('joinForm').onsubmit = async event => {
    event.preventDefault(); unlockAudio(); const button = $('joinButton'); button.disabled = true; $('joinError').textContent = '';
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
    socket.onmessage = event => { const m = JSON.parse(event.data); if (m.type === 'state') apply(m.state); if (m.type === 'answer_ack') answerAck(m); if (m.type === 'error') toast(m.error, false); };
    socket.onclose = event => {
      if (state && state.phase === 'ended') return;
      stopMusic();
      $('connection').textContent = 'Reconnecting... your progress is safe';
      unlockAnswers();
      if (event.code === 4003) { wait('Your room changed. Join again to continue.'); return; }
      reconnectTimer = setTimeout(() => getTicket(), Math.min(8000, 500 * 2 ** reconnects++));
    };
  }
  function apply(next) {
    const previousMe = state && me ? { id: me.id, mass: Number(me.mass) || 0, score: Number(me.score) || 0 } : null;
    const previousPhase = state && state.phase;
    state = next; me = state.players.find(p => p.id === state.me); if (!me) return;
    if (!scene && !rendererStarting) startRenderer();
    $('mass').textContent=me.mass;$('score').textContent=me.score;$('fishForm').textContent=fishEvolutionName(fishEvolution(me.mass));$('connection').textContent=state.solo?'Homework ocean · computer fish':'Live with your class';
    $('teacherWait').hidden = state.phase !== 'lobby'; $('teacherPause').hidden = state.phase !== 'paused';
    if (state.phase === 'ended') {
      syncMusic();
      if (!finishSoundPlayed && previousPhase && previousPhase !== 'ended') { finishSoundPlayed = true; playCue('finish'); }
      return finish();
    }
    renderState(); renderQuestion();
    const freshEvent = state.event && state.event.id !== lastEvent ? state.event : null;
    const swallowed = freshEvent && freshEvent.outcome === 'correct' && freshEvent.attacker === state.me;
    if (previousMe && previousMe.id === me.id && me.score > previousMe.score && !swallowed) {
      const now = performance.now();
      if (now - lastPlanktonCue > 110) { lastPlanktonCue = now; playCue('plankton'); }
      pulseStat('mass'); pulseStat('score'); growthRipple(false);
    }
    if (freshEvent) {
      lastEvent = freshEvent.id;
      if (previousMe) {
        const mine = freshEvent.attacker === state.me;
        if (freshEvent.outcome === 'correct' && mine) { toast('Correct! You swallowed the fish and grew bigger!', true); playCue('correct'); pulseStat('mass'); pulseStat('score'); growthRipple(true); }
        else if (freshEvent.outcome === 'incorrect' && mine) { toast('Not this time. Keep exploring!', false); playCue('wrong'); }
        else if (freshEvent.outcome === 'timeout' && mine) { toast('Time ran out. Keep going!', false); playCue('wrong'); }
        else if (freshEvent.outcome === 'bumped' && freshEvent.victim === state.me) { toast('That fish is too big! Eat more plankton first.', false); playCue('bump'); }
        else if (freshEvent.outcome === 'correct' && freshEvent.victim === state.me) { toast('Splash! You are safely back. Grow and try again!', false); playCue('bump'); }
      }
    }
    if(previousMe&&me.mass>previousMe.mass) {
      const before=fishEvolution(previousMe.mass),after=fishEvolution(me.mass);
      if(FISH_STAGE_ORDER.indexOf(after)>FISH_STAGE_ORDER.indexOf(before)) {
        toast(`Evolution! You became a ${fishEvolutionName(after)}!`,true);playCue('correct');growthRipple(true);
      }
    }
    syncMusic();
  }
  function startRenderer() {
    rendererStarting = true;
    new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: innerWidth, height: innerHeight, backgroundColor: '#073b58', scale: { mode: Phaser.Scale.RESIZE }, scene: { preload() { this.load.image('lagoon', '/assets/fishquest/lagoon.png'); }, create() { scene = this; rendererStarting = false; const bg = this.add.image(1200, 800, 'lagoon').setDisplaySize(2400, 1600).setDepth(-5); bg.setAlpha(.93); this.cameras.main.setBounds(0, 0, 2400, 1600); renderState(); }, update() { animate(); } } });
  }
  const FISH_PALETTES = [
    ['#ffd07a','#f56a38','#b93230','#fff5d8'], ['#a8f8e3','#24bfa9','#167989','#e8fff8'],
    ['#fff2a6','#efb632','#c76724','#fff8d4'], ['#e8c9ff','#9b6ed6','#5d3a96','#f8edff'],
    ['#a7eaff','#359cde','#285da5','#e6f8ff'], ['#ffc3dc','#ec6396','#a92e68','#fff0f6'],
    ['#d7f788','#83c83e','#397c43','#f4ffd8'], ['#ffaaa0','#e64945','#8f2538','#ffe8e2'],
    ['#a4f7ff','#20bdd1','#176f9c','#e8fdff'], ['#bdc4ff','#5969dc','#343783','#eef0ff'],
  ];
  const FISH_STAGE_ORDER=['minnow','reef','hunter','shark'];
  const FISH_STAGE_STYLE={
    minnow:{body:.40,tail:.25,fin:.21,tailX:-20,finX:-2,finY:7,label:31},
    reef:{body:.46,tail:.32,fin:.29,tailX:-24,finX:-2,finY:9,label:36},
    hunter:{body:.49,tail:.34,fin:.30,tailX:-26,finX:-1,finY:10,label:39},
    shark:{body:.53,tail:.37,fin:.31,tailX:-29,finX:1,finY:12,label:44},
  };
  function fishEvolution(mass) {
    const size=Number(mass)||100;
    return size>=450?'shark':size>=280?'hunter':size>=160?'reef':'minnow';
  }
  function fishEvolutionName(stage) {
    return ({minnow:'quick minnow',reef:'reef fish',hunter:'ocean hunter',shark:'shark'})[stage]||'fish';
  }
  function fishBodyPath(c,stage,species) {
    c.beginPath();
    if(stage==='shark') {
      c.moveTo(14,58);c.bezierCurveTo(39,28,102,23,139,40);c.quadraticCurveTo(157,49,151,61);c.quadraticCurveTo(157,72,138,79);c.bezierCurveTo(95,95,39,87,14,58);c.closePath();
      return;
    }
    const hunter=stage==='hunter', minnow=stage==='minnow';
    const shape=species===1
      ? {x:84,y:58,rx:minnow?48:hunter?58:54,ry:minnow?34:hunter?42:45}
      : species===2
        ? {x:82,y:58,rx:minnow?58:hunter?72:68,ry:minnow?25:hunter?31:29}
        : {x:83,y:58,rx:minnow?55:hunter?69:65,ry:minnow?29:hunter?34:38};
    c.ellipse(shape.x,shape.y,shape.rx,shape.ry,0,0,Math.PI*2);
  }
  function fishTexture(variant,part='body',stage='minnow') {
    const key=`fish-${variant}-${stage}-${part}`;
    if(scene.textures.exists(key)) return key;
    const species=Number(variant)%3;
    const [light,base,dark,accent]=FISH_PALETTES[Number(variant)%FISH_PALETTES.length];
    const texture=scene.textures.createCanvas(key,160,112),c=texture.context;
    c.lineJoin='round';c.lineCap='round';c.lineWidth=3;c.strokeStyle='#153950';
    const shade=c.createLinearGradient(0,15,0,100);shade.addColorStop(0,light);shade.addColorStop(.5,base);shade.addColorStop(1,dark);c.fillStyle=shade;
    if(part==='tail') {
      if(stage==='shark') {
        c.beginPath();c.moveTo(147,56);c.bezierCurveTo(105,51,76,26,43,9);c.quadraticCurveTo(57,39,48,54);c.quadraticCurveTo(60,69,42,103);c.bezierCurveTo(79,86,111,62,147,56);c.fill();c.stroke();
      } else if(species===1) {
        c.beginPath();c.moveTo(145,56);c.bezierCurveTo(102,48,65,19,31,18);c.quadraticCurveTo(52,46,49,56);c.quadraticCurveTo(52,68,31,94);c.bezierCurveTo(70,92,108,64,145,56);c.fill();c.stroke();
      } else if(species===2) {
        c.beginPath();c.moveTo(145,56);c.bezierCurveTo(100,46,72,28,38,19);c.quadraticCurveTo(53,47,48,56);c.quadraticCurveTo(53,65,38,92);c.bezierCurveTo(76,80,108,65,145,56);c.fill();c.stroke();
      } else {
        c.beginPath();c.moveTo(145,56);c.bezierCurveTo(100,48,68,15,30,12);c.quadraticCurveTo(48,56,30,100);c.bezierCurveTo(70,96,109,63,145,56);c.fill();c.stroke();
      }
      c.strokeStyle=accent;c.globalAlpha=.7;c.lineWidth=2;for(const y of [28,44,68,84]){c.beginPath();c.moveTo(132,56);c.lineTo(49,y);c.stroke();}
    } else if(part==='fin') {
      if(stage==='shark'||stage==='hunter') {
        c.beginPath();c.moveTo(112,31);c.quadraticCurveTo(73,39,37,88);c.quadraticCurveTo(86,82,112,31);c.fill();c.stroke();
      } else if(species===1) {
        c.beginPath();c.moveTo(108,29);c.bezierCurveTo(66,23,37,45,42,91);c.quadraticCurveTo(88,78,108,29);c.fill();c.stroke();
      } else if(species===2) {
        c.beginPath();c.moveTo(111,36);c.quadraticCurveTo(72,43,42,76);c.quadraticCurveTo(85,77,111,36);c.fill();c.stroke();
      } else {
        c.beginPath();c.moveTo(110,30);c.bezierCurveTo(74,25,40,47,35,80);c.quadraticCurveTo(85,87,110,30);c.fill();c.stroke();
      }
      c.strokeStyle=accent;c.lineWidth=2;c.beginPath();c.moveTo(101,38);c.lineTo(49,76);c.stroke();
    } else {
      if(stage==='shark') {
        c.beginPath();c.moveTo(52,35);c.lineTo(76,5);c.lineTo(92,34);c.fill();c.stroke();
      } else if(stage==='hunter'||species===1) {
        c.beginPath();c.moveTo(48,35);c.quadraticCurveTo(67,2,101,19);c.lineTo(116,38);c.fill();c.stroke();
        if(species===1&&stage!=='hunter'){c.beginPath();c.moveTo(51,78);c.quadraticCurveTo(70,111,98,91);c.fill();c.stroke();}
      } else {
        c.beginPath();c.moveTo(52,38);c.quadraticCurveTo(69,12,99,24);c.lineTo(111,40);c.fill();c.stroke();
      }
      fishBodyPath(c,stage,species);c.fill();c.stroke();
      c.save();fishBodyPath(c,stage,species);c.clip();
      if(species===0) {
        c.fillStyle=accent;c.globalAlpha=stage==='shark'?.45:.78;
        for(const x of [48,76]){c.beginPath();c.moveTo(x,10);c.bezierCurveTo(x-13,42,x+16,72,x+1,106);c.lineTo(x+16,106);c.bezierCurveTo(x+28,71,x+2,39,x+16,10);c.fill();}
      } else if(species===1) {
        c.fillStyle=accent;c.globalAlpha=.72;
        for(const [x,y,r] of [[45,43,7],[66,70,9],[88,38,6],[104,66,7]]){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
      } else {
        c.strokeStyle=accent;c.globalAlpha=.82;c.lineWidth=5;
        for(const y of [43,67]){c.beginPath();c.moveTo(20,y);for(let x=20;x<150;x+=16)c.quadraticCurveTo(x+8,y-8,x+16,y);c.stroke();}
      }
      c.globalAlpha=.24;c.fillStyle='#ffffff';c.beginPath();c.ellipse(82,82,55,13,0,0,Math.PI*2);c.fill();c.restore();
      const eyeX=stage==='shark'?128:species===1?118:124,eyeY=stage==='shark'?47:46,eyeSize=stage==='minnow'?17:15;
      c.fillStyle='#ffffff';c.strokeStyle='#153950';c.lineWidth=3;c.beginPath();c.ellipse(eyeX,eyeY,eyeSize,eyeSize+2,-.12,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle='#113047';c.beginPath();c.ellipse(eyeX+4,eyeY+1,8,11,0,0,Math.PI*2);c.fill();
      c.fillStyle='#ffffff';c.beginPath();c.arc(eyeX+6,eyeY-4,3.5,0,Math.PI*2);c.fill();
      c.strokeStyle='#733f44';c.lineWidth=2.5;c.beginPath();c.moveTo(stage==='shark'?121:130,69);c.quadraticCurveTo(140,76,149,65);c.stroke();
      if(stage==='shark') {
        c.strokeStyle='#294e62';c.lineWidth=2;for(const x of [103,109,115]){c.beginPath();c.moveTo(x,53);c.lineTo(x-3,67);c.stroke();}
        c.fillStyle='#ffffff';for(const x of [130,138,146]){c.beginPath();c.moveTo(x,69);c.lineTo(x+3,75);c.lineTo(x+6,69);c.fill();}
      }
    }
    texture.refresh();return key;
  }
  function setFishEvolution(e,p) {
    const stage=fishEvolution(p.mass);
    if(e.stage===stage)return;
    const style=FISH_STAGE_STYLE[stage];e.stage=stage;e.tailBase=style.tail;e.finBase=style.fin;e.labelOffset=style.label;
    e.tail.setTexture(fishTexture(p.variant,'tail',stage)).setPosition(style.tailX,0).setScale(style.tail);
    e.body.setTexture(fishTexture(p.variant,'body',stage)).setScale(style.body);
    e.fin.setTexture(fishTexture(p.variant,'fin',stage)).setPosition(style.finX,style.finY).setScale(style.fin);
  }
  function makeFish(p) {
    const stage=fishEvolution(p.mass),style=FISH_STAGE_STYLE[stage];
    const tail=scene.add.image(style.tailX,0,fishTexture(p.variant,'tail',stage)).setOrigin(.9,.5).setScale(style.tail);
    const body=scene.add.image(0,0,fishTexture(p.variant,'body',stage)).setScale(style.body);
    const fin=scene.add.image(style.finX,style.finY,fishTexture(p.variant,'fin',stage)).setOrigin(.68,.28).setScale(style.fin);
    const sprite=scene.add.container(p.x,p.y,[tail,body,fin]);
    const label=scene.add.text(p.x,p.y-style.label,p.name,{font:'bold 15px Arial',color:'#ffffff',stroke:'#052c48',strokeThickness:4}).setOrigin(.5);
    return {sprite,label,tail,body,fin,stage,tailBase:style.tail,finBase:style.fin,labelOffset:style.label,tx:p.x,ty:p.y,scale:Math.pow(p.mass/100,.65),facing:1,phase:p.variant*1.7,swimSpeed:0};
  }
  const bubbles = [];
  let oceanTime=0;
  function planktonTexture(variant) {
    const key=`plankton-${variant}`;
    if(scene.textures.exists(key)) return key;
    const texture=scene.textures.createCanvas(key,48,64), c=texture.context;
    c.strokeStyle='#245b48'; c.lineWidth=2; c.lineCap='round';
    c.beginPath(); c.moveTo(19,25); c.quadraticCurveTo(8,14,12,5); c.moveTo(29,25); c.quadraticCurveTo(40,13,36,4); c.stroke();
    const gradient=c.createLinearGradient(12,20,36,52);
    gradient.addColorStop(0,['#d9fa90','#9df4dd','#ffe599'][variant]); gradient.addColorStop(1,['#58b96a','#39ab91','#e7af48'][variant]);
    c.fillStyle=gradient; c.beginPath(); c.ellipse(24,37,13,20,0,0,Math.PI*2); c.fill(); c.stroke();
    c.fillStyle='#fffde7'; c.beginPath(); c.ellipse(24,30,8,9,0,0,Math.PI*2); c.fill();
    c.fillStyle='#244958'; c.beginPath(); c.arc(26,30,4,0,Math.PI*2); c.fill();
    c.fillStyle='#ffffff'; c.beginPath(); c.arc(27,28,1.5,0,Math.PI*2); c.fill();
    c.beginPath(); c.moveTo(20,44); c.quadraticCurveTo(25,49,29,43); c.stroke();
    texture.refresh(); return key;
  }
  function animateOcean(dt,t) {
    if(!bubbles.length) {
      for(let i=0;i<56;i++) {
        const bubble=scene.add.circle((i*443)%2400,(i*277)%1600,2+i%6,0xc7faff,.035).setStrokeStyle(1,0xd5fcff,.24).setDepth(i%3===0?2:-2);
        bubbles.push({sprite:bubble,x:bubble.x,y:bubble.y,speed:12+i%23,phase:i*2.4});
      }
    }
    for(const b of bubbles) {
      b.y-=b.speed*dt;
      if(b.y < -12) b.y=1612;
      b.sprite.setPosition(b.x+Math.sin(t*.55+b.phase)*15,b.y);
    }
    for(const [id,f] of foods) if(f.visible) {
      const phase=t*1.8+Number(id)*2.3;
      f.rotation=Math.sin(phase)*.16;
      f.setPosition(f.foodX+Math.sin(phase*.7)*2,f.foodY+Math.sin(phase)*3);
      f.setScale(.34*(1+Math.sin(phase)*.035),.34*(1-Math.sin(phase)*.04));
    }
  }
  function renderState() {
    if (!scene) return;
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id); let e = entities.get(p.id);
      if (!e) { e = makeFish(p); entities.set(p.id,e); if (p.id === state.me) scene.cameras.main.startFollow(e.sprite,true,.08,.08); }
      setFishEvolution(e,p);
      if (Math.abs(p.x-e.tx)>1) e.facing=p.x>e.tx?1:-1;
      e.tx=p.x; e.ty=p.y; e.scale=Math.pow(p.mass/100,.65); e.locked=p.locked;
      e.sprite.setAlpha(p.respawning ? .2 : p.protected ? .72 : 1); e.label.setText(p.id === state.me ? 'You' : p.npc ? `${p.name} · ${p.mass}` : p.name).setAlpha(p.respawning ? .3 : 1);
    }
    for (const [id, e] of entities) if (!seen.has(id)) { e.sprite.destroy(); e.label.destroy(); entities.delete(id); }
    const foodSeen = new Set();
    for (const [id, x, y] of state.food) { foodSeen.add(id); let f = foods.get(id); if (!f) { f = scene.add.image(x,y,planktonTexture(id%3)).setScale(.34); foods.set(id,f); } f.foodX=x; f.foodY=y; f.setVisible(true); }
    for (const [id,f] of foods) if (!foodSeen.has(id)) f.setVisible(false);
  }
  function animate() {
    if (!state || !scene) return;
    const dt=state.phase==='paused'||state.phase==='ended'?0:Math.min(50,scene.game.loop.delta)/1000, follow=1-Math.exp(-14*dt);
    oceanTime+=dt*(reducedMotion?.2:1);
    const t=oceanTime;
    animateOcean(dt,t);
    for (const e of entities.values()) {
      const dx=e.tx-e.sprite.x,dy=e.ty-e.sprite.y,speed=Math.min(1,Math.hypot(dx,dy)/16);
      e.sprite.x+=dx*follow; e.sprite.y+=dy*follow;
      e.sprite.scaleY+=(e.scale-e.sprite.scaleY)*(1-Math.exp(-7*dt));
      e.sprite.scaleX+=(e.facing*e.scale-e.sprite.scaleX)*(1-Math.exp(-12*dt));
      e.swimSpeed+=(speed-e.swimSpeed)*(1-Math.exp(-4*dt));
      e.phase=(e.phase+dt*(reducedMotion?.8:e.locked?2.5:4+e.swimSpeed*6))%(Math.PI*2);
      const beat=e.phase;
      e.tail.rotation=Math.sin(beat)*(.10+e.swimSpeed*.19); e.tail.scaleX=e.tailBase*(.94+Math.cos(beat)*.06);
      e.tail.scaleY=e.tailBase*(1+Math.sin(beat+.7)*.04);
      e.fin.rotation=Math.sin(beat-.8)*.19+Math.sin(beat*2-1)*.035;
      e.fin.scaleY=e.finBase*(.94+Math.cos(beat-.8)*.08);
      const tilt=Math.max(-.25,Math.min(.25,dy*.018*e.facing));
      e.sprite.rotation+=(tilt+Math.sin(beat)*.025-e.sprite.rotation)*follow;
      e.label.setPosition(e.sprite.x,e.sprite.y-e.labelOffset*e.sprite.scaleY);
    }
    if (me) scene.cameras.main.setZoom(Math.max(.58, Math.min(1.05, 1.02 - (me.mass-100)/1600)));
  }
  function renderQuestion() {
    const q = state.question;
    if (!q) {
      $('question').hidden = true;
      if (renderedQuestionId) { renderedQuestionId = null; clearInterval(qTimer); unlockAnswers(); $('options').innerHTML = ''; }
      return;
    }
    $('question').hidden = false;
    if (renderedQuestionId === q.id) return;
    renderedQuestionId = q.id; clearInterval(qTimer);
    $('prompt').textContent = q.prompt; $('options').innerHTML = '';
    q.options.forEach((option, choice) => { const b = document.createElement('button'); b.className='option'; b.textContent=option; b.onclick=()=>sendAnswer(q.id,choice); $('options').appendChild(b); });
    const update=()=>{ $('qtime').textContent=`${Math.max(0,Math.ceil((q.expiresAt-Date.now())/1000))} seconds left`; }; update();qTimer=setInterval(update,250);
  }
  function sendAnswer(interactionId,choice) {
    if (!socket || socket.readyState !== WebSocket.OPEN) { toast('Reconnecting. Try that answer again.', false); return; }
    document.querySelectorAll('.option').forEach(x=>x.disabled=true);
    socket.send(JSON.stringify({ type:'answer', interactionId, choice }));
    clearTimeout(answerTimer); answerTimer=setTimeout(()=>{ if(state&&state.question&&state.question.id===interactionId){unlockAnswers();toast('The answer did not reach the ocean. Please tap it again.',false);}},2500);
  }
  function answerAck(message) {
    clearTimeout(answerTimer); answerTimer=null;
    if (!message.accepted && state && state.question && state.question.id === message.interactionId) {
      unlockAnswers(); toast(message.error || 'Please choose your answer again.', false);
    }
  }
  function unlockAnswers(){clearTimeout(answerTimer);answerTimer=null;document.querySelectorAll('.option').forEach(x=>x.disabled=false)}
  function finish() {
    stopMusic();
    show('ended'); const order=[...state.players].sort((a,b)=>b.score-a.score), place=order.findIndex(p=>p.id===state.me)+1;
    $('rank').textContent = place ? `You finished number ${place} of ${order.length}` : 'Adventure complete'; $('finalScore').textContent = `${me.score} points`;
    const p=state.personal||{}; $('learning').textContent = p.answered ? `You answered ${p.correct} of ${p.answered} questions correctly and explored ${p.coverage} different questions.` : 'You collected plankton and practised navigating the ocean.';
  }
  function toast(text, good) { const el=$('toast');el.textContent=text;el.className=`toast show ${good?'good':'bad'}`;setTimeout(()=>el.className='toast',2200); }
  $('soundToggle').onclick = async () => {
    audioSettings.sound = !audioSettings.sound; saveAudioSettings(); updateAudioControls();
    await unlockAudio(); if (audioSettings.sound) playCue('plankton');
  };
  $('musicToggle').onclick = async () => {
    audioSettings.music = !audioSettings.music; saveAudioSettings(); updateAudioControls();
    await unlockAudio(); syncMusic();
  };
  addEventListener('pointerdown', () => unlockAudio(), { once: true });
  addEventListener('keydown', () => unlockAudio(), { once: true });
  document.addEventListener('visibilitychange', syncMusic);
  addEventListener('keydown', e => { if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(e.key)) { keys.add(e.key.toLowerCase()); e.preventDefault(); } });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  const pad=$('touch'), dot=$('touchDot'); function moveTouch(e){const r=pad.getBoundingClientRect(),x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2),l=Math.max(1,Math.hypot(x,y)),m=Math.min(r.width*.32,l);touch={x:x/l,y:y/l};dot.style.transform=`translate(${touch.x*m}px,${touch.y*m}px)`;}
  pad.onpointerdown=e=>{pad.setPointerCapture(e.pointerId);moveTouch(e)};pad.onpointermove=e=>{if(pad.hasPointerCapture(e.pointerId))moveTouch(e)};pad.onpointerup=pad.onpointercancel=()=>{touch={x:0,y:0};dot.style.transform=''};
  setInterval(()=>{if(!socket||socket.readyState!==1||!state||state.phase!=='running'||state.question)return;let x=(keys.has('arrowright')||keys.has('d')?1:0)-(keys.has('arrowleft')||keys.has('a')?1:0),y=(keys.has('arrowdown')||keys.has('s')?1:0)-(keys.has('arrowup')||keys.has('w')?1:0);if(!x&&!y){x=touch.x;y=touch.y}socket.send(JSON.stringify({type:'input',seq:seq++,x,y}));},50);
  setInterval(()=>{if(!state)return;const left=state.endsAt?Math.max(0,state.endsAt-(state.phase==='paused'?state.pausedAt:Date.now())):0;$('time').textContent=state.phase==='lobby'?'Lobby':state.phase==='paused'?'Paused':`${Math.floor(left/60000)}:${String(Math.floor(left/1000)%60).padStart(2,'0')}`;},250);
  updateAudioControls(); load();
})();
