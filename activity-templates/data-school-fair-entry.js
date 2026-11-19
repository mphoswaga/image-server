// The earlier fair remains available to classes already assigned that edition.
const fair = require('./data-school-fair');
const registration = fair.sections[0];
const task = registration.items[0];
const fields = [
  ['Name', ['Mia Tran']],
  ['Age', ['9']],
  ['Date of birth', ['12 May 2017', '12/05/2017', '12/5/2017', '2017-05-12']],
  ['Phone', ['000 000 0001', '0000000001']],
];

module.exports = {
  ...fair,
  sections: [{
    ...registration,
    instructions: 'A helper has signed up. Read the badge and type a new record in the register.',
    items: [{
      ...task, prompt: 'Create the helper’s record. Copy the date and keep the zeroes at the start of the phone number.',
      activity: {
        ...task.activity,
        source: ['Mia Tran · Age 9 · Born 12 May 2017 · Phone 000 000 0001'],
        table: [fields.map(([label]) => label), fields.map(() => '')],
        inputs: fields.map(([label, accepted], column) => ({
          label, row: 1, column, entry: 'text', accepted, marks: 2,
        })),
      },
    }],
  }, ...fair.sections.slice(1)],
};
