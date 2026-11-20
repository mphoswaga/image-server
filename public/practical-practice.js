(() => {
  const root = document.getElementById('practiceTasks');
  const mode = new URLSearchParams(location.search).get('activity');
  const panels = [];
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  function card(title, instructions) {
    const section = element('section');
    section.className = 'practice-card';
    const description = element('p', instructions);
    description.className = 'instructions';
    section.append(element('h2', title), description);
    root.append(section);
    panels.push(section);
    return section;
  }
  const blocks = (...ops) => ops.map(op => ({op}));
  if (mode === 'codequest') {
    document.title = 'Grade 2 CodeQuest practice · LessonScope';
    document.getElementById('title').textContent = 'Grade 2 · CodeQuest practice';
    document.getElementById('intro').textContent = 'Build, debug and use Repeat. Test your code as often as you like. Your practice is not marked.';
    const tools = ['move','left','right','collect','repeat'];
    const missions = [
      {title:'First steps', instructions:'Build a route to the treasure. Press Test my code to watch your pirate.', mission:{size:6,start:[0,4,1],chest:[3,4],rocks:[],water:[],blocks:tools}},
      {title:'Around the rock', instructions:'Visit the flag, then go around the rock to reach the treasure.', mission:{size:6,start:[0,4,1],chest:[3,3],rocks:[[3,4]],water:[],blocks:tools}, checkpoint:[2,4]},
      {title:'Fix the route', instructions:'Test the starting code. Change the wrong turn so the pirate visits the flag and collects the treasure.', mission:{size:6,start:[0,4,1],chest:[2,2],rocks:[],water:[],blocks:tools}, checkpoint:[2,3], starter:blocks('move','move','right','move','move','collect')},
      {title:'Use Repeat', instructions:'Test the long code. Then use the × control on a Move block to make it shorter.', mission:{size:6,start:[0,5,1],chest:[4,5],rocks:[],water:[],blocks:tools,repeatRequired:true}, starter:blocks('left','right','move','move','move','move','collect'),targetBlocks:3},
      {title:'Two lookout flags', instructions:'Plan your own route. Visit both flags in either order, then collect the treasure.', mission:{size:6,start:[0,5,0],chest:[5,1],rocks:[[2,2],[2,3],[2,4]],water:[[0,0],[4,4]],blocks:tools}, checkpoint:[1,2], secondCheckpoint:[4,3]},
    ];
    for (const task of missions) {
      const panel = card(task.title,task.instructions);
      AssessmentCodeQuest.mount(panel,{...task,mission:{...task.mission,requireReturn:false}},null,() => {});
    }
  } else if (mode === 'data') {
    document.title = 'Grade 3 data practice · LessonScope';
    document.getElementById('title').textContent = 'Grade 3 · Data practice';
    document.getElementById('intro').textContent = 'Practise organising, checking and using data. You can check your answers and try again. Your practice is not marked.';
    function exercise(title,instructions,activity,keys) {
      const panel = card(title,instructions);
      const levels = [{instructions,activity,keys}, ...dataPracticeLevels(title)];
      const levelNames = ['Easy','Moderate','Complicated'];
      const levelLabel = element('strong');
      panel.prepend(levelLabel);
      const area = element('div');
      const button = element('button','Check my work');
      button.className = 'check';
      const next = element('button');
      const result = element('p'); result.className = 'feedback'; result.setAttribute('role','status');
      panel.append(area,button,result,next);
      function show(index) {
        const level = levels[index];
        levelLabel.textContent = levelNames[index] + ' · ' + (index+1) + ' of 3';
        panel.querySelector('.instructions').textContent = level.instructions;
        const task = structuredClone(level.activity);
        for (const field of task.inputs) {
          if (!field.options) continue;
          for (let i=field.options.length-1;i>0;i--) {
            const j=Math.floor(Math.random()*(i+1));
            [field.options[i],field.options[j]]=[field.options[j],field.options[i]];
          }
        }
        let responses = task.inputs.map(field=>field.initial ?? '');
        area.className = ''; area.replaceChildren();
        next.hidden = true; result.textContent = '';
        AssessmentDataTable.mount(area,{source:[],namedBadges:task.presentation==='records',...task},null,values=>{
          responses = values; next.hidden = true; result.textContent = '';
        });
        const normal = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
        button.onclick = () => {
          const missed = task.inputs.filter((field,i)=>!level.keys[i].some(key=>normal(key)===normal(responses[i])));
          result.textContent = missed.length ? 'Check again: ' + missed.map(f=>f.label).join(', ') + '.' :
            index===2 ? 'Well done! You completed all three levels.' : 'Well done! All answers match.';
          next.hidden = missed.length>0 || index===2;
        };
        next.textContent = 'Continue to ' + (levelNames[index+1] || '');
        next.onclick = () => {show(index+1); panel.scrollIntoView({block:'start'});button.blur();};
      }
      show(0);
    }
    const input = (label,row,column) => ({label,row,column,entry:'text'});
    const choice = (label,options) => ({label,options});
    exercise('Make a record','Read the badge and type each detail into the correct field. Keep the zeroes at the start of the phone number.',{
      presentation:'records',source:['Võ Khánh Linh · Age 8 · Born 3 June 2018 · Phone 000 000 0012'],
      table:[['Name','Age','Date of birth','Phone'],['','','','']],
      inputs:[input('Name',1,0),input('Age',1,1),input('Date of birth',1,2),input('Phone',1,3)]
    },[['Võ Khánh Linh'],['8'],['3 June 2018','03/06/2018','3/6/2018','2018-06-03'],['000 000 0012','0000000012']]);
    exercise('Choose data types','Pick the best data type for each field.',{
      presentation:'types',table:[['Field','Example'],['Name','Khánh Linh'],['Age','8'],['Birthday','3 June'],['Has a library card?','Yes']],
      inputs:['Name','Age','Birthday','Has a library card?'].map(label => choice(label,['Text','Number','Date','Yes / No']))
    },[['Text'],['Number'],['Date'],['Yes / No']]);
    exercise('Correct a record','Compare the record with the badge. Choose the correct details.',{
      presentation:'records',source:['Lê Minh Đức · Age 9 · Phone 000 000 0013'],
      table:[['Name','Age','Phone'],['Lê Minh Đức','','']],
      inputs:[{...choice('Age',['8','9','10']),row:1,column:1,initial:'8'},{...choice('Phone',['13','000 000 0013','000 000 0031']),row:1,column:2,initial:'13'}]
    },[['9'],['000 000 0013']]);
    exercise('Explore file sizes','Look at the examples and use the sizes shown in the task.',{
      presentation:'files',table:[['File','Size'],['Welcome note.txt','2 KB'],['Art poster.png','4 MB'],['Fair video.mp4','20 MB']],
      inputs:[choice('Which file is smallest?',['Welcome note.txt','Art poster.png','Fair video.mp4']),choice('A poster must be under 6 MB. How much space remains after a 4 MB poster?',['2 MB','10 MB','2 KB'])]
    },[['Welcome note.txt'],['2 MB']]);
    const units = ['Byte (B)','Kilobyte (KB)','Megabyte (MB)','Gigabyte (GB)','Terabyte (TB)'];
    exercise('File-size ladder','Drag the boxes or use the arrows. Put the smallest unit at the top.',{
      presentation:'order',table:[['Unit'],...[units[3],units[0],units[4],units[2],units[1]].map(unit=>[unit])],
      inputs:units.map((_,index)=>({label:'Position '+(index+1)}))
    },units.map(unit=>[unit]));
    exercise('Turn data into information','Read the votes and help the library decide which activity needs more space.',{
      presentation:'survey',table:[['Activity','Votes'],['Reading','7'],['Drawing','4'],['Puzzles','5']],
      inputs:[choice('Which activity received the most votes?',['Reading','Drawing','Puzzles']),choice('How many more votes did Reading get than Drawing?',['3','7','11']),choice('Which sentence is information you can use?',['Reading was the most popular activity.','7','4'])]
    },[['Reading'],['3'],['Reading was the most popular activity.']]);
  } else {
    const links = element('div'); links.className = 'grade-links';
    for (const [label,activity] of [['Grade 2 · CodeQuest','codequest'],['Grade 3 · Data practice','data']]) {
      const link = element('a',label); link.href = '?activity='+activity; links.append(link);
    }
    root.append(links);
    return;
  }
  practicalTaskPager(root,panels,{});
})();
