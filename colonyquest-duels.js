"use strict";
const crypto = require("node:crypto"),
  core = require("./public/colonyquest-core"),
  presentation = require("./public/colony-presentation");
const mix = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
module.exports = function install(ColonyMatch) {
  const P = ColonyMatch.prototype,
    base = {};
  for (const name of [
    "startIndividual",
    "tickIndividual",
    "upgrade",
    "raidAllowed",
    "finishPersonalQuestion",
    "snapshot",
    "pause",
    "resume",
    "end",
    "report",
    "settleAnswers",
    "teams",
    "options",
  ])
    base[name] = P[name];
  function pairFor(m, id) {
    return m.state.duels?.pairs?.find((pair) => pair.ids.includes(id));
  }
  function hold(p, kind, now) {
    if (!p.duelHold)
      p.duelHold = {
        phase: p.phase,
        remaining: p.deadline == null ? null : Math.max(0, p.deadline - now),
      };
    p.phase = kind;
    p.deadline = null;
  }
  function release(m, p, now) {
    const h = p.duelHold;
    if (!h) return;
    delete p.duelHold;
    m.setPersonalPhase(
      p,
      h.phase,
      h.remaining === null ? null : h.remaining / 1000,
      now,
    );
  }
  function points(m, p) {
    return (
      Math.max(
        0,
        Math.round(
          core.colonyStrength({ ...p.colony, correct: 0, attempts: 0 }) -
            (p.duelBaseline || 0),
        ),
      ) +
      10 *
        (p.answers.filter((a) => a.correct).length -
          (p.duelCorrectBaseline || 0))
    );
  }
  function score(m, now, partial = false) {
    const d = m.state.duels;
    if (!d || d.scored === d.round) return;
    d.scored = d.round;
    const results = d.pairs.map((pair) => {
      const a = m.player(pair.ids[0]),
        b = m.player(pair.ids[1]),
        as = points(m, a),
        bs = points(m, b),
        winner = as === bs ? null : as > bs ? a : b;
      for (const p of [a, b]) p.duelPoints = (p.duelPoints || 0) + points(m, p);
      if (winner) {
        winner.duelWins = (winner.duelWins || 0) + 1;
        if (!winner.npc)
          d.teams[winner.duelTeam] = (d.teams[winner.duelTeam] || 0) + 1;
      }
      return {
        ids: pair.ids,
        names: [a.name, b.name],
        scores: [as, bs],
        winner: winner?.id || null,
      };
    });
    d.history.push({ round: d.round, at: now, partial, results });
    d.history = d.history.slice(-100);
    m.event(
      "Duel " + d.round + " results",
      { kind: "duel-results", round: d.round, results },
      now,
    );
  }
  function begin(m, now) {
    const s = m.state,
      d = s.duels;
    for (const p of s.players.filter((p) => p.duelComputer)) p.removed = true;
    let players = m.active().filter((p) => p.phase !== "spectating");
    if (!players.length) return base.end.call(m, now);
    if (players.length % 2) {
      const id = crypto.randomUUID(),
        p = {
          id,
          studentId: "duel-computer-" + id,
          name: "Captain Byte · computer",
          npc: true,
          duelComputer: true,
          joined: true,
          connected: true,
          removed: false,
          answers: [],
          upgrades: [],
          round: Math.min(...players.map((p) => p.round || 0)),
          duelTeam: "Computer",
          colony: core.createTeam(
            { id, name: "Captain Byte · computer", colorIndex: 5 },
            5,
          ),
        };
      s.players.push(p);
      players.push(p);
    }
    d.round++;
    d.stage = "intro";
    d.stageUntil = now + 5000;
    d.deadline = d.stageUntil + d.minutes * 60000;
    d.pairs = [];
    const pool = mix(players);
    while (pool.length) {
      const a = pool.shift();
      let i = pool.findIndex(
        (b) => b.duelTeam !== a.duelTeam && b.id !== a.lastDuelRival,
      );
      if (i < 0) i = pool.findIndex((b) => b.id !== a.lastDuelRival);
      if (i < 0) i = 0;
      const b = pool.splice(i, 1)[0];
      a.lastDuelRival = b.id;
      b.lastDuelRival = a.id;
      d.pairs.push({
        id: crypto.randomUUID(),
        ids: [a.id, b.id],
        deadline: d.deadline,
        queue: null,
        raid: null,
      });
    }
    for (const p of players) {
      const color = p.colony.colorIndex;
      p.colony = m.startingColony(
        { id: p.id, name: p.name, colorIndex: color },
        color,
      );
      p.lastRaids = {};
      p.protectedUntilMs = 0;
      p.duelAnswerBaseline = p.answers.length;
      p.duelCorrectBaseline = p.answers.filter((a) => a.correct).length;
      p.duelBaseline = core.colonyStrength(p.colony);
      delete p.duelHold;
      const building = s.continuePlaying && p.round >= s.questions.length;
      m.setPersonalPhase(p, building ? "upgrade" : "answer", building ? s.upgradeSeconds : s.questionSeconds, now);
      hold(p, "duelIntro", now);
    }
    m.event(
      "Duel " + d.round + " · new opponents",
      {
        kind: "duel-intro",
        round: d.round,
        pairs: d.pairs.map((p) => ({
          ids: p.ids,
          names: p.ids.map((id) => m.player(id).name),
        })),
      },
      now,
    );
    d.lastTick = now;
  }
  P.startIndividual = function (now) {
    base.startIndividual.call(this, now);
    const d = this.state.duels;
    if (!d) return;
    const players = mix(this.active());
    players.forEach((p, i) => {
      p.duelTeam =
        d.teamMode === "gender"
          ? p.gender === "female"
            ? "Girls"
            : p.gender === "male"
              ? "Boys"
              : "Unassigned"
          : d.teamNames[i % 2];
      p.duelWins = 0;
      p.duelPoints = 0;
      d.teams[p.duelTeam] = 0;
    });
    begin(this, now);
  };
  P.finishPersonalQuestion = function (p, now) {
    base.finishPersonalQuestion.call(this, p, now);
    const d = this.state.duels,
      pair = pairFor(this, p.id);
    if (
      d &&
      p.phase !== "spectating" &&
      (d.stage === "closing" ||
        now >= pair?.deadline ||
        pair?.queue ||
        pair?.raid)
    )
      hold(p, "duelWait", now);
  };
  P.raidAllowed = function (p, target) {
    const d = this.state.duels;
    if (d && !this.executingDuelRaid) {
      const pair = pairFor(this, p.id);
      if (!pair?.ids.includes(target?.id))
        return { allowed: false, reason: "Raid your matched rival." };
      if (
        d.stage !== "playing" ||
        this.lastTick >= pair.deadline ||
        pair.queue ||
        pair.raid
      )
        return {
          allowed: false,
          reason: "Wait for this duel or raid to finish.",
        };
    }
    const result = base.raidAllowed.call(this, p, target);
    if (d && result.reason)
      result.reason = result.reason.replace(
        "Try another rival; this colony is protected for",
        "Your rival is protected for",
      );
    return result;
  };
  P.options = function (p) {
    const options = base.options.call(this, p);
    if (!this.state.duels) return options;
    const pair = pairFor(this, p?.id);
    return options.filter(
      (o) => o.key !== "raid" || pair?.ids.includes(o.target),
    );
  };
  P.upgrade = function (id, round, key, target, now = Date.now()) {
    const d = this.state.duels;
    if (!d || key !== "raid" || this.executingDuelRaid)
      return base.upgrade.call(this, id, round, key, target, now);
    const p = this.player(id),
      rival = this.player(target),
      pair = pairFor(this, id);
    if (
      !p ||
      p.teacherPaused ||
      this.state.phase !== "answer" ||
      p.phase !== "upgrade" ||
      round !== p.round ||
      now >= p.deadline ||
      !(this.state.continuePlaying && round >= this.state.questions.length) && !p.answers.some((a) => a.round === round && a.correct)
    )
      throw Error(
        "Answer correctly and choose your raid during the upgrade turn.",
      );
    if (now >= pair?.deadline)
      throw Error(
        "Duel time has ended. Choose another upgrade to finish your turn.",
      );
    const allowed = this.raidAllowed(p, rival);
    if (!allowed.allowed) throw Error(allowed.reason);
    pair.queue = { attacker: id, target, round, at: now };
    hold(p, "duelWait", now);
    this.event(
      p.name + " is preparing a raid on " + rival.name,
      { kind: "duel-raid-queued", attacker: id, target },
      now,
    );
  };
  P.tickIndividual = function (now) {
    const s = this.state,
      d = s.duels;
    if (!d) return base.tickIndividual.call(this, now);
    const delta = Math.max(0, now - (d.lastTick || now));
    d.lastTick = now;
    const playing = d.stage === "playing" || d.stage === "closing";
    if (playing) {
      d.gameRemainingMs = Math.max(
        0,
        (d.gameRemainingMs ?? (d.gameMinutes || 15) * 60000) - delta,
      );
      if (d.gameRemainingMs === 0) {
        d.gameExpired = true;
        d.stage = "closing";
        for (const pair of d.pairs)
          pair.deadline = Math.min(pair.deadline, now);
      }
    }
    if (d.stage === "intro" || d.stage === "results") {
      this.lastTick = now;
      if (now >= d.stageUntil) {
        if (d.stage === "results")
          return d.gameExpired ? this.end(now) : begin(this, now);
        d.stage = "playing";
        for (const pair of d.pairs)
          for (const id of pair.ids) {
            const p = this.player(id);
            if (p.connected && !p.teacherPaused) release(this, p, now);
          }
      } else return;
    }
    for (const pair of d.pairs) {
      const members = pair.ids.map((id) => this.player(id));
      if (members.some((p) => p.removed)) {
        pair.cancelled = true;
        pair.deadline = Math.min(pair.deadline, now);
        pair.queue = null;
        pair.raid = null;
        for (const p of members)
          if (p.removed) {
            p.phase = "spectating";
            delete p.duelHold;
          }
      }
      const unavailable = members.some(
        (p) => !p.removed && (p.teacherPaused || !p.connected),
      );
      if (unavailable) {
        pair.deadline += delta;
        if (pair.raid) pair.raid.until += delta;
        for (const p of members)
          if (!p.teacherPaused && !p.removed && p.connected)
            hold(p, "duelWait", now);
        continue;
      }
      if (!pair.queue && !pair.raid && now < pair.deadline)
        for (const p of members)
          if (
            p.duelHold &&
            ["duelWait", "duelIntro"].includes(p.phase) &&
            d.stage !== "closing"
          )
            release(this, p, now);
      if (pair.raid) {
        if (now >= pair.raid.until) {
          const attacker = this.player(pair.raid.attacker);
          delete attacker.duelHold;
          base.finishPersonalQuestion.call(this, attacker, now);
          const target = this.player(pair.raid.target);
          release(this, target, now);
          pair.raid = null;
          if (d.stage === "closing")
            for (const p of members)
              if (p.phase === "answer") hold(p, "duelWait", now);
        }
        continue;
      }
      if (pair.queue) {
        const target = this.player(pair.queue.target);
        if (
          target.phase !== "answer" &&
          target.phase !== "upgrade" &&
          (target.phase !== "reveal" || now >= target.deadline)
        ) {
          const q = pair.queue,
            attacker = this.player(q.attacker);
          release(this, attacker, now);
          this.setPersonalPhase(
            attacker,
            "upgrade",
            this.state.upgradeSeconds,
            now,
          );
          this.executingDuelRaid = true;
          try {
            base.upgrade.call(this, q.attacker, q.round, "raid", q.target, now);
          } catch (error) {
            this.event(
              "Raid cancelled: " + error.message,
              {
                kind: "duel-raid-cancelled",
                attacker: q.attacker,
                target: q.target,
              },
              now,
            );
            this.setPersonalPhase(attacker, "reveal", 1, now);
            pair.queue = null;
            release(this, target, now);
            continue;
          } finally {
            this.executingDuelRaid = false;
          }
          pair.queue = null;
          hold(attacker, "duelRaid", now);
          hold(target, "duelRaid", now);
          pair.raid = {
            ...q,
            startedAt: now,
            until: now + presentation.raidDuration(true) + 400,
            event: this.state.events.at(-1),
          };
        }
      }
    }
    d.deadline = Math.max(...d.pairs.map((p) => p.deadline));
    if (d.stage === "playing" && d.pairs.every((p) => now >= p.deadline))
      d.stage = "closing";
    base.tickIndividual.call(this, now);
    if (s.phase === "ended") return;
    if (
      d.stage === "closing" &&
      d.pairs.every(
        (pair) =>
          !pair.queue &&
          !pair.raid &&
          pair.ids.every((id) =>
            ["duelWait", "spectating"].includes(this.player(id).phase),
          ),
      )
    ) {
      score(this, now);
      d.stage = "results";
      d.stageUntil =
        now +
        Math.min(20, Math.max(8, Math.ceil(d.pairs.length / 4) * 3)) * 1000;
    }
  };
  P.snapshot = function (id, teacher, now, sharedPlayers, watchId) {
    const out = base.snapshot.call(
        this,
        id,
        teacher,
        now,
        sharedPlayers,
        watchId,
      ),
      d = this.state.duels;
    if (!d) return out;
    if (
      !teacher &&
      (d.stage === "intro" ||
        d.stage === "results" ||
        ["duelWait", "duelRaid", "duelIntro"].includes(
          this.player(id)?.phase,
        )) &&
      this.state.phase !== "ended"
    ) {
      out.phase =
        this.state.phase === "paused" || this.player(id)?.teacherPaused
          ? "paused"
          : d.stage === "results"
            ? "duelResults"
            : d.stage === "intro"
              ? "duelIntro"
              : this.player(id)?.phase;
      out.question = null;
      if (out.me) {
        delete out.me.correct;
        out.me.upgrades = [];
      }
    }
    const pair = pairFor(this, id),
      me = this.player(id),
      rival = pair && this.player(pair.ids.find((other) => other !== id));
    // A broadcast shares one player-summary array across all recipients.
    // Build class rankings once for that batch, rather than once per learner.
    let leaderboard;
    if (sharedPlayers && this.duelRankingCache?.players === sharedPlayers)
      leaderboard = this.duelRankingCache.leaderboard;
    else {
      leaderboard = this.active()
        .filter((p) => !p.npc)
        .map((p) => ({
          id: p.id,
          name: p.name,
          team: p.duelTeam,
          wins: p.duelWins || 0,
          points:
            (p.duelPoints || 0) + (d.scored === d.round ? 0 : points(this, p)),
        }))
        .sort((a, b) => b.wins - a.wins || b.points - a.points);
      if (sharedPlayers)
        this.duelRankingCache = { players: sharedPlayers, leaderboard };
    }
    out.duel = {
      round: d.round,
      stage: d.stage,
      minutes: d.minutes,
      gameMinutes: d.gameMinutes || 15,
      gameRemainingMs: d.gameRemainingMs ?? (d.gameMinutes || 15) * 60000,
      gameExpired: !!d.gameExpired,
      deadline: pair?.deadline || d.deadline,
      stageUntil: d.stageUntil,
      teams: d.teams,
      history: d.history.slice(-1),
      leaderboard,
      ...(teacher
        ? {
            pairs: d.pairs.map((p) => ({
              ...p,
              names: p.ids.map((id) => this.player(id).name),
            })),
          }
        : {}),
      rival: rival
        ? {
            id: rival.id,
            name: rival.name,
            colony: rival.colony,
            team: rival.duelTeam,
            points: points(this, rival),
            connected: rival.connected,
            paused: rival.teacherPaused,
            lastUpgrade: rival.upgrades.at(-1),
          }
        : null,
      points: me ? points(this, me) : 0,
      raid: pair?.raid || null,
      waiting: !!pair?.queue,
    };
    return out;
  };
  P.teams = function () {
    if (!this.state.duels || this.state.phase === "ended")
      return base.teams.call(this);
    return base.teams.call(this).filter((colony) => {
      const pair = pairFor(this, colony.id);
      return (
        !pair ||
        !pair.ids.some((id) => {
          const p = this.player(id);
          return !p.removed && (p.teacherPaused || !p.connected);
        })
      );
    });
  };
  P.settleAnswers = function () {
    base.settleAnswers.call(this);
    if (this.state.duels)
      for (const p of this.state.players) {
        p.colony.correct = Math.max(
          0,
          p.answers.filter((a) => a.correct).length -
            (p.duelCorrectBaseline || 0),
        );
        p.colony.attempts = Math.max(
          0,
          p.answers.length - (p.duelAnswerBaseline || 0),
        );
      }
  };
  P.pause = function (now = Date.now()) {
    base.pause.call(this, now);
    if (this.state.duels) this.state.duels.pausedAt = now;
  };
  P.resume = function (now = Date.now()) {
    const d = this.state.duels,
      elapsed = d ? now - (d.pausedAt || now) : 0;
    base.resume.call(this, now);
    if (d) {
      d.deadline += elapsed;
      d.stageUntil += elapsed;
      for (const pair of d.pairs) {
        pair.deadline += elapsed;
        if (pair.raid) pair.raid.until += elapsed;
      }
      d.lastTick = now;
      delete d.pausedAt;
    }
  };
  P.end = function (now = Date.now()) {
    if (this.state.duels) score(this, now, true);
    return base.end.call(this, now);
  };
  P.report = function () {
    const report = base.report.call(this);
    if (this.state.duels)
      report.duels = {
        gameMinutes: this.state.duels.gameMinutes || 15,
        gameRemainingMs: this.state.duels.gameRemainingMs,
        teams: this.state.duels.teams,
        history: this.state.duels.history,
        players: this.active()
          .filter((p) => !p.npc)
          .map((p) => ({
            studentId: p.studentId,
            name: p.name,
            team: p.duelTeam,
            wins: p.duelWins || 0,
            points: p.duelPoints || 0,
          })),
      };
    return report;
  };
};
