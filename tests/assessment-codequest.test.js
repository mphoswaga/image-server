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

test('game stages have a full-credit solution and enforce the game block rules', () => {
  const { questions } = assessment.normalizeAssessment(require('../activity-templates/codequest-stages'));
  const game = require('../public/codequest-core');
  for (const [index, question] of questions.entries()) {
    const { activity } = question;
    const solution = game.solve(activity.mission);
    assert.equal(code.grade(activity, solution).marksAwarded, question.marks);
    if (index >= 2) {
      assert.ok(solution.some(block => block.op === 'repeat'));
      const expanded = game.expand(solution).map(({ op }) => ({ op }));
      assert.throws(() => code.answer(expanded, activity), /Use up to/);
    }
  }
  assert.throws(() => code.answer(game.solve(questions[2].activity.mission), questions[0].activity), /Repeat is not available/);
});

test('the 60-minute voyage grades a working loop and two independently visited flags', () => {
  const game = require('../public/codequest-core');
  const {questions,sections,totalMarks} = assessment.normalizeAssessment(require('../activity-templates/codequest-voyage'));
  assert.equal(totalMarks,50);
  assert.deepEqual(sections.map(s => s.marks), [12,11,12,15]);
  const shorten = questions.find(q => q.id === 'shorten').activity;
  const linear = game.solve(shorten.mission);
  assert.equal(code.grade(shorten,shorten.starter).marksAwarded,4);
  assert.equal(code.grade(shorten,linear).marksAwarded,8);
  const optimised = code.grade(shorten,game.compact(linear));
  assert.equal(optimised.marksAwarded,12);
  assert.equal(optimised.execution.blocks,3);
  const task = questions.at(-1).activity;
  const {mission,rubric} = task;
  for (const cells of [[rubric.checkpoint.cell,rubric.secondCheckpoint.cell],[rubric.secondCheckpoint.cell,rubric.checkpoint.cell]]) {
    let program = [], start = mission.start;
    for (const chest of cells) {
      const leg = {...mission,start,chest};
      const segment = game.solve(leg).slice(0,-1);
      program.push(...segment);
      const end = game.run(leg,segment).frames.at(-1);
      start = [end.x,end.y,end.d];
    }
    program.push(...game.solve({...mission,start}));
    assert.equal(code.grade(task,program).marksAwarded,15);
  }
  assert.ok(code.grade(task,game.solve(mission)).marksAwarded < 15);
  assert.throws(() => code.normalize({...task,rubric:{...rubric,secondCheckpoint:rubric.checkpoint}},15), /different flags/);
});
