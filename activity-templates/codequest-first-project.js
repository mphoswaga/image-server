const blocks = (...ops) => ops.map(op => ({ op }));
const mission = (chest, rocks = []) => ({ size: 6, start: [0, 4, 1], chest, rocks });
const objectiveIds = ['sequence', 'debug', 'efficiency'];

function item(id, prompt, marks, kind, map, rubric, starter) {
  return { id, prompt, marks, activity: { kind, version: 1, mission: map, rubric, ...(starter ? { starter } : {}) } };
}

const sections = [
  {
    id: 'build', title: 'Build routes', type: 'practical', objectiveIds: [objectiveIds[0]],
    instructions: 'Add blocks to guide the pirate. Run your code to check it.',
    items: [
      item('near', 'Build code to collect the nearby treasure.', 5, 'codequest-build', mission([2, 4]), { reach: 2, collect: 3 }),
      item('middle', 'Visit the flag and turn around the rock to collect the treasure.', 7, 'codequest-build', mission([3, 3], [[3, 4]]), { checkpoint: { cell: [2, 4], marks: 2 }, reach: 2, collect: 3 }),
      item('far', 'Guide the pirate past the flag and around the reef to the far treasure.', 8, 'codequest-build', mission([4, 1], [[2, 4], [2, 3], [2, 2]]), { checkpoint: { cell: [1, 1], marks: 3 }, reach: 2, collect: 3 }),
    ],
  },
  {
    id: 'debug', title: 'Fix the code', type: 'practical', objectiveIds: [objectiveIds[1]],
    instructions: 'Test the starting code. Fix the route and test it again.',
    items: [item('fix', 'Fix the wrong turn. Pass the flag and collect the treasure.', 15, 'codequest-debug', mission([2, 2]),
      { checkpoint: { cell: [2, 3], marks: 5 }, reach: 4, collect: 6 },
      blocks('move', 'move', 'right', 'move', 'move', 'collect'))],
  },
  {
    id: 'optimise', title: 'Shorten the code', type: 'practical', objectiveIds: [objectiveIds[2]],
    instructions: 'The starting code works. Use fewer blocks and still collect the treasure.',
    items: [item('shorten', 'Make a shorter working route to the treasure.', 15, 'codequest-optimise', mission([3, 4]),
      { collect: 5, improvement: { shorter: { maxBlocks: 8, marks: 5 }, muchShorter: { maxBlocks: 6, marks: 10 } } },
      blocks('left', 'move', 'right', 'move', 'move', 'move', 'right', 'move', 'collect'))],
  },
];

module.exports = {
  title: 'CodeQuest · Build, fix and shorten', subject: 'ICT', grade: 'Grade 2',
  assessmentType: 'project', deliveryMode: 'live',
  instructions: 'Build, fix and shorten your code. Use Run to check your work before submitting.',
  objectives: [
    { id: objectiveIds[0], text: 'Build and sequence a linear algorithm' },
    { id: objectiveIds[1], text: 'Understand and correct an algorithm' },
    { id: objectiveIds[2], text: 'Improve an algorithm by removing unnecessary steps' },
  ],
  sections,
  totalMarks: sections.flatMap(section => section.items).reduce((sum, task) => sum + task.marks, 0),
};
