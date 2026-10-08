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
    repair: 'Workers are repairing the nest',
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
      this.effects.push({
        kind,
        start: this.clock,
        duration: kind === 'raid' ? 6200 : ['expansion', 'defense'].includes(kind) ? 7200 : 4800,
        ...extra,
      });
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
        this.layoutTransition = null;
        this.displayedRooms = null;
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
        if (
          old.story &&
          old.story.id !== state.story?.id &&
          ['rain', 'tunnel-collapse', 'footsteps'].includes(old.story.key)
        ) {
          const outcome = old.story.results?.find((result) => result.playerId === state.me.id);
          if (outcome && (outcome.food < 0 || outcome.pointsLost > 0))
            this.cue('repair', { hazard: old.story.key });
        }
        const overtake = window.ColonyQuestCore.overtakeEvidence(old.players, state.players, state.me.id);
        if (overtake) this.cue('overtake', { ...overtake, duration: 4500 });
        if (old.story && old.story.id !== state.story?.id) {
          const outcome = old.story.results?.find((result) => result.playerId === state.me.id);
          const evidence = window.ColonyQuestCore.survivalEvidence(old.story.key, before, outcome);
          if (evidence) this.cue('survival', { evidence, duration: 5200 });
        }
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
      const visible = definitions.slice(0, 19);
      const rows = 1 + Math.ceil((visible.length - 1) / 2);
      const floorHeight = depth / Math.max(2, rows);
      const rooms = visible.map((room, i) => {
        const floor = i === 0 ? 0 : 1 + Math.floor((i - 1) / 2);
        return {
          ...room,
          x: w * (i === 0 ? 0.5 : i % 2 ? 0.24 : 0.76),
          y: surface + floorHeight * (floor + 0.52),
          rx: Math.min(w * (i === 0 ? 0.24 : 0.205), floorHeight * 1.2),
          ry: Math.min(floorHeight * 0.36, w * 0.16),
        };
      });
      const signature = w + ':' + h + ':' + visible.map((room) => room.id).join(',');
      if (this.layoutTransition?.signature !== signature) {
        this.layoutTransition = {
          signature,
          start: this.clock,
          before: new Map((this.displayedRooms || []).map((room) => [room.id, room])),
        };
      }
      const moving = this.reduced
        ? 1
        : smooth(clamp((this.clock - this.layoutTransition.start) / 1000, 0, 1));
      for (const room of rooms) {
        const before = this.layoutTransition.before.get(room.id);
        if (before && moving < 1)
          for (const key of ['x', 'y', 'rx', 'ry']) room[key] = mix(before[key], room[key], moving);
      }
      this.displayedRooms = rooms.map((room) => ({ ...room }));
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
        build = this.reduced ? 1 : clamp(age / 6500, 0, 1);
      const { x, y, rx, ry } = room;
      c.save();
      c.translate(x, y);
      if (build < 1) {
        c.beginPath();
        c.ellipse(
          0,
          0,
          Math.max(1, rx * 1.1 * Math.min(1, build * 3)),
          Math.max(1, ry * 1.3 * Math.min(1, build * 3)),
          0,
          0,
          TAU,
        );
        c.clip();
      }
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
      // Every chamber has a lit work floor; material and room purpose stay readable at a glance.
      const glow = c.createRadialGradient(-rx * 0.4, -ry * 0.4, 0, 0, 0, rx);
      glow.addColorStop(0, '#ffe1a53d');
      glow.addColorStop(1, '#ffd27b00');
      ellipse(c, 0, 0, rx, ry, glow);
      c.fillStyle = '#674329';
      c.fillRect(-rx * 0.76, ry * 0.36, rx * 1.52, Math.max(3, ry * 0.12));
      c.strokeStyle = '#dbac6a';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-rx * 0.75, ry * 0.35);
      c.lineTo(rx * 0.75, ry * 0.35);
      c.stroke();
      if (build > 0.3) {
        for (const side of [-1, 1]) {
          const post = rx * side * 0.77;
          c.strokeStyle = '#58361f';
          c.lineWidth = 7 + (colony.defense || 0);
          c.beginPath();
          c.moveTo(post, ry * 0.36);
          c.lineTo(post * 0.9, -ry * 0.45);
          c.lineTo(post * 0.55, -ry * 0.72);
          c.stroke();
          c.strokeStyle = '#d7ab70';
          c.lineWidth = 2;
          c.stroke();
          for (let band = 0; band < (colony.defense || 0); band++) {
            c.fillStyle = '#adc1b5';
            c.fillRect(post - 5, ry * (0.22 - band * 0.16), 10, 3);
          }
          this.mushroom(post * 0.9, ry * 0.3, Math.min(10, ry * 0.25), '#edb866');
        }
      }
      c.save();
      c.globalAlpha *= clamp((build - 0.5) * 2, 0, 1);
      this.roomFurniture(room, colony, rx, ry);
      if (room.kind === 'nursery') {
        for (let i = 0; i < Math.min(9, colony.pantryBuilt ? 0 : colony.food || 0); i++)
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
        this.leaf(rx * 0.35, -ry * 0.55, Math.min(14, rx * 0.2));
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
      } else if (room.label.includes('Seed') || room.label.includes('Workshop') || room.kind === 'workers') {
        // Furnished above; keep the work floor clear for the ants.
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
      c.restore();
      if (build < 1) this.construction(room, build, g);
      if (g.h >= 340 && build > 0.8)
        this.tag(room.label.replace(/ \d+$/, ''), x, y - ry - 7, 10, '#fbe9b2', '#3d2921e8');
    }
    roomFurniture(room, colony, rx, ry) {
      const c = this.ctx;
      const timber = (x, y, w, h) => {
        c.fillStyle = '#573820';
        c.fillRect(x, y, w, h);
        c.fillStyle = '#ca9857';
        c.fillRect(x, y, w, Math.max(2, h * 0.3));
      };
      if (room.kind === 'food' || room.label.includes('Seed')) {
        for (const shelf of [-0.32, 0.08]) timber(-rx * 0.62, ry * shelf, rx * 1.24, Math.max(4, ry * 0.12));
        for (const side of [-1, 1]) timber(side * rx * 0.6, -ry * 0.5, 4, ry * 0.9);
        // Filled stores reflect actual food rather than a decorative full pantry.
        const stores = this.rooms(colony).filter(
          (item) => item.kind === 'food' || item.label.includes('Seed'),
        );
        const index = stores.findIndex((item) => item.id === room.id);
        const food = Math.max(0, colony.food || 0);
        const stored = Math.floor(food / stores.length) + (index < food % stores.length ? 1 : 0);
        for (let i = 0; i < Math.min(18, stored); i++) {
          const x = -rx * 0.5 + (i % 6) * rx * 0.2;
          const y = ry * (-0.42 + Math.floor(i / 6) * 0.32);
          this.cargo(x, y, 'seed', Math.min(7, rx * 0.055));
        }
      } else if (room.label.includes('Workshop')) {
        timber(-rx * 0.55, 0, rx * 1.1, ry * 0.16);
        for (const side of [-1, 1]) timber(side * rx * 0.42, ry * 0.12, 5, ry * 0.24);
        for (let i = 0; i < Math.min(6, colony.sticks || 0); i++)
          this.cargo(-rx * 0.4 + i * rx * 0.14, -ry * 0.08, 'stick', Math.min(10, rx * 0.1));
      } else if (room.kind === 'workers') {
        for (const side of [-1, 1]) {
          timber(side * rx * 0.45 - rx * 0.2, -ry * 0.2, rx * 0.4, 4);
          this.leaf(side * rx * 0.42, 0, rx * 0.25, 0.1);
          ellipse(c, side * rx * 0.5, -ry * 0.1, rx * 0.07, ry * 0.12, '#e8d4a1');
        }
      } else if (room.kind === 'guard') {
        timber(-rx * 0.6, ry * 0.3, rx * 1.2, 4);
        ellipse(c, rx * 0.48, -ry * 0.1, rx * 0.12, ry * 0.32, '#b59057', '#543620', 2);
        ellipse(c, rx * 0.48, -ry * 0.1, rx * 0.06, ry * 0.15, null, '#f1d69c', 2);
      }
    }
    construction(room, progress, g) {
      const c = this.ctx;
      const { x, y, rx, ry } = room;
      c.save();
      c.strokeStyle = '#e8c38590';
      c.lineWidth = 2;
      c.setLineDash([5, 6]);
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, TAU);
      c.stroke();
      c.setLineDash([]);
      const phase = progress < 0.33 ? 'digging' : progress < 0.67 ? 'reinforcing' : 'furnishing';
      this.canvas.dataset.constructionPhase = phase;
      c.fillStyle = '#33251f';
      c.fillRect(x - rx * 0.55, y + ry + 7, rx * 1.1, 4);
      c.fillStyle = '#f1cd76';
      c.fillRect(x - rx * 0.55, y + ry + 7, rx * 1.1 * progress, 4);
      if (!this.reduced && progress < 0.7)
        for (let i = 0; i < 7; i++) {
          const p = (this.clock / 750 + i / 7) % 1;
          ellipse(
            c,
            x + rx * 0.65 - p * rx * 0.35,
            y + ry * 0.2 - Math.sin(p * Math.PI) * ry * 0.6,
            2 * (1 - p),
            2 * (1 - p),
            '#d7ae73',
          );
        }
      c.restore();
    }
    indoorWorker(i, g, colony) {
      const elapsed = this.reduced ? i * 4200 + 8000 : this.clock + i * 4200;
      const cycle = Math.floor(elapsed / 18000);
      const room = g.rooms[(cycle + Math.floor(i / 3)) % g.rooms.length];
      const p = (elapsed % 18000) / 18000;
      const working = p >= 0.22 && p <= 0.78;
      const path = [
        [g.home.x, g.home.y + g.home.ry * 0.14],
        [g.home.x, room.y + room.ry * 0.14],
        [room.x - room.rx * 0.22, room.y + room.ry * 0.14],
      ];
      const point = this.pathPoint(
        path,
        p < 0.22 ? smooth(p / 0.22) : p > 0.78 ? 1 - smooth((p - 0.78) / 0.22) : 1,
      );
      if (p > 0.78) point.angle += Math.PI;
      const job =
        room.kind === 'food' || room.label.includes('Seed')
          ? 'stocking'
          : room.label.includes('Workshop')
            ? 'building'
            : room.kind === 'nursery' && this.state.me.colony.eggs?.length
              ? 'nursing'
              : 'tending';
      return {
        ...point,
        id: i,
        job: working ? job : 'walking',
        carrying: !working,
        cargo: room.label.includes('Workshop') ? 'stick' : room.label.includes('garden') ? 'leaf' : 'seed',
        p,
        room: room.id,
      };
    }
    habitatWeather(g, colony) {
      const story = this.state?.story;
      const rain = story?.key === 'rain' || this.state?.world?.birdStage === 'rain';
      const repair = this.effects.findLast((effect) => effect.kind === 'repair');
      if (!rain && !repair) {
        this.canvas.dataset.habitatResponse = '';
        return;
      }
      if (!rain && repair) {
        this.canvas.dataset.habitatResponse = 'repairing';
        const p = clamp((this.clock - repair.start) / repair.duration, 0, 1);
        const c = this.ctx;
        c.save();
        c.globalAlpha = 1 - p;
        if (repair.hazard === 'rain')
          for (const room of g.rooms)
            ellipse(c, room.x, room.y + room.ry * 0.32, room.rx * 0.7, room.ry * 0.12, '#6fbbd97a');
        else
          for (const room of g.rooms) {
            c.strokeStyle = '#382518';
            c.lineWidth = 3;
            c.beginPath();
            c.moveTo(room.x - room.rx * 0.4, room.y - room.ry * 0.6);
            c.lineTo(room.x - room.rx * 0.3, room.y - room.ry * 0.2);
            c.lineTo(room.x - room.rx * 0.5, room.y + room.ry * 0.2);
            c.stroke();
          }
        c.restore();
        return;
      }
      const c = this.ctx;
      const protectedNest = colony.defense >= 1;
      this.canvas.dataset.habitatResponse = protectedNest ? 'sheltered' : 'flood-response';
      if (protectedNest) {
        c.save();
        c.strokeStyle = '#baffdf';
        c.globalAlpha = this.reduced ? 0.6 : 0.4 + Math.sin(this.clock / 450) * 0.2;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(g.w * 0.5, g.surface, 37, Math.PI, Math.PI * 2);
        c.stroke();
        c.restore();
        for (const side of [-1, 1]) {
          c.strokeStyle = '#bcebf2a0';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(g.w * 0.5 + side * 24, g.surface - 20);
          c.quadraticCurveTo(g.w * 0.5 + side * 50, g.surface - 10, g.w * 0.5 + side * 65, g.surface + 2);
          c.stroke();
        }
      } else {
        c.strokeStyle = '#8bd3e090';
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(g.w * 0.5, g.surface);
        c.lineTo(g.home.x, g.home.y);
        c.stroke();
        for (const room of g.rooms) {
          const ripple = this.reduced ? 0 : Math.sin(this.clock / 350 + room.x) * 2;
          ellipse(
            c,
            room.x,
            room.y + room.ry * 0.32,
            room.rx * 0.7,
            room.ry * 0.12 + ripple,
            '#6fbbd97a',
            '#b5edf28a',
            1,
          );
        }
      }
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
      const gathering = [
        'gathering',
        'unloading',
        'tending',
        'nursing',
        'building',
        'stocking',
        'training',
      ].includes(activity);
      const bend = gathering && !this.reduced ? (1 + Math.sin(t * 5 + seed)) * 0.5 : 0;
      // Keep the illustrated characters upright on vertical tunnels, as on the smartboard.
      // Small gait, lean and squash convey walking without rotating their faces upside down.
      c.save();
      c.translate(x, y);
      ellipse(c, 0, height * 0.38, size * 0.34, size * 0.075, '#1a100b50');
      c.scale(facing, 1);
      c.translate(0, -Math.abs(stride) * size * 0.035);
      const alert = ['birds-warning', 'footsteps-warning'].includes(this.state?.story?.key) || this.state?.world?.birdStage === 'warning';
      c.rotate(Math.sin(angle) * facing * 0.13 + stride * 0.028 + bend * 0.16 - (alert ? .12 : 0));
      if (alert) {
        c.strokeStyle = '#ffe7a3'; c.lineWidth = 1.5;
        for (let ray = -1; ray <= 1; ray++) {
          c.beginPath(); c.moveTo(size * .28 + ray * 5, -height * .65);
          c.lineTo(size * .28 + ray * 8, -height * .85); c.stroke();
        }
      }
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
      if (activity === 'nursing') {
        this.leaf(size * 0.4, height * 0.15, size * 0.23, 0.1);
        ellipse(
          c,
          size * 0.4,
          height * 0.03 - bend * size * 0.03,
          size * 0.1,
          size * 0.13,
          '#fff2d1',
          '#c2a474',
          1,
        );
      } else if (activity === 'building') {
        c.save();
        c.translate(size * 0.4, -height * 0.08);
        c.rotate(-0.4 - bend * 0.9);
        c.strokeStyle = '#b9874b';
        c.lineWidth = Math.max(2, size * 0.045);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -size * 0.35);
        c.stroke();
        c.fillStyle = '#a4bab0';
        c.fillRect(-size * 0.12, -size * 0.4, size * 0.24, size * 0.12);
        c.restore();
        this.cargo(size * 0.55, height * 0.32, 'stick', size * 0.2);
      } else if (activity === 'stocking') {
        this.cargo(size * 0.4, height * (0.15 - bend * 0.35), 'seed', size * 0.17);
      } else if (activity === 'training') {
        c.save();
        c.translate(size * 0.38 + bend * size * 0.07, 0);
        c.fillStyle = '#658b81';
        c.strokeStyle = '#f1d484';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(-size * 0.15, -size * 0.25);
        c.lineTo(size * 0.15, -size * 0.25);
        c.lineTo(size * 0.13, size * 0.05);
        c.lineTo(0, size * 0.2);
        c.lineTo(-size * 0.13, size * 0.05);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }
      if (cargo) this.cargo(-size * 0.16, -height * 0.55, cargo, size * 0.25);
      c.restore();
    }
    workerJourney(i, g, colony) {
      const repair = this.effects.findLast((effect) => effect.kind === 'repair');
      if (i === 0 && repair && this.state?.story?.key !== 'rain') {
        const p = clamp((this.clock - repair.start) / repair.duration, 0, 1);
        const target = g.pantry;
        const path = [
          [g.home.x, g.home.y],
          [g.home.x, target.y],
          [target.x + target.rx * 0.35, target.y],
        ];
        const at = this.pathPoint(
          path,
          p < 0.3 ? smooth(p / 0.3) : p > 0.8 ? 1 - smooth((p - 0.8) / 0.2) : 1,
        );
        return {
          ...at,
          id: i,
          p,
          job: p < 0.3 || p > 0.8 ? 'walking' : 'building',
          carrying: p < 0.3,
          cargo: 'stick',
        };
      }
      if (this.state?.story?.key === 'rain') {
        const elapsed = this.state.story.elapsed + (this.clock - this.receivedAt);
        const p = this.reduced ? 1 : clamp((elapsed - i * 120) / 2800, 0, 1);
        const shelter = i % 2 ? g.pantry : g.home;
        const path = [
          [g.w * (0.5 + (i % 2 ? -0.18 : 0.18)), g.surface - 8],
          [g.w * 0.5, g.surface],
          [g.home.x, shelter.y],
          [shelter.x + ((i % 3) - 1) * g.size * 0.4, shelter.y + shelter.ry * 0.16],
        ];
        const point = this.pathPoint(path, smooth(p));
        return {
          ...point,
          id: i,
          p,
          job: p < 1 ? 'sheltering' : 'tending',
          carrying: colony.defense < 1 && p < 1,
          cargo: 'seed',
        };
      }
      if (i % 3 === 2 && g.rooms.length > 1) return this.indoorWorker(i, g, colony);
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
      const source = [g.w * (0.5 + side * ((this.state?.world?.dryOccurred && !this.state?.world?.rainOccurred ? 0.38 : 0.27) + random(i + trip) * 0.06)), g.surface - 10];
      const path = [
        [home.x, home.y + home.ry * 0.25],
        [g.home.x, home.y],
        [g.home.x, g.home.y],
        [g.w * 0.5, g.surface + g.depth * 0.07],
        gate,
        [g.w * (0.5 + side * 0.12), g.surface - 12],
        source,
      ];
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
      const cargo = ['seed', 'leaf', 'stick'][(trip + i) % 3];
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
            [home.x, room.y],
            [room.x, room.y],
          ],
          clamp(w * 0.035, 12, 26),
          this.reduced ? 1 : clamp(age / 2200, 0.02, 1),
        );
      }
      this.canvas.dataset.constructionPhase = '';
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
        (e) => ['expansion', 'defense'].includes(e.kind) && this.clock - e.start < 7000,
      );
      const hatch = this.effects.findLast((e) => ['workers', 'hatch'].includes(e.kind));
      this.workers = Array.from({ length: Math.min(24, Math.max(0, colony.workers ?? 1)) }, (_, i) =>
        this.workerJourney(i, g, colony),
      );
      for (const worker of this.workers.filter(
        (a) => !(building && a.id === 0) && !(hatch && a.id === this.workers.length - 1),
      ))
        this.ant(
          worker.x,
          worker.y,
          worker.y > surface + 8 ? Math.min(size * 1.12, home.ry * 1.15) : size * 1.12,
          worker.angle,
          worker.id,
          'worker',
          worker.carrying ? worker.cargo : null,
          !['gathering', 'unloading', 'tending', 'nursing', 'building', 'stocking'].includes(worker.job),
          worker.job,
        );
      // Guards patrol the entrance rather than shuffling in one fixed line.
      const guards = Math.min(8, Math.max(0, (colony.soldiers || 0) - (colony.raidAway || 0)));
      const recruit = this.effects.findLast((e) => e.kind === 'soldiers');
      for (let i = 0; i < guards; i++) {
        if (recruit && i === guards - 1) continue;
        if (i % 2 && rooms.some((room) => room.kind === 'guard')) {
          const barracks = rooms.find((room) => room.kind === 'guard');
          const p = this.reduced ? 0.5 : (this.clock / 14000 + i * 0.2) % 1;
          const x = barracks.x + barracks.rx * (0.05 + (this.reduced ? 0 : Math.sin(p * TAU) * 0.15));
          this.ant(
            x,
            barracks.y + barracks.ry * 0.14,
            Math.min(size, barracks.ry * 1.1),
            p < 0.5 ? 0 : Math.PI,
            i,
            'guard',
            null,
            false,
            'training',
          );
          continue;
        }
        const p = (this.clock / 7500 + i / guards) % 1;
        const x = w * (0.36 + (0.28 * (1 - Math.cos(p * TAU))) / 2);
        this.ant(x, surface - size * 0.1, size, p < 0.5 ? 0 : Math.PI, i, 'guard');
      }
      if (recruit) {
        const barracks = rooms.find((r) => r.kind === 'guard') || home;
        const path = [
          [barracks.x, barracks.y],
          [home.x, barracks.y],
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
      if (building && this.clock - building.start < 7000) {
        const room = rooms.at(-1),
          target =
            building.kind === 'defense'
              ? { x: w * 0.5 + size, y: surface - 5 }
              : { x: room.x + room.rx * 0.7, y: room.y };
        const p = clamp((this.clock - building.start) / 7000, 0, 1);
        const path = [
          [g.pantry.x, g.pantry.y],
          [home.x, g.pantry.y],
          [home.x, target.y],
          [target.x, target.y],
        ];
        const at = this.pathPoint(
          path,
          p < 0.28 ? smooth(p / 0.28) : p > 0.85 ? 1 - smooth((p - 0.85) / 0.15) : 1,
        );
        this.ant(
          at.x,
          at.y,
          size,
          p > 0.85 ? at.angle + Math.PI : at.angle,
          0,
          'builder',
          p < 0.28 ? 'stick' : null,
          p < 0.28 || p > 0.85,
          p < 0.28 ? 'carrying' : 'building',
        );
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
      this.habitatWeather(g, colony);
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
    shield(x, y, size, good = true) {
      const c = this.ctx;
      c.save();
      c.translate(x, y);
      c.fillStyle = good ? '#1b765f' : '#98572b';
      c.strokeStyle = '#ffe1a0';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-size * 0.5, -size * 0.55);
      c.lineTo(size * 0.5, -size * 0.55);
      c.lineTo(size * 0.44, size * 0.12);
      c.quadraticCurveTo(0, size * 0.65, 0, size * 0.65);
      c.quadraticCurveTo(-size * 0.44, size * 0.28, -size * 0.5, -size * 0.55);
      c.fill();
      c.stroke();
      c.strokeStyle = '#fff7d7';
      c.lineWidth = 3;
      c.beginPath();
      if (good) {
        c.moveTo(-size * 0.23, 0);
        c.lineTo(-size * 0.03, size * 0.17);
        c.lineTo(size * 0.28, -size * 0.2);
      } else {
        c.moveTo(0, -size * 0.3);
        c.lineTo(0, size * 0.1);
      }
      c.stroke();
      c.restore();
    }
    evidenceMoment(g) {
      const survival = this.effects.findLast((effect) => effect.kind === 'survival');
      const overtake = this.effects.findLast((effect) => effect.kind === 'overtake');
      const raid = this.effects.findLast((effect) => effect.kind === 'raid');
      const defended =
        raid &&
        raid.event.target === this.state.me?.id &&
        !raid.event.success &&
        this.clock - raid.start > raid.duration * 0.68;
      const event = survival || (defended ? raid : overtake);
      if (!event) {
        this.canvas.dataset.evidence = '';
        return;
      }
      const evidence = survival?.evidence;
      const target = evidence?.site === 'nursery' ? g.home : g.pantry;
      const size = Math.min(44, g.w * 0.09);
      const text =
        evidence?.text ||
        (defended ? 'Raid stopped · stores protected' : 'Overtook ' + (overtake.name.length > 22 ? overtake.name.slice(0, 21) + '…' : overtake.name) + ' · #' + overtake.rank);
      const good = evidence ? evidence.good : true;
      const y = Math.min(g.h - 30, target.y + target.ry + 20);
      this.shield(target.x + target.rx * 0.62, target.y - target.ry * 0.4, size, good);
      const c = this.ctx;
      if (good) {
        c.strokeStyle = '#b4eed39a';
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(target.x, target.y, target.rx * 1.02, target.ry * 1.05, 0, 0, TAU);
        c.stroke();
      }
      this.tag(text, g.w / 2, y, Math.min(13, Math.max(9, g.w / 38)), good ? '#d6ffe8' : '#ffdeaf');
      this.canvas.dataset.evidence = evidence
        ? good
          ? 'protected'
          : 'loss'
        : defended
          ? 'raid-defended'
          : 'overtake';
      if (overtake && !survival && !defended) {
        // A growing pennant makes the rank change visible without a dialog.
        c.strokeStyle = '#e6c878';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(g.w * 0.5 + 35, g.surface);
        c.lineTo(g.w * 0.5 + 35, g.surface - 60);
        c.stroke();
        c.fillStyle = '#eec95e';
        c.beginPath();
        c.moveTo(g.w * 0.5 + 35, g.surface - 60);
        c.lineTo(g.w * 0.5 + 70, g.surface - 47);
        c.lineTo(g.w * 0.5 + 35, g.surface - 35);
        c.fill();
      }
    }
    weather(w, h, surface) {
      const c = this.ctx,
        world = this.state?.world || {},
        t = this.clock / 1000;
      c.save();
      c.beginPath();
      c.rect(0, 0, w, surface);
      c.clip();
      if (world.birdStage === 'rain' || this.state?.story?.key === 'rain') {
        for (let i = 0; i < 5; i++) {
          ellipse(c, w * (i / 4), 8, w * 0.2, 28, '#25384755');
        }
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
      if (world.birdStage === 'warning' || this.state?.story?.key === 'birds-warning') {
        const x = this.reduced ? w * 0.65 : w - ((t * 85) % (w + 200));
        ellipse(c, x, surface - 5, 50, 10, '#101b2f55');
        for (const side of [-1, 1]) ellipse(c, x + side * 46, surface - 8, 44, 6, '#101b2f40');
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
      if (!this.overview) this.evidenceMoment(g);
      if (this.state?.story) window.ColonyStoryCanvas?.draw(this, g);
      else this.canvas.dataset.story = '';
      this.effects = this.effects.filter((e) => this.clock - e.start < e.duration);
      if (!this.effects.length) this.canvas.dataset.action = '';
    }
  };
})();
