/* Multiplayer artwork. All choreography is local; only earned game state comes from the server. */
(function () {
  'use strict';
  const load = (name) => {
    const image = new Image();
    image.src = '/assets/colonyquest/' + name + '.webp';
    return image;
  };
  const art = {
    meadow: load('moonroot-meadow'),
    dry: load('moonroot-dry-season'),
    soil: load('living-underground'),
    chamber: load('living-chamber'),
    queen: load('queen'),
    worker: load('pip-worker'),
    guard: load('guardian'),
    bird: load('meadow-bird-atlas'),
    spider: load('meadow-spider-atlas'),
  };
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const random = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const ellipse = (c, x, y, rx, ry, fill, stroke, width = 1) => {
    c.beginPath();
    c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.stroke();
    }
  };
  const labels = {
    workers: 'A new worker joins!',
    food: 'Food delivery!',
    supplies: 'Building supplies arrive!',
    expansion: 'Digging a new room!',
    defense: 'Reinforcing the entrance!',
    soldiers: 'Guard reporting for duty!',
    queen: 'An egg for the nursery!',
    hatch: 'A baby worker has hatched!',
  };

  window.ColonyScene = class {
    constructor(canvas, overview = false) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.overview = overview;
      this.state = null;
      this.clock = 0;
      this.last = performance.now();
      this.receivedAt = 0;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.effects = [];
      this.seen = new Set();
      this.roomBirths = new Map();
      this.workers = [];
      this.dryFade = 0;
      this.frameCount = 0;
      this.stopped = false;
      this.raf = requestAnimationFrame((t) => this.draw(t));
    }
    destroy() {
      this.stopped = true;
      cancelAnimationFrame(this.raf);
    }
    cue(kind, extra = {}) {
      this.effects.push({ kind, start: this.clock, duration: kind === 'raid' ? 6200 : 4800, ...extra });
      this.effects = this.effects.slice(-8);
      this.canvas.dataset.action = kind;
      if (labels[kind]) this.canvas.dispatchEvent(new CustomEvent('colony-action', { detail: labels[kind] }));
    }
    update(state) {
      const old = this.state,
        own = state?.me?.colony;
      if (old?.id !== state?.id) {
        this.effects = [];
        this.seen.clear();
        this.roomBirths.clear();
        this.clock = 0;
        this.dryFade = Number(!!state?.world?.dryOccurred && !state?.world?.rainOccurred);
      }
      if (old?.id === state?.id && own && old?.me?.colony) {
        const before = old.me.colony;
        for (const [key, icon] of [
          ['food', '🌾'],
          ['sticks', '🪵'],
          ['leaves', '🍃'],
        ]) {
          const gain = (own[key] || 0) - (before[key] || 0);
          if (gain > 0)
            this.effects.push({
              kind: 'income',
              key,
              text: '+' + gain + ' ' + icon,
              start: this.clock,
              duration: 1800,
            });
        }
        this.effects = this.effects.slice(-12);
        const u = state.me.lastUpgrade;
        const previous = old.me.lastUpgrade;
        if (
          u &&
          u.key !== 'raid' &&
          (!previous || `${u.round}:${u.key}` !== `${previous.round}:${previous.key}`)
        )
          this.cue(u.key);
        if ((own.eggs?.length || 0) < (before.eggs?.length || 0) && own.workers > before.workers)
          this.cue('hatch');
        const oldTrips = (before.forageTrips || []).reduce((a, b) => a + b, 0);
        const trips = (own.forageTrips || []).reduce((a, b) => a + b, 0);
        if (trips > oldTrips) this.cue('delivery', { count: trips - oldTrips, duration: 1800 });
        for (const room of this.rooms(own)) {
          if (!this.rooms(before).some((r) => r.id === room.id)) this.roomBirths.set(room.id, this.clock);
        }
        for (const event of state.events || []) {
          if (this.seen.has(event.id)) continue;
          this.seen.add(event.id);
          if (event.kind === 'raid' && (event.attacker === state.me.id || event.target === state.me.id))
            this.cue('raid', { event });
        }
      } else {
        for (const event of state?.events || []) this.seen.add(event.id);
      }
      // Keep deduplication bounded, even through a long classroom session.
      if (this.seen.size > 120) this.seen = new Set([...this.seen].slice(-60));
      this.state = state;
      this.receivedAt = this.clock;
    }
    rooms(colony) {
      return window.ColonyQuestCore.colonyRooms(colony);
    }
    sprite(image, x, y, size) {
      if (!image.complete || !image.naturalWidth) return;
      const ratio = image.naturalHeight / image.naturalWidth;
      this.ctx.drawImage(image, x - size / 2, y - (size * ratio) / 2, size, size * ratio);
    }
    creature(kind, x, y, size, seconds, right = false) {
      const image = art[kind];
      if (!image?.complete || !image.naturalWidth) return;
      const frame = this.reduced ? 0 : Math.floor(seconds * 6) % 2;
      const cell = image.naturalWidth / 2;
      const c = this.ctx;
      c.save();
      c.translate(x, y);
      c.scale(right ? -1 : 1, 1);
      c.drawImage(image, frame * cell, 0, cell, image.naturalHeight, -size / 2, -size / 2, size, size);
      c.restore();
      this.canvas.dataset[kind + 'Artwork'] = 'ready';
    }
    cover(image, x, y, w, h, alpha = 1) {
      if (!image.complete || !image.naturalWidth) return;
      const c = this.ctx,
        s = Math.max(w / image.width, h / image.height);
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
      c.globalAlpha = alpha;
      c.drawImage(
        image,
        x + (w - image.width * s) / 2,
        y + (h - image.height * s) / 2,
        image.width * s,
        image.height * s,
      );
      c.restore();
    }
    background(w, h, surface) {
      const c = this.ctx;
      c.fillStyle = '#49613c';
      c.fillRect(0, 0, w, h);
      // Crop the surface painting to its above-ground section, instead of allowing it to dwarf the nest.
      for (const [image, alpha] of [
        [art.meadow, 1],
        [art.dry, this.dryFade],
      ]) {
        if (!image.complete || !image.naturalWidth) continue;
        c.globalAlpha = alpha;
        c.drawImage(image, 0, 0, image.width, image.height * 0.5, 0, 0, w, surface + 12);
      }
      c.globalAlpha = 1;
      const earth = c.createLinearGradient(0, surface, 0, h);
      earth.addColorStop(0, '#84532d');
      earth.addColorStop(0.5, '#4a3027');
      earth.addColorStop(1, '#211c27');
      c.fillStyle = earth;
      c.fillRect(0, surface, w, h - surface);
      this.cover(art.soil, 0, surface, w, h - surface, 0.86);
      // Cached static decoration avoids painting hundreds of rocks on every animation frame.
      const cacheKey = `${Math.round(w)}:${Math.round(h)}`;
      if (this.cacheKey !== cacheKey) {
        this.cacheKey = cacheKey;
        this.soilLayer = document.createElement('canvas');
        this.soilLayer.width = Math.ceil(w);
        this.soilLayer.height = Math.ceil(h);
        const s = this.soilLayer.getContext('2d');
        for (let i = 0; i < 55; i++) {
          const x = random(i) * w,
            y = surface + random(i + 87) * (h - surface);
          ellipse(s, x, y, 2 + random(i + 20) * 8, 1 + random(i + 5) * 4, i % 3 ? '#b4845030' : '#13191d40');
        }
        s.strokeStyle = '#b28a5670';
        s.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          const x = ((i + 0.2) * w) / 6;
          s.beginPath();
          s.moveTo(x, surface);
          s.bezierCurveTo(x - 22, surface + 30, x + 37, surface + 53, x + 10, surface + 100);
          s.stroke();
        }
        s.strokeStyle = '#301e1a';
        s.lineWidth = 10;
        s.beginPath();
        s.moveTo(0, surface + 3);
        for (let x = 0; x <= w + 8; x += 8) s.lineTo(x, surface + Math.sin(x / 24) * 3);
        s.stroke();
      }
      c.drawImage(this.soilLayer, 0, 0);
      // Quiet drifting pollen and fireflies give depth without obscuring answers.
      for (let i = 0; i < 10; i++) {
        const x = (random(i + 13) * w + this.clock * 0.006) % w;
        const y = 50 + random(i + 31) * Math.max(1, surface - 65) + Math.sin(this.clock / 2000 + i) * 5;
        ellipse(
          c,
          x,
          y,
          1.8,
          1.8,
          `rgba(255,233,156,${0.2 + (0.3 * (1 + Math.sin(this.clock / 900 + i))) / 2})`,
        );
      }
    }
    layout(w, h, colony) {
      const surface = Math.max(h < 350 ? 46 : 90, h * 0.25);
      const bottom = h < 350 ? 30 : 70;
      const depth = Math.max(100, h - surface - bottom);
      const definitions = this.rooms(colony);
      const slots = [
        [0.5, 0.3],
        [0.22, 0.55],
        [0.78, 0.55],
        [0.19, 0.18],
        [0.81, 0.18],
        [0.35, 0.82],
        [0.72, 0.82],
      ];
      const rooms = definitions.slice(0, 19).map((room, i) => {
        let p = slots[i];
        if (definitions.length > 7) {
          const rows = Math.ceil(definitions.length / 3);
          p =
            i === 0
              ? [0.5, 0.14]
              : [0.16 + ((i - 1) % 3) * 0.34, 0.3 + Math.floor((i - 1) / 3) * (0.6 / Math.max(1, rows - 1))];
        }
        const crowded = definitions.length > 7;
        return {
          ...room,
          x: w * p[0],
          y: surface + depth * p[1],
          rx: Math.min(
            w * (i === 0 && !crowded ? 0.205 : 0.145),
            depth * (crowded ? 0.065 : i === 0 ? 0.125 : 0.102) * 2.3,
          ),
          ry: depth * (crowded ? 0.065 : i === 0 ? 0.125 : 0.102),
        };
      });
      return {
        w,
        h,
        surface,
        depth,
        rooms,
        home: rooms[0],
        pantry: rooms.find((r) => r.kind === 'food') || rooms[0],
        size: clamp(Math.min(w / 15, depth / 5), 19, 64),
      };
    }
    tunnel(path, width, progress = 1) {
      const c = this.ctx;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const [extra, color] of [
        [12, '#342019'],
        [7, '#805734'],
        [0, '#b18654'],
        [-7, '#c39d65'],
      ]) {
        c.strokeStyle = color;
        c.lineWidth = Math.max(2, width + extra);
        c.beginPath();
        c.moveTo(path[0][0], path[0][1]);
        const steps = 25;
        for (let i = 1; i <= steps; i++) {
          const p = this.pathPoint(path, (i / steps) * progress);
          c.lineTo(p.x, p.y);
        }
        c.stroke();
      }
      if (art.soil.complete && art.soil.naturalWidth) {
        this.tunnelGrain ||= c.createPattern(art.soil, 'repeat');
        c.save();
        c.globalAlpha = 0.3;
        c.strokeStyle = this.tunnelGrain;
        c.lineWidth = Math.max(3, width - 3);
        c.stroke();
        c.restore();
      }
    }
    pathPoint(path, amount) {
      const distances = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
      let left = clamp(amount, 0, 1) * distances.reduce((a, b) => a + b, 0);
      for (let i = 0; i < distances.length; i++) {
        if (left <= distances[i] || i === distances.length - 1) {
          const t = distances[i] ? left / distances[i] : 0;
          return {
            x: mix(path[i][0], path[i + 1][0], t),
            y: mix(path[i][1], path[i + 1][1], t),
            angle: Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0]),
          };
        }
        left -= distances[i];
      }
      return { x: path[0][0], y: path[0][1], angle: 0 };
    }
    leaf(x, y, size, angle = -0.45) {
      const c = this.ctx;
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.fillStyle = '#8bb44b';
      c.strokeStyle = '#d6e888';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(-size, 0);
      c.quadraticCurveTo(0, -size, size, 0);
      c.quadraticCurveTo(0, size, -size, 0);
      c.fill();
      c.stroke();
      c.strokeStyle = '#496e30';
      c.beginPath();
      c.moveTo(-size, 0);
      c.lineTo(size, 0);
      c.stroke();
      c.restore();
    }
    cargo(x, y, type, size = 7) {
      const c = this.ctx;
      if (type === 'leaf') return this.leaf(x, y, size);
      if (type === 'stick') {
        c.strokeStyle = '#6a3b23';
        c.lineWidth = size * 0.55;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x - size, y + size * 0.3);
        c.lineTo(x + size, y - size * 0.3);
        c.stroke();
        c.strokeStyle = '#e1b77b';
        c.lineWidth = 1.5;
        c.stroke();
      } else {
        ellipse(c, x, y, size * 0.85, size * 0.6, '#efc058', '#986136', 1);
        c.strokeStyle = '#fff0aa';
        c.beginPath();
        c.moveTo(x - size * 0.3, y);
        c.lineTo(x + size * 0.3, y - size * 0.25);
        c.stroke();
      }
    }
    room(room, colony, age, g) {
      const c = this.ctx,
        build = age < 2200 ? smooth(age / 2200) : 1;
      const { x, y, rx, ry } = room;
      c.save();
      c.translate(x, y);
      c.scale(Math.max(0.02, build), Math.max(0.02, build));
      if (art.chamber.complete && art.chamber.naturalWidth) {
        c.drawImage(art.chamber, -rx * 1.08, -ry * 1.25, rx * 2.16, ry * 2.5);
      } else {
        ellipse(c, 0, 3, rx + 6, ry + 7, '#211612');
        ellipse(c, 0, 0, rx + 3, ry + 3, '#af7742', '#dbaf66', 2);
        const light = c.createRadialGradient(-rx * 0.18, -ry * 0.25, 1, 0, 0, rx);
        light.addColorStop(0, '#fbe3a1');
        light.addColorStop(0.5, '#d5b170');
        light.addColorStop(1, '#8b5e39');
        ellipse(c, 0, 0, rx - 3, ry - 2, light, '#664529', 2);
        ellipse(c, 0, ry * 0.46, rx * 0.8, ry * 0.25, '#90633840');
        // Root arches and warm mushroom lamps give each earned room a furnished interior.
        c.strokeStyle = '#8c633b';
        c.lineWidth = 2;
        for (let k = -1; k <= 1; k += 2) {
          c.beginPath();
          c.moveTo(k * rx * 0.75, ry * 0.38);
          c.quadraticCurveTo(k * rx * 0.9, -ry * 0.6, k * rx * 0.37, -ry * 0.76);
          c.stroke();
          this.mushroom(k * rx * 0.72, ry * 0.28, Math.min(12, ry * 0.35), '#bd7443');
        }
      }
      if (room.kind === 'nursery') {
        for (let i = 0; i < Math.min(9, colony.food || 0); i++)
          this.cargo(-rx * 0.58 + (i % 3) * 9, ry * 0.25 - Math.floor(i / 3) * 6, 'seed', 5);
        for (let i = 0; i < (colony.eggs || []).length; i++) {
          const ex = rx * 0.34 + i * 8;
          this.leaf(ex, ry * 0.3, 9, 0.15);
          ellipse(
            c,
            ex,
            ry * 0.13 + Math.sin(this.clock / 650 + i) * (this.reduced ? 0 : 1),
            5,
            7,
            '#fff1ce',
            '#b0a075',
          );
        }
        this.sprite(
          art.queen,
          0,
          ry * 0.02 + (this.reduced ? 0 : Math.sin(this.clock / 900) * 1.3),
          Math.min(rx * 0.88, ry * 2.3),
        );
      } else if (room.kind === 'food') {
        for (let i = 0; i < Math.min(22, colony.food || 0); i++)
          this.cargo(
            -rx * 0.5 + (i % 6) * rx * 0.16,
            ry * 0.3 - Math.floor(i / 6) * ry * 0.23,
            'seed',
            Math.min(7, ry * 0.18),
          );
        this.leaf(rx * 0.35, -ry * 0.32, Math.min(14, rx * 0.2));
      } else if (room.kind === 'guard') {
        for (let i = -1; i <= 1; i++) {
          c.fillStyle = '#596f77';
          c.beginPath();
          c.moveTo(i * rx * 0.3 - 7, -ry * 0.38);
          c.lineTo(i * rx * 0.3 + 7, -ry * 0.38);
          c.lineTo(i * rx * 0.3 + 6, ry * 0.04);
          c.lineTo(i * rx * 0.3, ry * 0.28);
          c.lineTo(i * rx * 0.3 - 6, ry * 0.04);
          c.fill();
          c.fillStyle = '#ffd986';
          c.fillRect(i * rx * 0.3 - 1, -ry * 0.3, 2, ry * 0.35);
        }
      } else if (room.label.includes('Seed')) {
        for (let i = 0; i < Math.min(18, colony.food || 0); i++)
          this.cargo(
            -rx * 0.48 + (i % 6) * rx * 0.19,
            ry * 0.3 - Math.floor(i / 6) * ry * 0.24,
            'seed',
            Math.min(9, ry * 0.22),
          );
      } else if (room.label.includes('Workshop')) {
        for (let i = 0; i < 5; i++) this.cargo(-rx * 0.3 + i * 10, ry * 0.2, i % 2 ? 'leaf' : 'stick', 9);
      } else if (room.label.includes('Water')) {
        ellipse(c, 0, ry * 0.2, rx * 0.48, ry * 0.35, '#66a8b0', '#b4e4df', 2);
        ellipse(
          c,
          0,
          ry * 0.2,
          rx * (0.2 + (Math.sin(this.clock / 900) + 1) * 0.1),
          ry * 0.12,
          null,
          '#c5f4e088',
        );
      } else {
        for (let i = 0; i < 3; i++)
          this.mushroom(
            (i - 1) * rx * 0.37,
            ry * 0.3,
            Math.min(18, ry * 0.65),
            ['#db8d58', '#c994d1', '#d3aa5d'][i],
          );
      }
      c.restore();
      if (g.h >= 340 && build > 0.8)
        this.tag(room.label.replace(/ \d+$/, ''), x, y - ry - 7, 10, '#fbe9b2', '#3d2921e8');
    }
    mushroom(x, y, size, color) {
      const c = this.ctx;
      c.fillStyle = '#e3c48c';
      c.fillRect(x - size * 0.13, y - size * 0.65, size * 0.26, size * 0.7);
      ellipse(c, x, y - size * 0.65, size * 0.65, size * 0.32, color, '#f7d39c', 0.8);
      ellipse(c, x - size * 0.2, y - size * 0.75, size * 0.12, size * 0.06, '#fff2b9');
    }
    tag(text, x, y, size = 12, color = '#ffe4a4', background = '#24382ee8') {
      const c = this.ctx;
      c.font = `800 ${size}px system-ui`;
      c.textAlign = 'center';
      const width = c.measureText(text).width + 16;
      c.fillStyle = background;
      c.beginPath();
      c.roundRect(x - width / 2, y - size, width, size + 8, 6);
      c.fill();
      c.fillStyle = color;
      c.fillText(text, x, y + 1);
    }
    ant(x, y, size, angle, seed = 0, role = 'worker', cargo = null, working = true, activity = 'walk') {
      const c = this.ctx,
        t = this.clock / 1000;
      const image = role === 'guard' ? art.guard : art.worker;
      const stride = working && !this.reduced ? Math.sin(t * 12 + seed * 1.7) : 0;
      const facing = Math.cos(angle) < -0.05 ? -1 : 1;
      const height = size * 0.84;
      const gathering = ['gathering', 'unloading', 'tending'].includes(activity);
      const bend = gathering && !this.reduced ? (1 + Math.sin(t * 5 + seed)) * 0.5 : 0;
      // Keep the illustrated characters upright on vertical tunnels, as on the smartboard.
      // Small gait, lean and squash convey walking without rotating their faces upside down.
      c.save();
      c.translate(x, y);
      ellipse(c, 0, height * 0.38, size * 0.34, size * 0.075, '#1a100b50');
      c.scale(facing, 1);
      c.translate(0, -Math.abs(stride) * size * 0.035);
      c.rotate(Math.sin(angle) * facing * 0.13 + stride * 0.028 + bend * 0.16);
      c.scale(1 + stride * 0.015, 1 - stride * 0.025);
      // Six feet work in alternating groups behind the illustrated body.
      c.strokeStyle = role === 'guard' ? '#854124' : '#ac5729';
      c.lineWidth = Math.max(1.2, size * 0.025);
      c.lineCap = 'round';
      for (let leg = 0; leg < 3; leg++) {
        for (const side of [-1, 1]) {
          const step = working && !this.reduced ? Math.sin(t * 12 + seed * 1.7 + leg * 2.1 + side) : 0;
          const lx = (leg - 1) * size * 0.17;
          c.beginPath();
          c.moveTo(lx, height * 0.1);
          c.lineTo(lx + side * size * 0.08, height * 0.27);
          c.lineTo(lx + side * size * 0.16 + step * size * 0.07, height * (0.43 - Math.max(0, step) * 0.055));
          c.stroke();
        }
      }
      if (working && !this.reduced) {
        for (let i = 0; i < 3; i++) {
          const drift = (t * 2 + seed + i / 3) % 1;
          ellipse(
            c,
            -size * (0.45 + drift * 0.3),
            height * 0.4,
            size * 0.03 * (1 - drift),
            size * 0.012,
            '#e2c28b50',
          );
        }
      }
      if (image.complete && image.naturalWidth) {
        c.drawImage(image, -size * 0.65, -height * 0.7, size * 1.3, height * 1.3);
        this.canvas.dataset.ants = 'illustrated';
      }
      if (role === 'builder') {
        ellipse(c, size * 0.23, -height * 0.36, size * 0.17, size * 0.07, '#f5c653', '#795223');
      }
      if (cargo) this.cargo(-size * 0.16, -height * 0.55, cargo, size * 0.25);
      c.restore();
    }
    workerJourney(i, g, colony) {
      const home = g.pantry,
        gate = [g.w * 0.5, g.surface - 8];
      const side = i % 2 ? 1 : -1;
      const trip = (colony.forageTrips || [])[i] || 0;
      const duration = colony.dryShortfall ? 18000 : 12000;
      // Interpolate the server's progress only until its next snapshot. Never invent resource awards.
      const p = this.reduced
        ? 0.18 + ((i * 0.11) % 0.7)
        : ((colony.forageProgress?.[i] || 0) +
            (this.state?.story ? 0 : this.clock - this.receivedAt) / duration) %
          1;
      const source = [g.w * (0.5 + side * (0.27 + random(i + trip) * 0.16)), g.surface - 10];
      const path = [
        [home.x, home.y + home.ry * 0.25],
        [g.home.x, g.home.y],
        [g.w * 0.5, g.surface + g.depth * 0.07],
        gate,
        [g.w * (0.5 + side * 0.12), g.surface - 12],
        source,
      ];
      // Some workers tend an interior room on alternate trips; routes still pass through actual tunnels.
      if (i % 3 === 2 && trip % 2 && g.rooms.length > 2) {
        const target = g.rooms[2 + ((trip + i) % (g.rooms.length - 2))];
        const indoor = [
          [home.x, home.y],
          [g.home.x, g.home.y],
          [mix(g.home.x, target.x, 0.55), mix(g.home.y, target.y, 0.3)],
          [target.x, target.y + target.ry * 0.2],
        ];
        const point = this.pathPoint(
          indoor,
          p < 0.45 ? smooth(p / 0.45) : p < 0.6 ? 1 : 1 - smooth((p - 0.6) / 0.4),
        );
        if (p >= 0.6) point.angle += Math.PI;
        return {
          ...point,
          job: p > 0.45 && p < 0.6 ? 'tending' : 'stocking',
          carrying: p < 0.48,
          cargo: 'seed',
          p,
          id: i,
        };
      }
      let point,
        job,
        carrying = false;
      if (p < 0.4) {
        point = this.pathPoint(path, smooth(p / 0.4));
        job = 'foraging';
      } else if (p < 0.5) {
        point = { x: source[0], y: source[1], angle: side > 0 ? 0 : Math.PI };
        job = 'gathering';
      } else if (p < 0.93) {
        point = this.pathPoint(path, 1 - smooth((p - 0.5) / 0.43));
        point.angle += Math.PI;
        job = 'carrying';
        carrying = true;
      } else {
        point = { x: home.x, y: home.y + home.ry * 0.25, angle: 0 };
        job = 'unloading';
        carrying = p < 0.97;
      }
      const cargo = (trip + i) % 2 ? 'leaf' : 'stick';
      return { ...point, job, carrying, cargo, p, id: i };
    }
    nest(g, colony) {
      const c = this.ctx,
        { w, h, surface, depth, home, rooms, size } = g;
      this.tunnel(
        [
          [w * 0.5, surface],
          [w * 0.5, surface + depth * 0.11],
          [home.x, home.y],
        ],
        clamp(w * 0.045, 15, 35),
      );
      for (const room of rooms.slice(1)) {
        const age = this.clock - (this.roomBirths.get(room.id) ?? -10000);
        this.tunnel(
          [
            [home.x, home.y],
            [mix(home.x, room.x, 0.55), mix(home.y, room.y, 0.3)],
            [room.x, room.y],
          ],
          clamp(w * 0.035, 12, 26),
          clamp(age / 1700, 0.02, 1),
        );
      }
      for (const room of rooms)
        this.room(room, colony, this.clock - (this.roomBirths.get(room.id) ?? -10000), g);
      // Resource patches make the reason for each surface trip immediately visible.
      for (const side of [-1, 1]) {
        const x = w * (side < 0 ? 0.13 : 0.87);
        for (let i = 0; i < 4; i++)
          this.cargo(
            x + i * 9 - 14,
            surface - 10 - (i % 2) * 6,
            side < 0 ? 'seed' : i % 2 ? 'leaf' : 'stick',
            size * 0.15,
          );
      }
      const age = this.effects.findLast((e) => e.kind === 'defense');
      const progress = age ? clamp((this.clock - age.start) / 2500, 0, 1) : 1;
      const defense = clamp(colony.defense || 0, 0, 4);
      const level = Math.max(0, defense - (age && !this.reduced ? 1 - smooth(progress) : 0));
      const domeWidth = Math.min(w * 0.22, 48 + level * 19);
      const domeHeight = 20 + level * 12;
      const domeX = w * 0.5;
      const mud = c.createLinearGradient(domeX - domeWidth, surface - domeHeight, domeX + domeWidth, surface);
      mud.addColorStop(0, '#e0b778');
      mud.addColorStop(0.45, '#ac7545');
      mud.addColorStop(1, '#603c29');
      ellipse(c, domeX + 4, surface + 3, domeWidth * 1.12, 8, '#291c2260');
      c.beginPath();
      c.moveTo(domeX - domeWidth, surface);
      c.bezierCurveTo(
        domeX - domeWidth * 0.65,
        surface - domeHeight * 0.35,
        domeX - domeWidth * 0.65,
        surface - domeHeight,
        domeX,
        surface - domeHeight,
      );
      c.bezierCurveTo(
        domeX + domeWidth * 0.65,
        surface - domeHeight,
        domeX + domeWidth * 0.65,
        surface - domeHeight * 0.35,
        domeX + domeWidth,
        surface,
      );
      c.closePath();
      c.fillStyle = mud;
      c.fill();
      c.strokeStyle = '#6a442b';
      c.lineWidth = 3;
      c.stroke();
      // Packed soil layers and embedded stones make each reinforcement visible.
      for (let i = 0; i <= defense; i++) {
        const y = surface - 7 - i * 9;
        const span = domeWidth * (1 - (i + 1) / (defense + 3));
        c.strokeStyle = '#ecc28a80';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(domeX - span, y);
        c.quadraticCurveTo(domeX, y - 5, domeX + span, y);
        c.stroke();
        for (const side of [-1, 1]) ellipse(c, domeX + side * span * 0.85, y + 3, 4, 2.5, '#79543b');
      }
      ellipse(c, domeX, surface - 4, 14 + level * 2, 10 + level * 2, '#37251b', '#dbaf76', 3 + level);
      this.canvas.dataset.wallLevel = String(defense + 1);
      this.canvas.dataset.domeHeight = String(domeHeight);
      const building = this.effects.findLast(
        (e) => ['expansion', 'defense'].includes(e.kind) && this.clock - e.start < 3500,
      );
      const hatch = this.effects.findLast((e) => ['workers', 'hatch'].includes(e.kind));
      this.workers = Array.from({ length: Math.min(24, colony.workers || 1) }, (_, i) =>
        this.workerJourney(i, g, colony),
      );
      for (const worker of this.workers.filter(
        (a) => !(building && a.id === 0) && !(hatch && a.id === this.workers.length - 1),
      ))
        this.ant(
          worker.x,
          worker.y,
          size * 1.12,
          worker.angle,
          worker.id,
          'worker',
          worker.carrying ? worker.cargo : null,
          !['gathering', 'unloading', 'tending'].includes(worker.job),
          worker.job,
        );
      // Guards patrol the entrance rather than shuffling in one fixed line.
      const guards = Math.min(8, Math.max(0, (colony.soldiers || 0) - (colony.raidAway || 0)));
      const recruit = this.effects.findLast((e) => e.kind === 'soldiers');
      for (let i = 0; i < guards; i++) {
        if (recruit && i === guards - 1) continue;
        const p = (this.clock / 7500 + i / guards) % 1;
        const x = w * (0.36 + (0.28 * (1 - Math.cos(p * TAU))) / 2);
        this.ant(x, surface - size * 0.1, size, p < 0.5 ? 0 : Math.PI, i, 'guard');
      }
      if (recruit) {
        const barracks = rooms.find((r) => r.kind === 'guard') || home;
        const path = [
          [barracks.x, barracks.y],
          [home.x, home.y],
          [w * 0.5, surface],
          [w * 0.61, surface - 5],
        ];
        const p = clamp((this.clock - recruit.start) / recruit.duration, 0, 1);
        const arrival = this.pathPoint(path, smooth(p));
        this.ant(arrival.x, arrival.y, size * 1.12, arrival.angle, 4, 'guard');
      }
      const newEgg = this.effects.findLast((e) => e.kind === 'queen');
      if (newEgg) {
        const p = clamp((this.clock - newEgg.start) / newEgg.duration, 0, 1);
        c.globalAlpha = 1 - p;
        ellipse(
          c,
          home.x + home.rx * 0.35,
          home.y + home.ry * 0.1,
          size * (0.3 + p),
          size * (0.35 + p),
          null,
          '#ffe791',
          2,
        );
        c.globalAlpha = 1;
      }
      // Short construction scenes use the worker already earned, without inventing extra colony population.
      if (building && this.clock - building.start < 3500) {
        const room = rooms.at(-1),
          target =
            building.kind === 'defense'
              ? { x: w * 0.5 + size, y: surface - 5 }
              : { x: room.x + room.rx * 0.7, y: room.y };
        this.ant(target.x, target.y, size, Math.PI + Math.sin(this.clock / 95) * 0.12, 3, 'builder');
        for (let i = 0; i < 9; i++) {
          const phase = (this.clock / 650 + i / 9) % 1;
          ellipse(
            c,
            target.x - phase * size * 0.8,
            target.y - Math.sin(phase * Math.PI) * size * 0.8,
            2.5 * (1 - phase),
            2,
            '#e4b879',
          );
        }
      }
      if (hatch) {
        const p = clamp((this.clock - hatch.start) / 3000, 0, 1);
        this.ant(
          home.x + home.rx * 0.38,
          home.y + home.ry * 0.2,
          size * (0.35 + 0.4 * p),
          -0.4,
          9,
          'worker',
          null,
          false,
        );
        for (let i = 0; i < 5; i++)
          ellipse(
            c,
            home.x + home.rx * 0.38 + Math.cos((i * TAU) / 5) * p * size,
            home.y - p * size + Math.sin((i * TAU) / 5) * size * p,
            2 * (1 - p),
            2 * (1 - p),
            '#fff2b4',
          );
      }
      const delivery = this.effects.findLast((e) => ['delivery', 'food', 'supplies'].includes(e.kind));
      if (delivery) {
        const p = clamp((this.clock - delivery.start) / delivery.duration, 0, 1);
        c.globalAlpha = 1 - p;
        for (let i = 0; i < 3; i++)
          this.cargo(
            g.pantry.x + (i - 1) * size * 0.35,
            g.pantry.y - p * size - g.pantry.ry * 0.2,
            delivery.kind === 'supplies' ? (i % 2 ? 'stick' : 'leaf') : 'seed',
            size * 0.18,
          );
        c.globalAlpha = 1;
      }
      const raid = this.effects.findLast((e) => e.kind === 'raid');
      if (raid) {
        const p = clamp((this.clock - raid.start) / raid.duration, 0, 1),
          incoming = raid.event.target === this.state.me.id;
        const route = incoming
          ? [
              [w + size, surface - 8],
              [w * 0.53, surface - 8],
            ]
          : [
              [w * 0.35, surface - 8],
              [w * 0.68, surface - 8],
            ];
        const advancing = p < 0.68;
        const progress = this.reduced
          ? 0.85
          : p < 0.15
            ? 0
            : p < 0.5
              ? smooth((p - 0.15) / 0.35)
              : p < 0.68
                ? 1
                : 1 - smooth((p - 0.68) / 0.32);
        const movement = this.pathPoint(route, progress);
        this.canvas.dataset.raidPhase =
          p < 0.15 ? 'rally' : p < 0.5 ? 'approach' : p < 0.68 ? 'clash' : 'return';
        if (p >= 0.5 && p < 0.68) {
          const clash = this.reduced ? 0.5 : (p - 0.5) / 0.18;
          c.save();
          c.strokeStyle = raid.event.success ? '#ffd774' : '#a8e8d0';
          c.lineWidth = 3;
          c.globalAlpha = 1 - clash;
          c.beginPath();
          c.arc(route[1][0], route[1][1], size * (0.35 + clash), 0, TAU);
          c.stroke();
          for (let n = 0; n < 8; n++) {
            const theta = (n / 8) * TAU;
            ellipse(
              c,
              route[1][0] + Math.cos(theta) * size * clash,
              route[1][1] + Math.sin(theta) * size * clash * 0.55,
              3,
              2,
              '#ffe5a0',
            );
          }
          c.restore();
        }
        for (let i = 0; i < 3; i++)
          this.ant(
            movement.x + (advancing ? (incoming ? 1 : -1) : incoming ? -1 : 1) * i * size * 0.6,
            movement.y,
            size,
            advancing ? (incoming ? Math.PI : 0) : incoming ? 0 : Math.PI,
            i,
            'guard',
            p >= 0.68 && raid.event.success ? 'seed' : null,
            !(p < 0.15 || (p >= 0.5 && p < 0.68)),
          );
        this.tag(
          p < 0.15
            ? 'Guards assemble!'
            : p < 0.5
              ? 'The raiding party approaches!'
              : p < 0.68
                ? 'Clash at the entrance!'
                : incoming
                  ? raid.event.success
                    ? 'Raiders at the pantry!'
                    : 'Your guards held strong!'
                  : raid.event.success
                    ? 'Your raid brought food home!'
                    : 'Your guards are coming home',
          w / 2,
          surface - size * 1.3,
          h < 350 ? 10 : 13,
        );
      }
      if (!raid) this.canvas.dataset.raidPhase = '';
      if (this.rooms(colony).length > rooms.length)
        this.tag(`+${this.rooms(colony).length - rooms.length} deeper rooms`, w / 2, h - 74, 11);
      this.canvas.dataset.rooms = String(this.rooms(colony).length);
      this.canvas.dataset.jobs = [...new Set(this.workers.map((a) => a.job))].join(' ');
    }
    weather(w, h, surface) {
      const c = this.ctx,
        world = this.state?.world || {},
        t = this.clock / 1000;
      c.save();
      c.beginPath();
      c.rect(0, 0, w, surface);
      c.clip();
      if (world.birdStage === 'rain') {
        c.fillStyle = '#36596840';
        c.fillRect(0, 0, w, surface);
        c.strokeStyle = '#d4efffa0';
        c.lineWidth = 1.5;
        for (let i = 0; i < 38; i++) {
          const x = (i * 67 + t * 44) % w,
            y = (i * 43 + t * 180) % surface;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x - 5, y + 14);
          c.stroke();
        }
        for (let i = 0; i < 4; i++)
          ellipse(c, w * (0.15 + i * 0.23), surface - 1, 18 + Math.sin(t * 5 + i) * 4, 3, '#adcddd75');
      }
      if (world.dryOccurred && !world.rainOccurred) {
        c.fillStyle = '#edb95218';
        c.fillRect(0, 0, w, surface);
        for (let i = 0; i < 6; i++)
          this.leaf(
            (i * 103 + t * 17) % w,
            30 + ((i * 31 + Math.sin(t + i) * 8) % Math.max(30, surface - 35)),
            4,
            t * 0.4 + i,
          );
      }
      if (
        ['warning', 'attack'].includes(world.birdStage) &&
        !['birds', 'birds-warning'].includes(this.state?.story?.key)
      ) {
        for (let i = 0; i < 3; i++) {
          const x = ((t * 55 + (i * w) / 3) % (w + 150)) - 75;
          const y = surface * 0.45 + Math.sin(t + i) * 12;
          this.creature('bird', x, y, Math.min(110, w * 0.17), t + i * 0.2, true);
        }
      }
      c.restore();
    }
    draw(t) {
      if (this.stopped) return;
      this.raf = requestAnimationFrame((time) => this.draw(time));
      const dt = clamp(t - this.last, 0, 60);
      this.last = t;
      if (document.hidden) return;
      const canvas = this.canvas,
        c = this.ctx,
        w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const running =
        this.state &&
        !['paused', 'ended', 'lobby'].includes(this.state.phase) &&
        !document.body.classList.contains('offline');
      if (running) this.clock += dt;
      // Reduced motion retains feedback, with stationary workers and no weather sweeps.
      if (this.reduced && ++this.frameCount % 6) return;
      const colony = this.state?.me?.colony || { workers: 1, territory: 1, food: 8, eggs: [] };
      const g = this.layout(w, h, colony);
      if (running)
        this.dryFade +=
          (Number(!!this.state?.world?.dryOccurred && !this.state?.world?.rainOccurred) - this.dryFade) *
          0.03;
      this.background(w, h, this.overview ? h * 0.65 : g.surface);
      if (this.overview) {
        for (let i = 0; i < 10; i++)
          this.ant(
            ((this.clock * 0.017 + (i * w) / 10) % (w + 50)) - 25,
            h * 0.66 + Math.sin(i) * 15,
            35,
            0,
            i,
            'worker',
            i % 2 ? 'leaf' : 'seed',
          );
      } else this.nest(g, colony);
      if (!this.reduced) this.weather(w, h, this.overview ? h * 0.65 : g.surface);
      if (!this.overview) {
        // Soft edge lighting frames the playable nest; earned deliveries rise from its pantry.
        const shade = c.createRadialGradient(
          w * 0.5,
          h * 0.5,
          w * 0.16,
          w * 0.5,
          h * 0.5,
          Math.max(w, h) * 0.72,
        );
        shade.addColorStop(0, '#160e0800');
        shade.addColorStop(1, '#160e0870');
        c.fillStyle = shade;
        c.fillRect(0, 0, w, h);
        this.effects
          .filter((e) => e.kind === 'income')
          .forEach((e, i) => {
            const age = clamp((this.clock - e.start) / e.duration, 0, 1);
            c.save();
            c.globalAlpha = this.reduced ? 1 : 1 - age;
            this.tag(
              e.text,
              g.pantry.x + ((i % 3) - 1) * 34,
              g.pantry.y - g.pantry.ry - 12 - (this.reduced ? 0 : age * 38),
              12,
              '#ffe6a0',
            );
            c.restore();
          });
      }
      if (this.state?.story) window.ColonyStoryCanvas?.draw(this, g);
      else this.canvas.dataset.story = '';
      this.effects = this.effects.filter((e) => this.clock - e.start < e.duration);
      if (!this.effects.length) this.canvas.dataset.action = '';
    }
  };
})();
