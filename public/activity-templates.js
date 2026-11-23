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
  function showWorkspace(classroom) {
    $('setupTab').setAttribute('aria-pressed', String(!classroom));
    $('classTab').setAttribute('aria-pressed', String(classroom));
    $('workspaceTitle').textContent = classroom ? 'Assessment classroom' : 'Practical assessments';
    $('classWorkspace').hidden = $('scheduleWorkspace').hidden = !classroom;
    $('quickSetup').hidden = classroom;
    $('learnerPreview').hidden = true;
    $('openDraftDesk').hidden = true;
    window.scrollTo(0,0);
  }
  $('setupTab').onclick = () => showWorkspace(false);
  $('classTab').onclick = $('openDraftDesk').onclick = () => showWorkspace(true);
  function controls() {
    for (const id of ['preview','save','duplicate']) $(id).disabled = busy || !draft;
    $('template').disabled = $('version').disabled = !!busy;
    $('assign').disabled = busy || !draft || !$('roster').value;
    $('assign').textContent = dirty ? 'Save copy and create class draft' : 'Create class draft';
    lessonControls();
  }
  const selectedLesson = () => lessons.find(lesson => lesson.id === $('lesson').value);
  function lessonControls() {
    const lesson = selectedLesson();
    const active = lesson?.active && lesson.active.endsAt > Date.now();
    $('openLesson').disabled = busy || !lesson || lesson.hasOpened;
    $('closeLesson').disabled = busy || !active;
    $('resumeLesson').hidden = !lesson?.canResume || !!active;
    $('resumeLesson').disabled = !!busy;
    $('replacementLesson').disabled = busy || !lesson?.hasOpened || !!active || !$('replacement').selectedOptions.length;
    $('replacementLabel').hidden = !lesson?.hasOpened || !!active || !lesson.eligible.length;
    $('learnerLink').hidden = !active;
    if (active) $('learnerLink').href = '/assignment/' + encodeURIComponent(lesson.id);
    $('lessonStatus').textContent = !lesson ? 'No class drafts yet.' : active
      ? `Open until ${new Date(lesson.active.endsAt).toLocaleTimeString()} · ${lesson.attempts} started.`
      : lesson.hasOpened ? `Closed · ${lesson.attempts} started.` : 'Private draft. Opening the lesson lets the class start.';
  }
  let deskRequest = 0, desk = null, reader;
  function readingControls() {
    const task = desk?.tasks.find(t => t.id === $('guideTask').value);
    if (!task) return;
    reader.id = selectedLesson().id;
    reader.select(reader.id + '/' + task.id);
    $('readDirections').disabled = !task.instructions;
    for (const [id, label, part] of [['readPrompt','question','question'], ['readDirections','instructions','instructions']]) {
      const button = $(id);
      button.dataset.read = new URLSearchParams({questionId: task.id, part}).toString();
      button.dataset.label = label + ' aloud';
    }
    reader.sync();
  }
  async function refreshDesk() {
    const serial = ++deskRequest;
    const lesson = selectedLesson();
    if (!lesson?.hasOpened) { $('lessonDesk').hidden = true; return; }
    const detail = await request('/api/activity-templates/lessons/' + encodeURIComponent(lesson.id));
    if (serial !== deskRequest || selectedLesson()?.id !== lesson.id) return;
    const first = !desk || desk.id !== lesson.id;
    desk = {...detail, id: lesson.id};
    if (first) {
      $('guideTask').replaceChildren(...detail.tasks.map((task,i) => new Option((i+1) + '. ' + task.title, task.id)));
      if (detail.active?.questionId) $('guideTask').value = detail.active.questionId;
    }
    $('lessonDesk').hidden = false;
    $('guide').disabled = !detail.active;
    $('releaseGuide').disabled = !detail.active?.questionId;
    const guided = detail.tasks.findIndex(task => task.id === detail.active?.questionId);
    $('guideState').textContent = !detail.active ? 'Lesson closed.' : guided < 0 ? 'Students are working at their own pace.' : 'Everyone is on question ' + (guided + 1) + '.';
    $('submissionCount').textContent = 'Live submissions · ' + detail.learners.filter(l => l.submitted).length + ' of ' + detail.learners.length + ' submitted';
    $('learnerProgress').replaceChildren(...detail.learners.map(learner => {
      const status = learner.submitted ? 'Submitted' : learner.started
        ? learner.answered + ' of ' + detail.tasks.length + ' tasks with saved work' : 'Yet to start';
      const row = element('li', learner.name + ' · ' + status);
      if (learner.hasDraft && !learner.submitted) {
        const review = element('button','Review saved work');
        review.type = 'button';
        review.setAttribute('aria-label','Review saved work for ' + learner.name);
        review.onclick = () => reviewLearnerWork(lesson.id,learner.id);
        row.append(' ',review);
      }
      return row;
    }));
    if (!reader) reader = new AssessmentReader(lesson.id);
    readingControls();
  }
  function reviewLearnerWork(lessonId, studentId) {
    return action(async () => {
      const url = '/api/activity-templates/lessons/' + encodeURIComponent(lessonId) + '/work/' + encodeURIComponent(studentId);
      const work = await request(url);
      if (selectedLesson()?.id !== lessonId) return;
      const panel = $('classMarks');
      panel.replaceChildren(element('h3',work.name + ' · Saved work'));
      for (const task of work.tasks) {
        const value = work.answers[task.id];
        const answer = !Array.isArray(value) ? 'No saved answer' : task.kind === 'codequest'
          ? AssessmentCodeQuest.describe(value) : AssessmentDataTable.describe(task,value);
        const row = element('p');
        row.append(element('strong',task.title),document.createElement('br'),document.createTextNode(answer));
        panel.append(row);
      }
      if (work.canSubmit) {
        const submit = element('button','Submit saved work for this student');
        submit.type = 'button';
        submit.onclick = () => {
          if (!window.confirm('Submit ' + work.name + '’s saved work? Unanswered tasks earn zero and the student cannot keep editing.')) return;
          action(async () => {
            const result = await request(url,{updatedAt:work.updatedAt});
            panel.replaceChildren(element('h3',work.name + ' · Submitted'),element('p',result.totalMarks + '/' + result.maxMarks));
            await refreshDesk();
          });
        };
        panel.append(submit);
      }
      panel.focus();
    });
  }
  $('viewClassMarks').onclick = () => action(async () => {
    const id = selectedLesson().id;
    const {submissions} = await request('/api/assignment/'+encodeURIComponent(id)+'/results');
    if (selectedLesson()?.id !== id) return;
    const panel = $('classMarks');
    panel.replaceChildren(element('h3','Class results'));
    if (!submissions.length) panel.append(element('p','Results appear here when a student submits their project.'));
    for (const student of submissions) {
      const row = element('details');
      row.append(element('summary',student.name + ' · ' + student.totalMarks + '/' + student.maxMarks));
      for (const task of desk.tasks) {
        const grade = student.grades?.[task.id];
        if (grade) row.append(element('p',task.title + ' · ' + grade.rationale));
      }
      panel.append(row);
    }
  });
  $('guideTask').onchange = readingControls;
  function guideClass(release) {
    const lesson = selectedLesson();
    if (!desk?.active || desk.id !== lesson?.id) return;
    action(async () => {
      await request('/api/activity-templates/lessons/' + encodeURIComponent(lesson.id), {
        action: 'guide', windowId: desk.active.id, questionId: release ? null : $('guideTask').value
      });
      await refreshDesk();
    });
  }
  $('guide').onclick = () => guideClass(false);
  $('releaseGuide').onclick = () => guideClass(true);
  let timeForLesson;
  function chooseLesson() {
    $('classMarks').replaceChildren();
    const lesson = selectedLesson();
    if (lesson?.id !== timeForLesson) {
      $('lessonMinutes').value = lesson?.suggestedMinutes || 40;
      timeForLesson = lesson?.id;
    }
    reader?.stop();
    $('lessonDesk').hidden = true;
    refreshDesk().catch(error => { $('notice').textContent = error.message; });
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
    $('planRows').replaceChildren(...rows.map(row => element('li', `${row.className} · ${row.date} ${row.start}–${row.end} · Replacement: ${row.replacement || 'to arrange'} · ${row.prepared && row.preparedVersion !== row.version ? 'Earlier edition prepared. To use the longer project, choose the latest template above and create a separate class draft.' : row.prepared ? 'Draft prepared' : row.matched ? 'Roster matched' : 'Roster not matched'}`)));
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
      $('notice').textContent = command === 'close' ? 'Lesson closed.' : command === 'resume'
        ? 'Lesson resumed. Students can refresh their current tab to continue.' : 'Lesson open for the selected learners.';
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
    return line;
  }
  function rubricItems(task) {
    const { rubric, inputs } = task.activity;
    if (inputs) return inputs.map(input => [input.label, input, 'marks']);
    const criteria = [['Collect treasure', rubric, 'collect']];
    if (rubric.reach) criteria.unshift(['Reach treasure square', rubric, 'reach']);
    if (rubric.checkpoint) criteria.unshift(['Reach route checkpoint', rubric.checkpoint, 'marks']);
    if (rubric.secondCheckpoint) criteria.push(['Reach second lookout flag', rubric.secondCheckpoint, 'marks']);
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
      const facing = element('label','Pirate starts facing ');
      const directions = element('select');
      ['Up','Right','Down','Left'].forEach((direction,index)=>directions.add(new Option(direction,index)));
      directions.value = mission.start[2];
      directions.onchange = () => { mission.start[2] = Number(directions.value); dirty = true; recalculate(); controls(); };
      facing.append(directions); setup.append(facing);
      field(setup, 'Treasure column and row (1-based)', formatCells([mission.chest]), value => mission.chest = cells(value)[0] || []);
      field(setup, 'Rock squares (column,row; column,row)', formatCells(mission.rocks || []), value => mission.rocks = cells(value));
      if (activity.rubric.checkpoint) field(setup, 'Flag column and row (1-based)', formatCells([activity.rubric.checkpoint.cell]), value => activity.rubric.checkpoint.cell = cells(value)[0] || []);
      if (activity.rubric.secondCheckpoint) field(setup, 'Second flag column and row (1-based)', formatCells([activity.rubric.secondCheckpoint.cell]), value => activity.rubric.secondCheckpoint.cell = cells(value)[0] || []);
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
        if (activity.presentation === 'order') {
          field(setup, input.label + ' correct box', input.accepted[0], value => input.accepted = [value]);
          continue;
        }
        const choicesLine = field(setup, input.label + ' choices (separate with ;)', (input.options || []).join('; '), value => input.options = choices(value));
        if (activity.kind === 'data-organise') {
          const label = element('label', input.label + ' answer method ');
          const method = element('select');
          method.add(new Option('Choose from a list', 'list'));
          method.add(new Option('Type an answer', 'text'));
          method.value = input.entry === 'text' ? 'text' : 'list';
          choicesLine.hidden = method.value === 'text';
          method.onchange = () => {
            if (method.value === 'text') input.entry = 'text';
            else delete input.entry;
            choicesLine.hidden = method.value === 'text';
            dirty = true;
            $('learnerPreview').hidden = true;
            controls();
          };
          label.append(method);
          choicesLine.before(label);
        }
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
    activeIsland = null; stagedTasks = new Map();
    version = Number($('version').value);
    draft = structuredClone(record.versions[version - 1]);
    dirty = false;
    $('learnerPreview').hidden = true;
    renderEditor();
  }
  let activeIsland, stagedTasks = new Map();
  function renderStageChoices(group, section) {
    const catalog = records.find(item => item.id === 'starter-codequest-stages').versions[0].sections[0].items;
    for (const task of section.items) stagedTasks.set(task.id, task);
    const stages = catalog.map(stage => stagedTasks.get(stage.id) || structuredClone(stage));
    const selected = new Set(section.items.map(item => item.id));
    if (!stages.some(stage => stage.id === activeIsland)) activeIsland = section.items[0].id;
    const frame = document.createElement('iframe');
    frame.title = 'Select and play CodeQuest stages';
    frame.className = 'project-codequest-frame stage-console';
    frame.src = '/codequest.html?assessment=1';
    frame.onload = () => {
      const win = frame.contentWindow, doc = frame.contentDocument;
      if (!win.mountAssessmentStage) return;
      const nav = doc.createElement('nav');
      nav.className = 'island-selector';
      nav.setAttribute('aria-label','Assessment islands');
      const title = doc.createElement('h2');
      title.textContent = 'Choose your islands';
      const count = doc.createElement('span');
      count.className = 'island-count';
      count.setAttribute('aria-live', 'polite');
      title.append(count);
      nav.append(title);
      const strip = doc.createElement('div');
      nav.append(strip);
      doc.querySelector('#game').prepend(nav);
      const controls = [];
      const previewPrograms = new Map();
      const tools = doc.createElement('div');
      tools.className = 'treasure-tools';
      doc.getElementById('island').after(tools);
      let placementRequest = 0;
      function treasureControls(stage) {
        ++placementRequest;
        tools.replaceChildren();
        if (!selected.has(stage.id)) return;
        const edit = doc.createElement('button');
        edit.type = 'button';
        edit.textContent = 'Move treasure';
        tools.append(edit);
        edit.onclick = async () => {
          const requestId = ++placementRequest;
          edit.disabled = true;
          const status = doc.createElement('span');
          status.setAttribute('role','status');
          status.textContent = 'Checking squares…';
          tools.append(status);
          try {
            const { choices } = await request('/api/activity-templates/treasure-choices', { activity:stage.activity, marks:stage.marks });
            if (!frame.isConnected || requestId !== placementRequest) return;
            edit.textContent = 'Cancel';
            edit.disabled = false;
            edit.onclick = () => browse(stage);
            status.textContent = choices.length ? 'Choose a highlighted square.' : 'Only the current square fits.';
            if (!choices.length) return;
            const random = doc.createElement('button');
            random.type = 'button';
            random.textContent = 'Choose for me';
            random.onclick = () => placeTreasure(stage, choices[Math.floor(Math.random() * choices.length)]);
            edit.after(random);
            const tiles = doc.getElementById('island').querySelectorAll('.tile');
            for (const choice of choices) {
              const [x,y] = choice.chest;
              const square = doc.createElement('button');
              square.type = 'button';
              square.className = 'treasure-target';
              square.setAttribute('aria-label', 'Place treasure at row ' + (y+1) + ', column ' + (x+1));
              square.onclick = () => placeTreasure(stage, choice);
              tiles[y * stage.activity.mission.size + x].append(square);
            }
          } catch (error) {
            if (requestId !== placementRequest) return;
            status.textContent = error.message;
            edit.disabled = false;
            edit.onclick = () => browse(stage);
            edit.textContent = 'Back to island';
          }
        };
      }
      function browse(stage) {
        activeIsland = stage.id;
        const marks = section.items.reduce((total, item) => total + item.marks, 0);
        count.textContent = selected.size + ' selected · ' + marks + ' marks';
        if (selected.has(stage.id) && $('treasureTask').value !== stage.id) {
          $('treasureTask').value = stage.id;
          loadTreasureBoard();
        }
        win.mountAssessmentStage({
          mission:stage.activity.mission, starter:stage.activity.starter, checkpoint:stage.activity.rubric.checkpoint?.cell,
        }, previewPrograms.get(stage.id), program => previewPrograms.set(stage.id, structuredClone(program)), () => {});
        doc.getElementById('ownName').textContent = stage.prompt;
        treasureControls(stage);
        for (const row of controls) {
          row.button.setAttribute('aria-pressed', String(row.id === activeIsland));
          row.check.disabled = selected.size === 1 && selected.has(row.id);
        }
      }
      for (const stage of stages) {
        const card = doc.createElement('div');
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = stage.prompt;
        button.onclick = () => browse(stage);
        const label = doc.createElement('label'), check = doc.createElement('input');
        check.type = 'checkbox';
        check.checked = selected.has(stage.id);
        check.setAttribute('aria-label', 'Include ' + stage.prompt);
        check.onchange = () => {
          if (check.checked) selected.add(stage.id); else selected.delete(stage.id);
          section.items = stages.filter(item => selected.has(item.id));
          stagedTasks.set(stage.id, stage);
          dirty = true;
          $('learnerPreview').hidden = true;
          renderEditor(undefined, true);
          browse(stage);
        };
        label.append(check, doc.createTextNode('Include · ' + stage.marks + ' marks'));
        card.append(button,label); strip.append(card);
        controls.push({ id: stage.id, button, check });
      }
      browse(stages.find(item => item.id === activeIsland));
    };
    group.append(frame);
  }
  let treasureRequest = 0;
  function updateTreasureTasks() {
    const items = tasks().filter(item => item.activity.mission);
    const selected = $('treasureTask').value;
    $('treasurePicker').hidden = !items.length || draft.sections.every(section => section.id === 'codequest-stages');
    $('treasureTask').replaceChildren(...items.map(item => new Option(item.prompt, item.id)));
    if (items.some(item => item.id === selected)) $('treasureTask').value = selected;
    loadTreasureBoard();
  }
  function placeTreasure(task, choice) {
    task.activity.mission.chest = choice.chest;
    if (choice.blockLimit) task.activity.mission.blockLimit = choice.blockLimit;
    if (choice.starter?.length) task.activity.starter = choice.starter;
    if (choice.improvement) task.activity.rubric.improvement = choice.improvement;
    dirty = true;
    $('learnerPreview').hidden = true;
    renderEditor();
  }
  async function loadTreasureBoard() {
    const serial = ++treasureRequest;
    const task = tasks().find(item => item.id === $('treasureTask').value);
    const board = $('treasureBoard');
    board.replaceChildren();
    $('shuffleTreasure').disabled = true;
    if (!task || !$('treasurePicker').open) return;
    $('treasureHint').textContent = 'Checking playable squares…';
    const snapshot = JSON.stringify(task);
    try {
      const {choices} = await request('/api/activity-templates/treasure-choices', {activity: task.activity, marks: task.marks});
      if (serial !== treasureRequest) return;
      function place(choice) {
        if (snapshot !== JSON.stringify(task)) return loadTreasureBoard();
        placeTreasure(task, choice);
      }
      $('shuffleTreasure').disabled = !choices.length;
      $('shuffleTreasure').onclick = () => place(choices[Math.floor(Math.random() * choices.length)]);
      $('treasureHint').textContent = choices.length ? 'Tap a sand square to move the treasure.' : 'Only the current treasure square fits this task.';
      const m = task.activity.mission;
      board.style.gridTemplateColumns = 'repeat(' + m.size + ', 1fr)';
      for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
        const here = cell => cell?.[0] === x && cell[1] === y;
        const choice = choices.find(option => here(option.chest));
        const icon = here(m.chest) ? '💰' : here(m.start) ? '⛵' : (here(task.activity.rubric.checkpoint?.cell) || here(task.activity.rubric.secondCheckpoint?.cell)) ? '⚑' :
          m.rocks?.some(here) ? '🪨' : m.water?.some(here) ? '🌊' : '';
        const square = element('button',icon);
        square.type = 'button';
        square.disabled = !choice;
        square.setAttribute('aria-label', 'Row ' + (y+1) + ', column ' + (x+1) + (icon ? ' ' + icon : ''));
        square.onclick = () => place(choice);
        board.append(square);
      }
    } catch (error) { if (serial === treasureRequest) $('treasureHint').textContent = error.message; }
  }
  $('treasurePicker').ontoggle = () => { if (draft) loadTreasureBoard(); };
  $('treasureTask').onchange = loadTreasureBoard;
  function renderEditor(expandedSection, keepGame = false) {
    $('editor').replaceChildren();
    if (!keepGame) $('stageChoices').replaceChildren();
    $('projectPacing').hidden = draft.suggestedMinutes !== 60;
    $('projectPacing').textContent = '60-minute lesson · 3 min to get ready, about 52 min for the tasks and 5 min to check and submit. Adjust the working time for your class.';
    updateTreasureTasks();
    for (const [key,label] of [['title','Title'],['subject','Subject'],['grade','Grade'],['instructions','Learner instructions']]) {
      field($('editor'), label, draft[key], value => draft[key] = value, key === 'instructions' ? 'textarea' : 'text');
    }
    if (!draft.sections.some(section => section.id === 'codequest-stages')) {
      const stations = element('div');
      stations.className = 'station-directory';
      for (const [index, task] of tasks().entries()) {
        const section = draft.sections.find(section => section.items.includes(task));
        const button = element('button');
        button.type = 'button';
        button.append(element('strong',section.title), element('span',task.prompt), element('small',task.marks + ' marks · Preview →'));
        button.onclick = () => preview(index);
        stations.append(button);
      }
      $('stageChoices').replaceChildren(stations);
    }
    for (const section of draft.sections) {
      const group = element('details');
      const stageSection = section.id === 'codequest-stages';
      group.open = section.id === expandedSection;
      group.append(element('summary', section.title));
      if (stageSection && !keepGame) renderStageChoices($('stageChoices'), section);
      field(group, 'Section title', section.title, value => section.title = value);
      field(group, 'Section instructions', section.instructions, value => section.instructions = value, 'textarea');
      for (const [index, task] of section.items.entries()) {
        const rubric = element('fieldset');
        rubric.append(element('legend', `Task ${index + 1}`));
        field(rubric, 'Task instructions', task.prompt, value => task.prompt = value, 'textarea');
        for (const [label, target, key] of rubricItems(task)) field(rubric, label + ' points', target[key], value => target[key] = value, 'number');
        taskSetup(task, rubric);
        const duplicate = element('button','Duplicate task');
        duplicate.type = 'button';
        duplicate.onclick = () => {
          const copy = structuredClone(task);
          copy.id = 'task-' + crypto.randomUUID();
          copy.prompt = task.prompt.slice(0, 1960) + ' (copy)';
          section.items.splice(index + 1,0,copy);
          dirty = true; renderEditor(section.id);
        };
        const remove = element('button','Remove task');
        remove.type = 'button';
        remove.disabled = section.items.length === 1;
        remove.onclick = () => { section.items.splice(index,1); dirty = true; renderEditor(section.id); };
        if (!stageSection) rubric.append(duplicate, remove);
        const settings = element('details');
        settings.className = 'task-settings';
        settings.append(element('summary', task.prompt + ' · ' + task.marks + ' marks'), rubric);
        group.append(settings);
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
  $('editor').addEventListener('input', () => {
    const items = tasks();
    const summaries = $('editor').querySelectorAll('.task-settings > summary');
    const stations = $('stageChoices').querySelectorAll('.station-directory button');
    items.forEach((task, index) => {
      summaries[index].textContent = task.prompt + ' · ' + task.marks + ' marks';
      if (stations[index]) {
        const section = draft.sections.find(section => section.items.includes(task));
        stations[index].querySelector('strong').textContent = section.title;
        stations[index].querySelector('span').textContent = task.prompt;
        stations[index].querySelector('small').textContent = task.marks + ' marks · Preview →';
      }
    });
    $('learnerPreview').hidden = true;
  });
  $('customise').ontoggle = () => {
    if (draft && dirty && !$('customise').open) renderEditor();
  };
  $('template').onchange = () => choose();
  $('version').onchange = editVersion;
  $('roster').onchange = controls;
  $('save').onclick = () => save(false);
  $('duplicate').onclick = () => save(true);
  $('assign').onclick = () => action(async () => {
    const rosterId = $('roster').value;
    if (dirty) {
      const copy = await request('/api/activity-templates', { sourceId: record.id, baseVersion: version, assessment: draft, duplicate: true });
      await refresh(copy.id, copy.version);
    }
    const result = await request('/api/activity-templates/assign', { templateId: record.id, version, rosterId });
    $('notice').textContent = `Class draft created · ${result.totalMarks} marks. You’ll find it under Tests & projects.`;
    await refreshLessons(result.assessmentId);
    $('openDraftDesk').hidden = false;
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
  $('resumeLesson').onclick = () => manageLesson('resume');
  $('replacementLesson').onclick = () => manageLesson('replacement');
  $('closeLesson').onclick = () => manageLesson('close');
  $('preview').onclick = () => preview(0);
  function preview(index) { return action(async () => {
    const snapshot = structuredClone(draft);
    const {assessment,previewKey} = await request('/api/activity-templates/preview', {assessment:snapshot});
    const key = 'lesson-practical-preview-' + previewKey;
    let answers = {};
    try { answers = JSON.parse(sessionStorage.getItem(key)) || {}; } catch {}
    const panel = $('learnerPreview');
    panel.replaceChildren(element('h2', 'Learner preview'), element('p', assessment.instructions));
    const deck = element('div');
    const pages = [];
    let goToTask;
    const status = element('p');
    status.setAttribute('role','status');
    status.textContent = Object.keys(answers).length ? 'Preview answers restored in this tab.' : 'Try a task, then submit the preview to see its marks.';
    const results = element('section');
    const mark = element('button','Submit preview and see marks');
    mark.type = 'button';
    const save = (id,value) => {
      answers[id] = value;
      results.replaceChildren();
      try {
        sessionStorage.setItem(key,JSON.stringify(answers));
        status.textContent = 'Preview autosaved in this tab.';
      } catch { status.textContent = 'Keep this tab open. Browser storage is unavailable.'; }
    };
    mark.onclick = async () => {
      mark.disabled = true;
      deck.inert = true;
      try {
        const data = await request('/api/activity-templates/preview-results',{assessment:snapshot,answers});
        results.replaceChildren(element('h3','Preview result · ' + data.totalMarks + ' / ' + data.maxMarks));
        results.append(element('p','Teacher preview only. Class marks are separate.'));
        for (const q of assessment.questions) {
          const grade = data.grades[q.id];
          const details = element('details');
          details.append(element('summary',q.question + ' · ' + grade.marksAwarded + '/' + q.marks + (data.unanswered.includes(q.id) ? ' · Unanswered' : '')));
          for (const criterion of grade.criteria) details.append(element('p',criterion.label + ' · ' + criterion.awarded + '/' + criterion.max));
          results.append(details);
        }
        results.tabIndex = -1;
        results.focus();
        results.scrollIntoView({block:'start'});
      } catch (error) { status.textContent = error.message; }
      finally { mark.disabled = false; deck.inert = false; }
    };
    panel.append(deck,status,mark,results);
    for (const section of assessment.sections) {
      for (const task of section.items) {
        const page = element('article'); page.className = 'preview-task';
        pages.push(page); deck.append(page);
        const root = element('div');
        const activity = task.activity;
        page.append(element('h3', section.title), element('p', section.instructions), element('h4', `${task.prompt} · ${task.marks} marks`), root);
        if (activity.mission) AssessmentCodeQuest.mount(root, {
          mission: { rocks: [], water: [], ...activity.mission, requireReturn: false },
          starter: activity.starter, checkpoint: activity.rubric.checkpoint?.cell, secondCheckpoint: activity.rubric.secondCheckpoint?.cell, targetBlocks: activity.rubric.improvement?.muchShorter.maxBlocks,
        }, answers[task.id], value => save(task.id,value), value => save(task.id,value), value => save(task.id,value), false, () => {
          const next = pages.indexOf(page) + 1;
          if (next < pages.length) goToTask(next);
          else mark.focus();
        });
        else AssessmentDataTable.mount(root, { source: [], ...activity }, answers[task.id], value => save(task.id,value));
      }
    }
    goToTask = practicalTaskPager(deck,pages,{index},undefined,pages.map(page => !!page.querySelector('iframe')));
    panel.hidden = false;
    panel.scrollIntoView();
  }); }
  action(async () => {
    const [{ rosters }] = await Promise.all([request('/api/rosters'), refresh('starter-codequest')]);
    classes = rosters;
    for (const roster of rosters) $('roster').add(new Option(roster.name, roster.id));
    await refreshLessons();
  });
  setInterval(() => { const lesson = selectedLesson(); if (!busy && lesson?.active && !document.hidden) { if (lesson.active.endsAt <= Date.now()) refreshLessons().catch(() => {}); else refreshDesk().catch(() => { $('submissionCount').textContent = 'Live submissions · reconnecting…'; }); } }, 5000);
})();
