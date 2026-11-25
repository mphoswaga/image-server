const fair = require('./data-fair-stations');

const marksByStation = {
  desk: Array(12).fill(1),
  types: [1, 2, 1, 2, 2],
  'paper-register': [2, 2, 1, 1],
  repair: [1, 1, 2, 2],
  'stock-sheet': [1, 1, 1, 2, 2],
  files: [2, 1, 2],
  'file-units': [1, 1, 2, 1, 1],
};

const sections = fair.sections.filter(section => Object.hasOwn(marksByStation, section.id)).map(section => ({
  ...section,
  items: section.items.map(item => {
    const points = marksByStation[section.id];
    return {
      ...item,
      marks: points.reduce((total, mark) => total + mark, 0),
      activity: {
        ...item.activity,
        inputs: item.activity.inputs.map((input, index) => ({ ...input, marks: points[index] })),
      },
    };
  }),
}));

module.exports = {
  ...fair,
  sections,
  totalMarks: sections.flatMap(section => section.items).reduce((total, item) => total + item.marks, 0),
};
