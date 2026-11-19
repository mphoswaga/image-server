window.AssessmentCodeQuest = (() => {
  const labels = { move: 'Move forward', left: 'Turn left', right: 'Turn right', collect: 'Collect' };
  const describe = program => program?.length ? program.map(block => labels[block.op]).join(' → ') : 'No blocks';
  function mount(root, { mission, starter = [], checkpoint }, saved, onChange, onRun = () => {}) {
    let program = [...(Array.isArray(saved) ? saved : starter)];
    let replay, drag;
    const element = (tag, text) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      return node;
    };
    const button = (label, action) => {
      const control = element('button', label);
      control.type = 'button';
      control.onclick = action;
      return control;
    };
    const board = element('div');
    board.className = 'project-codeboard';
    board.style.gridTemplateColumns = `repeat(${mission.size}, 1fr)`;
    const sequence = element('ol');
    sequence.className = 'project-code-sequence';
    const symbols = { move: '↑', left: '↶', right: '↷', collect: '💰' };
    const feedback = element('p');
    feedback.setAttribute('role', 'status');
    function draw([px, py, direction], carrying = false) {
      const cells = [];
      for (let y = 0; y < mission.size; y++) for (let x = 0; x < mission.size; x++) {
        const treasure = !carrying && CodeQuest.at([mission.chest], x, y);
        const obstacle = CodeQuest.at(mission.rocks, x, y) || CodeQuest.at(mission.water, x, y);
        const waypoint = checkpoint && CodeQuest.at([checkpoint], x, y);
        const pirate = px === x && py === y;
        const cell = element('span', (treasure ? '💰' : obstacle ? '■' : waypoint ? '⚑' : '') + (pirate ? ['↑','→','↓','←'][direction] : ''));
        cell.className = 'project-code-tile';
        const asset = treasure ? 'treasure' : obstacle && CodeQuest.at(mission.rocks,x,y) ? 'rock' :
          CodeQuest.at([mission.start],x,y) ? 'ship' : null;
        if (CodeQuest.at(mission.water,x,y)) cell.classList.add('water');
        cell.textContent = waypoint ? '⚑' : '';
        if (asset) {
          const art = element('img'); art.src = '/assets/codequest/' + asset + '.svg'; art.alt = '';
          cell.append(art);
        }
        if (pirate) {
          const art = element('img'); art.src = '/assets/codequest/assessment-pirate.svg'; art.alt = '';
          art.className = 'project-pirate';
          const arrow = element('b', ['↑','→','↓','←'][direction]); arrow.className = 'project-direction';
          cell.append(art, arrow);
        }
        if (pirate || treasure || obstacle || waypoint) cell.setAttribute('aria-label', [pirate ? 'Pirate facing ' + ['up','right','down','left'][direction] : '', treasure ? 'Treasure' : obstacle ? 'Obstacle' : waypoint ? 'Route checkpoint' : '', `row ${y+1}, column ${x+1}`].filter(Boolean).join(', '));
        cells.push(cell);
      }
      board.replaceChildren(...cells);
    }
    function reset() { clearInterval(replay); draw(mission.start); feedback.textContent = ''; sequence.querySelectorAll('.is-running').forEach(row=>row.classList.remove('is-running')); }
    function change(next) {
      program = next;
      reset();
      renderCode();
      onChange([...program]);
    }
    function move(index, offset) {
      const next = [...program], target = index + offset;
      [next[index], next[target]] = [next[target], next[index]];
      change(next);
    }
    function drop(index) {
      if (!drag) return;
      const next = [...program];
      if (drag.op) {
        if (next.length >= 32) return;
        next.splice(index, 0, {op:drag.op});
      } else {
        const [block] = next.splice(drag.index, 1);
        next.splice(index > drag.index ? index - 1 : index, 0, block);
      }
      drag = null;
      change(next);
    }
    function draggable(node, payload) {
      node.draggable = true;
      node.ondragstart = event => { drag = payload; event.dataTransfer.setData('text/plain', 'codequest-block'); };
      node.ondragend = () => { drag = null; };
    }
    sequence.ondragover = event => { if (drag) event.preventDefault(); };
    sequence.ondrop = event => { if (drag) { event.preventDefault(); drop(program.length); } };
    function renderCode() {
      sequence.replaceChildren(...program.map((block, index) => {
        const row = element('li');
        row.dataset.op = block.op;
        draggable(row, {index});
        row.ondragover = event => { if (drag) event.preventDefault(); };
        row.ondrop = event => {
          if (!drag) return;
          event.preventDefault(); event.stopPropagation();
          const bounds = row.getBoundingClientRect();
          drop(index + Number(event.clientY > bounds.top + bounds.height / 2));
        };
        const step = element('span', labels[block.op]);
        const tools = element('div');
        tools.className = 'project-block-actions';
        tools.hidden = true;
        const toggle = () => { tools.hidden = !tools.hidden; edit.setAttribute('aria-expanded', String(!tools.hidden)); };
        const edit = button(symbols[block.op], toggle);
        step.onclick = toggle;
        edit.setAttribute('aria-label', 'Edit step ' + (index + 1) + ': ' + labels[block.op]);
        edit.setAttribute('aria-expanded','false');
        row.append(edit, step);
        const earlier = button('Earlier', () => move(index, -1));
        const later = button('Later', () => move(index, 1));
        earlier.disabled = index === 0;
        later.disabled = index === program.length - 1;
        const replace = element('select');
        replace.setAttribute('aria-label', 'Replace step ' + (index + 1));
        Object.entries(labels).forEach(([op, label]) => replace.add(new Option(label, op)));
        replace.value = block.op;
        replace.onchange = () => change(program.map((item, at) => at === index ? {op:replace.value} : item));
        tools.append(replace, earlier, later, button('Remove', () => change(program.filter((_, at) => at !== index))));
        row.append(tools);
        return row;
      }));
    }
    const run = button('Run code', () => {
      reset();
      onChange([...program]);
      const result = CodeQuest.run(mission, program);
      onRun([...program]);
      let index = 0;
      feedback.textContent = 'Running your code…';
      replay = setInterval(() => {
        if (!root.isConnected) return clearInterval(replay);
        const frame = result.frames[Math.min(++index, result.frames.length - 1)];
        draw([frame.x, frame.y, frame.d], frame.carrying);
        [...sequence.children].forEach((row,index) => row.classList.toggle('is-running', index === frame.block));
        if (index >= result.frames.length - 1) {
          clearInterval(replay);
          feedback.textContent = result.reason;
        }
      }, 220);
    });
    const controls = element('div');
    controls.className = 'project-code-controls';
    const palette = element('div');
    palette.className = 'project-code-palette';
    palette.append(...Object.entries(labels).map(([op, label]) => {
      const block = button(label, () => {
      if (program.length < 32) change([...program, {op}]);
      });
      block.dataset.op = op;
      draggable(block, {op});
      block.prepend(element('b', symbols[op] + ' '));
      block.setAttribute('aria-label', label);
      return block;
    }));
    run.className = 'project-run';
    controls.append(run, button('Reset pirate', reset));
    if (starter.length) controls.append(button('Restore starting code', () => change([...starter])));
    if (checkpoint) root.append(element('p', '⚑ Route checkpoint · visit it on the way to the treasure.'));
    const workspace = element('div'); workspace.className = 'project-code-layout';
    const code = element('div'); code.className = 'project-code-editor';
    const start = element('div', '▶ Start'); start.className = 'project-code-start';
    const hint = element('p','Tap a block to add it. Tap a step to change it.'); hint.className = 'project-code-hint';
    code.append(element('h3','My code'), hint, palette, start, sequence, controls);
    const island = element('div'); island.className = 'project-island';
    island.append(element('h3','Your island'), board, feedback);
    workspace.append(code, island);
    root.append(workspace);
    reset();
    renderCode();
  }
  return { mount, describe };
})();
