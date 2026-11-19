const original = require('./codequest-first-project');

const blocks = (...ops) => ops.map(op => ({op}));
const ship = { size: 6, start: [0, 5, 1], rocks: [], water: [] };
const tools = ['move', 'left', 'right', 'collect', 'repeat'];
const [build, debug, optimise] = original.sections;

module.exports = { suggestedMinutes:60,
  ...original, title: 'CodeQuest · The two-flag voyage',
  instructions: 'Build a route, repair a route and shorten a route. Then chart your own voyage. You can test and change your code before you submit.',
  sections: [
    {...build, items: build.items.slice(0, 2)},
    {...debug, instructions: 'Run the starter once. Watch where it stops. Change the turn and check whether the last move reaches the chest.',
      items: [{...debug.items[0], prompt: 'Repair the lighthouse route. Sail past the flag and collect the chest.', marks: 11,
        activity: {...debug.items[0].activity, mission: {...ship, chest: [2,2], rocks: [[3,4]], water: [[1,2],[1,3],[4,0]]},
          rubric: {checkpoint: {cell:[2,4], marks:4}, reach:3, collect:4},
          starter: blocks('move','move','right','move','move','collect')}}]},
    {...optimise, instructions: 'Test the long route first. Look for moves that repeat. Use the × control on a Move block, then compare your block count.',
      items: [{id:'shorten', prompt:'Collect the chest with fewer blocks. Use Repeat and compare your new block count with the starter.', marks:12,
        activity:{kind:'codequest-optimise',version:3,mission:{...ship,chest:[5,5],rocks:[[2,3],[4,2]],water:[[0,0],[1,0]],blocks:tools,repeatRequired:true},
          starter:blocks('left','move','right','move','move','move','move','move','right','move','collect'),
          rubric:{collect:4, improvement:{shorter:{maxBlocks:7,marks:4},muchShorter:{maxBlocks:3,marks:8}}}}}]},
    {id:'expedition',type:'practical',title:'The two-flag voyage',objectiveIds:['sequence','efficiency'],
      instructions:'Plan your own route. Visit both flags in either order before collecting the treasure. Test it, watch the flag count and improve your route.',
      items:[{id:'two-flags',prompt:'Sail around the reef, visit both lookout flags and collect the treasure.',marks:15,
        activity:{kind:'codequest-build',version:3,mission:{...ship,start:[0,5,0],chest:[5,1],rocks:[[2,2],[2,3],[2,4],[4,2]],water:[[0,0],[1,0],[3,4],[5,5]],blocks:tools},
          rubric:{checkpoint:{cell:[1,1],marks:4},secondCheckpoint:{cell:[4,4],marks:4},reach:3,collect:4}}}]},
  ],
};
