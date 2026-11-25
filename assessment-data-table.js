const { createHash } = require('node:crypto');
const kinds = ['data-organise', 'data-correct', 'data-find', 'data-interpret'];
const text = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('Use short, non-empty table labels and values.');
  return value.trim();
};
const equivalent = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const isTable = activity => kinds.includes(activity?.kind);

function normalize(activity, marks) {
  if (!isTable(activity) || (activity.version !== undefined && activity.version !== 1)) throw new Error('Unsupported data table task.');
  const { table, inputs, source } = activity;
  if (!Array.isArray(table) || table.length < 2 || table.length > 12 ||
      !Array.isArray(table[0]) || !table[0].length || table[0].length > 8 ||
      !table.every(row => Array.isArray(row) && row.length === table[0].length) ||
      !Array.isArray(inputs) || !inputs.length || inputs.length > 24) throw new Error('Provide a small rectangular table and at least one response.');
  const ordering = activity.presentation === 'order';
  const editable = !ordering && ['data-organise', 'data-correct'].includes(activity.kind);
  const tiles = ordering ? table.slice(1).map(row => text(row[0])) : [];
  if (ordering && (activity.kind !== 'data-organise' || table[0].length !== 1 || tiles.length < 2 ||
      inputs.length !== tiles.length || new Set(tiles.map(equivalent)).size !== tiles.length)) {
    throw new Error('Give every box a unique name and a matching position.');
  }
  const positions = new Set();
  const fields = inputs.map(input => {
    const { row, column, marks, accepted, initial } = input;
    const options = ordering ? tiles : input.options;
    const position = row + ':' + column;
    if (editable && (!Number.isInteger(row) || !Number.isInteger(column) || table[row]?.[column] === undefined || positions.has(position))) throw new Error('Each editable response needs a different table cell.');
    positions.add(position);
    if (input.entry === 'text') {
      if (activity.kind !== 'data-organise' || !Number.isInteger(marks) || marks < 1 || !Array.isArray(accepted) || !accepted.length || accepted.length > 30) throw new Error('A written table field needs accepted values and points.');
      return { label: text(input.label), marks, row, column, entry: 'text', accepted: accepted.map(value => equivalent(text(value))) };
    }
    if (!Number.isInteger(marks) || marks <= 0 || !Array.isArray(options) || options.length < 2 || options.length > 12 || !Array.isArray(accepted) || !accepted.length) throw new Error('Each response needs choices, a correct answer, and points.');
    const choices = options.map(text);
    const normalized = choices.map(equivalent);
    const keys = accepted.map(value => equivalent(text(value)));
    if (new Set(normalized).size !== choices.length || !keys.every(key => normalized.includes(key))) throw new Error('Use distinct choices that include the accepted answers.');
    if (activity.kind === 'data-correct' && (typeof initial !== 'string' || !normalized.includes(equivalent(initial)) || keys.includes(equivalent(initial)))) throw new Error('Each correction must start with a selectable incorrect value.');
    return { label: text(input.label), marks, options: choices, accepted: keys,
      ...(editable ? { row, column } : {}), ...(activity.kind === 'data-correct' ? { initial: choices[normalized.indexOf(equivalent(initial))] } : {}) };
  });
  if (ordering && (fields.some(field => field.accepted.length !== 1) || new Set(fields.map(field => field.accepted[0])).size !== fields.length)) {
    throw new Error('Use each box once in the correct order.');
  }
  if (fields.reduce((sum, input) => sum + input.marks, 0) !== marks) throw new Error('Table rubric points must add up to the task marks.');
  if (source !== undefined && (!Array.isArray(source) || source.length > 12)) throw new Error('Provide at most twelve source cards.');
  const presentation = ['records','files','types','survey','order','ballots','worksheet'].includes(activity.presentation) ? activity.presentation : null;
  return { kind: activity.kind, version: 1, ...(presentation ? {presentation} : {}), table: table.map((row, index) => row.map((value, column) =>
    editable && positions.has(index + ':' + column) ? '' : text(value))),
    source: (source || []).map(text), inputs: fields };
}

function shuffled(values, seed) {
  return values.map(value => ({
    value, rank: createHash('sha256').update(JSON.stringify([seed, value])).digest('hex'),
  })).sort((a, b) => a.rank.localeCompare(b.rank)).map(item => item.value);
}

// Keep the extra distractors usable in already-scheduled copies of Field designer.
const ticketFields = ['Name', 'Tickets bought', 'Visit date', 'Paid?'];
const baseTypes = ['Text', 'Number', 'Date', 'Yes / No'];
function choiceOptions(activity, input) {
  const { options } = input;
  if (activity.presentation === 'types' && activity.table[0][0] === 'Field' &&
      ticketFields.every((name, index) => activity.table[index + 1]?.[0] === name) &&
      ticketFields.includes(input.label) && options?.length === baseTypes.length &&
      baseTypes.every(type => options.includes(type))) {
    return [...options, 'Time', 'Money'];
  }
  return options;
}

function learnerView(activity, seed) {
  const { kind, source, inputs, presentation } = activity;
  let { table } = activity;
  if (seed && presentation === 'order') {
    const rows = shuffled(table.slice(1), seed);
    if (rows.every((row, index) => inputs[index].accepted.includes(equivalent(row[0])))) {
      rows.push(rows.shift());
    }
    table = [table[0], ...rows];
  }
  return { kind, table, source, ...(presentation ? {presentation} : {}), inputs: inputs.map(({ accepted, ...input }, index) => {
    const options = choiceOptions(activity, input);
    if (!options) return input;
    return { ...input, options: seed && presentation !== 'order' ? shuffled(options, [seed, index]) : options };
  }) };
}

function answer(activity, responses) {
  if (!Array.isArray(responses) || responses.length !== activity.inputs.length) throw new Error('Invalid table response.');
  const values = responses.map((value, index) => {
    if (value === null || value === '') return null;
    if (activity.inputs[index].entry === 'text') {
      if (typeof value !== 'string' || value.length > 300) throw new Error('Enter up to 300 characters in each field.');
      return value.trim() || null;
    }
    const normalized = equivalent(text(value));
    const choice = choiceOptions(activity, activity.inputs[index]).find(option => equivalent(option) === normalized);
    if (choice === undefined) throw new Error('Choose a supplied table value.');
    return choice;
  });
  if (activity.presentation === 'order' && values.some(value => value !== null) &&
      (values.includes(null) || new Set(values).size !== values.length)) throw new Error('Place each box once.');
  return values;
}

function grade(activity, responses) {
  if (activity.version !== 1) throw new Error('Unsupported table scoring version.');
  const values = answer(activity, responses);
  const criteria = activity.inputs.map((input, index) => {
    const response = values[index];
    const met = response !== null && input.accepted.includes(equivalent(response));
    return { label: input.label, response, max: input.marks, met, awarded: met ? input.marks : 0 };
  });
  const marksAwarded = criteria.reduce((sum, criterion) => sum + criterion.awarded, 0);
  return { source: 'auto', marksAwarded, criteria,
    verdict: criteria.every(criterion => criterion.met) ? 'correct' : marksAwarded ? 'partial' : 'incorrect',
    rationale: criteria.map(c => c.label + ': ' + c.awarded + '/' + c.max).join(' · ') };
}

module.exports = { isTable, normalize, learnerView, answer, grade };
