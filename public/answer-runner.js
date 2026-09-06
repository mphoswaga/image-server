(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnswerRunner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GRAVITY = 1200, JUMP_SPEED = 440, SLIDE_TIME = .9, CHECKPOINT_TIME = 25;
  const CHAPTERS = ['River gate', 'Waterfall steps', 'Sun temple'];

  function createState(width = 800, height = 450) {
    return { width, height, ground: height * .79, playerX: Math.min(150, width * .23),
      state: 'run', elapsed: 0, distance: 0, sinceQuestion: 0, checkpoints: 0,
      lift: 0, velocity: 0, slide: 0, jumpBuffer: 0, slideBuffer: 0, invulnerable: 1.5,
      spawnIn: 2.1, coinIn: .6, spawned: 0, obstacles: [], coins: [], streak: 0, collected: 0 };
  }
  function speed(s) { return Math.min(220, 145 + s.elapsed * 1.4) * Math.min(1.6, s.width / 360); }
  function resume(s) {
    s.state = 'run'; s.obstacles = []; s.coins = []; s.spawnIn = 1.8; s.coinIn = .5;
    s.invulnerable = 1.5; s.lift = s.velocity = s.slide = s.jumpBuffer = s.slideBuffer = 0;
    s.sinceQuestion = 0; s.checkpoints++;
  }
  function step(s, seconds, input = {}, random = Math.random) {
    const events = [];
    if (s.state !== 'run' || !Number.isFinite(seconds) || seconds <= 0) return events;
    const dt = Math.min(.05, seconds);
    s.elapsed += dt; s.sinceQuestion += dt;
    s.jumpBuffer = input.jump ? .16 : Math.max(0, s.jumpBuffer - dt);
    s.slideBuffer = input.slide ? .16 : Math.max(0, s.slideBuffer - dt);
    s.slide = Math.max(0, s.slide - dt);
    if (s.lift === 0 && s.jumpBuffer > 0) {
      s.velocity = JUMP_SPEED; s.jumpBuffer = 0; s.slide = 0; events.push({ type: 'jump' });
    } else if (s.lift === 0 && s.slideBuffer > 0) {
      s.slide = SLIDE_TIME; s.slideBuffer = 0;
    }
    if (s.velocity !== 0 || s.lift > 0) {
      s.lift += s.velocity * dt - GRAVITY * dt * dt / 2;
      s.velocity -= GRAVITY * dt;
      if (s.lift <= 0) { s.lift = s.velocity = 0; events.push({ type: 'land' }); }
    }
    s.invulnerable = Math.max(0, s.invulnerable - dt);
    const travel = speed(s) * dt;
    s.distance += travel;
    s.spawnIn -= dt;
    if (s.spawnIn <= 0) {
      const kind = s.spawned < 3 ? ['rock', 'branch', 'rock'][s.spawned] : random() < .45 ? 'branch' : s.elapsed > 25 && random() < .2 ? 'boulder' : 'rock';
      const obstacle = { x: s.width + 60, kind, width: kind === 'branch' ? 68 : kind === 'boulder' ? 44 : 34, height: kind === 'boulder' ? 45 : 34, passed: false };
      s.obstacles.push(obstacle); s.spawned++;
      // A full jump and landing fit between hazards, even at maximum speed.
      s.spawnIn = 1.45 + random() * .55;
      for (let i = 0; i < 3; i++) s.coins.push({ x: obstacle.x - 30 + i * 30, y: s.ground - (kind === 'branch' ? 18 : 102 + (i === 1 ? 9 : 0)), phase: i });
    }
    for (const o of s.obstacles) {
      o.x -= travel;
      const overlap = Math.abs(o.x - s.playerX) < o.width / 2 + 9;
      const bodyHeight = s.slide > 0 ? 25 : 58;
      const hit = o.kind === 'branch' ? s.lift + bodyHeight > 40 && s.lift < 88 : s.lift < o.height - 5;
      if (overlap && hit && s.invulnerable <= 0) {
        s.state = 'question'; s.streak = 0;
        events.push({ type: 'crash' }); return events;
      }
      if (!o.passed && o.x + o.width / 2 < s.playerX - 9) {
        o.passed = true;
        if (s.invulnerable <= 0) events.push({ type: 'score', amount: 2, text: 'Clear! +2', x: s.playerX, y: s.ground - 105 });
      }
    }
    s.obstacles = s.obstacles.filter(o => o.x > -100);
    const coinY = s.ground - s.lift - (s.slide > 0 ? 18 : 37);
    for (const c of s.coins) {
      c.x -= travel;
      if (Math.abs(c.x - s.playerX) < 21 && Math.abs(c.y - coinY) < 31) {
        c.taken = true; s.collected++; s.streak++;
        const bonus = s.streak % 5 === 0;
        events.push({ type: 'coin', amount: bonus ? 3 : 1, text: bonus ? '5-coin streak! +3' : '+1', x: c.x, y: c.y });
      } else if (c.x < s.playerX - 23 && !c.missed) { c.missed = true; s.streak = 0; }
    }
    s.coins = s.coins.filter(c => !c.taken && c.x > -20);
    s.coinIn -= dt;
    if (s.coinIn <= 0) {
      s.coinIn = 3.6;
      if (!s.obstacles.some(o => o.x > s.width - 130)) {
        for (let i = 0; i < 5; i++) s.coins.push({ x: s.width + 40 + i * 27, y: s.ground - 37, phase: i });
      }
    }
    if (s.sinceQuestion >= CHECKPOINT_TIME) {
      s.state = 'question'; events.push({ type: 'checkpoint' });
    }
    return events;
  }

  function create({ canvas, ctx: cx, width: W, height: H, sound, consumeInput, onScore, onQuestion, onStatus }) {
    const background = new Image(), explorer = new Image();
    background.src = '/assets/runner/jungle-ruins.webp';
    explorer.src = '/assets/runner/explorer.webp';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let s, particles = [], pops = [], statusIn = 0, dustIn = 0;
    const ready = img => img.complete && img.naturalWidth > 0;
    function init() { s = createState(W, H); particles = []; pops = []; statusIn = 0; consumeInput(); }
    function report() {
      canvas.dataset.runnerState = s.state;
      canvas.dataset.runnerAction = s.lift > 0 ? 'jump' : s.slide > 0 ? 'slide' : 'run';
      onStatus({ chapter: CHAPTERS[s.checkpoints % CHAPTERS.length], distance: Math.floor(s.distance / 10), coins: s.collected, progress: s.sinceQuestion / CHECKPOINT_TIME, paused: s.state === 'paused' });
    }
    function burst(x, y, color, count = 6) {
      if (reducedMotion) return;
      for (let i = 0; i < count; i++) particles.push({ x, y, vx: (Math.random() - .5) * 90, vy: -30 - Math.random() * 45, life: .5, color });
      particles = particles.slice(-90);
    }
    function update(dt) {
      if (s.state === 'paused') { consumeInput(); return; }
      for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 130 * dt; }
      particles = particles.filter(p => p.life > 0);
      for (const p of pops) p.life -= dt;
      pops = pops.filter(p => p.life > 0);
      const events = step(s, dt, consumeInput());
      for (const e of events) {
        if (e.type === 'jump') sound.jump();
        if (e.type === 'land') burst(s.playerX, s.ground, '#b9c9be');
        if (e.type === 'coin' || e.type === 'score') {
          onScore(e.amount); pops.push({ ...e, life: .9 });
          if (e.type === 'coin') { sound.coin(); burst(e.x, e.y, '#ffdc61'); }
        }
        if (e.type === 'crash' || e.type === 'checkpoint') onQuestion(e.type === 'checkpoint');
      }
      if (s.state === 'run' && s.lift === 0) {
        dustIn -= dt; if (dustIn <= 0) { dustIn = .14; burst(s.playerX - 17, s.ground, '#bfd2c1', 1); }
      }
      statusIn -= dt; if (statusIn <= 0) { statusIn = .1; report(); }
    }
    function imageTile(img, x, y, w, h, mirror, source) {
      cx.save(); cx.translate(x + (mirror ? w : 0), y); if (mirror) cx.scale(-1, 1);
      cx.drawImage(img, 0, source.y, img.naturalWidth, source.h, 0, 0, w, h); cx.restore();
    }
    function scenery() {
      cx.fillStyle = '#98d6d9'; cx.fillRect(0, 0, W, H);
      if (ready(background)) {
        const sourceH = background.naturalHeight * .746;
        const tileW = s.ground * background.naturalWidth / sourceH;
        const offset = s.distance * .12;
        const first = Math.floor(offset / tileW);
        for (let i = first; i <= first + Math.ceil(W / tileW) + 1; i++) imageTile(background, i * tileW - offset, 0, tileW, s.ground, i % 2 !== 0, { y: 0, h: sourceH });
        const groundW = 570, groundOffset = s.distance;
        const start = Math.floor(groundOffset / groundW);
        for (let i = start; i <= start + Math.ceil(W / groundW) + 1; i++) imageTile(background, i * groundW - groundOffset, s.ground, groundW, H - s.ground, i % 2 !== 0, { y: sourceH, h: background.naturalHeight - sourceH });
      } else {
        cx.fillStyle = '#3c8766'; cx.fillRect(0, s.ground - 20, W, H);
        cx.fillStyle = '#c7d2c8'; cx.fillRect(0, s.ground, W, 12);
      }
      if (!reducedMotion) {
        for (let i = 0; i < 9; i++) {
          const x = (W + i * 101 - s.distance * .22 % (W + 60)) % (W + 60);
          const y = 55 + i * 23 + Math.sin(s.elapsed * .8 + i) * 10;
          cx.save(); cx.translate(x, y); cx.rotate(Math.sin(s.elapsed + i));
          cx.fillStyle = i % 3 ? 'rgba(142,213,139,.6)' : 'rgba(255,224,135,.65)';
          cx.beginPath(); cx.ellipse(0, 0, 4, 1.5, 0, 0, Math.PI * 2); cx.fill(); cx.restore();
        }
      }
    }
    function obstacle(o) {
      cx.save(); cx.translate(o.x, s.ground);
      if (o.kind === 'branch') {
        cx.strokeStyle = '#366044'; cx.lineWidth = 4;
        for (const x of [-25, 25]) { cx.beginPath(); cx.moveTo(x, -88); cx.bezierCurveTo(x + 8, -150, x - 12, -190, x, -H); cx.stroke(); }
        cx.fillStyle = '#5d433a'; cx.strokeStyle = '#302f2d'; cx.lineWidth = 2;
        cx.beginPath(); cx.roundRect(-36, -88, 72, 46, 9); cx.fill(); cx.stroke();
        cx.fillStyle = '#4f9652'; cx.fillRect(-31, -88, 62, 7);
        cx.strokeStyle = '#ba9966'; cx.lineWidth = 2;
        for (let i = -24; i < 30; i += 15) { cx.beginPath(); cx.moveTo(i, -76); cx.lineTo(i + 6, -56); cx.stroke(); }
      } else {
        const r = o.width / 2;
        cx.translate(0, -o.height / 2);
        if (o.kind === 'boulder') cx.rotate(-s.distance / r);
        cx.fillStyle = '#687e89'; cx.strokeStyle = '#334d58'; cx.lineWidth = 2;
        cx.beginPath(); cx.moveTo(-r, 9); cx.lineTo(-r * .8, -15); cx.lineTo(-3, -o.height / 2); cx.lineTo(r, -10); cx.lineTo(r, 13); cx.lineTo(0, o.height / 2); cx.closePath(); cx.fill(); cx.stroke();
        cx.fillStyle = '#afc4c6'; cx.beginPath(); cx.moveTo(-r * .8, -15); cx.lineTo(-3, -o.height / 2); cx.lineTo(r, -10); cx.lineTo(0, 0); cx.closePath(); cx.fill();
        cx.fillStyle = '#6eab67'; cx.fillRect(-r + 5, -12, 14, 4);
      }
      cx.restore();
      if (o.x > s.playerX && o.x < W - 20) {
        const y = s.ground - (o.kind === 'branch' ? 115 : 72);
        cx.fillStyle = '#123e47'; cx.beginPath(); cx.roundRect(o.x - 23, y - 10, 46, 18, 4); cx.fill();
        cx.fillStyle = '#fff3ba'; cx.font = 'bold 9px Arial'; cx.textAlign = 'center'; cx.fillText(o.kind === 'branch' ? 'SLIDE' : 'JUMP', o.x, y + 2);
      }
    }
    function player() {
      const x = s.playerX, y = s.ground - s.lift;
      cx.fillStyle = 'rgba(14,42,40,.23)'; cx.beginPath(); cx.ellipse(x, s.ground + 3, 22 - s.lift * .1, 5, 0, 0, Math.PI * 2); cx.fill();
      if (s.invulnerable > 0) {
        cx.strokeStyle = 'rgba(144,245,231,.8)'; cx.lineWidth = 2;
        cx.beginPath(); cx.ellipse(x, y - 38, 34, 46, 0, 0, Math.PI * 2); cx.stroke();
      }
      if (ready(explorer)) {
        const index = s.lift > 0 ? 4 : s.slide > 0 ? 5 : [0, 1, 2, 3][Math.floor(s.elapsed * 10) % 4];
        const fw = explorer.naturalWidth / 3, fh = explorer.naturalHeight / 2;
        const bob = s.lift === 0 && s.slide <= 0 ? Math.sin(s.elapsed * 20) * 1.2 : 0;
        const drawHeight = s.slide > 0 && s.lift === 0 ? 48 : 88;
        cx.drawImage(explorer, index % 3 * fw, Math.floor(index / 3) * fh, fw, fh, x - 44, y - drawHeight + 3 + bob, 88, drawHeight);
      } else {
        // The runner stays visible and playable if an image cannot load.
        cx.fillStyle = '#19aeb1'; cx.fillRect(x - 12, y - (s.slide > 0 ? 25 : 48), 25, s.slide > 0 ? 20 : 34);
        cx.fillStyle = '#cf8d5b'; cx.beginPath(); cx.arc(x + 5, y - (s.slide > 0 ? 30 : 60), 12, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = '#233647'; cx.fillRect(x - 13, y - 13, 12, 13); cx.fillRect(x + 4, y - 13, 12, 13);
      }
    }
    function render() {
      cx.save(); cx.imageSmoothingEnabled = true;
      scenery();
      for (const c of s.coins) {
        const spin = Math.max(.25, Math.abs(Math.cos(s.elapsed * 5 + c.phase)));
        cx.fillStyle = '#bf780c'; cx.beginPath(); cx.ellipse(c.x, c.y, 8 * spin, 9, 0, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = '#ffe16b'; cx.beginPath(); cx.ellipse(c.x, c.y - 1, 6 * spin, 7, 0, 0, Math.PI * 2); cx.fill();
      }
      s.obstacles.forEach(obstacle); player();
      for (const p of particles) { cx.globalAlpha = Math.max(0, p.life * 2); cx.fillStyle = p.color; cx.fillRect(p.x, p.y, 3, 3); }
      cx.globalAlpha = 1;
      for (const p of pops) {
        cx.globalAlpha = Math.min(1, p.life * 2); cx.font = 'bold 14px Arial'; cx.textAlign = 'center';
        const x = Math.max(75, Math.min(W - 75, p.x)), y = p.y - (1 - p.life) * 30;
        cx.lineWidth = 4; cx.strokeStyle = '#173e49'; cx.strokeText(p.text, x, y); cx.fillStyle = '#ffed91'; cx.fillText(p.text, x, y);
      }
      cx.globalAlpha = 1;
      if (s.state === 'paused') {
        cx.fillStyle = 'rgba(12,44,51,.6)'; cx.fillRect(0, 0, W, H);
        cx.textAlign = 'center'; cx.fillStyle = '#ffffff'; cx.font = 'bold 28px Arial'; cx.fillText('Trail paused', W / 2, H / 2);
      }
      cx.restore();
    }
    return { init, update, render,
      resume() { resume(s); consumeInput(); report(); },
      pause() { if (s.state === 'run') { s.state = 'paused'; sound.stopMusic(); consumeInput(); report(); } },
      togglePause() { if (s.state === 'paused') { s.state = 'run'; sound.startMusic(); consumeInput(); report(); } else this.pause(); },
    };
  }
  return { createState, speed, step, resume, create, CHECKPOINT_TIME };
});
