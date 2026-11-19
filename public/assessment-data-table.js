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
    if (source.length) {
      const cards = element('ul');
      cards.className = 'project-data-source';
      source.forEach(card => cards.append(element('li', card)));
      root.append(element('strong', 'Source cards'), cards);
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
    root.append(wrap);
    inputs.forEach((input, index) => {
      if (input.row !== undefined) return;
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
