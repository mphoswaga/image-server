(function attachColonyQuestCore(root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.ColonyQuestCore = core;
}(typeof globalThis !== 'undefined' ? globalThis : this, function colonyQuestCoreFactory() {
  'use strict';

  const VERSION = 3;
  const TEAM_COLORS = Object.freeze([
    { name: 'Azure', primary: 0x2f80ed, light: 0x8ec5ff, dark: 0x123f7a },
    { name: 'Coral', primary: 0xef6351, light: 0xffb0a4, dark: 0x7b2b23 },
    { name: 'Emerald', primary: 0x20a66a, light: 0x8ce0b7, dark: 0x145c3f },
    { name: 'Gold', primary: 0xf2b134, light: 0xffdc83, dark: 0x795511 },
    { name: 'Violet', primary: 0x8c63d6, light: 0xcdb6f5, dark: 0x493074 },
    { name: 'Rose', primary: 0xd94f8a, light: 0xf4a8c8, dark: 0x762648 },
  ]);

  const REWARDS = Object.freeze({
    workers: { label: 'Workers', description: 'More ants collect food.', icon: 'worker' },
    food: { label: 'Food', description: 'Fill the colony stores.', icon: 'leaf' },
    defense: { label: 'Defense', description: 'Strengthen the nest walls.', icon: 'shield' },
    queen: { label: 'Queen', description: 'Grow the colony faster.', icon: 'crown' },
    expansion: { label: 'Expansion', description: 'Open new territory.', icon: 'compass' },
    soldiers: { label: 'Soldiers', description: 'Prepare for Colony Wars.', icon: 'sword' },
    raid: { label: 'Knowledge raid', description: 'Challenge another colony.', icon: 'flag' },
  });

  const EVENTS = Object.freeze([
    { key: 'fallen-fruit', title: 'The Orchard Gift', description: 'A ripe berry tumbles into Moonroot Meadow. Every colony gathers a share, and the smallest food stores receive the most.', tone: 'good' },
    { key: 'heavy-rain', title: 'The Rain Returns', description: 'Clouds gather above the old oak. Strong nest walls keep precious tunnels warm and dry.', tone: 'storm' },
    { key: 'food-trail', title: 'Pip Finds a Trail', description: 'Pip discovers a trail of golden seeds. Busy workers hurry the surprise harvest home.', tone: 'good' },
    { key: 'predator', title: 'A Shadow Crosses the Meadow', description: 'The colonies become perfectly still. Guardians protect the stores until the shadow safely passes.', tone: 'danger' },
    { key: 'new-territory', title: 'The Deep Root Opens', description: 'An ancient root shifts and reveals new earth. The smallest colonies discover room to grow.', tone: 'good' },
  ]);

  function clamp(value, min, max) {
    const n = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  }

  function text(value, max) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function cleanMember(member) {
    return {
      id: text(member && member.id, 80),
      name: text(member && member.name, 80) || 'Learner',
      turns: Math.floor(clamp(member && member.turns, 0, 1000)),
    };
  }

  function createTeam(input, index) {
    const colorIndex = Math.floor(clamp(input && input.colorIndex, 0, TEAM_COLORS.length - 1));
    return {
      id: text(input && input.id, 40) || `team-${index + 1}`,
      name: text(input && input.name, 40) || `Team ${index + 1}`,
      colorIndex,
      members: Array.isArray(input && input.members) ? input.members.slice(0, 80).map(cleanMember) : [],
      population: 8,
      workers: 5,
      soldiers: 1,
      food: 24,
      defense: 1,
      territory: 1,
      queenLevel: 1,
      nestLevel: 1,
      correct: 0,
      attempts: 0,
      successfulAttacks: 0,
      successfulDefenses: 0,
      upgrades: 0,
    };
  }

  function normalizeTeam(input, index) {
    const base = createTeam(input, index);
    const numeric = ['population', 'workers', 'soldiers', 'food', 'defense', 'territory', 'queenLevel', 'nestLevel', 'correct', 'attempts', 'successfulAttacks', 'successfulDefenses', 'upgrades'];
    for (const key of numeric) base[key] = Math.floor(clamp(input && input[key], 0, key === 'food' ? 9999 : 999));
    base.correct = Math.min(base.correct, base.attempts);
    base.population = Math.max(1, base.population);
    base.queenLevel = Math.max(1, base.queenLevel);
    base.nestLevel = Math.max(1, base.nestLevel);
    return base;
  }

  function strengthBreakdown(team) {
    const attempts = Math.max(0, Number(team && team.attempts) || 0);
    const correct = Math.max(0, Number(team && team.correct) || 0);
    return {
      knowledge: Math.round(correct * 100 + (attempts ? correct / attempts : 0) * 80),
      population: Math.round(clamp(team && team.population, 0, 999) * 3),
      economy: Math.round(clamp(team && team.workers, 0, 999) * 5),
      resources: Math.round(clamp(team && team.food, 0, 9999)),
      territory: Math.round(clamp(team && team.territory, 0, 99) * 28),
      defense: Math.round(clamp(team && team.defense, 0, 99) * 28),
      queen: Math.round(clamp(team && team.queenLevel, 0, 99) * 30),
      nest: Math.round(clamp(team && team.nestLevel, 0, 99) * 10),
      military: Math.round(clamp(team && team.soldiers, 0, 999) * 8),
      colonyWars: Math.round(clamp(team && team.successfulAttacks, 0, 99) * 40 + clamp(team && team.successfulDefenses, 0, 99) * 30),
    };
  }

  function colonyStrength(team) {
    return Object.values(strengthBreakdown(team)).reduce((sum, value) => sum + value, 0);
  }

  function comebackMultiplier(team, teams) {
    if (!Array.isArray(teams) || teams.length < 2) return 1;
    const scores = teams.map(colonyStrength);
    const leader = Math.max(...scores, 1);
    const own = colonyStrength(team);
    if (own < leader * 0.65) return 1.2;
    if (own < leader * 0.82) return 1.1;
    return 1;
  }

  function applyReward(team, reward, teams) {
    if (!team || !REWARDS[reward] || reward === 'raid') return team;
    const boost = comebackMultiplier(team, teams);
    const add = value => Math.max(1, Math.round(value * boost));
    if (reward === 'workers') {
      const amount = add(3);
      team.workers += amount;
      team.population += amount;
      team.food += add(3);
    } else if (reward === 'food') {
      team.food += add(22 + team.workers);
    } else if (reward === 'defense') {
      team.defense += 1;
      team.nestLevel += team.defense % 2 === 0 ? 1 : 0;
    } else if (reward === 'queen') {
      team.queenLevel += 1;
      team.population += add(2 + team.queenLevel);
      team.workers += add(1);
    } else if (reward === 'expansion') {
      team.territory += 1;
      team.food += add(9);
      team.nestLevel += team.territory % 2 === 0 ? 1 : 0;
    } else if (reward === 'soldiers') {
      const amount = add(3);
      team.soldiers += amount;
      team.population += amount;
      team.food = Math.max(0, team.food - 3);
    }
    team.upgrades += 1;
    return team;
  }

  function resolveRaid(attacker, defender, teams) {
    const attack = attacker.soldiers * 4 + attacker.territory * 2 + attacker.correct * 3;
    const guard = defender.defense * 5 + defender.soldiers * 3 + defender.nestLevel * 2;
    const knowledgeEdge = 12;
    const success = attack + knowledgeEdge >= guard * 0.78;
    if (success) {
      const stolen = Math.min(defender.food, Math.max(6, Math.round(12 * comebackMultiplier(attacker, teams))));
      defender.food -= stolen;
      attacker.food += stolen;
      attacker.successfulAttacks += 1;
      return { success: true, stolen };
    }
    defender.successfulDefenses += 1;
    defender.food += 5;
    return { success: false, stolen: 0 };
  }

  function applyUpkeep(teams) {
    for (const team of teams || []) {
      const production = Math.max(2, Math.round(team.workers * 0.65 + team.territory * 2 + team.queenLevel));
      const upkeep = Math.max(1, Math.round(team.population * 0.22 + team.soldiers * 0.35));
      team.food = Math.max(0, team.food + production - upkeep);
      const births = Math.max(1, team.queenLevel);
      if (team.food >= births * 2) {
        team.food -= births * 2;
        team.population += births;
        team.workers += Math.max(1, Math.ceil(births * 0.6));
      }
      if (team.food === 0 && team.population > 5) {
        team.population -= 1;
        if (team.workers > 3) team.workers -= 1;
      }
    }
    return teams;
  }

  function applyEvent(teams, key) {
    const event = EVENTS.find(item => item.key === key) || EVENTS[0];
    const strengths = (teams || []).map(colonyStrength);
    const weakest = strengths.length ? Math.min(...strengths) : 0;
    for (let index = 0; index < (teams || []).length; index += 1) {
      const team = teams[index];
      if (event.key === 'fallen-fruit') team.food += strengths[index] === weakest ? 20 : 12;
      if (event.key === 'heavy-rain') team.food = Math.max(0, team.food - Math.max(1, 9 - team.defense * 2));
      if (event.key === 'food-trail') team.food += 7 + Math.min(12, team.workers);
      if (event.key === 'predator') team.food = Math.max(0, team.food - Math.max(0, 12 - team.defense * 3 - team.soldiers));
      if (event.key === 'new-territory' && strengths[index] <= weakest * 1.08) team.territory += 1;
    }
    return event;
  }

  function rankTeams(teams) {
    return (teams || []).map(team => ({ team, score: colonyStrength(team), breakdown: strengthBreakdown(team) }))
      .sort((a, b) => b.score - a.score || b.team.correct - a.team.correct || a.team.name.localeCompare(b.team.name));
  }

  function normalizeConfig(input) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      teamCount: Math.floor(clamp(source.teamCount == null ? 4 : source.teamCount, 2, 6)),
      matchType: source.matchType === 'time' ? 'time' : 'rounds',
      rounds: Math.floor(clamp(source.rounds == null ? 5 : source.rounds, 2, 12)),
      durationMinutes: Math.floor(clamp(source.durationMinutes == null ? 15 : source.durationMinutes, 5, 45)),
      sound: source.sound !== false,
    };
  }

  function normalizeSession(input) {
    const source = input && typeof input === 'object' ? input : {};
    const phases = new Set(['setup', 'question', 'reward', 'event', 'paused', 'ended']);
    const teams = Array.isArray(source.teams) ? source.teams.slice(0, 6).map(normalizeTeam) : [];
    return {
      version: VERSION,
      phase: phases.has(source.phase) ? source.phase : 'setup',
      previousPhase: phases.has(source.previousPhase) ? source.previousPhase : null,
      startedAt: text(source.startedAt, 40) || null,
      endedAt: text(source.endedAt, 40) || null,
      endsAt: Number.isFinite(Number(source.endsAt)) ? Number(source.endsAt) : null,
      pausedAt: Number.isFinite(Number(source.pausedAt)) ? Number(source.pausedAt) : null,
      turnIndex: Math.floor(clamp(source.turnIndex, 0, 9999)),
      questionCursor: Math.floor(clamp(source.questionCursor, 0, 9999)),
      currentTeamIndex: Math.floor(clamp(source.currentTeamIndex, 0, Math.max(0, teams.length - 1))),
      introSeen: !!source.introSeen,
      warsActive: !!source.warsActive,
      eventAction: source.eventAction === 'next-turn' ? 'next-turn' : source.eventAction === 'question' ? 'question' : null,
      teams,
      answers: Array.isArray(source.answers) ? source.answers.slice(-500).map(answer => ({
        questionIndex: Math.floor(clamp(answer && answer.questionIndex, 0, 9999)),
        teamId: text(answer && answer.teamId, 40),
        studentId: text(answer && answer.studentId, 80) || null,
        studentName: text(answer && answer.studentName, 80) || null,
        correct: !!(answer && answer.correct),
        choice: Number.isFinite(Number(answer && answer.choice)) ? Number(answer.choice) : null,
        teacherJudged: !!(answer && answer.teacherJudged),
        at: text(answer && answer.at, 40),
      })) : [],
      events: Array.isArray(source.events) ? source.events.slice(-40).map(event => ({
        key: text(event && event.key, 40),
        at: text(event && event.at, 40),
        teamId: text(event && event.teamId, 40) || null,
        amount: Math.floor(clamp(event && event.amount, 0, 9999)),
        secondary: Math.floor(clamp(event && event.secondary, 0, 9999)),
      })) : [],
    };
  }

  function sessionSummary(session) {
    const safe = normalizeSession(session);
    const ranking = rankTeams(safe.teams);
    const answers = safe.answers.length;
    const correct = safe.answers.filter(answer => answer.correct).length;
    return {
      phase: safe.phase,
      startedAt: safe.startedAt,
      endedAt: safe.endedAt,
      turns: safe.turnIndex,
      answers,
      correct,
      accuracy: answers ? Math.round(correct / answers * 100) : 0,
      winner: ranking[0] ? { id: ranking[0].team.id, name: ranking[0].team.name, score: ranking[0].score } : null,
      teams: ranking.map((entry, index) => ({
        rank: index + 1,
        id: entry.team.id,
        name: entry.team.name,
        score: entry.score,
        correct: entry.team.correct,
        attempts: entry.team.attempts,
        accuracy: entry.team.attempts ? Math.round(entry.team.correct / entry.team.attempts * 100) : 0,
        breakdown: entry.breakdown,
      })),
      identifiedParticipation: safe.answers.filter(answer => answer.studentId).map(answer => ({
        studentId: answer.studentId,
        studentName: answer.studentName,
        teamId: answer.teamId,
        correct: answer.correct,
        questionIndex: answer.questionIndex,
      })),
    };
  }

  return {
    VERSION,
    TEAM_COLORS,
    REWARDS,
    EVENTS,
    clamp,
    createTeam,
    normalizeTeam,
    normalizeConfig,
    normalizeSession,
    applyReward,
    resolveRaid,
    applyUpkeep,
    applyEvent,
    comebackMultiplier,
    colonyStrength,
    strengthBreakdown,
    rankTeams,
    sessionSummary,
  };
}));
