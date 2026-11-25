// These are examples of the controls and skills. Assessed answers come only from the teacher's task.
window.DataStation = (() => {
  const samples = {
    register: 'Copy one card across one row. If the card says Room D03, type D03 under Room.',
    types: 'Books borrowed tells us how many books someone has borrowed. It is a number.',
    paper: 'Find the slip number in the register. Slip 014 goes in row 014, even if another slip comes first.',
    repair: 'If the card says A12 and the register says A21, open the list and choose A12.',
    stock: 'If a booth packs 9 kits and uses 2, type 7 under Left.',
    files: 'Read the file name, then press Choose this file below the preview.',
    order: 'Tap an up arrow to move that tile one place towards the top.',
    storage: 'A 3,000 KB photo uses 3 MB. Saving it in a folder with 12 MB free leaves 9 MB.',
    tally: 'Tick the slips for one booth. Write how many you ticked beside its name.',
    decision: 'If Books has 2 votes and Dance has 1, the votes support giving Books the extra chair.',
  };
  const illustrations = {register:'badge', repair:'badge', types:'tickets', stock:'kits', storage:'folder', order:'folder'};
  function heading(root, key, context) {
    const banner = document.createElement('header');
    banner.className = 'station-brief';
    const illustration = illustrations[key];
    if (illustration) {
      const image = document.createElement('img');
      image.src = '/assets/data-lab/' + illustration + '.webp';
      image.alt = '';
      banner.append(image);
    }
    const words = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = context.title;
    words.append(title);
    if (context.directions) {
      const directions = document.createElement('p');
      directions.textContent = context.directions;
      words.append(directions);
    }
    banner.append(words);
    const task = document.createElement('p');
    task.className = 'station-prompt';
    const marks = document.createElement('small');
    marks.textContent = context.marks + (context.marks === 1 ? ' mark' : ' marks');
    task.append(document.createTextNode(context.prompt), marks);
    root.before(banner, task);
  }
  function count(activity, values) {
    return activity.inputs.filter((input, index) => {
      const value = values?.[index];
      return value != null && String(value).trim() !== '' && (activity.requireEveryAnswer || value !== input.initial);
    }).length;
  }
  function instructions(text) {
    return (text || '').replace('Open “See an example” if you need help.', 'Each station starts with a short video. Tap the robot to watch again.');
  }
  function guideStockSheet(work) {
    const sheet = work.querySelector('.practice-sheet');
    sheet.classList.add('stock-sheet');
    const table = sheet.querySelector('table');
    table.caption.textContent = 'Kits at each booth';
    table.tHead.rows[0].lastElementChild.classList.add('stock-left');
    for (const cell of table.querySelectorAll('[data-column="Column D"]')) {
      cell.classList.toggle('stock-left', cell.dataset.row !== 'Row 5');
    }
    const decision = table.querySelector('[data-address="A5"]').parentElement;
    decision.classList.add('stock-decision');
    decision.querySelector('[data-address="A5"]').textContent = 'Booth needing more kits';
    decision.querySelector('[data-address="C5"]').textContent = 'Box address';
    const address = decision.querySelector('[data-address="D5"] input');
    if (address) address.placeholder = 'Letter + number';

    const steps = document.createElement('ol');
    steps.className = 'stock-steps';
    for (const [title, description] of [
      ['Fill in Left', 'For each booth, take away Used from Packed. Type how many kits are left in column D.'],
      ['Choose a booth', 'Look down the Left column. In row 5, write the name of the booth with the fewest kits left.'],
      ['Write the box address', 'Find the box that shows how many kits that booth has left. Write its column letter followed by its row number. For example, B2 means column B, row 2.'],
    ]) {
      const step = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = title;
      step.append(label, document.createTextNode(description));
      steps.append(step);
    }
    const source = work.querySelector('.project-data-source');
    source.previousElementSibling.remove();
    source.replaceWith(steps);
  }
  function mount(root, activity, saved, onChange, context) {
    const key = dataStationTopic(activity);
    const sample = samples[key];
    const stockSheet = key === 'stock' && activity.source?.join('|') ===
      'Stock check · Kits left = kits packed minus kits used.|Restock rule · Send extra kits to the booth with the fewest kits left.' &&
      activity.table[4]?.[0] === 'Restock booth' && activity.table[4][2] === 'Evidence cell';
    if (context) {
      const stockDirections = context.directions === 'For each booth, subtract Used from Packed and type the number under Left. In the last row, enter the booth to restock and the address of the box that supports your choice.' ||
        context.directions === 'Use the letter at the top and the number on the left to find a cell. Count what is still on each shelf.';
      heading(root, key, stockSheet ? {
        ...context,
        directions: stockDirections ? 'Use the table to work out which fair booth needs more kits.' : context.directions,
        prompt: context.prompt === 'Finish the stock check and sign off on the booth that needs more kits.' ?
          'Complete all five answer boxes.' : context.prompt,
      } : context);
    }
    const work = document.createElement('div');
    work.className = 'station-work';
    root.dataset.station = key;
    const progress = document.createElement('p');
    progress.className = 'station-progress';
    function update(values) {
      const n = count(activity, values);
      const total = activity.inputs.length;
      progress.textContent = key === 'order'
        ? (n ? 'Order recorded. You can still move the boxes.' : 'Move a box to record your order.')
        : key === 'repair' && !activity.requireEveryAnswer ? n + ' of ' + total + ' entries changed' : n + ' of ' + total + ' answers entered';
    }
    root.classList.add('assessment-station');
    root.append(work, progress);
    if (sample && context) StationTutorial.attach(root, {
      path: '/assets/data-lab/stations/' + key, sample, key: 'station-film:' + context.key, title: context.title || 'Station example',
    });
    AssessmentDataTable.mount(work, activity, saved, values => { update(values); onChange(values); }, key);
    if (stockSheet) guideStockSheet(work);
    if (key === 'paper') {
      const source = work.querySelector('.project-data-source');
      if (source) {
        const shelf = document.createElement('section');
        shelf.className = 'station-card-drawer';
        const art = document.createElement('img');
        art.src = '/assets/data-lab/library-card-drawer.webp';
        art.alt = 'A wooden library drawer holds paper borrowing slips in order behind coloured dividers.';
        const slips = document.createElement('div');
        const title = source.previousElementSibling;
        title.textContent = 'Paper database';
        source.before(shelf);
        shelf.append(art, slips);
        slips.append(title, source);
        const caption = work.querySelector('caption');
        if (caption) caption.textContent = 'Digital borrowing register';
      }
    }
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
    const grid = work.querySelector('.project-data-scroll table');
    if (grid && ['paper','repair'].includes(key)) {
      grid.parentElement.classList.add('station-row-cards');
      for (const row of Array.from(grid.rows).slice(1)) {
        Array.from(row.cells).forEach((cell, column) => { cell.dataset.heading = activity.table[0][column]; });
      }
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
  return {mount, count, instructions};
})();
