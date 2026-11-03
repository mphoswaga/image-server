/* Paired-colony presentation. Server snapshots own all outcomes and clocks. */
window.ColonyDuelView = class {
  constructor(host) {
    this.host = host;
    this.enabled = false;
    this.volume = 0.5;
    this.key = "";
    this.audioKey = "";
    this.bellKey = "";
    this.nodes = [];
    this.panel = document.createElement("section");
    this.panel.id = "colonyDuelPanel";
    this.panel.className = "colony-duel-panel";
    this.panel.innerHTML =
      '<div class="duel-heading"><strong data-title></strong><span class="duel-clocks"><b data-clock role="timer"></b><small data-game-clock role="timer"></small></span></div><div data-teams></div><div class="duel-tug" aria-label="Duel progress"><span data-a></span><span data-b></span></div><p data-status role="status"></p><p data-raid-result hidden role="status"></p><div data-pairs></div><details><summary>Duel leaderboard · top 10</summary><ol data-leaders></ol></details>';
    document.getElementById(host ? "hostRoom" : "learner").prepend(this.panel);
    this.announcement = document.createElement("section");
    this.announcement.className = "colony-duel-announcement";
    this.announcement.hidden = true;
    this.announcement.setAttribute("role", "status");
    document.body.append(this.announcement);
    this.music = new Audio("/assets/codequest/celebration.wav");
    this.music.preload = "none";
    this.music.loop = false;
    document.addEventListener("visibilitychange", () =>
      this.configure(this.enabled, this.volume),
    );
    document.addEventListener("pointerdown", () => {
      if (!this.enabled) return;
      try {
        this.context ||= new (
          window.AudioContext || window.webkitAudioContext
        )();
        this.context.resume().catch(() => {});
      } catch {}
    });
    window.addEventListener("pagehide", () => {
      this.music.pause();
      this.stopBell();
      this.rivalScene?.destroy();
    });
    if (!host) {
      const stage = document.querySelector(".colony-stage");
      this.own = document.createElement("div");
      this.own.className = "duel-own-stage";
      this.own.append(
        document.getElementById("colonyCanvas"),
        document.getElementById("resources"),
      );
      this.rival = document.createElement("aside");
      this.rival.className = "duel-rival";
      const heading = document.createElement("div");
      heading.className = "duel-rival-heading";
      this.rivalName = document.createElement("strong");
      const button = document.createElement("button");
      button.textContent = "View rival";
      button.onclick = () => {
        const expanded = stage.classList.toggle("inspect-rival");
        button.textContent = expanded ? "Back to my colony" : "View rival";
      };
      heading.append(this.rivalName, button);
      this.rivalStats = document.createElement("small");
      const canvas = document.createElement("canvas");
      canvas.id = "rivalColonyCanvas";
      canvas.setAttribute("aria-label", "Your rival’s live colony");
      this.rival.append(heading, this.rivalStats, canvas);
      stage.append(this.own, this.rival);
      this.rivalScene = new ColonyScene(canvas);
      this.rivalScene.isRival=true;
    }
  }
  el(selector) {
    return this.panel.querySelector(selector);
  }
  stopBell() {
    for (const node of this.nodes)
      try {
        node.stop();
      } catch {}
    this.nodes = [];
  }
  bell() {
    if (!this.host || !this.enabled || document.hidden) return;
    try {
      this.context ||= new (window.AudioContext || window.webkitAudioContext)();
      this.context.resume();
      for (let n = 0; n < 2; n++)
        for (const frequency of [660, 1327, 1822]) {
          const oscillator = this.context.createOscillator(),
            gain = this.context.createGain(),
            at = this.context.currentTime + n * 0.65;
          oscillator.connect(gain);
          gain.connect(this.context.destination);
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.055 * this.volume, at);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.8);
          oscillator.start(at);
          oscillator.stop(at + 0.85);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
            this.nodes = this.nodes.filter((n) => n !== oscillator);
          };
          this.nodes.push(oscillator);
        }
    } catch {}
  }
  configure(enabled, volume) {
    this.enabled = enabled;
    this.volume = volume;
    this.music.volume = Math.min(0.5, volume * 0.45);
    if (!enabled || document.hidden || this.state?.phase === "paused") {
      this.music.pause();
      this.stopBell();
      return;
    }
    const d = this.state?.duel,
      celebrate = this.host && d && (d.stage === "results" || this.state.phase === "ended");
    if (celebrate) {
      const key =
        this.state.id +
        ":" +
        d.round +
        ":" +
        (this.state.phase === "ended" ? "final" : "round");
      if (key !== this.audioKey) {
        this.audioKey = key;
        this.music.currentTime = 0;
      }
      if (this.music.paused && !this.music.ended)
        this.music.play().catch(() => {});
    } else this.music.pause();
  }
  hide() {
    this.panel.hidden = true;
    this.announcement.hidden = true;
    this.music.pause();
    this.stopBell();
    this.rivalScene?.update(null);
    document.body.classList.remove("colony-duel-mode", "colony-duel-raid");
  }
  sync(s, enabled, volume) {
    this.state = s;
    const d = s.duel;
    if (!d) {
      this.hide();
      return;
    }
    this.panel.hidden = false;
    document.querySelector(".brand small").textContent = "PAIRED COLONY DUELS";
    document.body.classList.add("colony-duel-mode");
    document.body.classList.toggle(
      "colony-duel-raid",
      !!d.raid && s.phase !== "paused",
    );
    this.configure(enabled, volume);
    const me = s.me,
      rival = d.rival;
    this.el("[data-title]").textContent =
      (d.stage === "lobby" ? "Colony duels · Lobby" : "Duel " + d.round) +
      (rival ? " · " + me.name + " vs " + rival.name : " · colony rivals");
    this.el("[data-teams]").textContent = Object.entries(d.teams)
      .map(([team, wins]) => team + ": " + wins + " wins")
      .join("   ·   ");
    const a = Math.max(0, d.points || 0),
      b = Math.max(0, rival?.points || 0),
      share = a + b ? (a / (a + b)) * 100 : 50;
    this.el("[data-a]").style.width = share + "%";
    this.el("[data-b]").style.width = 100 - share + "%";
    this.el("[data-status]").textContent = d.raid
      ? d.raid.event.attackerName +
        " raids " +
        d.raid.event.targetName +
        "! Both colonies watch the same battle."
      : d.waiting
        ? "Raid queued — waiting for the current question and upgrade to finish."
        : s.phase === "paused"
          ? "Paused by teacher."
          : d.stage === "closing"
            ? "Time is up. Finish your current turn before the next duel."
            : rival
              ? (a === b
                  ? "Level duel"
                  : a > b
                    ? "Your colony is ahead"
                    : "Your rival is ahead") +
                " · " +
                a +
                " vs " +
                b +
                " duel points. Answer correctly to build faster."
              : "Independent answers · synchronised raids · fresh colonies each duel.";
    if (rival && this.rivalScene) {
      if (this.rivalId !== rival.id + ":" + d.round) {
        this.rivalScene.update(null);
        this.rivalId = rival.id + ":" + d.round;
      }
      this.rivalName.textContent =
        rival.name + (rival.connected ? "" : " · reconnecting");
      this.rivalStats.textContent =
        "🌾 " +
        Math.floor(rival.colony.food) +
        " · 🛡 " +
        ColonyQuestCore.homeGuards(rival.colony) +
        " · Wall " +
        (rival.colony.defense + 1);
      this.rivalScene.update({
        ...s,
        me: {
          id: rival.id,
          name: rival.name,
          colony: rival.colony,
          lastUpgrade: rival.lastUpgrade,
        },
        story: s.story ? { ...s.story, results: [] } : null,
      });
    }
    const signature = JSON.stringify([
      d.round,
      d.stage,
      d.leaderboard,
      d.pairs?.map((p) => [p.names, p.raid?.startedAt, p.queue?.at]),
    ]);
    if (this.key !== signature) {
      this.key = signature;
      const list = this.el("[data-leaders]");
      list.replaceChildren();
      for (const p of d.leaderboard.slice(0, 10)) {
        const li = document.createElement("li");
        li.textContent =
          p.name +
          " · " +
          p.wins +
          " wins · " +
          p.points +
          " points · " +
          p.team;
        list.append(li);
      }
      this.el("[data-pairs]").textContent = this.host
        ? (d.pairs || [])
            .map(
              (p) =>
                p.names.join(" vs ") +
                (p.raid ? " · RAID" : p.queue ? " · raid queued" : ""),
            )
            .join("   •   ")
        : "";
    }
    const show = ["intro", "results"].includes(d.stage) && s.phase !== "ended";
    this.announcement.hidden = !show;
    if (show) {
      const k = s.id + ":" + d.round + ":" + d.stage;
      if (this.announcement.dataset.key !== k) {
        this.announcement.dataset.key = k;
        this.announcement.replaceChildren();
        const h = document.createElement("h1");
        h.textContent =
          d.stage === "intro" ? "Meet your colony rival!" : "Duel results";
        this.announcement.append(h);
        if (d.stage === "results") {
          const grid = document.createElement("div");
          grid.className = "duel-results-grid";
          for (const result of d.history.at(-1)?.results || []) {
            const card = document.createElement("article"),
              winner = document.createElement("strong"),
              details = document.createElement("p");
            winner.textContent = result.winner
              ? "🏆 " +
                result.names[result.ids.indexOf(result.winner)] +
                " won!"
              : "🤝 Draw";
            details.textContent =
              result.names.join(" vs ") + " · " + result.scores.join(" – ");
            card.append(winner, details);
            grid.append(card);
          }
          this.announcement.append(grid);
          const next = document.createElement("p");
          next.textContent = d.gameExpired
            ? "Game complete · final celebration next"
            : "Next opponents appear after this celebration";
          this.announcement.append(next);
        } else if (this.host) {
          const p = document.createElement("p");
          p.textContent = (d.pairs || [])
            .map((p) => p.names.join(" vs "))
            .join(" · ");
          this.announcement.append(p);
        } else if (rival) {
          for (const [i, p] of [me, rival].entries()) {
            const figure = document.createElement("figure"),
              img = document.createElement("img"),
              caption = document.createElement("figcaption");
            img.src =
              "/assets/colonyquest/" +
              (i ? "guardian" : "pip-worker") +
              ".webp";
            img.alt = "Ant captain";
            caption.textContent = p.name;
            figure.append(img, caption);
            this.announcement.append(figure);
          }
          if (d.stage === "results") {
            const result = d.history
                .at(-1)
                ?.results.find((r) => r.ids.includes(me.id)),
              p = document.createElement("p");
            p.textContent = result?.winner
              ? (result.winner === me.id ? me.name : rival.name) +
                " wins this duel!"
              : "A shared victory — this duel is a draw!";
            this.announcement.append(p);
          }
        }
        const timer = document.createElement("b");
        timer.dataset.announcementClock = "true";
        this.announcement.append(timer);
      }
      if (
        d.stage === "intro" &&
        s.phase !== "paused" &&
        s.phase !== "lobby" &&
        this.bellKey !== k &&
        this.enabled &&
        !document.hidden
      ) {
        this.bellKey = k;
        this.bell();
      }
    }
    this.clock(s.serverNow);
  }
  clock(now) {
    const s = this.state,
      d = s?.duel;
    if (!d) return;
    const paused = s.phase === "paused",
      deadline = ["intro", "results"].includes(d.stage)
        ? d.stageUntil
        : d.deadline,
      seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
    this.el("[data-clock]").textContent = paused
      ? "Paused"
      : d.stage === "closing"
        ? "Finishing turns"
        : Math.floor(seconds / 60) +
          ":" +
          String(seconds % 60).padStart(2, "0");
    const gameSeconds = Math.max(0, Math.ceil((d.gameRemainingMs || 0) / 1000));
    this.el("[data-game-clock]").textContent =
      "Game " +
      Math.floor(gameSeconds / 60) +
      ":" +
      String(gameSeconds % 60).padStart(2, "0");
    const result = this.el("[data-raid-result]");
    const raids = (
      this.host ? (d.pairs || []).map((p) => p.raid) : [d.raid]
    ).filter(
      (raid) =>
        raid && now - raid.startedAt >= (raid.until - raid.startedAt) * 0.6,
    );
    result.hidden = !raids.length;
    if (raids.length)
      result.textContent = raids
        .map((raid) => {
          const e = raid.event;
          return e.success
            ? "🏆 " +
                e.attackerName +
                " wins the raid! " +
                e.stolen +
                " food taken from " +
                e.targetName +
                "."
            : "🛡 " +
                e.targetName +
                " wins the defence! " +
                e.attackerName +
                " was held back.";
        })
        .join(" · ");
    const timer = this.announcement.querySelector("[data-announcement-clock]");
    if (timer) timer.textContent = paused ? "Paused" : seconds;
  }
};
