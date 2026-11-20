(() => {
  const root = document.getElementById('practiceTasks');
  const mode = new URLSearchParams(location.search).get('activity');
  document.body.dataset.activity = mode === "data" || mode === "codequest" ? mode : "home";
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
  if (mode === 'codequest') {
    document.title = 'Grade 2 CodeQuest practice · LessonScope';
    document.getElementById('title').textContent = 'Grade 2 · CodeQuest practice';
    document.getElementById('intro').textContent = 'Build, debug and use Repeat. Test your code as often as you like. Your practice is not marked.';
    const names = ['Easy','Moderate','Complicated'];
    for (const [title,levels] of codePracticeTopics) {
      const panel = card(title,'');
      const label = element('strong');
      const rules = element('div'); rules.className = 'voyage-rules';
      const board = element('div');
      const result = element('p'); result.className = 'feedback'; result.setAttribute('role','status');
      const next = element('button'); next.className = 'check';
      panel.prepend(label);
      panel.append(rules,board,result,next);
      function show(index) {
        const task = levels[index];
        label.textContent = names[index] + ' · ' + task.name;
        panel.querySelector('.instructions').textContent = task.instructions;
        rules.replaceChildren(element('strong',task.repeat));
        const budget = element('strong');
        if (task.limit) {
          rules.append(element('strong',task.limit+' blocks maximum'),budget,element('small',task.repeat==='No Repeat' ? 'Count every Move, turn and Collect.' : 'Count turns and Collect. Repeat ×4 Move counts as two blocks.'));
        }
        board.replaceChildren();
        function reset(program) {
          next.hidden = true; result.textContent = '';
          if (task.limit) {
            const count = CodeQuest.blockCount(program);
            budget.textContent = count + ' used' + (count > task.limit ? ' · over limit' : '');
          }
        }
        reset(task.starter);
        AssessmentCodeQuest.mount(board,{...task,targetBlocks:task.limit},null,reset,program=>{
          const outcome = checkPracticeVoyage(task,program);
          result.textContent = outcome.message + (outcome.complete && index===2 ? ' All three levels complete.' : '');
          next.hidden = !outcome.complete || index===2;
        });
        next.textContent = 'Continue to '+(names[index+1] || '');
        next.onclick = () => {show(index+1);panel.scrollIntoView({block:'start'});};
      }
      show(0);
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
          if (title === 'Choose data types' && index === 0 &&
              responses[4] && responses[5]) {
            result.textContent += ' Cellphone and house numbers use Text here because they identify a phone or house. We do not use them to calculate a quantity. Text also keeps the first zero in a phone number.';
          }
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
      presentation:'types',table:[['Field','Example'],['Name','Khánh Linh'],['Age','8'],['Birthday','3 June'],['Has a library card?','Yes'],['Cellphone number','0901234567'],['House number','24']],
      inputs:['Name','Age','Birthday','Has a library card?','Cellphone number','House number'].map(label => choice(label,['Text','Number','Date','Yes / No']))
    },[['Text'],['Number'],['Date'],['Yes / No'],['Text'],['Text']]);
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
    mountDatabasePractice(card('Paper records and digital records', ''));
  } else {
    const links = element('div'); links.className = 'grade-links';
    for (const [label,activity] of [['Grade 2 · CodeQuest','codequest'],['Grade 3 · Data practice','data']]) {
      const link = element('a',label); link.href = '?activity='+activity; links.append(link);
    }
    root.append(links);
    document.querySelector('.practice-brand a:last-child').hidden = true;
    return;
  }
  const topics = element('aside');
  topics.className = 'practice-topics';
  topics.setAttribute('aria-label', 'Practice topics');
  const heading = element('h2', 'Your topics');
  const select = element('select');
  select.setAttribute('aria-label', 'Choose a practice topic');
  const list = element('div');
  const view = {};
  const buttons = panels.map((panel, i) => {
    const title = panel.querySelector('h2').textContent;
    select.add(new Option((i + 1) + '. ' + title, i));
    const button = element('button');
    button.type = 'button';
    button.append(element('span', String(i + 1)), element('b', title));
    button.onclick = () => goTo(i);
    list.append(button);
    return button;
  });
  topics.append(heading, select, list);
  root.before(topics);
  const goTo = practicalTaskPager(root, panels, view, () => {
    select.value = view.all ? '' : String(view.index);
    for (const [i,button] of buttons.entries()) {
      if (!view.all && i === view.index) button.setAttribute('aria-current','step');
      else button.removeAttribute('aria-current');
    }
  });
  const allOption = new Option('All topics', '');
  allOption.disabled = true;
  select.prepend(allOption);
  select.value = String(view.index);
  select.onchange = () => goTo(Number(select.value));
})();
