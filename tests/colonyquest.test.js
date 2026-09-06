const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-colonyquest-'));

const core = require('../public/colonyquest-core');
const games = require('../games');
const roster = require('../roster');
const gradebook = require('../gradebook');

function teams(count = 4) {
  return Array.from({ length: count }, (_, index) => core.createTeam({
    name: `Colony ${index + 1}`,
    members: [{ id: `S${index + 1}`, name: `Learner ${index + 1}` }],
  }, index));
}

test('ColonyQuest starts as a balanced, child-readable colony simulation', () => {
  const colony = core.createTeam({ name: 'Blue Colony' }, 0);
  assert.equal(colony.name, 'Blue Colony');
  assert.equal(colony.population, 2);
  assert.equal(colony.workers, 1);
  assert.equal(colony.soldiers, 0);
  assert.equal(colony.queenLevel, 1);
  assert.equal(colony.defense, 0);
  assert.deepEqual(core.colonyRooms(colony).map(room => room.id), ['nursery']);
  assert.ok(core.colonyStrength(colony) > 0);
  assert.deepEqual(core.normalizeConfig(), {
    teamCount: 4,
    matchType: 'rounds',
    rounds: 5,
    durationMinutes: 15,
    sound: true,
  });
});

test('every strategic reward visibly changes the relevant colony state', () => {
  const gains = [];
  for (const reward of ['workers', 'food', 'defense', 'queen', 'expansion', 'soldiers']) {
    const all = teams(2);
    if (reward === 'soldiers') all[0].barracksBuilt = true;
    const before = JSON.stringify(all[0]);
    const beforeStrength = core.colonyStrength(all[0]);
    core.applyReward(all[0], reward, all);
    assert.notEqual(JSON.stringify(all[0]), before, `${reward} should change the colony`);
    assert.equal(all[0].upgrades, 1);
    gains.push(core.colonyStrength(all[0]) - beforeStrength);
  }
  assert.ok(gains.every(gain => gain > 0), 'Each small upgrade still contributes to colony strength');
});

test('round end changes food without silently adding ants or rooms', () => {
  const all = teams(2);
  all[0].queenLevel = 3;
  const beforePopulation = all[0].population;
  const beforeWorkers = all[0].workers;
  core.applyUpkeep(all);
  assert.equal(all[0].population, beforePopulation);
  assert.equal(all[0].workers, beforeWorkers);
  assert.equal(core.colonyRooms(all[0]).length, 1);
});

test('only expansion choices build permanent rooms, one at a time', () => {
  const all = teams(2), colony = all[0];
  core.applyReward(colony, 'expansion', all);
  assert.ok(core.colonyRooms(colony).some(room => room.id === 'food'));
  colony.food = 0;
  assert.ok(core.colonyRooms(core.normalizeTeam(colony, 0)).some(room => room.id === 'food'));
  for (let i = 0; i < 8; i++) {
    const before = core.colonyRooms(colony).length;
    core.applyReward(colony, 'expansion', all);
    assert.equal(core.colonyRooms(colony).length, before + 1);
  }
  const beforeRecruitment = core.colonyRooms(colony);
  for (let i = 0; i < 16; i++) core.applyReward(colony, 'soldiers', all);
  const rooms = core.colonyRooms(colony);
  assert.deepEqual(rooms, beforeRecruitment);
  assert.equal(new Set(rooms.map(room => room.id)).size, rooms.length);
  assert.deepEqual(core.colonyRooms(core.normalizeTeam(colony, 0)), rooms);
});

test('fortifications reach stone and steel and do not sell an invisible higher tier', () => {
  const all = teams(2), colony = all[0];
  const materials = [core.fortification(colony).name];
  for (let i = 0; i < 4; i++) {
    core.applyReward(colony, 'defense', all);
    materials.push(core.fortification(colony).name);
  }
  assert.deepEqual(materials, ['Earth', 'Timber', 'Brick', 'Stone', 'Stone and steel']);
  const before = JSON.stringify(colony);
  core.applyReward(colony, 'defense', all);
  assert.equal(JSON.stringify(colony), before);
  assert.equal(core.fortification(core.normalizeTeam(colony, 0)).name, 'Stone and steel');
});

test('recruiting one ant never adds other rewards, including after save and at old room thresholds', () => {
  for (const role of ['workers', 'soldiers']) {
    const all = teams(2);
    if (role === 'soldiers') all[0].barracksBuilt = true;
    all[1].food = 999;
    let colony = all[0];
    for (let index = 0; index < 20; index++) {
      const before = { ...colony };
      core.applyReward(colony, role, all);
      assert.equal(colony[role], before[role] + 1);
      assert.equal(colony.population, before.population + 1);
      assert.equal(colony.food, before.food);
      assert.equal(core.colonyRooms(colony).length, role === 'soldiers' ? 2 : 1);
      colony = core.normalizeTeam(colony, 0);
      assert.equal(core.colonyRooms(colony).length, role === 'soldiers' ? 2 : 1);
    }
  }
});

test('food and queen care make only the promised small change', () => {
  const all = teams(2), colony = all[0];
  core.applyReward(colony, 'food', all);
  assert.equal(colony.food, 13);
  assert.equal(core.colonyRooms(colony).length, 1);
  core.applyReward(colony, 'queen', all);
  assert.equal(colony.population, 3);
  assert.equal(colony.workers, 1);
  assert.equal(colony.soldiers, 0);
  assert.equal(core.colonyRooms(colony).length, 1);
});

test('old matches retain their ants and rooms while newborn colonies stay small', () => {
  const old = core.normalizeTeam({ population: 18, workers: 10, soldiers: 4, food: 60, defense: 3, territory: 4, queenLevel: 2, nestLevel: 3 }, 0);
  assert.equal(old.population, 18);
  assert.equal(old.workers, 10);
  assert.equal(old.soldiers, 4);
  assert.equal(core.colonyRooms(old).length, 6);
  const fresh = core.normalizeTeam(core.createTeam({}, 0), 0);
  assert.equal(core.colonyRooms(fresh).length, 1);
  assert.equal(fresh.population, 2);
  const large = core.normalizeTeam({ population: 28, workers: 16, soldiers: 11, food: 60, defense: 3, territory: 8, queenLevel: 1, nestLevel: 3 }, 0);
  const existingRooms = core.colonyRooms(large);
  assert.equal(existingRooms.length, 12);
  core.applyReward(large, 'workers', [large]);
  assert.deepEqual(core.colonyRooms(core.normalizeTeam(large, 0)), existingRooms);
});

test('eggs take two rounds, hatch one at a time, and survive a save', () => {
  let colony = core.createTeam({}, 0);
  core.applyReward(colony, 'queen', [colony]);
  core.applyReward(colony, 'queen', [colony]);
  assert.deepEqual(colony.eggs, [{ roundsLeft: 2 }, { roundsLeft: 2 }]);
  const population = colony.population;
  core.applyUpkeep([colony]);
  assert.equal(colony.workers, 1);
  colony = core.normalizeTeam(colony, 0);
  assert.equal(colony.eggs[0].roundsLeft, 1);
  core.applyUpkeep([colony]);
  assert.equal(colony.workers, 2);
  assert.equal(colony.eggs.length, 1);
  assert.equal(colony.population, population);
  core.applyUpkeep([colony]);
  assert.equal(colony.workers, 3);
  assert.equal(colony.eggs.length, 0);
  assert.equal(core.colonyRooms(colony).length, 1);
});

test('workers and gardens gather predictable food, with visible meal costs', () => {
  const colony = core.createTeam({}, 0);
  assert.deepEqual(core.roundEconomy(colony), { gathered: 2, eaten: 1, gardens: 0 });
  core.applyReward(colony, 'workers', [colony]);
  const before = colony.food;
  const budget = core.roundEconomy(colony);
  core.applyUpkeep([colony]);
  assert.equal(colony.food, before + budget.gathered - budget.eaten);
  for (let index = 0; index < 3; index++) core.applyReward(colony, 'expansion', [colony]);
  assert.equal(core.roundEconomy(colony).gathered, 6);
});

test('rain preparations and room protections contribute to the ending without destroying progress', () => {
  const colony = core.createTeam({}, 0);
  const earth = core.rainOutcome(colony);
  for (const reward of ['food', 'expansion', 'expansion', 'soldiers', 'defense']) core.applyReward(colony, reward, [colony]);
  assert.equal(core.rainPreparation(colony).filter(goal => goal.done).length, 4);
  const snapshot = JSON.stringify(colony);
  const outcome = core.rainOutcome(colony);
  assert.ok(outcome.protectedFood > earth.protectedFood);
  assert.equal(outcome.ready, 4);
  assert.equal(JSON.stringify(colony), snapshot);
  const raider = { ...core.createTeam({}, 1), soldiers: 1 };
  const beforeGuard = core.raidForecast(raider, colony).guard;
  colony.barracksAnnexes = 1;
  assert.equal(core.raidForecast(raider, colony).guard, beforeGuard + 4);
});

test('repeat raids give the same target two intervening turns to recover', () => {
  const colonies = teams(3);
  let session = core.normalizeSession({ teams: colonies, turnIndex: 0, events: [{ key: 'raid-result', attackerId: colonies[0].id, defenderId: colonies[1].id, turnIndex: 0 }] });
  for (let round = 0; round <= 3; round++) {
    session.turnIndex = round * 3;
    session = core.normalizeSession(session);
    assert.equal(core.raidCooldown(session, colonies[0].id, colonies[1].id), Math.max(0, 3 - round));
    assert.equal(core.raidCooldown(session, colonies[0].id, colonies[2].id), 0);
  }
});

test('harvest recovery and team improvement preserve actual evidence', () => {
  const colony = core.createTeam({}, 0);
  const saved = core.normalizeSession({ teams: [colony], phase: 'event', stormSeen: true, events: [{ key: 'round-supplies', chapterBefore: 'First Light', reportIndex: 0, reports: [{ teamId: colony.id, gathered: 4, eaten: 1, hatched: 1 }] }], answers: [false, false, true, true].map(correct => ({ teamId: colony.id, correct })) });
  assert.deepEqual(core.normalizeSession(saved), saved);
  assert.equal(saved.events[0].reports[0].hatched, 1);
  assert.equal(saved.stormSeen, true);
  assert.equal(core.learningImprovement(saved, colony.id), 100);
  assert.equal(core.learningImprovement(saved, 'unknown'), null);
});

test('natural upgrade requirements are enforced without consuming a blocked choice', () => {
  const colony = core.createTeam({}, 0);
  colony.workers = 0;
  colony.population = 1;
  colony.food = 0;
  for (const reward of ['food', 'expansion', 'defense', 'soldiers', 'queen', 'raid']) {
    assert.equal(core.rewardAvailability(colony, reward).allowed, false, reward);
    const before = JSON.stringify(colony);
    core.applyReward(colony, reward, [colony]);
    assert.equal(JSON.stringify(colony), before, reward);
  }
  core.applyReward(colony, 'workers', [colony]);
  assert.equal(colony.workers, 1);
  core.applyReward(colony, 'food', [colony]);
  core.applyReward(colony, 'expansion', [colony]);
  assert.equal(core.rewardAvailability(colony, 'soldiers').allowed, false);
  core.applyReward(colony, 'expansion', [colony]);
  assert.equal(core.rewardAvailability(colony, 'soldiers').allowed, true);
  core.applyReward(colony, 'soldiers', [colony]);
  assert.equal(colony.soldiers, 1);
  for (let i = 0; i < 3; i++) core.applyReward(colony, 'queen', [colony]);
  const beforeFull = JSON.stringify(colony);
  core.applyReward(colony, 'queen', [colony]);
  assert.equal(JSON.stringify(colony), beforeFull);
  core.applyUpkeep([colony]);
  core.applyUpkeep([colony]);
  assert.equal(core.rewardAvailability(colony, 'queen').allowed, true);
});

test('a raid needs soldiers, a different supplied target, and an expired cooldown', () => {
  const colonies = teams(2), [attacker, defender] = colonies;
  const unchanged = () => JSON.stringify(colonies);
  let before = unchanged();
  assert.equal(core.resolveRaid(attacker, defender, colonies).blocked, true);
  assert.equal(unchanged(), before);
  attacker.soldiers = 1;
  before = unchanged();
  assert.equal(core.resolveRaid(attacker, attacker, colonies).blocked, true);
  assert.equal(unchanged(), before);
  defender.food = 0;
  before = unchanged();
  assert.equal(core.resolveRaid(attacker, defender, colonies).blocked, true);
  assert.equal(unchanged(), before);
  defender.food = 5;
  const session = { teams: colonies, turnIndex: 2, events: [{ key: 'raid-result', attackerId: attacker.id, defenderId: defender.id, turnIndex: 0 }] };
  before = unchanged();
  assert.equal(core.resolveRaid(attacker, defender, colonies, session).blocked, true);
  assert.equal(unchanged(), before);
  session.turnIndex = 6;
  assert.equal(core.resolveRaid(attacker, defender, colonies, session).success, true);
});

test('unattended gardens and discoveries cannot bypass the worker requirement', () => {
  const colony = { ...core.createTeam({}, 0), workers: 0, population: 1, expansionRooms: 1 };
  const before = JSON.stringify(colony);
  assert.equal(core.roundEconomy(colony).gathered, 0);
  core.applyEvent([colony], 'food-trail');
  core.applyEvent([colony], 'new-territory');
  assert.equal(JSON.stringify(colony), before);
});

test('comeback help is meaningful without erasing the leading colony', () => {
  const all = teams(2);
  all[0].food = 400;
  all[0].population = 80;
  const weaker = all[1];
  assert.equal(core.comebackMultiplier(weaker, all), 1.2);
  const before = core.colonyStrength(all[0]);
  core.applyReward(weaker, 'workers', all);
  assert.equal(weaker.workers, 2);
  assert.ok(core.colonyStrength(all[0]) === before);
  assert.ok(core.colonyStrength(all[0]) > core.colonyStrength(weaker));
});

test('knowledge raids reward success or defense but never eliminate a colony', () => {
  const all = teams(2);
  const attacker = all[0];
  const defender = all[1];
  attacker.soldiers = 30;
  attacker.correct = 5;
  const success = core.resolveRaid(attacker, defender, all);
  assert.equal(success.success, true);
  assert.ok(success.stolen > 0);
  assert.ok(defender.population >= 1);
  assert.ok(defender.food >= 0);

  attacker.soldiers = 1;
  attacker.correct = 0;
  defender.food = 8;
  defender.defense = 20;
  const defended = core.resolveRaid(attacker, defender, all);
  assert.equal(defended.success, false);
  assert.equal(defender.successfulDefenses, 1);
  assert.ok(attacker.population >= 1);
});

test('raid results survive recovery without resolving the raid again', () => {
  const all = teams(2);
  all[0].soldiers = 1;
  const result = core.resolveRaid(all[0], all[1], all);
  const saved = core.normalizeSession({ phase: 'event', eventAction: 'next-turn', teams: all, events: [{ key: 'raid-result', attackerId: all[0].id, defenderId: all[1].id, ...result }] });
  const restored = core.normalizeSession(saved);
  assert.deepEqual(restored.teams, saved.teams);
  assert.equal(restored.events[0].attackerId, all[0].id);
  assert.equal(restored.events[0].defenderId, all[1].id);
  assert.equal(restored.events[0].success, result.success);
  assert.equal(restored.events[0].stolen, result.stolen);
});

test('world events stay bounded and favor defenses or trailing colonies appropriately', () => {
  const all = teams(3);
  all[0].food = 300;
  all[0].population = 60;
  all[1].defense = 8;
  const weakFood = all[2].food;
  core.applyEvent(all, 'fallen-fruit');
  assert.ok(all[2].food - weakFood >= 20);
  const defendedFood = all[1].food;
  core.applyEvent(all, 'heavy-rain');
  assert.ok(all[1].food >= defendedFood - 1);
  assert.ok(all.every(team => team.food >= 0 && team.population >= 1));
});

test('session normalization preserves recovery phases and honest named participation', () => {
  const all = teams(2);
  const session = core.normalizeSession({
    phase: 'event',
    previousPhase: 'reward',
    eventAction: 'next-turn',
    turnIndex: 7,
    questionCursor: 7,
    currentTeamIndex: 99,
    introSeen: true,
    warsActive: true,
    teams: all,
    answers: [
      { questionIndex: 0, teamId: all[0].id, studentId: 'S1', studentName: 'Learner 1', correct: true },
      { questionIndex: 1, teamId: all[1].id, correct: false },
    ],
    events: [{ key: 'upgrade-workers', teamId: all[0].id, amount: 3, secondary: 4, at: '2026-01-01T00:00:00.000Z' }],
  });
  assert.equal(session.phase, 'event');
  assert.equal(session.previousPhase, 'reward');
  assert.equal(session.eventAction, 'next-turn');
  assert.equal(session.currentTeamIndex, 1);
  assert.equal(session.introSeen, true);
  assert.deepEqual(session.events[0], { key: 'upgrade-workers', teamId: all[0].id, amount: 3, secondary: 4, at: '2026-01-01T00:00:00.000Z' });
  assert.equal(session.teams.length, 2);
  const summary = core.sessionSummary(session);
  assert.equal(summary.answers, 2);
  assert.equal(summary.correct, 1);
  assert.equal(summary.accuracy, 50);
  assert.equal(summary.identifiedParticipation.length, 1);
  assert.equal(summary.identifiedParticipation[0].studentId, 'S1');
});

test('persistent ColonyQuest games have no learner room and keep recoverable match state', () => {
  const game = games.createGame({
    teacherId: 'teacher-colony',
    teacherName: 'Teacher',
    lessonTitle: 'Habitats',
    subject: 'Science',
    topic: 'Habitats',
    grade: 'Grade 3',
    mode: 'colonyquest',
    game: {
      summary: { overview: 'Habitats review', concepts: ['habitat'] },
      questions: [{ question: 'Which is a habitat?', options: ['Forest', 'Pencil'], correctIndex: 0 }],
    },
  });
  assert.equal(game.mode, 'colonyquest');
  assert.equal(game.roomCode, null);
  assert.equal(games.getRoomCode(''), null);
  assert.equal(games.listTeacherGames('teacher-colony').length, 1);

  const configured = games.updateColonyQuest(game.id, {
    teamCount: 2,
    matchType: 'time',
    durationMinutes: 10,
    teams: [{ name: 'Leaf Colony' }, { name: 'River Colony' }],
    questions: game.questions,
  });
  assert.equal(configured.colonyquest.teams.length, 2);
  assert.equal(configured.colonyquest.teams[0].name, 'Leaf Colony');

  const saved = games.saveColonyQuestSession(game.id, {
    phase: 'reward',
    turnIndex: 3,
    teams: teams(2),
    answers: [{ questionIndex: 0, teamId: 'team-1', correct: true }],
  });
  assert.equal(saved.phase, 'reward');
  assert.ok(saved.updatedAt);
  assert.equal(games.getColonyQuestSession(game.id).turnIndex, 3);
  assert.equal(games.listTeacherGames('teacher-colony').length, 1, 'session sidecar is not listed as another game');
  games.clearColonyQuestSession(game.id);
  assert.equal(games.getColonyQuestSession(game.id), null);
});

test('invalid ColonyQuest snapshots and incomplete questions are rejected', () => {
  assert.throws(() => games.saveColonyQuestSession('missing-teams', { phase: 'question', teams: [{}] }), /at least two teams/i);
  const game = games.createGame({
    teacherId: 'teacher-invalid', lessonTitle: 'Test', subject: 'ICT', topic: 'Files', grade: 'Grade 3', mode: 'colonyquest',
    game: { questions: [{ question: 'Valid?', options: ['Yes', 'No'], correctIndex: 0 }] },
  });
  assert.throws(() => games.updateColonyQuest(game.id, {
    teamCount: 2,
    questions: [{ question: 'Broken', options: ['', 'No'], correctIndex: 0 }],
  }), /at least one complete question/i);
});

test('an existing arcade lesson can add ColonyQuest without losing its original mode', () => {
  const game = games.createGame({
    teacherId: 'teacher-picker', lessonTitle: 'Habitats', subject: 'Science', topic: 'Habitats', grade: 'Grade 3', mode: 'arcade',
    game: { questions: [{ question: 'A habitat?', options: ['Forest', 'Desk'], correctIndex: 0 }] },
  });
  assert.equal(game.colonyquest, null);
  const updated = games.updateColonyQuest(game.id, { teamCount: 2 });
  assert.equal(updated.mode, 'arcade');
  assert.equal(updated.colonyquest.teamCount, 2);
  assert.equal(updated.colonyquest.teams.length, 2);
  assert.equal(updated.questions[0].question, 'A habitat?');
});

test('whole-class answers never become blank or invented individual gradebook marks', () => {
  const teacherId = 'teacher-honest-results';
  const classRoster = roster.saveRoster(teacherId, {
    name: 'Grade 3',
    students: [{ id: 'S1', name: 'Amina' }, { id: 'S2', name: 'Ben' }],
  });
  const game = games.createGame({
    teacherId, lessonTitle: 'Habitats', subject: 'Science', topic: 'Habitats', grade: 'Grade 3',
    rosterId: classRoster.id, mode: 'colonyquest',
    game: { questions: [{ question: 'A habitat?', options: ['Forest', 'Desk'], correctIndex: 0 }] },
  });
  games.saveColonyQuestSession(game.id, {
    phase: 'ended', teams: teams(2),
    answers: [{ questionIndex: 0, teamId: 'team-1', studentId: 'S1', studentName: 'Amina', correct: true }],
  });
  const marks = gradebook.buildGradebook(teacherId, classRoster.id);
  assert.equal(marks.assessments.length, 0);
  assert.ok(marks.rows.every(row => row.done === 0));
  assert.equal(gradebook.listClasses(teacherId)[0].games, 0);
});

test('the dashboard exposes ColonyQuest as a whole-class lesson game', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const picker = fs.readFileSync(path.join(__dirname, '..', 'public', 'play.html'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'colonyquest.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'colonyquest.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  assert.match(dashboard, /data-game-mode="colonyquest"/);
  assert.match(dashboard, /Whole class - ColonyQuest/);
  assert.match(dashboard, /Open ColonyQuest setup/);
  assert.match(picker, /id="colonyQuestPick"/);
  assert.match(picker, /location\.href='\/colonyquest\/'\+GAME_ID/);
  assert.match(page, /vendor\/phaser\.min\.js/);
  assert.match(page, /Mark correct/);
  assert.match(page, /Random learner/);
  assert.match(page, /Moonroot Meadow needs you/);
  assert.match(page, /id="worldStory"/);
  assert.match(page, /class="overlay question-overlay hidden"/);
  assert.match(page, /colonyquest-core\.js\?v=\d+/);
  assert.match(page, /colonyquest\.js\?v=\d+/);
  assert.match(client, /moonroot-meadow\.webp/);
  assert.match(server, /app\.get\('\/colonyquest-core\.js'[\s\S]*Cache-Control', 'no-store, max-age=0'/);
  assert.match(server, /app\.get\('\/colonyquest\.js'[\s\S]*Cache-Control', 'no-store, max-age=0'/);
  assert.match(server, /app\.get\('\/colonyquest\/:id'/);

  for (const name of ['moonroot-meadow.webp', 'pip-worker.webp', 'queen.webp', 'guardian.webp']) {
    const asset = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'colonyquest', name));
    assert.ok(asset.length > 10_000, `${name} should contain production artwork`);
    assert.equal(asset.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(asset.subarray(8, 12).toString('ascii'), 'WEBP');
  }
});
