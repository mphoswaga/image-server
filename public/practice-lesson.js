(() => {
  const mode = new URLSearchParams(location.search).get('activity');
  if (!['data','codequest'].includes(mode)) return;
  const sheet = '<div class="lesson-sheet"><table><thead><tr><th></th><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><th>1</th><td>Name</td><td>Room</td><td>Books borrowed</td></tr><tr><th>2</th><td>Khánh Linh</td><td>B04</td><td>2</td></tr><tr><th>3</th><td>Gia Bảo</td><td>B02</td><td>3</td></tr></tbody></table></div>';
  const chips = values => '<div class="lesson-chips">'+values.map(v=>'<span>'+v+'</span>').join('')+'</div>';
  const slides = mode==='data' ? [
    ['Meet your class register', 'A database is an organised collection of records. In this practice, you will use pretend pupil details to organise, check and find information.', sheet,
      'Khánh Linh and Gia Bảo each have their own record. All details in these activities are made up.'],
    ['Rows go across. Columns go down.', 'Rows have numbers. Columns have letters. A cell is one box where a row and a column meet.', sheet.replace('<td>B04</td>','<td class="lesson-cell">B04</td>'),
      'The highlighted cell is B2. It is in column B and row 2. It contains B04, Khánh Linh’s room.'],
    ['Fields and records', 'A field is a category of detail, such as Name or Room. A record holds the details about one pupil.', sheet,
      'Name, Room and Books borrowed are field names in row 1. Khánh Linh’s complete record is in row 2. B04 is one value in the Room field.'],
    ['Choose the right data type', 'Choose a data type that suits the purpose of the detail.', '<div class="lesson-examples"><article><b>Text</b><p>Name · Khánh Linh<br>Room · B04<br>House number · 24<br>Family phone · 090 000 0018</p></article><article><b>Number</b><p>Age · 8<br>Books borrowed · 2</p></article><article><b>Date</b><p>Date of birth<br>3 June 2018</p></article><article><b>Yes / No</b><p>Has a library card?<br>Yes</p></article></div>',
      'We store phone and house numbers as Text here because they identify something. We add up quantities, such as books. Text also keeps the first zero of a phone number.'],
    ['Copy carefully. Check the source.', 'Read the pupil card and copy each detail into the correct column. If a detail is missing, leave it empty and flag it when the task asks.', '<div class="lesson-example"><b>Pupil card</b><p>Gia Bảo · Room B02 · Family phone 090 000 0015</p><hr><b>Register before checking</b><p>Gia Bảo · Room B20 · Family phone 090 000 0015</p></div>',
      'Change B20 to B02. Keep the accurate phone number. When two cards have the same card ID, enter that pupil once.'],
    ['Paper and digital databases', 'A physical database keeps records on paper. A digital database keeps records electronically.', '<div class="lesson-examples"><article><b>Paper filing drawer</b><p>Open the drawer. Look through the pupil cards. Find the matching card ID.</p></article><article><b>Digital register</b><p>Type a name or card ID into Search. Find the record, then update the correct detail.</p></article></div>',
      'When Minh Anh changes rooms, read the new room on her paper card and update her digital record to match.'],
    ['Put file sizes in order', 'From smallest unit to largest unit, use this order.', chips(['Byte (B)','Kilobyte (KB)','Megabyte (MB)','Gigabyte (GB)','Terabyte (TB)']),
      'A short text note usually takes less space than a picture or video. Always compare the sizes shown in the task.'],
    ['Convert before comparing', 'For these activities, use 1 MB = 1,000 KB and 1 GB = 1,000 MB.', '<div class="lesson-examples"><article><b>Compare two files</b><p>Photo · 2 MB = 2,000 KB<br>Map · 800 KB<br>The map is smaller.</p></article><article><b>Find the space left</b><p>5 MB free − 3 MB picture = 2 MB<br>2 MB = 2,000 KB left</p></article></div>',
      'In the ladder tasks, drag a box or use its up and down arrows. Compare quantities after putting them in the same unit.'],
    ['Turn data into information', 'Data are the recorded details. Information gives those details meaning so you can answer a question or make a decision.', '<div class="lesson-examples"><article><b>Class votes</b><p>Reading · 6<br>Drawing · 4<br>Puzzles · 3</p></article><article><b>What the data tell us</b><p>Reading received the most votes.<br>Reading received 2 more votes than Drawing.</p></article></div>',
      'If two more children vote for Puzzles, update its total to 5 before comparing. Check what changed and what the question asks.'],

  ] : [
    ['Give your pirate clear instructions', 'An algorithm is an ordered set of instructions. Your pirate reads the blocks from top to bottom, then down the next column.', '<div class="lesson-example"><img class="lesson-pirate" src="/assets/codequest/assessment-pirate.svg" alt="Your pirate"><b>Start → Move → Move → Collect</b><p>This code reaches a chest two squares straight ahead and collects it.</p></div>',
      'Move goes one square in the direction the pirate is facing. Collect works when the pirate is standing on the chest.'],
    ['Turn first. Then move.', 'Turn left and Turn right change the direction the pirate faces. A turn stays on the same square.', chips(['Facing up ↑','Turn right ↱','Now facing right →','Move one square →']),
      'Plan from the pirate’s point of view. When the pirate faces right, turning left points it up.'],
    ['Test, find the mistake, improve', 'Debugging means finding and fixing mistakes in code. Use Test my code and watch each highlighted step.', chips(['Plan a route','Test my code','Find the wrong step','Edit and test again']),
      'Tap a block to edit it. Drag blocks to change their order. Drag a block out of the code area to remove it. Avoid rocks and water, and visit any flags before collecting.'],
    ['Repeat saves repeated instructions', 'When Repeat is available, set the × number on a block to run that action several times.', '<div class="lesson-example"><b>Move · Move · Move · Move · Collect</b><p>becomes</p><b>Repeat ×4 [Move] · Collect</b></div>',
      'No Repeat means use single actions. Use Repeat means your working route must run a Repeat block. Repeat optional means you choose.'],
    ['Read the block limit', 'Some challenges ask you to reach the treasure using a maximum number of blocks. Count the Repeat container and the blocks inside it.', '<div class="lesson-example"><b>Repeat ×4 [Move] · Collect</b><p>Repeat container = 1<br>Move inside Repeat = 1<br>Collect = 1<br><strong>Total = 3 blocks</strong></p></div>',
      'The × number tells the pirate how many times to act. It does not add extra written blocks. Test a route, then shorten it while keeping it correct.'],

  ];
  // These small worked examples have their own data, separate from learner answers.
  const item = (key,text) => '<span class="demo-item" data-key="'+key+'">'+text+'</span>';
  const row = (...items) => '<div class="demo-row">'+items.join('')+'</div>';
  const change = (target,caption,text) => ({target,caption,text});
  const miniGrid = '<table class="demo-grid"><tr><th></th><th>A</th><th data-key="col">B</th></tr><tr><th>1</th><td>Name</td><td>Room</td></tr><tr><th data-key="row">2</th><td>Mai</td><td data-key="cell">A03</td></tr></table>';
  const record = row(item('card','Pupil card · Mai · Room A03'))+row(item('name','Name · Mai'),item('room','Room · ____'));
  const demos = {
    'Correct a record':[4,record.replace('Room · ____','Room · A30'),[change('card','Read the room on the source card.'),change('room','The digits are swapped. Select the wrong entry and replace it.','Room · A03')]],
    'Choose data types':[3,row(item('field','Room number · 007'))+row(item('number','○ Number'),item('type','○ Text')),[change('field','Read the field and its example.'),change('type','Choose Text to keep this room code exactly as written.','● Text')]],
    'Explore file sizes':[7,row(item('map','Map.png · 2 MB'),item('note','Note.txt · 50 KB'))+row(item('answer','Smaller file · ____')),[change('map','Convert 2 MB to 2,000 KB.','Map.png · 2,000 KB'),change('note','Compare 50 KB with 2,000 KB.'),change('answer','Choose the file that uses less space.','Smaller file · Note.txt')]],
    'File-size ladder':[6,'<div class="demo-ladder">'+item('large','⠿  Megabyte (MB)')+item('small','⠿  Kilobyte (KB)')+item('largest','⠿  Gigabyte (GB)')+'</div>',[change('small','Press and hold Kilobyte.'),{target:'large',caption:'Drag it above Megabyte and release.',reorder:true},change('small','Read down the ladder from smallest to largest.')]],
    'Turn data into information':[8,row(item('art','Art · 5 votes'),item('music','Music · 8 votes'))+row(item('answer','○ Music received the most votes')),[change('art','Read the five votes for Art.'),change('music','Compare with the eight votes for Music.'),change('answer','Choose the statement supported by the votes.','● Music received the most votes')]],
    'Paper records and digital records':[5,row(item('drawer','▣ Open filing drawer'),item('search','Search library register'))+row(item('room','Room · A01')),[change('drawer','Open the paper drawer and read card L24.','Card L24 · Mai · Room A03'),change('search','Search for the same card ID in the digital register.','Search · L24 → Mai'),change('room','Update Mai’s room to match the paper card.','Room · A03')]],
    'Rows, columns and cells':[1,miniGrid,[change('row','Click 2 on the left to select row 2.'),change('col','Click B at the top to select column B.'),change('cell','Click where they meet. Cell B2 holds the room code A03.')]]
  };
  function voyage(title, lesson, tiles, moves, steps) {
    const ocean = '<div class="demo-island">'+tiles.map((tile,i)=>item('tile'+i,tile)).join('')+'</div>';
    demos[title] = [lesson,ocean+row(...moves.map(([key,label])=>item(key,label)))+row(item('stack','▶ Start')),steps];
  }
  const pirateImage = '<img src="/assets/codequest/assessment-pirate.svg" alt="Pirate">';
  const pirate=pirateImage+' →', chest='<img src="/assets/codequest/treasure.svg" alt="Treasure chest">';
  voyage('First steps',0,[pirate,chest],[['move','↑ Move'],['collect','Collect'],['test','▶ Test my code']],[
    {target:'move',caption:'Click Move to add one step.',stack:'▶ Start · Move'},
    {target:'collect',caption:'Add Collect after Move.',stack:'▶ Start · Move · Collect'},
    {target:'test',caption:'Test the code. The pirate moves onto the chest and collects it.',travel:[0,1]}]);
  voyage('Around the rock',1,[pirate,'🪨','⬜','⬜'],[['turn','↱ Turn right'],['move','↑ Move']],[{target:'tile1',caption:'Look ahead. A rock blocks the square on the right.'},{target:'turn',caption:'Add Turn right. The pirate will face down.',stack:'▶ Start · Turn right'},{target:'move',caption:'Add Move. Testing these steps takes the pirate below the rock.',stack:'▶ Start · Turn right · Move',travel:[0,2]}]);
  voyage('Fix the route',2,[pirate,chest],[['wrong','1 · Turn left'],['move','↑ Move'],['test','▶ Test my code']],[change('wrong','Tap the step that turns away from the chest.'),{target:'move',caption:'Choose Move to replace the wrong turn.',stack:'▶ Start · Move · Collect'},{target:'test',caption:'Test the repaired route.',travel:[0,1]}]);
  voyage('Use Repeat',4,[pirate,'⬜',chest],[['count','Move × 1'],['test','▶ Test my code']],[{target:'count',caption:'Click the repeat count and enter 2.',text:'Move × 2',stack:'▶ Start · Move × 2 · Collect'},{target:'test',caption:'Run the code. One written Move runs twice before Collect.',travel:[0,1,2]}]);
  voyage('Two lookout flags',2,[pirate,'⚑ 1','⚑ 2',chest],[['test','▶ Test my code']],[change('tile1','Plan to cross the first flag.'),change('tile2','Continue through the second flag.'),{target:'test',caption:'Test the route through both flags, then collect.',stack:'▶ Start · Move · Move · Move · Collect',travel:[0,1,2,3]}]);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const tutorials = [];
  for (const panel of document.querySelectorAll('.practice-card')) {
    const title = panel.querySelector('h2').textContent;
    const box = document.createElement('details');
    box.className = 'topic-tutorial';
    if (title === 'Make a record') {
      box.innerHTML = '<summary>Watch how to fill in one row · 38 seconds</summary><div class="tutorial-body"><video controls playsinline preload="metadata" aria-label="How to copy a pupil card into the register" poster="/assets/data-lab/make-a-record.jpg"><source src="/assets/data-lab/make-a-record.mp4" type="video/mp4"><track kind="captions" srclang="en" label="English" src="/assets/data-lab/make-a-record.vtt"></video><button type="button" class="demo-start">Start practice</button></div>';
      panel.querySelector('.instructions').after(box);
      const video = box.querySelector('video');
      const stop = () => video.pause();
      let visited = false;
      box.ontoggle = () => { if (box.open) visited = true; else stop(); };
      box.querySelector('button').onclick = () => { box.open = false; box.querySelector('summary').focus(); };
      tutorials.push({panel,box,stop,seen:()=>visited});
      continue;
    }
    const [lesson,scene,steps] = demos[title];
    box.innerHTML = '<summary>Watch tutorial · '+title+'</summary><div class="tutorial-body"><div class="demo-stage"><div class="demo-scene"></div><i class="demo-pointer" aria-hidden="true"></i></div><p class="demo-caption" role="status"></p><div class="demo-actions"><button type="button" class="demo-play"></button><button type="button" class="demo-next">Step forward</button><button type="button" class="demo-start">Start practice</button></div><details class="demo-reading"><summary>Read the example</summary></details></div>';
    panel.querySelector('.instructions').after(box);
    const reading = box.querySelector('.demo-reading');
    const readings = title==='Rows, columns and cells'?[1,2]:title==='Use Repeat'?[3,4]:title==='Explore file sizes'?[6,7]:[lesson];
    for (const idx of readings) {
      const [heading,intro,visual,note]=slides[idx];
      reading.insertAdjacentHTML('beforeend','<h3>'+heading+'</h3><p>'+intro+'</p>'+visual+'<p>'+note+'</p>');
    }
    const stage=box.querySelector('.demo-stage'), sceneEl=box.querySelector('.demo-scene'), pointer=box.querySelector('.demo-pointer');
    const play=box.querySelector('.demo-play'),forward=box.querySelector('.demo-next'),caption=box.querySelector('.demo-caption');
    let index=0, timer=0, playing=false, visited=false;
    const at=key=>sceneEl.querySelector('[data-key="'+key+'"]');
    function stop() {clearTimeout(timer);playing=false;play.textContent=index===steps.length?'Replay':'Play';}
    function reset() {
      stop();index=0;sceneEl.innerHTML=scene;pointer.hidden=true;forward.disabled=false;
      caption.textContent='Watch how to '+title.toLowerCase()+'.';play.textContent='Play';
    }
    function step() {
      const action=steps[index++];
      const target=at(action.target);
      sceneEl.querySelectorAll('.demo-on').forEach(node=>node.classList.remove('demo-on'));
      target.classList.add('demo-on');
      if (action.target==='row') Array.from(target.parentElement.cells).forEach(cell=>cell.classList.add('demo-on'));
      if (action.target==='col') Array.from(target.closest('table').rows).forEach(row=>row.cells[2].classList.add('demo-on'));
      const base=stage.getBoundingClientRect(), rect=target.getBoundingClientRect();
      pointer.hidden=false;
      pointer.style.transform='translate('+Math.round(rect.left-base.left+rect.width*.55)+'px,'+Math.round(rect.top-base.top+rect.height*.55)+'px)';
      if (!reduced.matches) target.animate([{boxShadow:'inset 0 0 0 3px #ebad30'},{boxShadow:'inset 0 0 0 0 transparent'}],{delay:360,duration:650});
      if(action.text) target.textContent=action.text;
      if(action.stack) at('stack').textContent=action.stack;
      if(action.reorder) {
        const tile=at('small'),before=tile.offsetTop;
        target.before(tile);
        if(!reduced.matches) tile.animate([{transform:'translateY('+(before-tile.offsetTop)+'px)'},{transform:'translateY(0)'}],650);
      }
      if(action.travel) {
        const path=action.travel.map(i=>at('tile'+i));
        const avatar=document.createElement('span');avatar.innerHTML=pirateImage;path[0].replaceChildren(avatar);
        const start=path[0].getBoundingClientRect();
        const frames=path.map(tile=>{const end=tile.getBoundingClientRect();return {transform:'translate('+(end.x-start.x)+'px,'+(end.y-start.y)+'px)'};});
        avatar.style.display='inline-block';avatar.style.transform=frames.at(-1).transform;
        if(!reduced.matches) avatar.animate(frames,{duration:500*(path.length-1),easing:'linear'});
      }
      caption.textContent=(index)+' / '+steps.length+' · '+action.caption;
      forward.disabled=index===steps.length;
      if(forward.disabled)stop();
      else if(playing)timer=setTimeout(step,3000);
    }
    function start() {if(index===steps.length)reset();playing=true;play.textContent='Pause';step();}
    play.onclick=()=>playing?stop():start();
    forward.onclick=()=>{stop();step();};
    box.querySelector('.demo-start').onclick=()=>{box.open=false;box.querySelector('summary').focus();};
    box.ontoggle=()=>{if(box.open&&!panel.hidden){visited=true;if(!index&&!reduced.matches)start();}else stop();};
    reset();
    tutorials.push({panel,box,stop,seen:()=>visited});
  }
  function sync() {
    const visible=tutorials.filter(t=>!t.panel.hidden);
    for(const t of tutorials) {
      if(t.panel.hidden || visible.length!==1){t.box.open=false;t.stop();}
      else if(!t.seen())t.box.open=true;
    }
  }
  const observer=new MutationObserver(sync);
  tutorials.forEach(t=>observer.observe(t.panel,{attributes:true,attributeFilter:['hidden']}));
  sync();
})();
