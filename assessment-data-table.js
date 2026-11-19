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
  const editable = ['data-organise', 'data-correct'].includes(activity.kind);
  const positions = new Set();
  const fields = inputs.map(input => {
    const { row, column, marks, options, accepted, initial } = input;
    const position = row + ':' + column;
    if (editable && (!Number.isInteger(row) || !Number.isInteger(column) || table[row]?.[column] === undefined || positions.has(position))) throw new Error('Each editable response needs a different table cell.');
    positions.add(position);
    if (!Number.isInteger(marks) || marks <= 0 || !Array.isArray(options) || options.length < 2 || options.length > 12 || !Array.isArray(accepted) || !accepted.length) throw new Error('Each response needs choices, a correct answer, and points.');
    const choices = options.map(text);
    const normalized = choices.map(equivalent);
    const keys = accepted.map(value => equivalent(text(value)));
    if (new Set(normalized).size !== choices.length || !keys.every(key => normalized.includes(key))) throw new Error('Use distinct choices that include the accepted answers.');
    if (activity.kind === 'data-correct' && (typeof initial !== 'string' || !normalized.includes(equivalent(initial)) || keys.includes(equivalent(initial)))) throw new Error('Each correction must start with a selectable incorrect value.');
    return { label: text(input.label), marks, options: choices, accepted: keys,
      ...(editable ? { row, column } : {}), ...(activity.kind === 'data-correct' ? { initial: choices[normalized.indexOf(equivalent(initial))] } : {}) };
  });
  if (fields.reduce((sum, input) => sum + input.marks, 0) !== marks) throw new Error('Table rubric points must add up to the task marks.');
  if (source !== undefined && (!Array.isArray(source) || source.length > 12)) throw new Error('Provide at most twelve source cards.');
  const presentation = ['records','files','types','survey'].includes(activity.presentation) ? activity.presentation : null;
  return { kind: activity.kind, version: 1, ...(presentation ? {presentation} : {}), table: table.map((row, index) => row.map((value, column) =>
    editable && positions.has(index + ':' + column) ? '' : text(value))),
    source: (source || []).map(text), inputs: fields };
}

function learnerView({ kind, table, source, inputs, presentation }) {
  return { kind, table, source, ...(presentation ? {presentation} : {}), inputs: inputs.map(({ accepted, ...input }) => input) };
}

function answer(activity, responses) {
  if (!Array.isArray(responses) || responses.length !== activity.inputs.length) throw new Error('Invalid table response.');
  return responses.map((value, index) => {
    if (value === null || value === '') return null;
    const choice = activity.inputs[index].options.find(option => equivalent(option) === equivalent(text(value)));
    if (choice === undefined) throw new Error('Choose a supplied table value.');
    return choice;
  });
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
