const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-games-'));

const games = require('../games');

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
