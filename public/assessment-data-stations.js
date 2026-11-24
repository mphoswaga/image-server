// These are examples of the controls and skills. Assessed answers come only from the teacher's task.
window.DataStation = (() => {
  const examples = {
    register: ['Make a record', 'Read one card. Type its details across one row. Use the cards in the order shown unless the table gives you an ID to match.', 'For example, if the first card says Mai, type Mai under Name in the first empty row.'],
    repair: ['Correct a record', 'Read the source card. Open each list in the register and choose the detail that matches.', 'If a card says Room A12 and the register says A21, open the Room list and choose A12.'],
    types: ['Choose data types', 'Look at each example. Choose one answer for each question below it.', 'A shelf code such as 04 is a label. Think about what the value is used for.'],
    paper: ['Make a record', 'Match the number on a slip to the number in the table. Fill the empty boxes in that row.', 'Slip 014 belongs in the row marked 014, even if another slip comes first.'],
    stock: ['Rows, columns and cells', 'Work across each row first. For the restock decision, enter the booth name and the address of the box that proves your choice.', 'If a stall packs 9 kits and uses 2, it has 7 left. A value in column E, row 6 has the address E6.'],
    files: ['Explore file sizes', 'Read the file names and sizes. Select your file using the circle beside its name. Then answer the questions below.', 'With 9 MB free, saving a 2 MB picture leaves 7 MB.'],
    order: ['File-size ladder', 'Drag a box to its place, or tap its up or down arrow. Read your list from top to bottom.', 'To move the bottom box up one place, tap its up arrow once.'],
    storage: ['Explore file sizes', 'Read the sizes on the cards. Put them in the same unit before you add, subtract or compare them.', 'If a folder has 12 MB free, a 3,000 KB recording takes 3 MB and leaves 9 MB.'],
    tally: ['Turn data into information', 'Count one group at a time. Tap a slip to tick it as you count. Type each total in the matching row.', 'If three slips say Dance, Drawing and Dance, the Dance tally is 2.'],
    decision: ['Turn data into information', 'Read the rule and compare the votes. Choose the answer you can support with the numbers.', 'If Dance has 6 votes and Drawing has 4, the counts support giving Dance more space.'],
    table: [null, 'Read the headings. Follow the station instructions and fill in each answer.', 'Follow a row across to read the details for one record.'],
  };
  function exampleKey(activity) {
    switch (activity.presentation) {
      case 'records': return activity.kind === 'data-correct' ? 'repair' : activity.inputs.every(input => input.entry === 'text') ? 'register' : 'table';
      case 'types': return activity.table[0].includes('Size') ? 'storage' : 'types';
      case 'worksheet': return activity.table[0].includes('Packed') ? 'stock' : 'table';
      case 'files': return 'files';
      case 'order': return 'order';
      case 'survey': return 'decision';
      case 'ballots': return activity.inputs.some(input => input.entry === 'text') ? 'tally' : 'decision';
      default: return activity.table[0][0] === 'Slip' ? 'paper' : 'table';
    }
  }
  function count(activity, values) {
    return activity.inputs.filter((input, index) => {
      const value = values?.[index];
      return value != null && String(value).trim() !== '' && value !== input.initial;
    }).length;
  }
  function mount(root, activity, saved, onChange) {
    const key = exampleKey(activity);
    const [topic, directions, sample] = examples[key];
    const help = document.createElement('aside');
    help.className = 'station-guide';
    const action = document.createElement('strong');
    action.textContent = 'What to do';
    const steps = document.createElement('p');
    steps.textContent = directions;
    const demo = document.createElement('details');
    const toggle = document.createElement('summary');
    toggle.textContent = 'See an example';
    const words = document.createElement('p');
    words.textContent = sample;
    demo.append(toggle, words);
    if (topic) {
      const film = practiceFilms[topic];
      demo.ontoggle = () => {
        let video = demo.querySelector('video');
        if (!demo.open) { video?.pause(); return; }
        if (video) return;
        video = document.createElement('video');
        video.controls = video.playsInline = true;
        video.preload = 'none';
        video.setAttribute('aria-label', topic + ' practice example');
        video.poster = film.path + '.jpg';
        video.src = film.path + '.mp4';
        const captions = document.createElement('track');
        captions.kind = 'captions'; captions.srclang = 'en'; captions.label = 'English';
        captions.src = film.path + '.vtt';
        video.append(captions);
        const caption = document.createElement('p');
        caption.textContent = 'Practice example · ' + film.seconds + ' seconds. Try your own task below.';
        demo.append(caption, video);
      };
    }
    help.append(action, steps, demo);
    const work = document.createElement('div');
    const progress = document.createElement('p');
    progress.className = 'station-progress';
    function update(values) {
      const n = count(activity, values);
      const total = activity.inputs.length;
      progress.textContent = key === 'order'
        ? (n ? 'Order recorded. You can still move the boxes.' : 'Move a box to record your order.')
        : key === 'repair' ? n + ' of ' + total + ' entries changed' : n + ' of ' + total + ' answers entered';
    }
    root.classList.add('assessment-station');
    root.append(help, work, progress);
    AssessmentDataTable.mount(work, activity, saved, values => { update(values); onChange(values); });
    if (key === 'register' && activity.source.length === activity.table.length - 1) {
      work.classList.add('numbered-records');
      work.querySelectorAll('.project-data-source li').forEach((card, i) => {
        const label = document.createElement('small');
        label.textContent = 'Card ' + (i + 1);
        card.prepend(label);
      });
      const cards = [...work.querySelectorAll('.project-data-source li')];
      work.addEventListener('focusin', event => {
        const row = event.target.closest('tr');
        if (!row) return;
        cards.forEach((card, i) => card.classList.toggle('active-record', row.rowIndex === i + 1));
      });
    }
    if (key === 'tally') {
      for (const slip of work.querySelectorAll('.project-data-source li')) {
        const label = document.createElement('label');
        const tick = document.createElement('input');
        tick.type = 'checkbox';
        tick.setAttribute('aria-label', 'Counted ' + slip.textContent);
        label.append(tick, ...slip.childNodes);
        slip.append(label);
      }
    }
    update(saved);
  }
  return {mount, count};
})();
