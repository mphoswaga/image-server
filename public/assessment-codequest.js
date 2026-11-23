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
    let closeConfirmation;
    let submitting = false;
    const changed = program => {
      const edited = JSON.stringify(latest) !== JSON.stringify(program);
      latest = program;
      if (edited && submit) {
        closeConfirmation();
        submit.disabled = submitting || !program.length;
        stageStatus.textContent = '';
      }
      onChange(program);
    };
    const labelAction = (button, label, path) => {
      const doc = button.ownerDocument;
      const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('width', '20');
      icon.setAttribute('height', '20');
      icon.setAttribute('aria-hidden', 'true');
      icon.style.verticalAlign = 'middle';
      const lines = doc.createElementNS(icon.namespaceURI, 'path');
      lines.setAttribute('d', path);
      lines.setAttribute('fill', 'none');
      lines.setAttribute('stroke', 'currentColor');
      lines.setAttribute('stroke-width', '2');
      lines.setAttribute('stroke-linecap', 'round');
      lines.setAttribute('stroke-linejoin', 'round');
      icon.append(lines);
      button.replaceChildren(icon, ' ' + label);
    };
    function animateIcon(button, frames, duration = 300) {
      if (frame.contentWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      return button.querySelector('svg')?.animate?.(frames, { duration, easing: 'ease-out' });
    }
    let mountedDocument;
    function mountStage() {
      if (!frame.contentWindow.mountAssessmentStage || frame.contentDocument === mountedDocument) return;
      frame.contentWindow.mountAssessmentStage(task, latest, changed, onRun);
      const doc = frame.contentDocument;
      const test = doc.getElementById('test');
      labelAction(test, 'Test my code', 'M9 3h6 M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3 M8 15h8');
      test.addEventListener('click', () => animateIcon(test, [
        { transform: 'rotate(0)' },
        { transform: 'rotate(-22deg)' },
        { transform: 'rotate(18deg)' },
        { transform: 'rotate(0)' },
      ], 420));
      if (onSubmit) {
        submit = doc.createElement('button');
        submit.type = 'button';
        const sendIcon = 'M22 2 9 15 M22 2l-7 20-6-7-7-6Z';
        labelAction(submit, 'Submit code', sendIcon);
        submit.disabled = !latest.length;
        submit.style.background = '#10634e';
        submit.style.color = '#fff';
        test.after(submit);
        doc.getElementById('controlHint').textContent = 'Build your code. Test it as often as you like. When you are ready, choose Submit code.';
        stageStatus = doc.createElement('p');
        stageStatus.setAttribute('role','status');
        if (confirmed) stageStatus.textContent = 'Code submitted for this island.';
        const toolbar = test.parentElement;
        const confirmation = doc.createElement('div');
        confirmation.hidden = true;
        const question = doc.createElement('p');
        question.textContent = 'Ready to turn in your code for this island?';
        const actions = doc.createElement('div');
        actions.className = 'toolbar';
        const confirm = submit.cloneNode();
        labelAction(confirm, 'Yes, submit code', sendIcon);
        confirm.disabled = false;
        const edit = doc.createElement('button');
        edit.type = 'button';
        labelAction(edit, 'Keep editing', 'm4 16-1 5 5-1L21 7l-4-4Z M14 6l4 4');
        actions.append(confirm, edit);
        confirmation.append(question, actions);
        toolbar.after(confirmation, stageStatus);
        closeConfirmation = () => {
          confirmation.hidden = true;
          toolbar.hidden = false;
        };
        submit.onclick = () => {
          toolbar.hidden = true;
          confirmation.hidden = false;
          confirm.focus();
          animateIcon(confirm, [
            { transform: 'translate(-4px, 3px)' },
            { transform: 'translate(0, 0)' },
          ]);
        };
        edit.onclick = () => {
          closeConfirmation();
          submit.focus();
        };
        confirm.onclick = async () => {
          closeConfirmation();
          submitting = true;
          stageStatus.textContent = 'Saving your code…';
          submit.disabled = true;
          const submitted = structuredClone(latest);
          try {
            await onSubmit(submitted);
            if (!root.isConnected || JSON.stringify(submitted) !== JSON.stringify(latest)) return;
            stageStatus.textContent = 'Code submitted for this island.';
            const flight = animateIcon(submit, [
              { transform: 'translate(0, 0)' },
              { transform: 'translate(8px, -7px)', opacity: 0 },
            ], 240);
            if (flight) await flight.finished.catch(() => {});
            if (root.isConnected && JSON.stringify(submitted) === JSON.stringify(latest)) afterSubmit?.();
          } catch (error) { stageStatus.textContent = error.message; }
          finally { submitting = false; submit.disabled = !latest.length; }
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
