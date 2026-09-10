const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gamesDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-games-'));
process.env.DATA_DIR = gamesDataDir;

const games = require('../games');

test('saved games correct deterministic math keys before classroom play', () => {
  const game = games.createGame({
    teacherId: 'teacher-math', lessonTitle: 'Rounding', subject: 'Math', topic: 'Rounding', grade: 'Grade 4', mode: 'colonyquest',
    game: { questions: [{ question: 'Round 84 to the nearest 10.', options: ['80', '84', '90', '85'], correctIndex: 2, explanation: 'Wrong generated key.' }] },
  });
  assert.equal(game.questions[0].correctIndex, 0);
  assert.equal(games.getGame(game.id).questions[0].options[0], '80');
});

test('startup repair corrects matching legacy game files', () => {
  const id = 'legacy84';
  const dir = path.join(gamesDataDir, 'games');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
    id, teacherId: 'teacher-math', questions: [{ question: 'Round 84 to the nearest 10.', options: ['80', '84', '90', '85'], correctIndex: 2 }],
  }));
  assert.deepEqual(games.repairStoredMathAnswers(), { gamesChanged: 1, questionsChanged: 1 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')).questions[0].correctIndex, 0);
});

test('every arcade choice keeps an anonymous top score', () => {
  const game = games.createGame({
    teacherId: 'teacher-scores',
    lessonTitle: 'Habitats',
    subject: 'Science',
    topic: 'Habitats',
    grade: 'Grade 2',
    game: { questions: [{ question: 'A habitat?', options: ['Forest', 'Spoon'], correctIndex: 0 }] },
  });
  for (const [index, gameType] of ['car', 'space', 'runner', 'target'].entries()) {
    games.recordResult(game.id, {
      studentId: `S${index + 1}`,
      name: `Learner ${index + 1}`,
      score: 1,
      total: 1,
      answers: [0],
      arcadeScore: 10 + index,
      gameType,
    });
  }
  assert.deepEqual(games.getHighScores(game.id), { car: 10, space: 11, runner: 12, target: 13 });
});
