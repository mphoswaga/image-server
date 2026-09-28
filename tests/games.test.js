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

test('teachers can update saved arcade game questions without replacing the game', () => {
  const game = games.createGame({
    teacherId: 'teacher-edit',
    lessonTitle: 'Documents',
    subject: 'ICT',
    topic: 'Documents',
    grade: 'Grade 2',
    game: { questions: [{ question: 'Old question?', options: ['Old', 'New', 'Both', 'Neither'], correctIndex: 0, explanation: 'Original.' }] },
  });
  const updated = games.updateGameQuestions(game.id, [
    { question: 'Which shortcut copies text?', options: ['Ctrl + C', 'Ctrl + V', 'Ctrl + X', 'Ctrl + Z'], correctIndex: 0, explanation: 'Copy uses Ctrl + C.' },
  ]);

  assert.equal(updated.id, game.id);
  assert.equal(updated.questions[0].question, 'Which shortcut copies text?');
  assert.equal(updated.questions[0].options[0], 'Ctrl + C');
  assert.equal(updated.questions[0].correctIndex, 0);
  assert.equal(games.getGame(game.id).questions[0].explanation, 'Copy uses Ctrl + C.');
});

test('removing a game learner is reversible and preserves other games and saved marks', () => {
  const args={teacherId:'attendance-teacher',lessonTitle:'Reef',game:{questions:[{question:'Water?',options:['Ocean','Sky'],correctIndex:0}]}};
  const a=games.createGame(args),b=games.createGame(args);
  games.recordResult(a.id,{studentId:'s1',name:'Learner One',score:1,total:1,answers:[0],gameType:'car'});
  const before=games.getResults(a.id);
  games.setStudentRemoved(a.id,' s1 ','Learner One',true);
  assert.equal(games.isStudentRemoved(games.getGame(a.id),'S1'),true);
  assert.equal(games.isStudentRemoved(games.getGame(b.id),'S1'),false);
  assert.deepEqual(games.getResults(a.id),before);
  games.setStudentRemoved(a.id,'S1','Learner One',true);
  assert.equal(games.getGame(a.id).removedStudents.length,1);
  games.setStudentRemoved(a.id,'S1','Learner One',false);
  assert.equal(games.isStudentRemoved(games.getGame(a.id),'S1'),false);
  assert.deepEqual(games.getResults(a.id),before);
});
