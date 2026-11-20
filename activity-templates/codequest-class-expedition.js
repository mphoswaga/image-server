const voyage = require('./codequest-voyage');

const [build, debug, optimise, expedition] = voyage.sections;
const commands = (...ops) => ops.map(op => ({op}));
const basic = ['move', 'left', 'right', 'collect'];
const loopTools = [...basic, 'repeat'];

function task(base, marks, rubric) {
  return {...base, marks, activity:{...base.activity, rubric}};
}

const harbour = {
  id:'harbour-bend', prompt:'Harbour bend · Start facing up. Find a turn that takes you to the chest. No Repeat.', marks:3,
  activity:{kind:'codequest-build', version:3, mission:{size:4,start:[0,3,0],chest:[2,1],blocks:basic},
    rubric:{reach:1,collect:2}},
};

const early = {
  id:'missed-delivery', prompt:'Missed delivery · Watch where the pirate turns. Repair the code so it passes the flag before collecting.', marks:6,
  activity:{kind:'codequest-debug', version:3,
    mission:{size:5,start:[0,4,1],chest:[4,0],rocks:[[2,2],[3,2]],water:[[0,0],[0,1]],blocks:basic},
    starter:commands('move','move','move','left','move','move','move','collect'),
    rubric:{checkpoint:{cell:[4,2],marks:2},reach:2,collect:2}},
};

const crossing = {
  id:'corner-crossing', prompt:'Corner crossing · Keep the turn and shorten both straight stretches. Earn full marks with Repeat in 6 blocks or fewer.', marks:8,
  activity:{kind:'codequest-optimise',version:3,
    mission:{size:5,start:[0,4,1],chest:[4,0],rocks:[[2,2]],water:[[0,0],[0,1],[1,0]],blocks:loopTools,repeatRequired:true},
    starter:commands('move','move','move','move','left','move','move','move','move','collect'),
    rubric:{collect:2,improvement:{shorter:{maxBlocks:8,marks:3},muchShorter:{maxBlocks:6,marks:6}}}},
};

const sections = [
  {...build,items:[
    task(build.items[0],3,{reach:1,collect:2}), harbour,
    task(build.items[1],5,{checkpoint:{cell:[2,4],marks:2},reach:1,collect:2}),
  ]},
  {...debug,instructions:'Test each starter. Watch the route, change the code and run it again.',
    items:[task(debug.items[0],6,{checkpoint:{cell:[2,4],marks:2},reach:2,collect:2}),early]},
  {...optimise,instructions:'Test the working route. Use the × control to shorten it, then test your shorter code.',
    items:[task(optimise.items[0],7,{collect:2,improvement:{shorter:{maxBlocks:7,marks:2},muchShorter:{maxBlocks:3,marks:5}}}),crossing]},
  {...expedition,items:[task(expedition.items[0],12,{checkpoint:{cell:[1,1],marks:3},secondCheckpoint:{cell:[4,4],marks:3},reach:2,collect:4})]},
];

module.exports = {...voyage,title:'CodeQuest · Harbour to the lookouts',sections,
  instructions:'Sail eight islands. Build routes, repair two broken programs and shorten two working ones. Finish by navigating both lookouts.',
  totalMarks:sections.flatMap(s => s.items).reduce((sum,item) => sum + item.marks,0)};
