const fair = require('./data-school-fair-entry');
const units = ['Byte (B)', 'Kilobyte (KB)', 'Megabyte (MB)', 'Gigabyte (GB)', 'Terabyte (TB)'];
const startingOrder = [units[2], units[4], units[0], units[1], units[3]];
const fileUnits = {
  id: 'file-units', title: 'File-size ladder', type: 'practical', objectiveIds: ['sizes'],
  instructions: 'Put the smallest unit at the top and the largest at the bottom.',
  items: [{
    id: 'order-units', prompt: 'Drag the boxes up or down, or use the arrow buttons.', marks: units.length,
    activity: {
      kind: 'data-organise', version: 1, presentation: 'order',
      table: [['Units'], ...startingOrder.map(unit => [unit])],
      inputs: units.map((unit, index) => ({label: 'Position ' + (index + 1), accepted: [unit], marks: 1})),
    },
  }],
};
module.exports = {
  ...fair,
  sections: fair.sections.flatMap(section => {
    if (section.id !== 'files') return [section];
    const task = section.items[0];
    const inputs = task.activity.inputs.slice(0, 3).map((input, i) => ({...input, marks: [2, 2, 3][i]}));
    return [{...section, items: [{...task, marks: 7, activity: {...task.activity, inputs}}]}, fileUnits];
  }),
};
