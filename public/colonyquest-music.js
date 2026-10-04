/* Shared, streamed soundtrack for both ColonyQuest modes. */
(function (root) {
  'use strict';
  const tracks = [
    {
      title: 'Ghibli Station',
      artist: 'The Mini Vandals',
      src: '/assets/colonyquest/music/ghibli-station-the-mini-vandals.mp3',
    },
    {
      title: 'Toys Are Us',
      artist: 'Blue Deer Studio',
      src: '/assets/colonyquest/music/toys-are-us-blue-deer-studio.mp3',
    },
  ];
  root.ColonyMusic = class {
    constructor(onTrack = () => {}) {
      this.media = document.createElement('audio');
      this.media.hidden = true;
      this.media.preload = 'none';
      this.media.dataset.colonyMusic = 'true';
      this.media.volume = 0.3;
      document.body.appendChild(this.media);
      this.index = 0;
      this.active = false;
      this.pending = false;
      this.blocked = false;
      this.failed = new Set();
      this.onTrack = onTrack;
      this.selectTrack();
      this.media.addEventListener('ended', () => {
        this.failed.clear();
        this.next();
      });
      this.media.addEventListener('error', () => {
        this.failed.add(this.index);
        if (this.failed.size < tracks.length) this.next();
        else this.blocked = true; // A missing soundtrack must never stop a question.
      });
      document.addEventListener('visibilitychange', () => this.sync());
      const unlock = () => {
        if (!this.blocked) return;
        this.blocked = false;
        this.failed.clear();
        if (this.media.error) this.media.load();
        this.sync();
      };
      document.addEventListener('pointerdown', unlock);
      document.addEventListener('keydown', unlock);
      window.addEventListener('pagehide', () => this.media.pause());
    }
    selectTrack() {
      const track = tracks[this.index];
      this.media.src = track.src;
      this.media.title = `${track.title} — ${track.artist}`;
      this.onTrack(track);
    }
    next() {
      this.index = (this.index + 1) % tracks.length;
      this.selectTrack();
      this.sync();
    }
    setActive(active) {
      this.active = !!active;
      this.sync();
    }
    setVolume(volume) {
      this.media.volume = Math.max(0, Math.min(1, Number(volume) || 0));
      this.sync();
    }
    shouldPlay() {
      return this.active && !document.hidden && this.media.volume > 0;
    }
    sync() {
      if (!this.shouldPlay()) {
        this.media.pause();
        return;
      }
      if (this.blocked || this.pending || !this.media.paused) return;
      this.pending = true;
      Promise.resolve(this.media.play())
        .then(() => {
          if (!this.shouldPlay()) this.media.pause();
        })
        .catch((error) => {
          if (error.name !== 'AbortError') this.blocked = true;
        })
        .finally(() => {
          this.pending = false;
        });
    }
  };
})(window);
