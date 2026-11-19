const { generate } = require('../codequest-maps');

const stages = Array.from({ length: 5 }, (_, index) => {
  const level = index + 1;
  // Every learner gets the same playable island for the chosen stage.
  const { map } = generate({ level, seed: 'assessment-stage-v1-' + level, requireReturn: false });
  return {
    id: 'codequest-stage-' + level,
    prompt: 'Stage ' + level + ' · ' + map.title,
    marks: 10,
    activity: {
      kind: 'codequest-build', version: 2, mission: map,
      rubric: { reach: 4, collect: 6 },
    },
  };
});

module.exports = {
  title: 'CodeQuest · Choose game stages', subject: 'ICT', grade: 'Grade 2',
  assessmentType: 'project', deliveryMode: 'live', totalMarks: 50,
  instructions: 'Build a route to the treasure on each island. Test your code before submitting.',
  objectives: [{ id: 'sequence', text: 'Build and test an algorithm to reach and collect the treasure' }],
  sections: [{
    id: 'codequest-stages', type: 'practical', title: 'CodeQuest stages',
    objectiveIds: ['sequence'], instructions: 'Guide your pirate to the chest and use Collect.',
    items: stages,
  }],
};
