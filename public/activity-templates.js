(() => {
  const $ = id => document.getElementById(id);
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  let records = [], lessons = [], classes = [], record, version, draft, dirty, busy;
  const tasks = () => draft.sections.flatMap(section => section.items);
  async function request(path, body) {
    const response = await fetch(path, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not complete that action.');
    return data;
  }
  function controls() {
    for (const id of ['preview','save','duplicate']) $(id).disabled = busy || !draft;
    $('template').disabled = $('version').disabled = !!busy;
    $('assign').disabled = busy || !draft || dirty || !$('roster').value;
    lessonControls();
  }
  const selectedLesson = () => lessons.find(lesson => lesson.id === $('lesson').value);
  function lessonControls() {
    const lesson = selectedLesson();
    const active = lesson?.active && lesson.active.endsAt > Date.now();
    $('openLesson').disabled = busy || !lesson || lesson.hasOpened;
    $('closeLesson').disabled = busy || !active;
    $('replacementLesson').disabled = busy || !lesson?.hasOpened || !!active || !$('replacement').selectedOptions.length;
    $('replacementLabel').hidden = !lesson?.hasOpened || !!active || !lesson.eligible.length;
    $('learnerLink').hidden = !active;
    if (active) $('learnerLink').href = '/assignment/' + encodeURIComponent(lesson.id);
    $('lessonStatus').textContent = !lesson ? 'No class drafts yet.' : active
      ? `Open until ${new Date(lesson.active.endsAt).toLocaleTimeString()} · ${lesson.attempts} started.`
      : lesson.hasOpened ? `Closed · ${lesson.attempts} started.` : 'Private draft. Opening the lesson lets the class start.';
  }
  function chooseLesson() {
    $('replacement').replaceChildren(...(selectedLesson()?.eligible || []).map(student => new Option(student.name, student.id)));
    lessonControls();
  }
  async function refreshLessons(id = $('lesson').value) {
    lessons = (await request('/api/activity-templates/lessons')).lessons;
    $('lesson').replaceChildren(...lessons.map(lesson => new Option(
      `${lesson.title} · ${classes.find(item => item.id === lesson.rosterId)?.name || 'Class'}`, lesson.id)));
    if (lessons.some(lesson => lesson.id === id)) $('lesson').value = id;
    chooseLesson();
  }
  async function loadPlan() {
    const {rows} = await request('/api/activity-templates/class-plan');
    $('planRows').replaceChildren(...rows.map(row => element('li', `${row.className} · ${row.date} ${row.start}–${row.end} · Replacement: ${row.replacement || 'to arrange'} · ${row.prepared ? 'Draft prepared' : row.matched ? 'Roster matched' : 'Roster not matched'}`)));
    $('preparePlan').disabled = rows.some(row => !row.matched) || rows.every(row => row.prepared);
  }
  function manageLesson(command) {
    const lesson = selectedLesson();
    if (!lesson) return;
    if (command === 'close' && !window.confirm('Close the lesson now? Learners who started cannot resume in a replacement lesson.')) return;
    return action(async () => {
      await request('/api/activity-templates/lessons/' + encodeURIComponent(lesson.id), {
        action: command, minutes: Number($('lessonMinutes').value),
        studentIds: [...$('replacement').selectedOptions].map(option => option.value),
      });
      await refreshLessons(lesson.id);
      $('notice').textContent = command === 'close' ? 'Lesson closed.' : 'Lesson open for the selected learners.';
    });
  }
  function field(parent, label, value, change, type = 'text') {
    const line = element('label', label + ' ');
    const control = element(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') control.type = type;
    if (type === 'number') { control.min = '1'; control.max = '1000'; }
    control.value = value ?? '';
    control.addEventListener('input', () => {
      change(type === 'number' ? Number(control.value) : control.value);
      dirty = true;
      recalculate();
      controls();
    });
    line.append(control);
    parent.append(line);
  }
  function rubricItems(task) {
    const { rubric, inputs } = task.activity;
    if (inputs) return inputs.map(input => [input.label, input, 'marks']);
    const criteria = [['Collect treasure', rubric, 'collect']];
    if (rubric.reach) criteria.unshift(['Reach treasure square', rubric, 'reach']);
    if (rubric.checkpoint) criteria.unshift(['Reach route checkpoint', rubric.checkpoint, 'marks']);
    if (rubric.improvement) {
      const { shorter, muchShorter } = rubric.improvement;
      criteria.push([`Working route in ${shorter.maxBlocks} blocks or fewer (partial)`, shorter, 'marks', true],
        [`Working route in ${muchShorter.maxBlocks} blocks or fewer (full)`, muchShorter, 'marks']);
    }
    return criteria;
  }
  function taskSetup(task, parent) {
    const setup = element('details');
    setup.append(element('summary', 'Task setup'));
    const activity = task.activity;
    const choices = value => value.split(';').map(item => item.trim()).filter(Boolean);
    const cells = value => choices(value).map(item => item.split(',').map(part => Number(part.trim()) - 1));
    const formatCells = points => points.map(point => point.map(n => n + 1).join(',')).join('; ');
    if (activity.mission) {
      const mission = activity.mission;
      field(setup, 'Board size', mission.size, value => mission.size = value, 'number');
      field(setup, 'Starting column and row (1-based)', formatCells([mission.start.slice(0,2)]), value => {
        const point = cells(value)[0] || [];
        mission.start = [point[0], point[1], mission.start[2]];
      });
      field(setup, 'Treasure column and row (1-based)', formatCells([mission.chest]), value => mission.chest = cells(value)[0] || []);
      field(setup, 'Rock squares (column,row; column,row)', formatCells(mission.rocks || []), value => mission.rocks = cells(value));
      if (activity.rubric.checkpoint) field(setup, 'Flag column and row (1-based)', formatCells([activity.rubric.checkpoint.cell]), value => activity.rubric.checkpoint.cell = cells(value)[0] || []);
      if (activity.starter?.length) {
        field(setup, 'Starting blocks (move; left; right; collect)', activity.starter.map(block=>block.op).join('; '),
          value => activity.starter = choices(value).map(op=>({op})));
      }
    } else {
      field(setup, 'Source cards (one per line)', (activity.source || []).join('\n'), value => activity.source = value.split('\n').map(line=>line.trim()).filter(Boolean), 'textarea');
      for (const [rowIndex, row] of activity.table.entries()) for (const [columnIndex, value] of row.entries()) {
        if (activity.inputs.some(input=>input.row===rowIndex&&input.column===columnIndex)) continue;
        field(setup, `Table row ${rowIndex+1}, column ${columnIndex+1}`, value, next=>activity.table[rowIndex][columnIndex]=next);
      }
      for (const input of activity.inputs) {
        field(setup, 'Response label', input.label, value => input.label = value);
        field(setup, input.label + ' choices (separate with ;)', input.options.join('; '), value => input.options = choices(value));
        field(setup, input.label + ' accepted values (separate with ;)', input.accepted.join('; '), value => input.accepted = choices(value));
        if (activity.kind === 'data-correct') field(setup, input.label + ' starting value', input.initial, value => input.initial = value);
      }
    }
    parent.append(setup);
  }
  function recalculate() {
    for (const task of tasks()) task.marks = rubricItems(task).reduce((sum, [, owner, key, partial]) => sum + (partial ? 0 : owner[key]), 0);
    draft.totalMarks = tasks().reduce((sum, task) => sum + task.marks, 0);
    $('total').textContent = `Total: ${draft.totalMarks} marks${dirty ? ' · Unsaved changes' : ''}`;
  }
  function editVersion() {
    version = Number($('version').value);
    draft = structuredClone(record.versions[version - 1]);
    dirty = false;
    $('learnerPreview').hidden = true;
    $('editor').replaceChildren();
    for (const [key,label] of [['title','Title'],['subject','Subject'],['grade','Grade'],['instructions','Learner instructions']]) {
      field($('editor'), label, draft[key], value => draft[key] = value, key === 'instructions' ? 'textarea' : 'text');
    }
    for (const section of draft.sections) {
      const group = element('details');
      group.append(element('summary', section.title));
      field(group, 'Section title', section.title, value => section.title = value);
      field(group, 'Section instructions', section.instructions, value => section.instructions = value, 'textarea');
      for (const [index, task] of section.items.entries()) {
        const rubric = element('fieldset');
        rubric.append(element('legend', `Task ${index + 1}`));
        field(rubric, 'Task instructions', task.prompt, value => task.prompt = value, 'textarea');
        for (const [label, target, key] of rubricItems(task)) field(rubric, label + ' points', target[key], value => target[key] = value, 'number');
        taskSetup(task, rubric);
        group.append(rubric);
      }
      $('editor').append(group);
    }
    $('save').textContent = record.starter ? 'Save as template' : 'Save new version';
    recalculate();
    controls();
  }
  function choose(selectedVersion) {
    record = records.find(item => item.id === $('template').value);
    if (!record) return;
    $('version').replaceChildren(...record.versions.map((_, index) => new Option('Version ' + (index + 1), index + 1)));
    $('version').value = selectedVersion || record.versions.length;
    editVersion();
  }
  async function refresh(id, selectedVersion) {
    records = (await request('/api/activity-templates')).templates;
    $('template').replaceChildren(...records.map(item => new Option(item.versions.at(-1).title + (item.starter ? ' · Starter' : ''), item.id)));
    if (id) $('template').value = id;
    choose(selectedVersion);
  }
  async function action(work) {
    if (busy) return;
    busy = true;
    controls();
    try { await work(); }
    catch (error) { $('notice').textContent = error.message; }
    finally { busy = false; controls(); }
  }
  function save(duplicate) {
    return action(async () => {
      const saved = await request('/api/activity-templates', { sourceId: record.id, baseVersion: version, assessment: draft, duplicate });
      await refresh(saved.id, saved.version);
      $('notice').textContent = `Saved version ${saved.version}.`;
    });
  }
  $('template').onchange = () => choose();
  $('version').onchange = editVersion;
  $('roster').onchange = controls;
  $('save').onclick = () => save(false);
  $('duplicate').onclick = () => save(true);
  $('assign').onclick = () => action(async () => {
    const result = await request('/api/activity-templates/assign', { templateId: record.id, version, rosterId: $('roster').value });
    $('notice').textContent = `Class draft created · ${result.totalMarks} marks. You’ll find it under Tests & projects.`;
    await refreshLessons(result.assessmentId);
  });
  $('lesson').onchange = chooseLesson;
  $('classPlan').ontoggle = () => { if ($('classPlan').open) action(loadPlan); };
  $('preparePlan').onclick = () => action(async () => {
    const result = await request('/api/activity-templates/class-plan', {});
    await Promise.all([loadPlan(), refreshLessons()]);
    $('notice').textContent = `${result.created} class drafts prepared. None were opened.`;
  });
  $('replacement').onchange = lessonControls;
  $('openLesson').onclick = () => manageLesson('open');
  $('replacementLesson').onclick = () => manageLesson('replacement');
  $('closeLesson').onclick = () => manageLesson('close');
  $('preview').onclick = () => action(async () => {
    const {assessment} = await request('/api/activity-templates/preview', {assessment:draft});
    const panel = $('learnerPreview');
    panel.replaceChildren(element('h2', 'Learner preview'), element('p', assessment.instructions));
    for (const section of assessment.sections) {
      panel.append(element('h3', section.title), element('p', section.instructions));
      for (const task of section.items) {
        const root = element('div');
        const activity = task.activity;
        panel.append(element('h4', `${task.prompt} · ${task.marks} marks`), root);
        if (activity.mission) AssessmentCodeQuest.mount(root, {
          mission: { rocks: [], water: [], ...activity.mission, requireReturn: false },
          starter: activity.starter, checkpoint: activity.rubric.checkpoint?.cell,
        }, null, () => {});
        else AssessmentDataTable.mount(root, { source: [], ...activity }, null, () => {});
      }
    }
    panel.hidden = false;
    panel.scrollIntoView();
  });
  action(async () => {
    const [{ rosters }] = await Promise.all([request('/api/rosters'), refresh()]);
    classes = rosters;
    for (const roster of rosters) $('roster').add(new Option(roster.name, roster.id));
    await refreshLessons();
  });
  setInterval(() => { const lesson = selectedLesson(); if (!busy && lesson?.active && lesson.active.endsAt <= Date.now()) refreshLessons().catch(() => {}); }, 5000);
})();
