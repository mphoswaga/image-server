// One row per map square: arrows start the pirate, # is rock, ~ is water,
// 1 and 2 are lookout flags, and X is the treasure.
function practiceIsland(name, instructions, rows, repeat, limit, starterMoves = '') {
  const mission = {size:rows.length,rocks:[],water:[],blocks:['move','left','right','collect'],requireReturn:false};
  if (repeat !== 'No Repeat') mission.blocks.push('repeat');
  mission.repeatRequired = repeat === 'Use Repeat';
  const flags = [];
  rows.forEach((row,y) => Array.from(row).forEach((tile,x) => {
    const cell = [x,y];
    if ('^>v<'.includes(tile)) mission.start = [x,y,'^>v<'.indexOf(tile)];
    if (tile === 'X') mission.chest = cell;
    if (tile === '#') mission.rocks.push(cell);
    if (tile === '~') mission.water.push(cell);
    if ('12'.includes(tile)) flags[Number(tile)-1] = cell;
  }));
  const ops = {M:'move',L:'left',R:'right',C:'collect'};
  return {name,instructions,mission,repeat,limit,checkpoint:flags[0],secondCheckpoint:flags[1],
    starter:Array.from(starterMoves,op => ({op:ops[op]}))};
}

const codePracticeTopics = [
  ['First steps',[
    practiceIsland('Sandbar','Move to the chest and use Collect.', ['....','....','>..X','....'],'No Repeat'),
    practiceIsland('Harbour bend','Your pirate starts facing up. Plan where to turn.', ['....','..X.','....','^...'],'No Repeat'),
    practiceIsland('Narrow channel','Follow the channel. Count the moves, the turns and Collect.', ['~~~~~','~~..X','~~.~~','>..~~','~~~~~'],'No Repeat',9)
  ]],
  ['Around the rock',[
    practiceIsland('Reef gate','Visit the flag and steer around the rock.', ['....','...X','>1#.','....'],'No Repeat'),
    practiceIsland('Sheltered cove','Find a safe passage to the flag and then the chest.', ['~...X','~.##.','..1..','.#.#.','^..~~'],'Repeat optional'),
    practiceIsland('Coral pass','Reach the lookout before collecting. Use the long clear stretches to save blocks.', ['1...X','.###.','.~~~.','.###.','^....'],'Use Repeat',6)
  ]],
  ['Fix the route',[
    practiceIsland('Wrong turn','Test the starter. Find the turn that sends the pirate away from the chest.', ['....','..X.','..1.','>...'],'No Repeat',null,'MMRMMC'),
    practiceIsland('Early stop','The pirate turns too soon and tries to collect too early. Fix the route through the flag.', ['....X','....1','..#..','.....','>....'],'No Repeat',null,'MMMLMMMC'),
    practiceIsland('Broken delivery','The starter sails into a rock. Repair it, visit the flag and shorten the working code.', ['..1..','..##.','..~~.','>..#X','~~~~~'],'Use Repeat',12,'MMMRMC')
  ]],
  ['Use Repeat',[
    practiceIsland('Four square sprint','Test the working starter. Set the × number on Move to shorten it.', ['.....','.....','>...X','.....','.....'],'Use Repeat',3,'MMMMC'),
    practiceIsland('Corner crossing','Shorten both straight stretches while keeping the turn.', ['....X','.....','.....','.....','>....'],'Use Repeat',6,'MMMMLMMMMC'),
    practiceIsland('Switchback','Shorten the long working route. Keep both turns in the right places.', ['......','......','......','...~..','...~..','>..~.X'],'Use Repeat',12,'MMLMMMRMMMRMMMC')
  ]],
  ['Two lookout flags',[
    practiceIsland('Lookout trail','Visit both flags and collect the chest.', ['....','...X','...2','>1..'],'Repeat optional'),
    practiceIsland('Twin coves','Choose the order of the flags. Watch for the reef between them.', ['1...X','.##..','..~..','...2.','^....'],'Repeat optional'),
    practiceIsland('Captain’s circuit','Pass both lookouts and finish at the chest. Plan your turns before testing.', ['1...2','.###.','.~~~.','.###.','^...X'],'Use Repeat',9)
  ]]
];

function checkPracticeVoyage(task,program) {
  const run = CodeQuest.run(task.mission,program);
  if (!run.success) return {message:run.reason};
  const flags = [task.checkpoint,task.secondCheckpoint].filter(Boolean);
  const visited = flags.filter(([x,y])=>run.frames.some(frame=>frame.x===x && frame.y===y)).length;
  if (visited < flags.length) return {message:'Treasure collected. You visited '+visited+' of '+flags.length+' flags. Try a route through every flag.'};
  if (task.mission.repeatRequired && !run.frames.some(frame=>program[frame.block]?.op==='repeat')) return {message:'Treasure collected! Now use Repeat on the route.'};
  const count = CodeQuest.blockCount(program);
  if (task.limit && count>task.limit) return {message:'Your route works in '+count+' blocks. Shorten it to '+task.limit+' or fewer.'};
  return {complete:true,message:'Voyage complete! Your route uses '+count+' blocks.'};
}
