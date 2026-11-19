const CodeQuest = require('./public/codequest-core');

function normalize(activity, marks) {
  const { size, start, chest, rocks = [], water = [] } = activity.mission || {};
  const cell = value => Array.isArray(value) && value.length === 2 &&
    value.every(n => Number.isInteger(n) && n >= 0 && n < size);
  const { kind } = activity;
  if (!['codequest-build', 'codequest-debug', 'codequest-optimise'].includes(kind) ||
      (activity.version !== undefined && ![1, 2].includes(activity.version)) ||
      !Number.isInteger(size) || size < 3 || size > 8 ||
      !Array.isArray(start) || start.length !== 3 || !cell(start.slice(0, 2)) ||
      ![0, 1, 2, 3].includes(start[2]) || !cell(chest) ||
      !Array.isArray(rocks) || !Array.isArray(water) || ![...rocks, ...water].every(cell)) {
    throw new Error('Choose a valid CodeQuest build map.');
  }
  const mission = { size, start, chest, rocks, water, requireReturn: false };
  const version = activity.version || 1;
  if (version === 2) {
    if (kind !== 'codequest-build') throw new Error('Choose a CodeQuest build stage.');
    const { blocks, blockLimit, repeatRequired } = activity.mission;
    mission.blocks = ['move', 'left', 'right', 'collect'];
    if (blocks?.includes('repeat')) mission.blocks.push('repeat');
    if (blockLimit !== undefined) {
      CodeQuest.checkBudget({ blockLimit }, []);
      mission.blockLimit = blockLimit;
    }
    if (repeatRequired && !mission.blocks.includes('repeat')) throw new Error('Enable Repeat for this stage.');
    mission.repeatRequired = !!repeatRequired;
  }
  const obstacles = [...rocks, ...water];
  const solution = CodeQuest.solve(mission);
  if ([start.slice(0, 2), chest].some(([x, y]) => CodeQuest.at(obstacles, x, y)) ||
      !solution.length || solution.length > 32 || !CodeQuest.run(mission, solution).success) throw new Error('The CodeQuest treasure must be reachable.');
  const { reach, collect, checkpoint, improvement } = activity.rubric || {};
  const points = [collect];
  const rubric = { collect };
  const starter = kind === 'codequest-build' ? [] : answer(activity.starter);
  const initial = CodeQuest.run(mission, starter);
  if (kind === 'codequest-debug' && (!starter.length || initial.success)) {
    throw new Error('Debug must start with code that does not collect the treasure.');
  }
  if (kind === 'codequest-optimise') {
    const { shorter, muchShorter } = improvement || {};
    if (!initial.success || !shorter || !muchShorter ||
        ![shorter.maxBlocks, muchShorter.maxBlocks].every(Number.isInteger) ||
        muchShorter.maxBlocks < solution.length || muchShorter.maxBlocks >= shorter.maxBlocks ||
        shorter.maxBlocks >= starter.length || muchShorter.marks <= shorter.marks) {
      throw new Error('Optimise needs working starter code and two achievable, shorter code limits.');
    }
    points.push(shorter.marks, muchShorter.marks);
    rubric.improvement = {
      shorter: { maxBlocks: shorter.maxBlocks, marks: shorter.marks },
      muchShorter: { maxBlocks: muchShorter.maxBlocks, marks: muchShorter.marks },
    };
  } else {
    points.push(reach);
    rubric.reach = reach;
    if (checkpoint || kind === 'codequest-debug') {
      const position = checkpoint?.cell;
      if (!cell(position) || CodeQuest.at([...obstacles, start.slice(0, 2), chest], ...position) ||
          (kind === 'codequest-debug' && visited(initial, position)) ||
          !solutionVia(mission, position)) {
        throw new Error('Choose a reachable route checkpoint the starter code has not already reached.');
      }
      points.push(checkpoint.marks);
      rubric.checkpoint = { cell: position, marks: checkpoint.marks };
    }
  }
  if (!points.every(n => Number.isInteger(n) && n > 0) ||
      collect + (rubric.reach || 0) + (rubric.checkpoint?.marks || 0) + (rubric.improvement?.muchShorter.marks || 0) !== marks) {
    throw new Error('CodeQuest rubric points must add up to the task marks.');
  }
  return { kind, version, mission, starter, rubric };
}

function visited(result, [x, y]) {
  return result.frames.some(frame => frame.x === x && frame.y === y);
}

function solutionVia(mission, position) {
  const first = CodeQuest.solve({ ...mission, rocks: [...mission.rocks, mission.chest], chest: position });
  if (!first.length || first.length > 32) return false;
  const end = CodeQuest.run({ ...mission, chest: position }, first).frames.at(-1);
  const last = CodeQuest.solve({ ...mission, start: [end.x, end.y, end.d] });
  return last.length > 0 && first.length - 1 + last.length <= 32;
}

function answer(program, activity) {
  const normalized = CodeQuest.normalize(program);
  if (!activity?.mission.blocks?.includes('repeat') && normalized.some(block => block.op === 'repeat')) throw new Error('Repeat is not available for this task.');
  CodeQuest.checkBudget(activity?.mission || {}, normalized);
  CodeQuest.expand(normalized);
  return normalized;
}

function grade(activity, program) {
  if (![1, 2].includes(activity.version)) throw new Error('Unsupported CodeQuest scoring version.');
  const final = answer(program, activity);
  const result = CodeQuest.run(activity.mission, final);
  const { rubric } = activity;
  const criteria = [];
  const add = (label, max, awarded) => criteria.push({ label, max, awarded, met: awarded === max });
  if (rubric.checkpoint) {
    add('Reached the marked route checkpoint', rubric.checkpoint.marks,
      visited(result, rubric.checkpoint.cell) ? rubric.checkpoint.marks : 0);
  }
  if (rubric.reach) add('Reached the treasure square', rubric.reach, visited(result, activity.mission.chest) ? rubric.reach : 0);
  add('Collected the treasure', rubric.collect, result.success ? rubric.collect : 0);
  if (rubric.improvement) {
    const { shorter, muchShorter } = rubric.improvement;
    const earned = !result.success ? 0 : final.length <= muchShorter.maxBlocks ? muchShorter.marks :
      final.length <= shorter.maxBlocks ? shorter.marks : 0;
    add('Shortened the working program', muchShorter.marks, earned);
  }
  const marksAwarded = criteria.reduce((total, item) => total + item.awarded, 0);
  return {
    marksAwarded, source: 'auto', verdict: criteria.every(item => item.met) ? 'correct' : marksAwarded ? 'partial' : 'incorrect',
    criteria, execution: { success: result.success, reason: result.reason, steps: result.steps, blocks: final.length, starterBlocks: activity.starter?.length || 0 },
    rationale: criteria.map(item => item.label + ': ' + item.awarded + '/' + item.max).join(' · '),
  };
}

module.exports = { normalize, answer, grade };
