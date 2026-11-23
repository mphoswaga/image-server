window.AssessmentCodeQuest = (() => {
  const labels = { move: 'Move forward', left: 'Turn left', right: 'Turn right', collect: 'Collect' };
  const describe = program => program?.length ? program.map(block => block.op === 'repeat'
    ? 'Repeat ' + block.count + ' × (' + block.body.map(child => labels[child.op]).join(', ') + ')'
    : labels[block.op]).join(' → ') : 'No blocks';

  function mount(root, task, saved, onChange, onRun = () => {}, onSubmit, confirmed = false) {
    const frame = document.createElement('iframe');
    frame.className = 'project-codequest-frame';
    frame.title = 'CodeQuest coding workspace';
    const loading = document.createElement('p');
    loading.setAttribute('role', 'status');
    loading.textContent = 'Loading your island…';
    frame.style.visibility = 'hidden';
    let latest = saved ?? task.starter ?? [];
    let prompt;
    let stageStatus;
    const changed = program => {
      const edited = JSON.stringify(latest) !== JSON.stringify(program);
      latest = program;
      if (edited && prompt) { prompt.hidden = true; stageStatus.textContent = ''; }
      onChange(program);
    };
    let mountedDocument;
    function mountStage() {
      if (!frame.contentWindow.mountAssessmentStage || frame.contentDocument === mountedDocument) return;
      frame.contentWindow.mountAssessmentStage(task, latest, changed, onRun, () => {
        if (prompt && frame.getClientRects().length) {
          prompt.hidden = false;
          if (document.activeElement === frame) prompt.querySelector('button').focus();
        }
      });
      mountedDocument = frame.contentDocument;
      frame.style.visibility = '';
      loading.remove();
    }
    frame.addEventListener('codequest-ready', mountStage);
    frame.addEventListener('load', mountStage);
    root.append(loading, frame);
    if (onSubmit) {
      const button = text => Object.assign(document.createElement('button'), {type:'button', textContent:text});
      const submit = button('Submit this code');
      prompt = document.createElement('div');
      prompt.className = 'project-task-nav project-code-confirm';
      prompt.hidden = true;
      const question = document.createElement('strong');
      question.textContent = 'Ready to submit this code for this island?';
      const yes = button('Yes, submit code');
      const no = button('Keep editing');
      stageStatus = document.createElement('p');
      stageStatus.setAttribute('role','status');
      if (confirmed) stageStatus.textContent = 'Code submitted for this island.';
      submit.onclick = () => { prompt.hidden = false; yes.focus(); };
      no.onclick = () => { prompt.hidden = true; submit.focus(); };
      yes.onclick = async () => {
        yes.disabled = true;
        try {
          const submitted = structuredClone(latest);
          await onSubmit(submitted);
          if (JSON.stringify(submitted) !== JSON.stringify(latest)) return;
          prompt.hidden = true;
          stageStatus.textContent = 'Code submitted for this island. You can revise it before submitting your project.';
        } catch (error) { stageStatus.textContent = error.message; }
        finally { yes.disabled = false; }
      };
      prompt.append(question,yes,no);
      root.append(submit,prompt,stageStatus);
    }
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
