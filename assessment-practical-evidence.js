const code = require('./assessment-codequest');
const table = require('./assessment-data-table');

function capture(previous, questions, answers, runs) {
  const evidence = Object.assign(Object.create(null), structuredClone(previous.practicalEvidence || {}));
  for (const run of (Array.isArray(runs) ? runs.slice(0, 16) : [])) {
    const task = questions.find(item => item.id === run?.id && item.kind === 'codequest');
    if (!task) continue;
    try {
      const result = code.grade(task.activity, run.program);
      const entry = evidence[task.id] ||= { tests: [] };
      const key = JSON.stringify(code.answer(run.program, task.activity));
      if (entry.tests.some(test => test.key === key) || entry.tests.length >= 30) continue;
      entry.tests.push({ key, success: result.execution.success, blocks: result.execution.blocks, reason: result.execution.reason });
    } catch {}
  }
  for (const task of questions.filter(item => item.kind === 'data-table' && Array.isArray(answers[item.id]))) {
    const before = previous.answers?.[task.id] || task.activity.inputs.map(input => input.initial ?? null);
    const old = table.grade(task.activity, before);
    const next = table.grade(task.activity, answers[task.id]);
    next.criteria.forEach((item, index) => {
      const prior = old.criteria[index];
      if (prior.response === null || prior.met || !item.met) return;
      const entry = evidence[task.id] ||= { corrections: [] };
      if (!entry.corrections.includes(index)) entry.corrections.push(index);
    });
  }
  return evidence;
}

function describe(task, evidence, grade) {
  const notes = [];
  if (evidence?.tests?.length) {
    const tests = evidence.tests;
    notes.push(`Tested ${tests.length} distinct block sequences.`);
    const failed = tests.findIndex(test => !test.success);
    if (failed >= 0 && tests.slice(failed + 1).some(test => test.success)) notes.push('A later test collected the treasure after an unsuccessful test.');
  }
  if (task.activity?.kind === 'codequest-optimise' && grade?.execution?.success && grade.execution.blocks < grade.execution.starterBlocks) {
    notes.push(`Shortened the working route from ${grade.execution.starterBlocks} to ${grade.execution.blocks} blocks.`);
  }
  if (evidence?.corrections?.length) {
    const labels = evidence.corrections.slice(0, 3).map(index => task.activity.inputs[index]?.label).filter(Boolean);
    if (labels.length) notes.push(`Changed incorrect values to accepted values for: ${labels.join('; ')}.`);
  }
  return notes;
}

module.exports = { capture, describe };
