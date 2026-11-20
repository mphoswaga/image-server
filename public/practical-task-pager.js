window.practicalTaskPager = (root, panels, view = {}, onPageChange) => {
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
  nav.append(previous, status, toggle);
  const footer = document.createElement('div');
  footer.className = 'project-task-next';
  footer.append(next);
  root.append(footer);
  root.prepend(nav);
  function show() {
    panels.forEach((panel, position) => panel.hidden = !view.all && index !== position);
    view.index = index;
    toggle.textContent = view.all ? 'Show one task at a time' : 'Show all tasks';
    previous.hidden = next.hidden = !!view.all;
    status.textContent = view.all ? `All ${panels.length} tasks` : `Task ${index + 1} of ${panels.length}`;
    previous.disabled = index === 0;
    next.disabled = index === panels.length - 1;
    footer.hidden = !!view.all || next.disabled;
    onPageChange?.(!!view.all || next.disabled);
  }
  function goTo(position) {
    index = position;
    view.all = false;
    show();
    panels[index].tabIndex = -1;
    panels[index].focus({preventScroll:true});
    nav.scrollIntoView({block:'start'});
  }
  previous.onclick = () => goTo(index - 1);
  next.onclick = () => goTo(index + 1);
  show();
  return goTo;
};
