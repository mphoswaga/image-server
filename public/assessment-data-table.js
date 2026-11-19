window.AssessmentDataTable = (() => {
  function mount(root, activity, saved, onChange) {
    const { table, source, inputs } = activity;
    const responses = Array.isArray(saved) ? [...saved] : inputs.map(input => input.initial ?? null);
    const element = (tag, text) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      return node;
    };
    function select(input, index) {
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
    if (source.length) {
      const cards = element('ul');
      cards.className = 'project-data-source';
      source.forEach((card,index) => {
        const item = element('li');
        item.append(element('strong', 'Card ' + (index + 1)));
        card.split(' · ').forEach(line => item.append(element('div', line)));
        cards.append(item);
      });
      root.append(element('strong', activity.presentation === 'records' ? 'Helper badges' : 'Source cards'), cards);
    }
    const wrap = element('div');
    wrap.className = 'project-data-scroll';
    const grid = element('table');
    grid.append(element('caption', 'Data table'));
    table.forEach((row, rowIndex) => {
      const line = grid.insertRow();
      row.forEach((value, column) => {
        const cell = element(rowIndex ? 'td' : 'th');
        if (!rowIndex) cell.scope = 'col';
        const inputIndex = inputs.findIndex(input => input.row === rowIndex && input.column === column);
        if (inputIndex === -1) cell.textContent = value;
        else cell.append(select(inputs[inputIndex], inputIndex));
        line.append(cell);
      });
    });
    wrap.append(grid);
    // When the first prompt asks for a file, the files themselves are the answer controls.
    const files = activity.presentation === 'files' ? table.slice(1) : [];
    const fileQuestion = files.length && inputs.find(input => input.row === undefined &&
      input.options.length === files.length && files.every(row => input.options.includes(row[0])));
    if (['files','survey','types'].includes(activity.presentation) && !inputs.some(input => input.row !== undefined)) {
      const list = element('ul');
      list.className = 'lab-exhibits';
      const rows = table.slice(1);
      const largest = Math.max(1, ...rows.map(row => Number(row[1]) || 0));
      for (const row of rows) {
        const exhibit = element('li');
        if (activity.presentation === 'files') {
          const ext = row[0].split('.').pop().slice(0,6).toUpperCase();
          exhibit.append(element('small', ext));
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
            const ext = option.includes('.') ? option.split('.').pop().toUpperCase() : 'FILE';
            const symbol = element('span', ext);
            symbol.className = 'file-symbol';
            if (['PNG','JPG','JPEG','GIF'].includes(ext)) symbol.classList.add('picture-file');
            if (['MP4','MOV','WEBM'].includes(ext)) symbol.classList.add('video-file');
            symbol.setAttribute('aria-hidden', 'true');
            label.append(symbol, element('strong', option), element('small', row.slice(1).join(' · ')));
            radio.setAttribute('aria-label', option);
          } else label.append(document.createTextNode(option));
          group.append(label);
        }
        root.append(group);
        return;
      }
      const label = element('label', input.label + ' ');
      label.className = 'project-data-response';
      label.append(select(input, index));
      root.append(label);
    });
  }
  function describe(activity, responses) {
    if (!Array.isArray(responses)) return 'No response';
    return activity.inputs.map((input, index) => input.label + ': ' + (responses[index] ?? 'No response')).join(' · ');
  }
  return { mount, describe };
})();
