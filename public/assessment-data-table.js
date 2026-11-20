window.AssessmentDataTable = (() => {
  function mount(root, activity, saved, onChange) {
    const { table, source, inputs } = activity;
    const responses = Array.isArray(saved) ? [...saved] : inputs.map(input => input.initial ?? null);
    const element = (tag, text) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      return node;
    };
    if (activity.presentation === 'order') {
      const order = saved?.length === inputs.length && saved.every(Boolean) ? [...saved] : table.slice(1).map(row => row[0]);
      const list = element('ol');
      list.className = 'unit-order';
      const status = element('div');
      status.setAttribute('role', 'status');
      let drag;
      function move(from, to, direction) {
        if (from === to || to < 0 || to >= order.length) return;
        const [tile] = order.splice(from, 1);
        order.splice(to, 0, tile);
        onChange([...order]);
        render();
        if (direction) {
          const buttons = list.children[to].querySelectorAll('button');
          const next = buttons[direction === 'up' ? 0 : 1];
          (next.disabled ? list.children[to].querySelector('button:enabled') : next).focus();
        }
        status.textContent = tile + ' moved to position ' + (to + 1) + ' of ' + order.length + '.';
      }
      function target(y) {
        const rows = Array.from(list.children);
        const index = rows.findIndex(row => y < row.getBoundingClientRect().bottom);
        return index < 0 ? rows.length - 1 : index;
      }
      function render() {
        list.replaceChildren();
        order.forEach((tile, index) => {
          const row = element('li');
          const handle = element('span', tile);
          handle.className = 'unit-handle';
          row.onpointerdown = event => {
            if (!event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
            row.setPointerCapture(event.pointerId);
            drag = index;
            row.classList.add('moving');
          };
          row.onpointermove = event => {
            if (drag !== index || !row.hasPointerCapture(event.pointerId)) return;
            Array.from(list.children).forEach((item, i) => item.classList.toggle('destination', i === target(event.clientY)));
          };
          row.onpointerup = event => {
            if (drag !== index || !row.hasPointerCapture(event.pointerId)) return;
            drag = undefined;
            move(index, target(event.clientY));
          };
          row.onlostpointercapture = () => {
            drag = undefined;
            Array.from(list.children).forEach(item => item.classList.remove('moving', 'destination'));
          };
          row.append(handle);
          for (const [direction, step, icon] of [['up', -1, '↑'], ['down', 1, '↓']]) {
            const button = element('button', icon);
            button.type = 'button';
            button.setAttribute('aria-label', 'Move ' + tile + ' ' + direction);
            button.disabled = index + step < 0 || index + step >= order.length;
            button.onclick = () => move(index, index + step, direction);
            row.append(button);
          }
          list.append(row);
        });
      }
      render();
      root.append(element('strong', 'Smallest'), list, element('strong', 'Largest'), status);
      return;
    }
    function cellControl(input, index) {
      if (input.entry === 'text') {
        const control = element('input');
        control.type = 'text';
        control.maxLength = 300;
        control.autocomplete = 'off';
        control.setAttribute('aria-label', input.label);
        control.value = responses[index] ?? '';
        control.addEventListener('input', () => {
          responses[index] = control.value.trim() || null;
          onChange([...responses]);
        });
        return control;
      }
      const control = element('select');
      control.setAttribute('aria-label', input.label);
      control.add(new Option('Choose…', ''));
      for (const option of input.options) control.add(new Option(option, option));
      control.value = responses[index] ?? '';
      control.addEventListener('change', () => {
        responses[index] = control.value || null;
        onChange([...responses]);
      });
      return control;
    }
    if (activity.presentation) root.classList.add('data-lab', 'lab-' + activity.presentation);
    const writtenRecord = inputs.some(input => input.entry === 'text');
    const ballotDesk = activity.presentation === 'ballots';
    if (ballotDesk) {
      const banner = element('img');
      banner.className = 'ballot-scene';
      banner.alt = '';
      banner.src = '/assets/data-lab/fair-ballot-booths.webp';
      banner.width = 1050; banner.height = 250;
      root.append(banner);
    }
    if (source.length) {
      const cards = element('ul');
      cards.className = 'project-data-source';
      source.forEach((card,index) => {
        const item = element('li');
        const lines = card.split(' · ');
        item.append(element('strong', writtenRecord || ballotDesk || activity.namedBadges ? lines.shift() : 'Card ' + (index + 1)));
        lines.forEach(line => item.append(element('div', line)));
        cards.append(item);
      });
      root.append(element('strong', activity.recordSourceTitle || (activity.presentation === 'records' ? (source.length === 1 ? 'Helper badge' : 'Helper badges') : ballotDesk ? 'Voting slips' : 'Source cards')), cards);
    }
    const wrap = element('div');
    wrap.className = 'project-data-scroll';
    const grid = element('table');
    grid.append(element('caption', writtenRecord && activity.presentation === 'records' ? 'Register' : ballotDesk && writtenRecord ? 'Vote tally' : 'Data table'));
    table.forEach((row, rowIndex) => {
      const line = grid.insertRow();
      row.forEach((value, column) => {
        const cell = element(rowIndex ? 'td' : 'th');
        if (!rowIndex) cell.scope = 'col';
        const inputIndex = inputs.findIndex(input => input.row === rowIndex && input.column === column);
        if (inputIndex === -1) cell.textContent = value;
        else cell.append(cellControl(inputs[inputIndex], inputIndex));
        line.append(cell);
      });
    });
    if (table.slice(1).every((row, i) => row.every((_, col) => inputs.some(field => field.row === i + 1 && field.column === col && field.entry === 'text')))) {
      wrap.classList.add('record-entry');
      for (const row of Array.from(grid.rows).slice(1)) Array.from(row.cells).forEach((cell, col) => { cell.dataset.heading = table[0][col]; });
    }
    wrap.append(grid);
    if (activity.presentation === 'worksheet') framePracticeSheet(grid);
    // When the first prompt asks for a file, the files themselves are the answer controls.
    const files = activity.presentation === 'files' ? table.slice(1) : [];
    const fileQuestion = files.length && inputs.find(input => input.row === undefined &&
      input.options.length === files.length && files.every(row => input.options.includes(row[0])));
    function filePreview(filename) {
      const preview = element('div');
      preview.className = 'lab-file-preview';
      const base = '/assets/data-lab/';
      const extension = filename.includes('.') ? filename.split('.').pop().toUpperCase() : 'File';
      if (extension === 'TXT') {
        const note = element('iframe');
        note.title = 'Welcome note text file';
        note.src = base + 'welcome.txt';
        note.loading = 'lazy';
        preview.append(note);
      } else if (extension === 'PNG') {
        const link = element('a');
        link.href = base + 'art-poster.png';
        link.target = '_blank';
        link.rel = 'noopener';
        const poster = element('img');
        poster.src = link.href;
        poster.loading = 'lazy';
        poster.alt = 'Open the full school fair art poster';
        link.append(poster);
        preview.append(link);
      } else if (extension === 'MP4') {
        const video = element('video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'none';
        video.poster = base + 'fair-preview.jpg';
        video.src = base + 'fair.mp4';
        video.setAttribute('aria-label', 'Play the school fair video');
        preview.append(video);
      } else {
        preview.append(element('span', extension));
        return preview;
      }
      if (!['Welcome note.txt','Art poster.png','Fair video.mp4'].includes(filename)) {
        preview.classList.add('sample-file');
        preview.append(element('small', extension + ' example'));
      }
      return preview;
    }
    if (['files','survey','types'].includes(activity.presentation) && !inputs.some(input => input.row !== undefined)) {
      const list = element('ul');
      list.className = 'lab-exhibits';
      const rows = table.slice(1);
      const largest = Math.max(1, ...rows.map(row => Number(row[1]) || 0));
      for (const row of rows) {
        const exhibit = element('li');
        if (activity.presentation === 'files') {
          if (!fileQuestion) exhibit.append(filePreview(row[0]));
        }
        exhibit.append(element('strong', row[0]));
        row.slice(1).forEach((value, i) => exhibit.append(element('span', table[0][i+1] + ' · ' + value)));
        if (activity.presentation === 'survey' && Number(row[1]) >= 0) {
          const meter = element('meter');
          meter.max = largest; meter.value = Number(row[1]);
          meter.setAttribute('aria-label', row[0] + ' votes');
          exhibit.append(meter);
        }
        list.append(exhibit);
      }
      if (!fileQuestion) root.append(list);
    } else root.append(wrap);
    inputs.forEach((input, index) => {
      if (input.row !== undefined) return;
      if (activity.presentation) {
        const group = element('fieldset');
        group.className = 'lab-choices';
        group.append(element('legend', input.label));
        const name = 'lab-' + crypto.randomUUID();
        const filePicker = input === fileQuestion;
        if (filePicker) group.classList.add('file-picker');
        const options = filePicker ? files.map(row => row[0]) : input.options;
        for (const option of options) {
          const label = element('label');
          const radio = element('input');
          radio.type = 'radio'; radio.name = name; radio.value = option;
          radio.checked = responses[index] === option;
          radio.onchange = () => { responses[index] = option; onChange([...responses]); };
          label.append(radio);
          if (filePicker) {
            const row = files.find(file => file[0] === option);
            const card = element('div');
            card.className = 'lab-file-card';
            label.append(element('strong', option), element('small', 'Task size · ' + row.slice(1).join(' · ')));
            radio.setAttribute('aria-label', option);
            card.append(filePreview(option), label);
            group.append(card);
            continue;
          } else label.append(document.createTextNode(option));
          group.append(label);
        }
        root.append(group);
        return;
      }
      const label = element('label', input.label + ' ');
      label.className = 'project-data-response';
      label.append(cellControl(input, index));
      root.append(label);
    });
  }
  function describe(activity, responses) {
    if (!Array.isArray(responses)) return 'No response';
    return activity.inputs.map((input, index) => input.label + ': ' + (responses[index] ?? 'No response')).join(' · ');
  }
  return { mount, describe };
})();
