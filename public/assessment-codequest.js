window.AssessmentCodeQuest = (() => {
  const labels = { move: 'Move forward', left: 'Turn left', right: 'Turn right', collect: 'Collect' };
  const describe = program => program?.length ? program.map(block => labels[block.op]).join(' → ') : 'No blocks';
  function mount(root, { mission, starter = [], checkpoint }, saved, onChange, onRun = () => {}) {
    let program = [...(Array.isArray(saved) ? saved : starter)];
    let replay;
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
    const feedback = element('p');
    feedback.setAttribute('role', 'status');
    function draw([px, py, direction]) {
      const cells = [];
      for (let y = 0; y < mission.size; y++) for (let x = 0; x < mission.size; x++) {
        const treasure = CodeQuest.at([mission.chest], x, y);
        const obstacle = CodeQuest.at(mission.rocks, x, y) || CodeQuest.at(mission.water, x, y);
        const waypoint = checkpoint && CodeQuest.at([checkpoint], x, y);
        const pirate = px === x && py === y;
        const cell = element('span', (treasure ? '💰' : obstacle ? '■' : waypoint ? '⚑' : '') + (pirate ? ['↑','→','↓','←'][direction] : ''));
        if (cell.textContent) cell.setAttribute('aria-label', [pirate ? 'Pirate facing ' + ['up','right','down','left'][direction] : '', treasure ? 'Treasure' : obstacle ? 'Obstacle' : waypoint ? 'Route checkpoint' : '', `row ${y+1}, column ${x+1}`].filter(Boolean).join(', '));
        cells.push(cell);
      }
      board.replaceChildren(...cells);
    }
    function reset() { clearInterval(replay); draw(mission.start); feedback.textContent = ''; }
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
    function renderCode() {
      sequence.replaceChildren(...program.map((block, index) => {
        const row = element('li');
        row.append(element('span', labels[block.op]));
        const earlier = button('Earlier', () => move(index, -1));
        const later = button('Later', () => move(index, 1));
        earlier.disabled = index === 0;
        later.disabled = index === program.length - 1;
        row.append(earlier, later, button('Remove', () => change(program.filter((_, at) => at !== index))));
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
        draw([frame.x, frame.y, frame.d]);
        if (index >= result.frames.length - 1) {
          clearInterval(replay);
          feedback.textContent = result.reason;
        }
      }, 220);
    });
    const controls = element('div');
    controls.className = 'project-code-controls';
    controls.append(...Object.entries(labels).map(([op, label]) => button(label, () => {
      if (program.length < 32) change([...program, {op}]);
    })), run, button('Reset pirate', reset));
    if (starter.length) controls.append(button('Restore starting code', () => change([...starter])));
    if (checkpoint) root.append(element('p', '⚑ Route checkpoint · visit it on the way to the treasure.'));
    root.append(board, controls, sequence, feedback);
    reset();
    renderCode();
  }
  return { mount, describe };
})();
