'use strict';
const crypto = require('node:crypto');
const core = require('./public/colonyquest-core');
const story = require('./colonyquest-story');
const ACTIVE = ['answer', 'upgrade', 'reveal', 'story'];
const UPGRADE_KEYS = ['workers', 'food', 'supplies', 'expansion', 'defense', 'soldiers', 'queen'];
const LABELS = {
  workers: 'Worker ant',
  food: 'Gather food',
  supplies: 'Collect materials',
  expansion: 'New room',
  defense: 'Stronger walls',
  soldiers: 'Guard ant',
  queen: 'Nursery egg',
};

// The server owns resources, question clocks and outcomes. Animation positions
// never enter this state: thirty clients send two decisions each per round.
class ColonyMatch {
  constructor(game, { state, preview = false, rosterIds = [], storyEnabled = true, now = Date.now() } = {}) {
    this.state = state || {
      version: 1,
      storyVersion: storyEnabled ? 1 : 0,
      storyQueue: [],
      storySeen: [],
      id: crypto.randomUUID(),
      gameId: game.id,
      title: game.lessonTitle,
      questions: structuredClone(game.questions),
      preview,
      rosterIds,
      phase: 'lobby',
      round: 0,
      players: [],
      events: [],
      startedAt: null,
      endedAt: null,
      updatedAt: now,
      world: { dryOccurred: false, rainOccurred: false, birdStage: null },
      questionSeconds: 25,
      upgradeSeconds: 12,
    };
    this.lastTick = now;
  }
  player(id) {
    return this.state.players.find((p) => p.id === id);
  }
  active() {
    return this.state.players.filter((p) => !p.removed);
  }
  teams() {
    return this.active().map((p) => p.colony);
  }
  world() {
    return { ...this.state.world, teams: this.teams(), phase: 'question' };
  }
  event(text, extra = {}, now = Date.now()) {
    this.state.events.push({ id: crypto.randomUUID(), text, at: now, ...extra });
    this.state.events = this.state.events.slice(-80);
  }
  join(identity, now = Date.now()) {
    const s = this.state;
    let p = s.players.find((p) => p.studentId === identity.studentId);
    if (!p) {
      if (s.phase !== 'lobby') throw Error('This round has started. Ask your teacher to open a new game.');
      if (s.players.length >= 80) throw Error('This room is full.');
      const id = crypto.randomUUID();
      p = {
        id,
        studentId: identity.studentId,
        name: identity.name,
        rosterId: identity.rosterId || null,
        npc: !!identity.npc,
        connected: true,
        removed: false,
        answers: [],
        upgrades: [],
        protectedUntilRound: -1,
        colony: core.createTeam(
          { id, name: identity.name, colorIndex: s.players.length % core.TEAM_COLORS.length },
          s.players.length,
        ),
      };
      s.players.push(p);
    }
    if (p.removed) throw Error('Your teacher has removed you from this game.');
    p.connected = true;
    s.updatedAt = now;
    return p;
  }
  start(now = Date.now()) {
    if (this.state.phase !== 'lobby') throw Error('This game has already started.');
    if (!this.active().some((p) => p.connected && !p.npc))
      throw Error('Wait for at least one learner to join.');
    this.state.startedAt = now;
    if (this.state.storyVersion) {
      this.state.afterStory = 'answer';
      this.beginStory('intro', now);
    } else this.setPhase('answer', this.state.questionSeconds, now);
  }
  beginStory(key, now) {
    const beat = story.beats[key];
    const results = story.apply(this, key);
    this.state.storySeen.push(key);
    this.state.story = {
      key,
      id: `${this.state.round}:${key}`,
      ...beat,
      duration: beat.seconds * 1000,
      results,
    };
    this.event(beat.title, { kind: 'story', key, results }, now);
    this.setPhase('story', beat.seconds, now);
  }
  advanceStory(now) {
    const s = this.state;
    if (s.story?.key === 'rain') s.world.birdStage = 'rush';
    if (s.story?.key === 'birds') s.world.birdStage = 'done';
    const key = s.storyQueue.shift();
    if (key) return this.beginStory(key, now);
    s.story = null;
    if (s.afterStory === 'end') return this.end(now);
    if (s.afterStory === 'next') s.round++;
    this.setPhase('answer', s.questionSeconds, now);
  }
  setPhase(phase, seconds, now) {
    Object.assign(this.state, { phase, deadline: now + seconds * 1000, phaseStartedAt: now, updatedAt: now });
    this.lastTick = now;
  }
  pause(now = Date.now()) {
    if (!ACTIVE.includes(this.state.phase)) throw Error('The game is not running.');
    Object.assign(this.state, {
      resumePhase: this.state.phase,
      remaining: Math.max(0, this.state.deadline - now),
      phase: 'paused',
      deadline: null,
    });
  }
  resume(now = Date.now()) {
    if (this.state.phase !== 'paused') throw Error('The game is not paused.');
    this.setPhase(this.state.resumePhase, (this.state.remaining || 0) / 1000, now);
  }
  restore(now = Date.now()) {
    if (ACTIVE.includes(this.state.phase))
      this.pause(Math.min(this.state.updatedAt || now, this.state.deadline));
    this.state.players.forEach((p) => {
      p.connected = !!p.npc;
    });
    this.lastTick = now;
  }
  end(now = Date.now()) {
    if (this.state.phase === 'ended') return;
    // A manually ended open question still records submitted work; blanks stay blank.
    this.settleAnswers();
    Object.assign(this.state, { phase: 'ended', deadline: null, endedAt: now, updatedAt: now });
  }
  settleAnswers() {
    for (const p of this.state.players) {
      p.colony.attempts = p.answers.length;
      p.colony.correct = p.answers.filter((a) => a.correct).length;
    }
  }
  answer(playerId, round, choice, now = Date.now()) {
    const s = this.state,
      p = this.player(playerId);
    if (!p || p.removed) throw Error('Join this room again.');
    if (!Number.isInteger(round) || round !== s.round) throw Error('That question has finished.');
    const previous = p.answers.find((a) => a.round === round);
    if (previous) return previous; // retries must never earn a second upgrade
    if (s.phase !== 'answer' || now >= s.deadline) throw Error('Answers are closed for this question.');
    const q = s.questions[round];
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length)
      throw Error('Choose one of the answers.');
    const a = { round, choice, correct: choice === q.correctIndex, at: now };
    p.answers.push(a);
    s.updatedAt = now;
    return a;
  }
  raidAllowed(p, target) {
    if (!target || target.removed || target.id === p.id)
      return { allowed: false, reason: 'Choose a rival colony.' };
    if (!target.connected) return { allowed: false, reason: 'This colony is reconnecting.' };
    if (this.state.round <= target.protectedUntilRound)
      return { allowed: false, reason: 'This colony is recovering.' };
    const lastRound = (p.lastRaids || {})[target.id];
    if (Number.isInteger(lastRound) && this.state.round - lastRound < 3)
      return { allowed: false, reason: 'Choose a different rival for three rounds.' };
    if (target.colony.food <= 3) return { allowed: false, reason: 'This colony needs its remaining food.' };
    return core.raidAvailability(p.colony, target.colony);
  }
  options(p) {
    if (!p) return [];
    const rewards = UPGRADE_KEYS.map((key) => ({
      key,
      label: LABELS[key],
      ...core.rewardAvailability(p.colony, key),
      cost: core.buildingCost(key),
    }));
    // Rival cards are the upgrade choice itself, so raiding adds no extra popup.
    for (const target of this.active()
      .filter((t) => t.id !== p.id)
      .sort((a, b) => core.colonyStrength(b.colony) - core.colonyStrength(a.colony))) {
      const availability = this.raidAllowed(p, target);
      if (availability.allowed)
        rewards.push({
          key: 'raid',
          target: target.id,
          label: `Raid ${target.name}`,
          allowed: true,
          reason: core.raidForecast(p.colony, target.colony).success
            ? 'Guards have the advantage'
            : 'Rival walls or guards are stronger',
        });
      if (rewards.length >= 10) break;
    }
    return rewards;
  }
  upgrade(playerId, round, key, targetId, now = Date.now()) {
    const s = this.state,
      p = this.player(playerId);
    if (!p || p.removed) throw Error('Join this room again.');
    if (round !== s.round) throw Error('That upgrade window has finished.');
    if (p.upgrades.some((u) => u.round === round)) return;
    if (s.phase !== 'upgrade' || now >= s.deadline) throw Error('Upgrades are closed for this question.');
    if (!p.answers.some((a) => a.round === round && a.correct))
      throw Error('Answer correctly to earn an upgrade.');
    if (key === 'raid') {
      const target = this.player(targetId),
        allowed = this.raidAllowed(p, target);
      if (!allowed.allowed) throw Error(allowed.reason);
      const food = target.colony.food;
      const outcome = core.resolveRaid(p.colony, target.colony, this.teams());
      const capped = Math.min(outcome.stolen, 5, Math.max(0, food - 3));
      target.colony.food += outcome.stolen - capped;
      p.colony.food -= outcome.stolen - capped;
      target.protectedUntilRound = s.round + 1;
      (p.lastRaids ||= {})[target.id] = s.round;
      this.event(
        outcome.success
          ? `${p.name} brought home ${capped} food from ${target.name}.`
          : `${target.name}'s guards held the entrance.`,
        {
          kind: 'raid',
          attacker: p.id,
          target: target.id,
          round: s.round,
          stolen: capped,
          success: outcome.success,
        },
        now,
      );
    } else {
      if (!UPGRADE_KEYS.includes(key)) throw Error('Choose an upgrade.');
      const available = core.rewardAvailability(p.colony, key);
      if (!available.allowed) throw Error(available.reason);
      core.applyReward(p.colony, key, this.teams());
    }
    p.upgrades.push({ round, key, target: targetId || null });
    s.updatedAt = now;
  }
  tick(now = Date.now()) {
    const s = this.state;
    if (!ACTIVE.includes(s.phase)) {
      this.lastTick = now;
      return;
    }
    if (s.phase === 'story') {
      if (now >= s.deadline) this.advanceStory(now);
      this.lastTick = now;
      s.updatedAt = now;
      return;
    }
    const dt = Math.min(1000, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const world = this.world();
    core.advanceEconomy(world, dt);
    if (!s.storyVersion) core.advanceBirdEvent(world, dt);
    const { teams, phase, ...worldState } = world;
    s.world = worldState;
    for (const p of this.active().filter((p) => p.npc)) {
      if (
        s.phase === 'answer' &&
        now - s.phaseStartedAt > 5000 + (s.players.indexOf(p) % 3) * 1500 &&
        !p.answers.some((a) => a.round === s.round)
      ) {
        const q = s.questions[s.round];
        this.answer(
          p.id,
          s.round,
          s.round % 4 === 3 ? (q.correctIndex + 1) % q.options.length : q.correctIndex,
          Math.min(now, s.deadline - 1),
        );
      }
      if (
        s.phase === 'upgrade' &&
        now - s.phaseStartedAt > 2000 &&
        !p.upgrades.some((u) => u.round === s.round) &&
        p.answers.some((a) => a.round === s.round && a.correct)
      ) {
        const preferred = ['expansion', 'soldiers', 'defense', 'workers', 'supplies', 'food'];
        const options = this.options(p);
        const pick =
          options.find((o) => o.key === 'raid') ||
          preferred.map((k) => options.find((o) => o.key === k && o.allowed)).find(Boolean);
        this.upgrade(p.id, s.round, pick.key, pick.target, Math.min(now, s.deadline - 1));
      }
    }
    const active = this.active();
    if (
      s.phase === 'answer' &&
      (now >= s.deadline ||
        (now - s.phaseStartedAt >= 4000 &&
          active.length &&
          active.every((p) => p.answers.some((a) => a.round === s.round))))
    ) {
      this.settleAnswers();
      this.setPhase('upgrade', s.upgradeSeconds, now);
    } else if (
      s.phase === 'upgrade' &&
      (now >= s.deadline ||
        (now - s.phaseStartedAt >= 4000 &&
          active.every(
            (p) =>
              !p.answers.some((a) => a.round === s.round && a.correct) ||
              p.upgrades.some((u) => u.round === s.round),
          )))
    ) {
      for (const p of active)
        if (
          p.answers.some((a) => a.round === s.round && a.correct) &&
          !p.upgrades.some((u) => u.round === s.round)
        )
          this.upgrade(p.id, s.round, 'food', null, Math.min(now, s.deadline - 1));
      this.setPhase('reveal', 4, now);
    } else if (s.phase === 'reveal' && now >= s.deadline) {
      core.applyUpkeep(this.teams());
      if (s.storyVersion) {
        s.storyQueue = (story.schedule(s.questions.length)[s.round + 1] || []).filter(
          (key) => !s.storySeen.includes(key),
        );
        s.afterStory = s.round + 1 >= s.questions.length ? 'end' : 'next';
        this.advanceStory(now);
        s.updatedAt = now;
        return;
      }
      if (s.round + 1 >= s.questions.length) {
        this.end(now);
        return;
      }
      s.round++;
      const progress = s.round / s.questions.length,
        schedule = core.seasonSchedule({ rounds: s.questions.length });
      const world = this.world();
      if (!world.dryOccurred && progress >= schedule.dry) {
        core.applyDrySeason(world);
        this.event('Dry season! Colonies use 12 stored food. Keep your workers fed.', { kind: 'dry' }, now);
      } else if (world.dryOccurred && !world.rainOccurred && progress >= schedule.rain) {
        core.applyRain(world);
        this.event('Rain returns! Strong walls protect your stores.', { kind: 'rain' }, now);
      }
      const { teams, phase, ...rest } = world;
      s.world = rest;
      this.setPhase('answer', s.questionSeconds, now);
    }
    s.updatedAt = now;
  }
  snapshot(playerId = null, teacher = false, now = Date.now()) {
    const s = this.state,
      p = this.player(playerId),
      q = s.questions[s.round];
    const phase = s.phase === 'paused' ? s.resumePhase : s.phase;
    const revealed = ['upgrade', 'reveal', 'ended'].includes(phase);
    const players = this.active()
      .map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        npc: p.npc,
        strength: core.colonyStrength(p.colony),
        food: p.colony.food,
        workers: p.colony.workers,
        soldiers: p.colony.soldiers,
        rooms: p.colony.territory,
        color: p.colony.colorIndex,
        answered: p.answers.some((a) => a.round === s.round),
        ...(teacher || s.phase === 'ended'
          ? { score: p.answers.filter((a) => a.correct).length, answeredCount: p.answers.length }
          : {}),
      }))
      .sort((a, b) => b.strength - a.strength);
    return {
      id: s.id,
      title: s.title,
      phase: s.phase,
      resumePhase: s.resumePhase,
      round: s.round,
      total: s.questions.length,
      serverNow: now,
      deadline: s.deadline,
      remaining: s.remaining,
      preview: s.preview,
      world: s.world,
      story:
        phase === 'story' && s.story
          ? {
              ...s.story,
              results: teacher ? s.story.results : s.story.results.filter((r) => r.playerId === playerId),
              elapsed: Math.max(
                0,
                s.story.duration - (s.phase === 'paused' ? s.remaining : Math.max(0, s.deadline - now)),
              ),
              winners:
                s.story.key === 'acorn'
                  ? core
                      .rankTeams(this.teams())
                      .filter(
                        (item, i, ranked) =>
                          item.score === ranked[0].score &&
                          item.team.correct === ranked[0].team.correct &&
                          (item.team.attempts ? item.team.correct / item.team.attempts : 0) ===
                            (ranked[0].team.attempts ? ranked[0].team.correct / ranked[0].team.attempts : 0),
                      )
                      .map((item) => item.team.name)
                  : [],
            }
          : null,
      players,
      question: q
        ? {
            question: q.question,
            options: q.options,
            ...(revealed ? { correctIndex: q.correctIndex, explanation: q.explanation } : {}),
          }
        : null,
      events: s.events
        .map((e) =>
          !teacher && e.kind === 'story'
            ? { ...e, results: e.results.filter((r) => r.playerId === playerId) }
            : e,
        )
        .filter((e) => e.kind !== 'raid' || teacher || e.attacker === playerId || e.target === playerId)
        .slice(-4),
      me: p
        ? {
            id: p.id,
            name: p.name,
            colony: p.colony,
            choice: p.answers.find((a) => a.round === s.round)?.choice ?? null,
            ...(revealed ? { correct: !!p.answers.find((a) => a.round === s.round)?.correct } : {}),
            lastUpgrade: p.upgrades.at(-1) || null,
            upgraded: p.upgrades.some((u) => u.round === s.round),
            upgrades: s.phase === 'upgrade' ? this.options(p) : [],
          }
        : null,
    };
  }
  report() {
    const s = this.state,
      players = s.players.filter((p) => !p.npc);
    return {
      id: s.id,
      title: s.title,
      phase: s.phase,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      preview: s.preview,
      total: s.questions.length,
      learners: players.map((p) => ({
        name: p.name,
        studentId: p.studentId,
        rosterId: p.rosterId,
        removed: p.removed,
        correct: p.answers.filter((a) => a.correct).length,
        answered: p.answers.length,
        strength: core.colonyStrength(p.colony),
        answers: p.answers,
      })),
      questions: s.questions.map((q, i) => ({
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        correct: players.filter((p) => p.answers.some((a) => a.round === i && a.correct)).length,
        answered: players.filter((p) => p.answers.some((a) => a.round === i)).length,
      })),
      events: s.events,
    };
  }
}
module.exports = { ColonyMatch, ACTIVE };
