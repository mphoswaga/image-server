window.practicalTaskPager = (root, panels, view = {}, onPageChange, codePages = [], stationNames = []) => {
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
  if (codePages.some(Boolean) || stationNames.length) {
    const options = document.createElement('details');
    const label = document.createElement('summary');
    label.textContent = stationNames.length ? 'Station menu' : 'Task options';
    options.append(label, previous, toggle);
    if (stationNames.length) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Jump to station');
      stationNames.forEach((name, i) => select.add(new Option((i + 1) + '. ' + name, i)));
      select.onchange = () => goTo(Number(select.value));
      options.append(select);
      nav.classList.add('station-navigation');
    }
    nav.append(status, options);
  } else nav.append(previous, status, toggle);
  const footer = document.createElement('div');
  footer.className = 'project-task-next';
  footer.append(next);
  root.append(footer);
  root.prepend(nav);
  function show() {
    panels.forEach((panel, position) => panel.hidden = !view.all && index !== position);
    for (const panel of panels) {
      if (panel.hidden) panel.querySelectorAll('video').forEach(video => video.pause());
    }
    if (stationNames.length) nav.querySelector('select').value = index;
    view.index = index;
    toggle.textContent = view.all ? 'Show one task at a time' : 'Show all tasks';
    previous.hidden = next.hidden = !!view.all;
    status.textContent = view.all ? `All ${panels.length} tasks` : `Task ${index + 1} of ${panels.length}`;
    if (stationNames.length && !view.all) status.textContent = 'Station ' + (index + 1) + ' of ' + panels.length;
    previous.disabled = index === 0;
    next.disabled = index === panels.length - 1;
    footer.hidden = !!view.all || next.disabled || codePages[index];
    onPageChange?.(!!view.all || next.disabled);
  }
  function goTo(position) {
    nav.querySelector('details')?.removeAttribute('open');
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
