const CodeQuest = require('./public/codequest-core');

function normalize(activity, marks) {
  const { size, start, chest, rocks = [], water = [] } = activity.mission || {};
  const cell = value => Array.isArray(value) && value.length === 2 &&
    value.every(n => Number.isInteger(n) && n >= 0 && n < size);
  const { kind } = activity;
  if (!['codequest-build', 'codequest-debug', 'codequest-optimise'].includes(kind) ||
      (activity.version !== undefined && ![1, 2, 3].includes(activity.version)) ||
      !Number.isInteger(size) || size < 3 || size > 8 ||
      !Array.isArray(start) || start.length !== 3 || !cell(start.slice(0, 2)) ||
      ![0, 1, 2, 3].includes(start[2]) || !cell(chest) ||
      !Array.isArray(rocks) || !Array.isArray(water) || ![...rocks, ...water].every(cell)) {
    throw new Error('Choose a valid CodeQuest build map.');
  }
  const mission = { size, start, chest, rocks, water, requireReturn: false };
  const version = activity.version || 1;
  if (version >= 2) {
    if (version === 2 && kind !== 'codequest-build') throw new Error('Choose a CodeQuest build stage.');
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
  const { reach, collect, checkpoint, secondCheckpoint, improvement } = activity.rubric || {};
  const points = [collect];
  const rubric = { collect };
  const starter = kind === 'codequest-build' ? [] : answer(activity.starter);
  const initial = CodeQuest.run(mission, starter);
  if (secondCheckpoint && (version !== 3 || kind !== 'codequest-build' || !checkpoint)) {
    throw new Error('Add a first flag before placing a second flag on a build mission.');
  }
  if (kind === 'codequest-debug' && (!starter.length || initial.success)) {
    throw new Error('Debug must start with code that does not collect the treasure.');
  }
  if (kind === 'codequest-optimise') {
    const { shorter, muchShorter } = improvement || {};
    const compact = mission.repeatRequired ? CodeQuest.compact(solution) : solution;
    const targetCost = CodeQuest.blockCount(compact);
    if (!initial.success || !shorter || !muchShorter ||
        (mission.repeatRequired && !compact.some(block => block.op === 'repeat')) ||
        ![shorter.maxBlocks, muchShorter.maxBlocks].every(Number.isInteger) ||
        muchShorter.maxBlocks < targetCost || muchShorter.maxBlocks >= shorter.maxBlocks ||
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
      if (secondCheckpoint) {
        const next = secondCheckpoint.cell;
        if (!cell(next) || CodeQuest.at([...obstacles, start, chest, position], ...next) ||
            !(solutionVia(mission, position, next) || solutionVia(mission, next, position))) {
          throw new Error('Place two different flags on a route to the treasure.');
        }
        points.push(secondCheckpoint.marks);
        rubric.secondCheckpoint = {cell:next, marks:secondCheckpoint.marks};
      }
    }
  }
  if (!points.every(n => Number.isInteger(n) && n > 0) ||
      collect + (rubric.reach || 0) + (rubric.checkpoint?.marks || 0) + (rubric.secondCheckpoint?.marks || 0) + (rubric.improvement?.muchShorter.marks || 0) !== marks) {
    throw new Error('CodeQuest rubric points must add up to the task marks.');
  }
  return { kind, version, mission, starter, rubric };
}

function visited(result, [x, y]) {
  return result.frames.some(frame => frame.x === x && frame.y === y);
}

function solutionVia(mission, position, next) {
  const first = CodeQuest.solve({ ...mission, rocks: [...mission.rocks, mission.chest], chest: position });
  if (!first.length || first.length > 32) return false;
  const end = CodeQuest.run({ ...mission, chest: position }, first).frames.at(-1);
  const rest = { ...mission, start: [end.x, end.y, end.d] };
  const last = next ? solutionVia(rest, next) : CodeQuest.solve(rest);
  return last && last.length > 0 && first.length - 1 + last.length <= 32 && first.slice(0, -1).concat(last);
}

function treasureChoices(raw, marks) {
  const activity = normalize(raw, marks);
  const { mission, kind, rubric } = activity;
  const choices = [];
  for (let y = 0; y < mission.size; y++) for (let x = 0; x < mission.size; x++) {
    if (CodeQuest.at([mission.start, mission.chest, ...mission.water, ...mission.rocks], x, y)) continue;
    const map = { ...mission, chest: [x, y] };
    const next = { ...activity, mission: map, rubric: structuredClone(rubric) };
    try {
      const route = CodeQuest.solve({ ...map, blockLimit: undefined });
      if (!route.length) continue;
      if (map.repeatRequired && kind !== 'codequest-optimise') {
        const cost = CodeQuest.blockCount(CodeQuest.compact(route));
        if (cost >= route.length) continue;
        map.blockLimit = Math.min(cost + 1, route.length - 1);
      }
      if (kind === 'codequest-optimise') {
        const { shorter, muchShorter } = next.rubric.improvement;
        if (map.repeatRequired && !CodeQuest.compact(route).some(block => block.op === 'repeat')) continue;
        muchShorter.maxBlocks = map.repeatRequired ? CodeQuest.blockCount(CodeQuest.compact(route)) : route.length;
        shorter.maxBlocks = route.length + 2;
        next.starter = ['left','right','left','right'].map(op => ({op})).concat(route);
      }
      if (kind === 'codequest-debug') {
        const via = solutionVia(map, rubric.checkpoint.cell);
        if (!via) continue;
        next.starter = [{ op: via[0].op === 'left' ? 'right' : 'left' }, ...via.slice(1)];
      }
      normalize(next, marks);
      choices.push({ chest: map.chest, blockLimit: map.blockLimit, starter: next.starter, improvement: next.rubric.improvement });
    } catch { /* This square cannot meet the current task rules. */ }
  }
  return choices;
}

function answer(program, activity) {
  const normalized = CodeQuest.normalize(program);
  if (!activity?.mission.blocks?.includes('repeat') && normalized.some(block => block.op === 'repeat')) throw new Error('Repeat is not available for this task.');
  CodeQuest.checkBudget(activity?.mission || {}, normalized);
  CodeQuest.expand(normalized);
  return normalized;
}

function grade(activity, program) {
  if (![1, 2, 3].includes(activity.version)) throw new Error('Unsupported CodeQuest scoring version.');
  const final = answer(program, activity);
  const result = CodeQuest.run(activity.mission, final);
  const { rubric } = activity;
  const criteria = [];
  const add = (label, max, awarded) => criteria.push({ label, max, awarded, met: awarded === max });
  if (rubric.checkpoint) {
    add('Reached the marked route checkpoint', rubric.checkpoint.marks,
      visited(result, rubric.checkpoint.cell) ? rubric.checkpoint.marks : 0);
  }
  if (rubric.secondCheckpoint) {
    add('Reached the second lookout flag', rubric.secondCheckpoint.marks,
      visited(result, rubric.secondCheckpoint.cell) ? rubric.secondCheckpoint.marks : 0);
  }
  const blocks = activity.version === 3 ? CodeQuest.blockCount(final) : final.length;
  if (rubric.reach) add('Reached the treasure square', rubric.reach, visited(result, activity.mission.chest) ? rubric.reach : 0);
  add('Collected the treasure', rubric.collect, result.success ? rubric.collect : 0);
  if (rubric.improvement) {
    const { shorter, muchShorter } = rubric.improvement;
    const usedRepeat = result.frames.some(frame => final[frame.block]?.op === 'repeat');
    const earned = !result.success ? 0 : blocks <= muchShorter.maxBlocks && (!activity.mission.repeatRequired || usedRepeat) ? muchShorter.marks :
      blocks <= shorter.maxBlocks ? shorter.marks : 0;
    add('Shortened the working program', muchShorter.marks, earned);
  }
  const marksAwarded = criteria.reduce((total, item) => total + item.awarded, 0);
  return {
    marksAwarded, source: 'auto', verdict: criteria.every(item => item.met) ? 'correct' : marksAwarded ? 'partial' : 'incorrect',
    criteria, execution: { success: result.success, reason: result.reason, steps: result.steps, blocks, starterBlocks: CodeQuest.blockCount(activity.starter || []) },
    rationale: criteria.map(item => item.label + ': ' + item.awarded + '/' + item.max).join(' · '),
  };
}

module.exports = { normalize, answer, grade, treasureChoices };
