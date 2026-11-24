window.practicalTaskPager = (root, panels, view = {}, onPageChange, codePages = [], stationNames = [], gate = null) => {
  if (panels.length < 2) {
    if (stationNames.length) window.StationTutorial?.activate(panels[0]);
    return;
  }
  let index = Math.min(view.index || 0, panels.length - 1);
  const furthest = () => {
    if (!gate) return panels.length - 1;
    const firstUnanswered = panels.findIndex((_, position) => !gate(position));
    return firstUnanswered < 0 ? panels.length - 1 : firstUnanswered;
  };
  index = Math.min(index, furthest());
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
    options.append(label);
    if (stationNames.length) {
      view.all = false;
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Jump to station');
      stationNames.forEach((name, i) => select.add(new Option((i + 1) + '. ' + name, i)));
      select.onchange = () => goTo(Number(select.value));
      options.append(select);
      nav.classList.add('station-navigation');
    } else options.append(previous, toggle);
    nav.append(status, options);
  } else nav.append(previous, status, toggle);
  const footer = document.createElement('div');
  footer.className = 'project-task-next';
  if (stationNames.length) {
    previous.textContent = '← Previous station';
    next.textContent = 'Next station →';
    footer.classList.add('station-turn');
    footer.append(previous);
  }
  footer.append(next);
  const nudge = document.createElement('p');
  if (gate) {
    nudge.className = 'station-progress';
    nudge.setAttribute('role', 'status');
    root.append(nudge);
  }
  root.append(footer);
  root.prepend(nav);
  function show() {
    panels.forEach((panel, position) => panel.hidden = !view.all && index !== position);
    for (const panel of panels) {
      if (panel.hidden) panel.querySelectorAll('video').forEach(video => video.pause());
    }
    view.index = index;
    toggle.textContent = view.all ? 'Show one task at a time' : 'Show all tasks';
    previous.hidden = next.hidden = !!view.all;
    status.textContent = view.all ? `All ${panels.length} tasks` : `Task ${index + 1} of ${panels.length}`;
    if (stationNames.length) {
      nav.querySelector('select').value = index;
      status.textContent = 'Station ' + (index + 1) + ' of ' + panels.length;
      nav.style.setProperty('--station-complete', (100 * (index + 1) / panels.length) + '%');
      window.StationTutorial?.activate(panels[index]);
      previous.hidden = index === 0;
      next.hidden = index === panels.length - 1;
    }
    previous.disabled = index === 0;
    next.disabled = index === panels.length - 1;
    updateGate();
    footer.hidden = !!view.all || (!stationNames.length && index === panels.length - 1) || codePages[index];
    onPageChange?.(!!view.all || index === panels.length - 1);
  }
  function updateGate() {
    if (!gate) return;
    const lastAllowed = furthest();
    next.disabled = index === panels.length - 1 || index >= lastAllowed;
    for (const option of nav.querySelector('select').options) {
      option.disabled = Number(option.value) > lastAllowed;
    }
    const message = gate(index) ? '' : 'Answer every question on this station to continue.';
    if (nudge.textContent !== message) nudge.textContent = message;
    nudge.hidden = !message;
  }
  function goTo(position) {
    if (gate && position > furthest()) {
      nav.querySelector('select').value = index;
      return;
    }
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
  goTo.refreshAvailability = updateGate;
  return goTo;
};
