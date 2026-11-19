window.practicalTaskPager = (root, panels, view = {}) => {
  if (panels.length < 2) return;
  let index = Math.min(view.index || 0, panels.length - 1);
  const nav = document.createElement('nav');
  nav.className = 'project-task-nav';
  nav.setAttribute('aria-label', 'Activity tasks');
  const previous = document.createElement('button'), next = document.createElement('button'), status = document.createElement('span');
  for (const [button,label] of [[previous,'Previous task'],[next,'Next task']]) {
    button.type = 'button';
    button.textContent = label;
  }
  status.setAttribute('aria-live','polite');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.onclick = () => { view.all = !view.all; show(); };
  nav.append(previous, status, next, toggle);
  root.prepend(nav);
  function show() {
    panels.forEach((panel, position) => panel.hidden = !view.all && index !== position);
    view.index = index;
    toggle.textContent = view.all ? 'Show one task at a time' : 'Show all tasks';
    previous.hidden = next.hidden = !!view.all;
    status.textContent = view.all ? `All ${panels.length} tasks` : `Task ${index + 1} of ${panels.length}`;
    previous.disabled = index === 0;
    next.disabled = index === panels.length - 1;
  }
  previous.onclick = () => { if (index > 0) { index--; show(); } };
  next.onclick = () => { if (index < panels.length - 1) { index++; show(); } };
  show();
};
