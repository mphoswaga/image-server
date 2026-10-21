/* Short original musical cues; no downloads and no game state changes. */
(function (root) {
  'use strict';
  class ColonyEventAudio {
    constructor() {
      this.enabled = false;
      this.volume = 0.5;
      this.nodes = [];
      this.seen = new Set();
    }
    configure(enabled, volume) {
      this.enabled = enabled;
      this.volume = Math.max(0, Math.min(1, volume || 0));
      if (!enabled || !this.volume) this.stop();
    }
    stop() {
      for (const n of this.nodes) {
        try {
          n.stop();
        } catch {}
      }
      this.nodes = [];
    }
    tone(freq, time, duration, type = 'sine', gain = 0.035) {
      const c = this.context,
        o = c.createOscillator(),
        g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(gain * this.volume, time + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      o.connect(g);
      g.connect(c.destination);
      o.start(time);
      o.stop(time + duration + 0.03);
      this.nodes.push(o);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
        this.nodes = this.nodes.filter((n) => n !== o);
      };
    }
    play(kind, success = true, duration = 6400) {
      if (!this.enabled || !this.volume || document.hidden) return;
      try {
        this.context ||= new (window.AudioContext || window.webkitAudioContext)();
        this.context.resume().catch(() => {});
        this.stop();
        this.onCue?.(kind === 'raid' ? duration : kind === 'raid-result' ? 1400 : 3000);
        const t = this.context.currentTime + 0.03;
        if (kind === 'raid-result') {
          (success ? [392,494,587,784] : [392,494,659]).forEach((f,i)=>this.tone(f,t+i*.18,.45));
        } else if (kind === 'raid') {
          // Rally, advancing footsteps, clash, then the result motif.
          for (let i = 0; i < 8; i++)
            this.tone(i % 2 ? 110 : 82, t + i * 0.32, 0.2, 'triangle', 0.07);
          this.tone(196, t + duration / 1000 * .5, 0.6, 'triangle');
          this.tone(207.65, t + duration / 1000 * .5, 0.55, 'triangle');
          (success ? [392, 494, 587, 784] : [392, 330, 262]).forEach((f, i) =>
            this.tone(f, t + duration / 1000 * .76 + i * 0.22, 0.5),
          );
        } else if (kind === 'rain') {
          [784, 659, 587, 494, 440, 392, 330, 294].forEach((f, i) =>
            this.tone(f, t + i * 0.18, 0.3),
          );
          this.tone(65, t + 0.5, 1.7, 'triangle', 0.07);
        } else if (['birds', 'birds-warning'].includes(kind)) {
          for (let i = 0; i < 4; i++) {
            this.tone(1046, t + i * 0.5, 0.15);
            this.tone(880, t + i * 0.5 + 0.15, 0.2);
          }
          this.tone(98, t, 2, 'triangle', 0.045);
        } else if (['stomp', 'footsteps', 'footsteps-warning'].includes(kind)) {
          [0, 0.8, 1.6].forEach((d) => this.tone(55, t + d, 0.7, 'triangle', 0.1));
        } else {
          [220, 247, 262, 294].forEach((f, i) => this.tone(f, t + i * 0.42, 0.6, 'triangle'));
        }
      } catch {
        /* Audio must never block gameplay. */
      }
    }
    update(next, prior, host) {
      if (!prior || prior.id !== next.id) {
        this.seen = new Set((next.events || []).map((e) => e.id));
        return;
      }
      const fresh = (next.events || []).filter((e) => !this.seen.has(e.id));
      (next.events || []).forEach((e) => this.seen.add(e.id));
      if (this.seen.size > 200) this.seen = new Set((next.events || []).map((e) => e.id));
      // Learners receive only their raids. The host hears one cue for the latest event.
      const e = fresh
        .filter(
          (e) =>
            e.kind === 'raid' ||
            [
              'rain',
              'birds',
              'stomp',
              'dry',
              'predator',
              'birds-warning',
              'footsteps-warning',
              'footsteps',
              'tunnel-collapse',
            ].includes(e.key || e.kind),
        )
        .at(-1);
      if(e)this.voice?.play(e.kind==='raid'?'raid':e.key||e.kind);
      if (e)
        this.play(
          e.kind === 'raid' ? 'raid' : e.key || e.kind,
          e.kind === 'raid' && !host && e.target === next.me?.id ? !e.success : e.success,
          next.pacing === 'individual' ? 6400 : 8400,
        );
    }
  }
  root.ColonyEventAudio = ColonyEventAudio;
})(window);
