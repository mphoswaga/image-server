window.AssessmentCodeQuest = (() => {
  const labels = { move: 'Move forward', left: 'Turn left', right: 'Turn right', collect: 'Collect' };
  const describe = program => program?.length ? program.map(block => block.op === 'repeat'
    ? 'Repeat ' + block.count + ' × (' + block.body.map(child => labels[child.op]).join(', ') + ')'
    : labels[block.op]).join(' → ') : 'No blocks';

  function mount(root, task, saved, onChange, onRun = () => {}) {
    const frame = document.createElement('iframe');
    frame.className = 'project-codequest-frame';
    frame.title = 'CodeQuest coding workspace';
    frame.loading = 'lazy';
    frame.src = '/codequest.html?assessment=1';
    frame.addEventListener('load', () => {
      frame.contentWindow.mountAssessmentStage?.(task, saved, onChange, onRun);
    }, { once: true });
    root.append(frame);
  }

  return { mount, describe };
})();
