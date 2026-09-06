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
  assert.equal(colony.population, 8);
  assert.equal(colony.workers, 5);
  assert.equal(colony.soldiers, 1);
  assert.equal(colony.queenLevel, 1);
  assert.equal(colony.defense, 1);
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
    const before = JSON.stringify(all[0]);
    const beforeStrength = core.colonyStrength(all[0]);
    core.applyReward(all[0], reward, all);
    assert.notEqual(JSON.stringify(all[0]), before, `${reward} should change the colony`);
    assert.equal(all[0].upgrades, 1);
    gains.push(core.colonyStrength(all[0]) - beforeStrength);
  }
  assert.ok(Math.max(...gains) <= Math.min(...gains) * 2, `upgrade values should remain strategically comparable: ${gains}`);
});

test('queen development produces visible colony growth during each round', () => {
  const all = teams(2);
  all[0].queenLevel = 3;
  const beforePopulation = all[0].population;
  const beforeWorkers = all[0].workers;
  core.applyUpkeep(all);
  assert.equal(all[0].population, beforePopulation + 3);
  assert.ok(all[0].workers > beforeWorkers);
});

test('comeback help is meaningful without erasing the leading colony', () => {
  const all = teams(2);
  all[0].food = 400;
  all[0].population = 80;
  const weaker = all[1];
  assert.equal(core.comebackMultiplier(weaker, all), 1.2);
  const before = core.colonyStrength(all[0]);
  core.applyReward(weaker, 'workers', all);
  assert.equal(weaker.workers, 9);
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

  attacker.soldiers = 0;
  attacker.correct = 0;
  defender.defense = 20;
  const defended = core.resolveRaid(attacker, defender, all);
  assert.equal(defended.success, false);
  assert.equal(defender.successfulDefenses, 1);
  assert.ok(attacker.population >= 1);
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
    warsActive: true,
    teams: all,
    answers: [
      { questionIndex: 0, teamId: all[0].id, studentId: 'S1', studentName: 'Learner 1', correct: true },
      { questionIndex: 1, teamId: all[1].id, correct: false },
    ],
    events: [{ key: 'raid-result', at: '2026-01-01T00:00:00.000Z' }],
  });
  assert.equal(session.phase, 'event');
  assert.equal(session.previousPhase, 'reward');
  assert.equal(session.eventAction, 'next-turn');
  assert.equal(session.currentTeamIndex, 1);
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
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'colonyquest.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'image-server.js'), 'utf8');
  assert.match(dashboard, /data-game-mode="colonyquest"/);
  assert.match(dashboard, /Whole class - ColonyQuest/);
  assert.match(dashboard, /Open ColonyQuest setup/);
  assert.match(page, /vendor\/phaser\.min\.js/);
  assert.match(page, /Mark correct/);
  assert.match(page, /Random learner/);
  assert.match(server, /app\.get\('\/colonyquest\/:id'/);
});
