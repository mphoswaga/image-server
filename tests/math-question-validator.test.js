const test = require('node:test');
const assert = require('node:assert/strict');
const { inferNumericAnswer, repairMathQuestion, repairMathQuestions } = require('../math-question-validator');

test('84 rounds to 80 at the nearest ten and repairs the reported wrong key', () => {
  const result = repairMathQuestion({
    question: 'Round 84 to the nearest 10.',
    options: ['80', '84', '90', '85'],
    correctIndex: 2,
    explanation: '84 is closer to 90.',
  });
  assert.equal(result.repaired, true);
  assert.equal(result.question.correctIndex, 0);
  assert.equal(result.question.options[result.question.correctIndex], '80');
  assert.match(result.question.explanation, /84 rounds to 80/);
});

test('rounding halves, decimals and larger places use deterministic arithmetic', () => {
  assert.equal(inferNumericAnswer('Round 85 to the nearest ten.').value, 90);
  assert.equal(inferNumericAnswer('Round 1,449 to the nearest hundred.').value, 1400);
  assert.equal(inferNumericAnswer('Round 3.46 to the nearest tenth.').value, 3.5);
});

test('basic arithmetic and percentage answer indexes are repaired too', () => {
  const checked = repairMathQuestions([
    { question: 'What is 7 × 8?', options: ['54', '56', '64', '48'], correctIndex: 0 },
    { question: 'Calculate 15 - 6.', options: ['21', '8', '9', '11'], correctIndex: 1 },
    { question: 'What is 25% of 80?', options: ['20', '25', '40', '10'], correctIndex: 2 },
  ]);
  assert.deepEqual(checked.questions.map(question => question.correctIndex), [1, 2, 0]);
  assert.deepEqual(checked.repairedIndexes, [0, 1, 2]);
  assert.deepEqual(checked.issues, []);
});

test('ambiguous or missing calculated options are rejected while non-math stays unchanged', () => {
  const checked = repairMathQuestions([
    { question: 'Round 84 to the nearest 10.', options: ['70', '90', '100', '85'], correctIndex: 1 },
    { question: 'Which animal is a mammal?', options: ['Whale', 'Trout'], correctIndex: 0 },
  ]);
  assert.match(checked.issues[0], /calculated answer 80 is missing/);
  assert.equal(checked.questions[1].correctIndex, 0);
});
