(() => {
  const root = document.getElementById('practiceTasks');
  const mode = new URLSearchParams(location.search).get('activity');
  function card(title, instructions) {
    const section = document.createElement('section');
    for (const [tag, text] of [['h2', title], ['p', instructions]]) {
      const node = document.createElement(tag);
      node.textContent = text;
      section.append(node);
    }
    root.append(section);
    return section;
  }
  if (mode !== 'data') {
    const base = { size: 5, start: [1, 3, 1], chest: [3, 2], rocks: [[3, 3]], water: [], requireReturn: false };
    const blocks = (...ops) => ops.map(op => ({op}));
    const practice = [
      ['Build a route', 'Go around the rock and collect the treasure.', []],
      ['Fix a route', 'Run the starting code. Change the turn that sends the pirate the wrong way.', blocks('move','right','move','right','move','collect')],
      ['Shorten a route', 'Remove extra steps and still collect the treasure.', blocks('left','right','move','left','move','right','move','collect')],
    ];
    for (const [title, instructions, starter] of practice) AssessmentCodeQuest.mount(card(title, instructions), {mission:base,starter}, null, () => {});
  }
  if (mode !== 'codequest') {
    const source = ['Basil · herb · 6 pots', 'Tulip · flower · 3 pots'];
    function exercise(title, instructions, activity, keys) {
      const panel = card(title, instructions);
      let responses = activity.inputs.map(input => input.initial ?? null);
      AssessmentDataTable.mount(panel, activity, null, next => { responses = next; });
      const result = document.createElement('p');
      result.setAttribute('role','status');
      const check = document.createElement('button');
      check.textContent = 'Check my work';
      check.onclick = () => { result.textContent = responses.every((value,index) => value === keys[index]) ? 'That matches the data.' : 'Check the source again and try another choice.'; };
      panel.append(check, result);
    }
    exercise('Organise and correct', 'Use the source cards to fill the heading and repair the value.', {
      source, table:[['Plant','','Pots'],['Basil','Herb','6'],['Tulip','Flower','']],
      inputs:[{row:0,column:1,label:'Field for the plant type',options:['Pots','Type','Plant']},
        {row:2,column:2,label:'Correct the number of Tulip pots',options:['6','3'],initial:'6'}],
    }, ['Type','3']);
    exercise('Find and interpret', 'Read the completed table.', {
      source:[], table:[['Plant','Type','Pots'],['Basil','Herb','6'],['Tulip','Flower','3']],
      inputs:[{label:'Which record shows a flower?',options:['Basil','Tulip']},
        {label:'Which plant has the most pots?',options:['Basil','Tulip']}],
    }, ['Tulip','Basil']);
  }
})();
