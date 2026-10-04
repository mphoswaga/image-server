/* Cinematic story overlays for multiplayer only. Outcomes always come from saved server state. */
(function () {
  'use strict';
  const images = {};
  for (const [key, file] of Object.entries({
    pip: 'pip-worker.webp',
    queen: 'queen.webp',
    guard: 'guardian.webp',
    shoe: 'human-leg-shoe.png',
  })) {
    const image = new Image();
    image.src = '/assets/colonyquest/' + file;
    images[key] = image;
  }
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const oval = (c, x, y, rx, ry, fill, stroke) => {
    c.beginPath();
    c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 2;
      c.stroke();
    }
  };
  function acorn(c, x, y, size, turn) {
    c.save();
    c.translate(x, y);
    c.rotate(turn);
    const gold = c.createLinearGradient(-size, 0, size, 0);
    gold.addColorStop(0, '#ae6825');
    gold.addColorStop(0.45, '#ffe5a0');
    gold.addColorStop(1, '#c5812f');
    oval(c, 0, size * 0.1, size * 0.58, size * 0.75, gold, '#815729');
    oval(c, 0, -size * 0.4, size * 0.7, size * 0.32, '#775336', '#ffe1a0');
    c.strokeStyle = '#e4b667';
    c.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(i * size * 0.2 - size * 0.1, -size * 0.52);
      c.lineTo(i * size * 0.2 + size * 0.12, -size * 0.28);
      c.stroke();
    }
    c.strokeStyle = '#63472c';
    c.lineWidth = size * 0.1;
    c.beginPath();
    c.moveTo(0, -size * 0.7);
    c.quadraticCurveTo(size * 0.12, -size * 0.96, size * 0.3, -size * 0.9);
    c.stroke();
    c.restore();
  }
  window.ColonyStoryCanvas = {
    draw(scene, g) {
      const story = scene.state?.story;
      if (!story) return;
      const c = scene.ctx,
        w = g.w,
        h = g.h,
        ground = scene.overview ? h * 0.65 : g.surface;
      const elapsed = Math.min(story.duration, story.elapsed + Math.max(0, scene.clock - scene.receivedAt));
      const p = clamp(elapsed / story.duration),
        t = scene.reduced ? 0 : elapsed / 1000;
      const q = scene.reduced ? 0.65 : p,
        size = Math.min(w * 0.16, Math.max(55, h * 0.14));
      const own = story.results?.find((r) => r.playerId === scene.state.me?.id);
      scene.canvas.dataset.story = story.key;
      c.save();
      // Soft focus only over the scene. Question and answer controls live outside this canvas.
      const glow = c.createRadialGradient(w * 0.5, ground * 0.6, 0, w * 0.5, ground * 0.6, w * 0.65);
      glow.addColorStop(0, '#ffedbe25');
      glow.addColorStop(1, '#151d243d');
      c.fillStyle = glow;
      c.fillRect(0, 0, w, h);
      if (story.key === 'intro') {
        acorn(c, w * 0.74, ground * 0.55, size * 0.46, Math.sin(t) * 0.05);
        scene.sprite(images.pip, lerp(w * 0.16, w * 0.39, clamp(q * 2)), ground - size * 0.25, size);
        scene.sprite(images.guard, w * 0.59, ground - size * 0.23, size * 0.92);
        for (let i = 0; i < 7; i++) oval(c, w * (0.2 + i * 0.09), ground + 16, 3, 3, '#ffe7a0');
      } else if (story.key === 'fallen-fruit') {
        const fall = clamp(q * 2.8),
          bounce = Math.abs(Math.sin(fall * Math.PI * 2)) * (1 - fall) * size;
        const x = w * 0.69,
          y = lerp(-size, ground - size * 0.27, fall) - bounce;
        const berry = c.createRadialGradient(x - 10, y - 12, 2, x, y, size * 0.4);
        berry.addColorStop(0, '#ffc365');
        berry.addColorStop(0.5, '#e77a3c');
        berry.addColorStop(1, '#98462e');
        oval(c, x, y, size * 0.4 * (q > 0.65 ? 1 - (q - 0.65) : 1), size * 0.32, berry, '#783e28');
        scene.leaf(x, y - size * 0.29, size * 0.16);
        for (let i = 0; i < 4; i++) {
          const travel = clamp((q - 0.32) * 1.5),
            ax = lerp(w * 0.48, w * 0.67, travel < 0.5 ? travel * 2 : 2 - travel * 2) - i * size * 0.27;
          scene.ant(
            ax,
            ground - 5,
            size * 0.52,
            travel > 0.5 ? Math.PI : 0,
            i,
            'worker',
            travel > 0.5 ? 'seed' : null,
          );
        }
      } else if (story.key === 'food-trail') {
        for (let i = 0; i < 9; i++) {
          const x = w * (0.18 + i * 0.075);
          scene.cargo(x, ground - 8, 'seed', 7);
          if (q > i / 11) oval(c, x, ground - 21, 2, 2, '#fff0b0');
        }
        for (let i = 0; i < 4; i++)
          scene.ant(
            w * (0.18 + q * 0.64) - i * size * 0.38,
            ground - 8,
            size * 0.6,
            0,
            i,
            'worker',
            q > 0.5 ? 'seed' : null,
          );
      } else if (story.key === 'predator') {
        const toward = q < 0.55 ? q / 0.55 : 1 - (q - 0.55) / 0.45;
        scene.creature(
          'spider',
          lerp(w + size, w * 0.64, toward),
          ground - size * 0.24,
          size * 1.3,
          t,
          q > 0.55,
        );
        const x = w * 0.48 + Math.min(q, 0.5) * w * 0.12;
        scene.sprite(images.guard, x, ground - size * 0.26, size);
        if (q > 0.55) {
          c.strokeStyle = '#ffe7a1';
          c.lineWidth = 3;
          for (let i = 0; i < 3; i++) {
            c.beginPath();
            c.moveTo(x + size * 0.34 + i * 9, ground - size * 0.6);
            c.lineTo(x + size * 0.41 + i * 9, ground - size * 0.73);
            c.stroke();
          }
        }
      } else if (story.key === 'tunnel-collapse') {
        const x = w * 0.5,
          y = scene.overview ? ground : g.home.y - g.home.ry;
        for (let i = 0; i < 9; i++) {
          const fall = clamp(q * 3),
            clear = clamp((q - 0.5) * 2),
            dx = ((i % 3) - 1) * size * 0.22;
          oval(
            c,
            x + dx + clear * (i % 2 ? 1 : -1) * size,
            y - ((i / 3) | 0) * size * 0.15 - (1 - fall) * size,
            size * 0.15 * (1 - clear * 0.8),
            size * 0.1,
            '#a98d68',
            '#5e4e3c',
          );
        }
        for (let i = 0; i < 2; i++)
          scene.ant(
            x + (i ? 1 : -1) * size * 0.55,
            y + size * 0.1,
            size * 0.65,
            i ? Math.PI : 0,
            i,
            'builder',
            q > 0.65 ? 'stick' : null,
          );
      } else if (story.key === 'lost-ant') {
        const x = lerp(w * 0.9, w * 0.5, q),
          y = ground - 6;
        for (let i = 0; i < 8; i++)
          oval(
            c,
            w * (0.52 + i * 0.05),
            ground - 4,
            3,
            3,
            `rgba(250,234,160,${0.4 + Math.sin(t * 3 + i) * 0.25})`,
          );
        scene.ant(x, y, size * 0.44, Math.PI, 4, 'worker', null, q < 0.94);
        scene.sprite(images.pip, w * 0.43, ground - size * 0.2, size * 0.8);
        if (q > 0.8)
          for (let i = 0; i < 5; i++) scene.cargo(w * 0.49 + (i - 2) * 8, ground - 18 - q * 12, 'seed', 5);
      } else if (story.key === 'new-territory') {
        const x = w * 0.75,
          y = scene.overview ? ground + 25 : g.home.y + g.home.ry;
        c.save();
        c.translate(x, y);
        c.rotate(-q * 0.7);
        c.strokeStyle = '#674028';
        c.lineWidth = size * 0.17;
        c.beginPath();
        c.moveTo(-size * 0.55, 0);
        c.quadraticCurveTo(0, -size * 0.65, size * 0.6, -size * 0.1);
        c.stroke();
        c.restore();
        scene.ant(x - size * 0.5, y, size * 0.6, 0, 2, 'builder');
        for (let i = 0; i < 6; i++)
          oval(c, x + Math.sin(i) * q * size, y - Math.abs(Math.cos(i)) * q * size * 0.6, 2, 2, '#ffd285');
      } else if (story.key === 'dry') {
        const sunX = w * 0.79,
          sunY = Math.max(30, ground * 0.33);
        oval(c, sunX, sunY, size * 0.28, size * 0.28, '#ffe3a5');
        c.strokeStyle = '#f3c563';
        c.lineWidth = 2;
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5;
          c.beginPath();
          c.moveTo(sunX + Math.cos(a) * size * 0.35, sunY + Math.sin(a) * size * 0.35);
          c.lineTo(sunX + Math.cos(a) * size * 0.45, sunY + Math.sin(a) * size * 0.45);
          c.stroke();
        }
        scene.sprite(images.queen, w * 0.4, ground - size * 0.2, size);
      } else if (story.key === 'rain') {
        scene.ant(w * 0.45, ground - 5, size * 0.65, 0, 2, 'builder', 'stick');
        if (own?.food < 0 && !scene.overview) {
          c.strokeStyle = '#8dd8e1aa';
          c.lineWidth = 5;
          c.beginPath();
          c.moveTo(w * 0.5, ground);
          c.lineTo(w * 0.5, g.home.y);
          c.stroke();
          oval(c, g.home.x, g.home.y + g.home.ry * 0.45, g.home.rx * 0.55 * q, 5, '#78becaaa');
        } else {
          c.strokeStyle = '#bce2ba';
          c.lineWidth = 4;
          c.beginPath();
          c.arc(w * 0.5, ground + 6, size * 0.5, Math.PI, 0);
          c.stroke();
        }
      } else if (story.key === 'birds' || story.key === 'birds-warning') {
        for (let i = 0; i < 3; i++) {
          const x = lerp(w * 1.1, -w * 0.1, q) + i * size * 1.15,
            y = ground - size * 0.4 - Math.sin(q * Math.PI) * ground * 0.35 - (i % 2) * size * 0.2;
          scene.creature('bird', x, y, size * 1.5, t + i * 0.2);
          if (q > 0.55 && own?.food < 0) scene.cargo(x, y + size * 0.13, 'seed', 7);
        }
        scene.sprite(images.guard, w * 0.48, ground - size * 0.26, size);
      } else if (story.key === 'footsteps-warning' || story.key === 'footsteps') {
        const warning = story.key === 'footsteps-warning';
        const shade = warning ? 0.15 + 0.15 * Math.sin(t * 3) : 0.25;
        c.fillStyle = `rgba(30,36,37,${shade})`;
        c.fillRect(0, 0, w, ground);
        if (!warning) {
          const y = lerp(-h * 0.6, ground, clamp(q * 2));
          const shoe = images.shoe;
          if (shoe.complete && shoe.naturalWidth) {
            const sw = Math.min(w * 0.56, h * 0.75),
              sh = (sw * shoe.naturalHeight) / shoe.naturalWidth;
            c.drawImage(shoe, w * 0.5 - sw * 0.5, y - sh, sw, sh);
          }
          if (q > 0.45)
            for (let i = 0; i < 16; i++)
              oval(
                c,
                w * 0.5 + Math.cos(i) * size * (q - 0.4) * 4,
                ground - Math.sin(i * 4) ** 2 * size * (q - 0.4),
                5 * (1 - q),
                4 * (1 - q),
                '#e4bb7a',
              );
          if (own?.pointsLost && !scene.overview) {
            c.strokeStyle = '#4d332a';
            c.lineWidth = 3;
            c.beginPath();
            c.moveTo(g.home.x - g.home.rx * 0.6, g.home.y - g.home.ry);
            c.lineTo(g.home.x - g.home.rx * 0.35, g.home.y);
            c.lineTo(g.home.x - g.home.rx * 0.45, g.home.y + g.home.ry * 0.3);
            c.stroke();
          }
        }
      } else if (story.key === 'acorn') {
        const x = w * 0.5,
          y = ground + Math.min(h * 0.22, 110);
        const halo = c.createRadialGradient(x, y, 5, x, y, size * 1.5);
        halo.addColorStop(0, '#ffe69965');
        halo.addColorStop(1, '#ffe69900');
        c.fillStyle = halo;
        c.fillRect(x - size * 1.5, y - size * 1.5, size * 3, size * 3);
        acorn(c, x, y, size * 0.8, Math.sin(t * 1.3) * 0.07);
        for (let i = 0; i < 18; i++) {
          const angle = (i * Math.PI) / 9 + t * 0.3,
            r = size * (0.8 + q * 0.9);
          oval(
            c,
            x + Math.cos(angle) * r,
            y + Math.sin(angle) * r * 0.65,
            2.2,
            2.2,
            ['#ffe8ac', '#aee2b1', '#e4bafa'][i % 3],
          );
        }
        scene.sprite(images.queen, x - size * 1.25, y + size * 0.2, size);
        scene.sprite(images.pip, x + size * 1.12, y + size * 0.3, size * 0.7);
      }
      c.restore();
    },
  };
})();
