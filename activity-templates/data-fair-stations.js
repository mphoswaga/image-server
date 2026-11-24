// A directions-only edition. Keep existing projects pinned to their original content.
const investigation = require('./data-class-investigation');
const directions = {
  desk: 'Start with Card 1 and fill the first row. Use the next row for each new student. Keep every zero in the family phone numbers.',
  types: 'Look at the example on each field card. Pick a type for each field, then choose a value for the last question.',
  'paper-register': 'Find the slip with the same number as the first row. Fill its empty boxes. Then do the same for the second row.',
  repair: 'Compare the register with the badge above it. Open each list to fix the record. For a missing detail, decide how you would check it.',
  'stock-sheet': 'For each booth, subtract Used from Packed and type the number under Left. In the last row, enter the booth to restock and the address of the box that supports your choice.',
  files: 'The upload limit is 5 MB. Look at each file and its size. Choose the poster, then answer the two questions below the files.',
  'file-units': 'Build the ladder from smallest at the top to largest at the bottom. You can move a box more than once.',
  storage: 'The folder has 1 GB free. Save the video and poster first. Then choose a recording that fits. Use 1 GB = 1,000 MB and 1 MB = 1,000 KB.',
  count: 'Count how many slips name each booth. Type one total beside each booth. Give blank slips their own total.',
  decision: 'The organisers have one extra table. Use the votes and the fair rule to choose a booth, then pick the evidence for your decision.',
};
module.exports = {
  ...investigation,
  instructions: 'Work through one fair station at a time. Open “See an example” if you need help. Check your answers before you hand in the project.',
  sections: investigation.sections.map(section => ({...section, instructions: directions[section.id] || section.instructions})),
};
