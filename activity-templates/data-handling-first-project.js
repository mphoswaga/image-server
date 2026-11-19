const table = [
  ['Name', 'Role', 'Supply packs'],
  ['Mia', 'Pilot', '4'],
  ['Leo', 'Engineer', '7'],
  ['Nia', 'Scientist', '2'],
];
const source = table.slice(1).map(([name, role, packs]) => `${name} · ${role} · ${packs} supply packs`);
const options = [
  table.slice(1).map(row => row[0]),
  table.slice(1).map(row => row[1]),
  table.slice(1).map(row => row[2]),
];
const response = (label, options, key, marks) => ({ label, options, accepted: [key], marks });
const edit = (row, column, input, initial) => ({ ...input, row, column, ...(initial ? { initial } : {}) });
const organise = [
  edit(0, 1, response('Field for a crew job', ['Role', 'Supply packs', 'Name'], 'Role', 2)),
  edit(0, 2, response('Field for the number of packs', ['Name', 'Supply packs', 'Role'], 'Supply packs', 2)),
  ...table.slice(1).flatMap(([name, role, packs], index) => {
    const row = index + 1;
    return [
      ...(index ? [edit(row, 0, response('Source card ' + row + ' — name', options[0], name, 2))] : []),
      edit(row, 1, response('Source card ' + row + ' — role', options[1], role, 2)),
      edit(row, 2, response('Source card ' + row + ' — supply packs', options[2], packs, 2)),
    ];
  }),
];
const correct = [
  edit(1, 1, response('Correct Mia’s role', ['4', ...options[1]], 'Pilot', 5), '4'),
  edit(2, 2, response('Correct Leo’s pack count', options[2], '7', 5), '4'),
  edit(3, 2, response('Correct Nia’s pack count', ['Many', ...options[2]], '2', 5), 'Many'),
];
function item(id, prompt, kind, inputs, showSource = false) {
  const editable = kind === 'data-organise' || kind === 'data-correct';
  const display = editable ? table.map((row, y) => row.map((value, x) =>
    inputs.some(input => input.row === y && input.column === x) ? '' : value)) : table;
  return { id, prompt, marks: inputs.reduce((sum, input) => sum + input.marks, 0),
    activity: { kind, version: 1, table: display, inputs, ...(showSource ? { source } : {}) } };
}
const sections = [
  { id: 'organise', title: 'Organise the crew', type: 'practical', objectiveIds: ['table'],
    instructions: 'Use the cards in order, from top to bottom.',
    items: [item('arrange', 'Choose the field names and fill the empty cells.', 'data-organise', organise, true)] },
  { id: 'correct', title: 'Correct the table', type: 'practical', objectiveIds: ['table', 'types'],
    instructions: 'Compare the table with the source cards. Pack counts must be numbers.',
    items: [item('repair', 'Fix the three values in the table.', 'data-correct', correct, true)] },
  { id: 'use', title: 'Use the data', type: 'practical', objectiveIds: ['table', 'information'],
    instructions: 'Use the correct reference table below.',
    items: [
      item('find', 'Find a record and read a value.', 'data-find', [
        response('Select the scientist’s record', options[0], 'Nia', 5),
        response('How many packs does Mia have?', options[2], '4', 5),
      ]),
      item('interpret', 'Use the counts to make a decision.', 'data-interpret', [
        response('Who has the most packs to share?', options[0], 'Leo', 5),
      ]),
    ] },
];
module.exports = {
  title: 'Space Data Mission', subject: 'ICT', grade: 'Grade 3', assessmentType: 'project', deliveryMode: 'live',
  instructions: 'Read the source cards. Organise, fix and use the data.',
  objectives: [
    { id: 'table', text: 'Identify and organise fields, records and values in a table' },
    { id: 'types', text: 'Choose appropriate values for numeric and text fields' },
    { id: 'information', text: 'Use table values to turn data into useful information' },
  ],
  sections,
  totalMarks: sections.flatMap(section => section.items).reduce((sum, task) => sum + task.marks, 0),
};
