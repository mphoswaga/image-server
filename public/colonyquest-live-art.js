/* Local-only colony animation: server packets contain resources, never positions. */
(function () {
  'use strict';
  const load = (name) => {
    const img = new Image();
    img.src = '/assets/colonyquest/' + name + '.webp';
    return img;
  };
  const meadow = load('moonroot-meadow'),
    dry = load('moonroot-dry-season'),
    ant = load('pip-worker'),
    queen = load('queen'),
    guard = load('guardian');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.ColonyScene = class {
    constructor(canvas, overview = false) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.overview = overview;
      this.state = null;
      this.clock = 0;
      this.last = performance.now();
      this.dryFade = 0;
      this.raf = requestAnimationFrame((t) => this.draw(t));
    }
    update(state) {
      this.state = state;
    }
    sprite(img, x, y, size, flip = false) {
      if (!img.complete || !img.naturalWidth) return;
      const c = this.ctx;
      c.save();
      c.translate(x, y);
      if (flip) c.scale(-1, 1);
      const r = img.naturalHeight / img.naturalWidth;
      c.drawImage(img, -size / 2, (-size * r) / 2, size, size * r);
      c.restore();
    }
    cover(img, w, h, alpha = 1) {
      if (!img.complete || !img.naturalWidth) return;
      const c = this.ctx,
        scale = Math.max(w / img.width, h / img.height);
      c.globalAlpha = alpha;
      c.drawImage(
        img,
        (w - img.width * scale) / 2,
        (h - img.height * scale) / 2,
        img.width * scale,
        img.height * scale,
      );
      c.globalAlpha = 1;
    }
    draw(t) {
      const canvas = this.canvas,
        c = this.ctx,
        dpr = Math.min(devicePixelRatio || 1, 1.5),
        w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!w || !h) {
        this.last = t;
        this.raf = requestAnimationFrame((t) => this.draw(t));
        return;
      }
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dt = Math.min(50, t - this.last);
      this.last = t;
      const state = this.state,
        live =
          state && !['paused', 'ended'].includes(state.phase) && !document.body.classList.contains('offline');
      if (live && !reduced && !document.hidden) this.clock += dt;
      const secs = this.clock / 1000,
        world = state?.world || {},
        isDry = world.dryOccurred && !world.rainOccurred;
      this.dryFade += (Number(isDry) - this.dryFade) * 0.035;
      c.fillStyle = '#8ac98a';
      c.fillRect(0, 0, w, h);
      this.cover(meadow, w, h);
      this.cover(dry, w, h, this.dryFade);
      if (this.overview) {
        c.fillStyle = '#1c49342b';
        c.fillRect(0, 0, w, h);
        for (let i = 0; i < 12; i++)
          this.sprite(ant, ((secs * 20 + (i * w) / 12) % (w + 60)) - 30, h * 0.8 + Math.sin(i * 2) * 30, 32);
      } else {
        const colony = state?.me?.colony || { workers: 1, territory: 1, food: 8, eggs: [] };
        const surface = h * 0.44;
        const earth = c.createLinearGradient(0, surface, 0, h);
        earth.addColorStop(0, '#694c30');
        earth.addColorStop(1, '#302a23');
        c.fillStyle = earth;
        c.beginPath();
        c.moveTo(0, surface);
        for (let x = 0; x <= w + 10; x += 10) c.lineTo(x, surface + Math.sin(x * 0.019) * 8);
        c.lineTo(w, h);
        c.lineTo(0, h);
        c.fill();
        for (let i = 0; i < 28; i++) {
          c.fillStyle = i % 2 ? '#aa805025' : '#221d1940';
          c.beginPath();
          c.arc((i * 97) % w, surface + ((i * 43) % Math.max(1, h - surface)), 2 + (i % 4), 0, Math.PI * 2);
          c.fill();
        }
        const rooms = Math.min(7, colony.territory || 1);
        c.lineCap = 'round';
        c.strokeStyle = '#bf9865';
        c.lineWidth = 25;
        c.beginPath();
        c.moveTo(w * 0.5, surface);
        c.lineTo(w * 0.5, h * 0.63);
        c.stroke();
        for (let i = 0; i < rooms; i++) {
          const positions = [
            [0.5, 0.64],
            [0.2, 0.62],
            [0.8, 0.62],
            [0.2, 0.82],
            [0.5, 0.85],
            [0.8, 0.82],
            [0.5, 0.94],
          ];
          const x = w * positions[i][0],
            y = h * positions[i][1],
            rw = Math.min(67, w * 0.13),
            rh = Math.min(35, h * 0.065);
          c.beginPath();
          c.moveTo(w * 0.5, h * 0.62);
          c.lineTo(x, y);
          c.stroke();
          c.fillStyle = '#cda76c';
          c.beginPath();
          c.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = '#493723';
          c.lineWidth = 3;
          c.stroke();
          c.strokeStyle = '#bf9865';
          c.lineWidth = 25;
          if (i === 0) this.sprite(queen, x, y, Math.min(80, w * 0.15));
          else if (i === 1) {
            for (let f = 0; f < Math.min(12, colony.food || 0); f++) {
              c.fillStyle = f % 2 ? '#efc753' : '#a5be61';
              c.beginPath();
              c.ellipse(x - 25 + (f % 6) * 9, y + Math.floor(f / 6) * 8, 5, 3, 0.5, 0, 7);
              c.fill();
            }
          } else if (i === 2) this.sprite(guard, x, y, 43);
        }
        const workers = Math.min(18, colony.workers || 1);
        for (let i = 0; i < workers; i++) {
          const phase = (secs / (colony.dryShortfall ? 18 : 12) + i * 0.173) % 1,
            walk = (1 - Math.cos(phase * Math.PI * 2)) / 2;
          const x = w * 0.5 + w * 0.42 * (i % 2 ? 1 : -1) * walk,
            y = surface - 19 + Math.sin(phase * Math.PI * 4 + i) * 5;
          this.sprite(ant, x, y, Math.min(61, w * 0.11), i % 2 ? phase > 0.5 : phase < 0.5);
          if (phase > 0.5) {
            c.fillStyle = i % 3 === 0 ? '#eacb5b' : '#a9d669';
            c.beginPath();
            c.ellipse(x, y - 17, 7, 3, -0.4, 0, 7);
            c.fill();
          }
        }
        for (let i = 0; i < Math.min(6, colony.soldiers || 0); i++)
          this.sprite(guard, w * 0.38 + i * 25 + Math.sin(secs + i) * 8, surface - 12, 44, i % 2 === 0);
        if (colony.defense) {
          c.strokeStyle = '#b8bfa3';
          c.lineWidth = 4 + colony.defense;
          c.beginPath();
          c.arc(w * 0.5, surface + 5, 23 + colony.defense * 5, Math.PI, 0);
          c.stroke();
        }
        const raid = state?.events?.findLast(
          (e) => e.kind === 'raid' && (e.attacker === state.me?.id || e.target === state.me?.id),
        );
        if (raid && Date.now() - raid.at < 6000) {
          const progress = (Date.now() - raid.at) / 6000;
          c.fillStyle = '#ffe398';
          c.font = 'bold 17px system-ui';
          c.textAlign = 'center';
          c.fillText(
            raid.success ? 'RAID • FOOD ON THE MOVE' : 'GUARDS HOLD THE ENTRANCE',
            w / 2,
            surface - 70,
          );
          for (let i = 0; i < 4; i++) this.sprite(guard, w * progress - i * 22, surface - 35, 46);
        }
      }
      if (world.birdStage === 'rain') {
        c.strokeStyle = '#e0f7ffa0';
        c.lineWidth = 2;
        for (let i = 0; i < 30; i++) {
          const x = (i * 61 + secs * 60) % w,
            y = (i * 47 + secs * 160) % h;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x - 9, y + 23);
          c.stroke();
        }
      }
      if (['warning', 'attack'].includes(world.birdStage)) {
        c.strokeStyle = '#23342be0';
        c.lineWidth = 4;
        for (let i = 0; i < 3; i++) {
          const x = ((secs * 40 + (i * w) / 3) % (w + 100)) - 50,
            y = h * 0.15 + Math.sin(secs + i) * 15;
          c.beginPath();
          c.moveTo(x - 15, y + Math.sin(secs * 6) * 8);
          c.quadraticCurveTo(x - 6, y - 8, x, y);
          c.quadraticCurveTo(x + 6, y - 8, x + 15, y + Math.sin(secs * 6) * 8);
          c.stroke();
        }
      }
      this.raf = requestAnimationFrame((time) => this.draw(time));
    }
  };
})();
