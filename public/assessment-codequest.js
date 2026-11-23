window.AssessmentCodeQuest = (() => {
  const labels = { move: 'Move forward', left: 'Turn left', right: 'Turn right', collect: 'Collect' };
  const describe = program => program?.length ? program.map(block => block.op === 'repeat'
    ? 'Repeat ' + block.count + ' × (' + block.body.map(child => labels[child.op]).join(', ') + ')'
    : labels[block.op]).join(' → ') : 'No blocks';

  function mount(root, task, saved, onChange, onRun = () => {}, onSubmit, confirmed = false, afterSubmit) {
    const frame = document.createElement('iframe');
    frame.className = 'project-codequest-frame';
    frame.title = 'CodeQuest coding workspace';
    const loading = document.createElement('p');
    loading.setAttribute('role', 'status');
    loading.textContent = 'Loading your island…';
    frame.style.visibility = 'hidden';
    let latest = saved ?? task.starter ?? [];
    let submit;
    let stageStatus;
    const changed = program => {
      const edited = JSON.stringify(latest) !== JSON.stringify(program);
      latest = program;
      if (edited && submit) { submit.disabled = !program.length; stageStatus.textContent = ''; }
      onChange(program);
    };
    let mountedDocument;
    function mountStage() {
      if (!frame.contentWindow.mountAssessmentStage || frame.contentDocument === mountedDocument) return;
      frame.contentWindow.mountAssessmentStage(task, latest, changed, onRun);
      if (onSubmit) {
        const doc = frame.contentDocument;
        const test = doc.getElementById('test');
        submit = doc.createElement('button');
        submit.type = 'button';
        submit.textContent = 'Submit code';
        submit.disabled = !latest.length;
        submit.style.background = '#10634e';
        submit.style.color = '#fff';
        test.after(submit);
        doc.getElementById('controlHint').textContent = 'Build your code. Test it as often as you like. When you are ready, choose Submit code.';
        stageStatus = doc.createElement('p');
        stageStatus.setAttribute('role','status');
        if (confirmed) stageStatus.textContent = 'Code submitted for this island.';
        test.parentElement.after(stageStatus);
        submit.onclick = async () => {
          if (!window.confirm('Submit your code for this island?')) return;
          submit.disabled = true;
          const submitted = structuredClone(latest);
          try {
            await onSubmit(submitted);
            if (!root.isConnected || JSON.stringify(submitted) !== JSON.stringify(latest)) return;
            stageStatus.textContent = 'Code submitted for this island.';
            afterSubmit?.();
          } catch (error) { stageStatus.textContent = error.message; }
          finally { submit.disabled = !latest.length; }
        };
      }
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
