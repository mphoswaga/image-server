const test = require('node:test');
const assert = require('node:assert/strict');
const assessment = require('../assignments');
const code = require('../assessment-codequest');
const template = require('../activity-templates/codequest-first-project');

const commands = ops => ops.split(' ').map(op => ({ op }));
const reference = {
  near: 'move move collect',
  middle: 'move move left move right move collect',
  far: 'move left move move move right move move move collect',
  fix: 'move move left move move collect',
  shorten: 'move move move collect',
};

test('the five initial tasks have full-credit linear solutions and total fifty marks', () => {
  const project = assessment.normalizeAssessment(template);
  assert.equal(project.totalMarks, 50);
  assert.deepEqual(project.sections.map(section => section.marks), [20, 15, 15]);
  for (const task of project.questions) {
    const result = code.grade(task.activity, commands(reference[task.id]));
    assert.equal(result.marksAwarded, task.marks, task.id);
    assert.equal(result.execution.success, true);
    assert.equal(code.grade(task.activity, []).marksAwarded, 0);
  }
  const near = project.questions[0];
  assert.equal(code.grade(near.activity, commands('left right move move collect')).marksAwarded, 5);
});

test('debug earns credit for the corrected segment and optimise counts every authored block', () => {
  const { questions } = assessment.normalizeAssessment(template);
  const debug = questions.find(q => q.id === 'fix').activity;
  assert.equal(code.grade(debug, debug.starter).execution.success, false);
  assert.equal(code.grade(debug, commands('move move left move')).marksAwarded, 5);
  assert.throws(() => code.normalize({ ...debug, starter: commands(reference.fix) }, 15));
  const optimise = questions.find(q => q.id === 'shorten').activity;
  assert.equal(code.grade(optimise, optimise.starter).marksAwarded, 5);
  assert.throws(() => code.normalize({ ...optimise, starter: commands('move collect') }, 15));
  const routeWithUnusedTail = code.grade(optimise, commands('move move move collect left left right right'));
  assert.equal(routeWithUnusedTail.execution.steps, 4);
  assert.equal(routeWithUnusedTail.execution.blocks, 8);
  assert.equal(routeWithUnusedTail.marksAwarded, 10);
  assert.equal(code.grade(optimise, commands('move move collect')).marksAwarded, 0);
});
