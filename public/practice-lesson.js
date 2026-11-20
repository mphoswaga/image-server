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
  const films = {
    'Make a record': {path:'/assets/data-lab/make-a-record', seconds:38, reading:[0, 2]},
    'Choose data types': {path:'/assets/practice-films/data-types', seconds:19, reading:[3]},
    'Correct a record': {path:'/assets/practice-films/correct-record', seconds:18, reading:[4]},
    'Explore file sizes': {path:'/assets/practice-films/file-sizes', seconds:21, reading:[6, 7]},
    'File-size ladder': {path:'/assets/practice-films/size-ladder', seconds:19, reading:[6]},
    'Turn data into information': {path:'/assets/practice-films/information', seconds:19, reading:[8]},
    'Paper records and digital records': {path:'/assets/practice-films/databases', seconds:17, reading:[5]},
    'Rows, columns and cells': {path:'/assets/practice-films/rows-columns', seconds:16, reading:[1, 2]},
    'First steps': {path:'/assets/practice-films/first-steps', seconds:22, reading:[0]},
    'Around the rock': {path:'/assets/practice-films/around-rock', seconds:23, reading:[1]},
    'Fix the route': {path:'/assets/practice-films/fix-route', seconds:21, reading:[2]},
    'Use Repeat': {path:'/assets/practice-films/use-repeat', seconds:20, reading:[3, 4]},
    'Two lookout flags': {path:'/assets/practice-films/two-flags', seconds:22, reading:[2]},
  };
  const tutorials = [];
  for (const panel of document.querySelectorAll('.practice-card')) {
    const title = panel.querySelector('h2').textContent;
    const film = films[title];
    if (!film) continue;
    const box = document.createElement('details');
    box.className = 'topic-tutorial';
    box.innerHTML = '<summary></summary><div class="tutorial-body"><video controls playsinline preload="none"><track kind="captions" srclang="en" label="English"></video><button type="button" class="demo-start">Start practice</button><details class="demo-reading"><summary>Read the example</summary></details></div>';
    const summary = box.querySelector('summary');
    summary.textContent = 'Watch ' + title + ' · ' + film.seconds + ' seconds';
    const video = box.querySelector('video');
    video.setAttribute('aria-label', title + ' worked example');
    const reading = box.querySelector('.demo-reading');
    for (const index of film.reading) {
      const [heading,intro,visual,note] = slides[index];
      reading.insertAdjacentHTML('beforeend','<h3>'+heading+'</h3><p>'+intro+'</p>'+visual+'<p>'+note+'</p>');
    }
    panel.querySelector('.instructions').after(box);
    const tutorial = {panel,box,video,visited:false};
    tutorials.push(tutorial);
    box.ontoggle = () => {
      if (!box.open) { video.pause(); return; }
      tutorial.visited = true;
      if (!video.hasAttribute('src')) {
        video.poster = film.path + '.jpg';
        video.querySelector('track').src = film.path + '.vtt';
        video.src = film.path + '.mp4';
      }
    };
    video.onplay = () => tutorials.forEach(other => { if (other !== tutorial) other.video.pause(); });
    box.querySelector('button').onclick = () => { box.open = false; summary.focus(); };
  }
  function sync() {
    const single = tutorials.filter(t => !t.panel.hidden).length === 1;
    for (const t of tutorials) {
      if (t.panel.hidden || !single) { t.box.open = false; t.video.pause(); }
      else if (!t.visited) t.box.open = true;
    }
  }
  const observer = new MutationObserver(sync);
  tutorials.forEach(t => observer.observe(t.panel,{attributes:true,attributeFilter:['hidden']}));
  sync();
})();
