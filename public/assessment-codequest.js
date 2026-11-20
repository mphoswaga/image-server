window.AssessmentCodeQuest = (() => {
  const labels = { move: 'Move forward', left: 'Turn left', right: 'Turn right', collect: 'Collect' };
  const describe = program => program?.length ? program.map(block => block.op === 'repeat'
    ? 'Repeat ' + block.count + ' × (' + block.body.map(child => labels[child.op]).join(', ') + ')'
    : labels[block.op]).join(' → ') : 'No blocks';

  function mount(root, task, saved, onChange, onRun = () => {}) {
    const frame = document.createElement('iframe');
    frame.className = 'project-codequest-frame';
    frame.title = 'CodeQuest coding workspace';
    const loading = document.createElement('p');
    loading.setAttribute('role', 'status');
    loading.textContent = 'Loading your island…';
    frame.style.visibility = 'hidden';
    let mountedDocument;
    function mountStage() {
      if (!frame.contentWindow.mountAssessmentStage || frame.contentDocument === mountedDocument) return;
      frame.contentWindow.mountAssessmentStage(task, saved, onChange, onRun);
      mountedDocument = frame.contentDocument;
      frame.style.visibility = '';
      loading.remove();
    }
    frame.addEventListener('codequest-ready', mountStage);
    frame.addEventListener('load', mountStage);
    root.append(loading, frame);
    // Hidden questions have no width. Start the game as soon as its page opens.
    const size = new ResizeObserver(() => {
      if (!frame.clientWidth) return;
      size.disconnect();
      frame.src = '/codequest.html?assessment=1';
    });
    size.observe(frame);
  }

  return { mount, describe };
})();
