(() => {
  'use strict';

  const core = window.ColonyQuestCore;
  const $ = id => document.getElementById(id);
  const gameId = location.pathname.split('/').filter(Boolean).pop();
  const localKey = `lessonscope:colonyquest:${gameId}`;
  let data = null;
  let config = null;
  let session = null;
  let matchType = 'rounds';
  let game = null;
  let scene = null;
  let colonyViews = new Map();
  let answerLocked = false;
  let pendingOutcome = null;
  let transitionLocked = false;
  let currentParticipant = null;
  let participantOffset = 0;
  let saveChain = Promise.resolve();
  let toastTimer = null;
  let clockTimer = null;
  let soundOn = true;
  let audioContext = null;
  let ambientTimer = null;
  let worldStoryAction = null;
  const ASSETS = {
    world: '/assets/colonyquest/moonroot-meadow.webp',
    worker: '/assets/colonyquest/pip-worker.webp',
    queen: '/assets/colonyquest/queen.webp',
    guardian: '/assets/colonyquest/guardian.webp',
  };
  const STORY = {
    intro: 'Last night, the Great Rain swept through Moonroot Meadow and left the old colony tunnels empty. Queen Aurelia has asked Pip and your class to guide the new colonies before moonrise. Every answer awakens a Heartseed, and every choice changes the world below.',
    chapters: [
      { at: 0, title: 'First Light', line: 'Wake the workers and gather the first seeds.' },
      { at: .3, title: 'Deep Roots', line: 'Open warm chambers beneath the ancient oak.' },
      { at: .6, title: 'Storm Watch', line: 'Prepare the nests as clouds return to the meadow.' },
      { at: .7, title: 'Moonroot Rally', line: 'Friendly knowledge challenges decide who carries the Ancient Acorn.' },
    ],
  };
  const REWARD_STORIES = {
    workers: { title: 'The foraging trail comes alive', text: 'New workers hurry from the meadow entrance to the food store, carrying fresh seeds for the colony.', site: 'entrance' },
    food: { title: 'The food store fills', text: 'The workers stack a new harvest inside the pantry so the colony can grow through the next chapter.', site: 'food' },
    defense: { title: 'The nest walls grow stronger', text: 'Guardians carry pebbles to the guard post and reinforce the tunnels before the rain returns.', site: 'guard' },
    queen: { title: 'The nursery begins to glow', text: 'The queen tends new eggs in the nursery, welcoming more ants into the colony family.', site: 'nursery' },
    expansion: { title: 'A hidden tunnel opens', text: 'Workers clear the deep roots, raise a new colony flag, and discover another chamber to explore.', site: 'expansion' },
    soldiers: { title: 'A guardian patrol forms', text: 'New guardians march between the entrance and guard post, ready to protect every worker and seed.', site: 'guard' },
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function colorHex(value) {
    return `#${Number(value || 0).toString(16).padStart(6, '0')}`;
  }

  async function request(path = '', options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(`/api/game/${encodeURIComponent(gameId)}/colonyquest${path}`, { ...options, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'ColonyQuest could not connect.');
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  function showNotice(message = '') {
    $('setupNotice').textContent = message;
  }

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 2800);
  }

  function setMatchType(type) {
    matchType = type === 'time' ? 'time' : 'rounds';
    document.querySelectorAll('#matchType button').forEach(button => button.classList.toggle('active', button.dataset.type === matchType));
    $('roundsField').classList.toggle('hidden', matchType !== 'rounds');
    $('timeField').classList.toggle('hidden', matchType !== 'time');
  }

  function currentDraftTeams() {
    return Array.from({ length: Number($('teamCount').value) || 4 }, (_, index) => {
      const existing = (config.teams || [])[index] || {};
      const input = document.querySelector(`.team-line[data-index="${index}"] input`);
      return {
        id: existing.id || `team-${index + 1}`,
        name: input ? input.value.trim() : (existing.name || `Team ${index + 1}`),
        colorIndex: index % core.TEAM_COLORS.length,
        members: existing.members || [],
      };
    });
  }

  function renderTeamEditor() {
    const teams = currentDraftTeams();
    config.teams = teams;
    $('teamEditor').innerHTML = teams.map((team, index) => `<label class="team-line" data-index="${index}"><span class="team-swatch" style="background:${colorHex(core.TEAM_COLORS[team.colorIndex].primary)}"></span><input maxlength="40" value="${esc(team.name)}" aria-label="Team ${index + 1} name"></label>`).join('');
    renderRosterAssignments();
  }

  function memberTeamMap() {
    const map = new Map();
    for (const team of config.teams || []) for (const member of team.members || []) map.set(String(member.id), team.id);
    document.querySelectorAll('#rosterAssign select[data-student-id]').forEach(select => map.set(select.dataset.studentId, select.value));
    return map;
  }

  function renderRosterAssignments() {
    const roster = data && data.roster;
    if (!roster || !roster.students.length) {
      $('rosterBlock').classList.add('hidden');
      return;
    }
    $('rosterBlock').classList.remove('hidden');
    $('rosterNote').textContent = `${roster.name} is attached. Learners are spread evenly at first; change any team below.`;
    const teams = config.teams || [];
    const prior = memberTeamMap();
    $('rosterAssign').innerHTML = roster.students.map((student, index) => {
      const assigned = prior.get(String(student.id)) || teams[index % teams.length].id;
      return `<label class="student-row"><b>${esc(student.name)}</b><select data-student-id="${esc(student.id)}" data-student-name="${esc(student.name)}" aria-label="Team for ${esc(student.name)}">${teams.map(team => `<option value="${esc(team.id)}"${team.id === assigned ? ' selected' : ''}>${esc(team.name)}</option>`).join('')}</select></label>`;
    }).join('');
  }

  function renderQuestions() {
    $('questionCount').textContent = data.game.questions.length;
    $('questionList').innerHTML = data.game.questions.map((question, index) => {
      const options = Array.from({ length: 4 }, (_, optionIndex) => (question.options || [])[optionIndex] || '');
      return `<div class="question-row" data-question-index="${index}"><span class="question-number">${index + 1}</span><input class="qtext" value="${esc(question.question)}" aria-label="Question ${index + 1}">${options.map((option, optionIndex) => `<input class="qopt" value="${esc(option)}" aria-label="Question ${index + 1} answer ${optionIndex + 1}">`).join('')}<select class="qcorrect" aria-label="Correct answer for question ${index + 1}">${options.map((_, optionIndex) => `<option value="${optionIndex}"${optionIndex === Number(question.correctIndex) ? ' selected' : ''}>${String.fromCharCode(65 + optionIndex)}</option>`).join('')}</select></div>`;
    }).join('');
  }

  function collectTeams() {
    const teams = [...document.querySelectorAll('.team-line')].map((row, index) => ({
      id: (config.teams[index] && config.teams[index].id) || `team-${index + 1}`,
      name: row.querySelector('input').value.trim() || `Team ${index + 1}`,
      colorIndex: index % core.TEAM_COLORS.length,
      members: [],
    }));
    document.querySelectorAll('#rosterAssign select[data-student-id]').forEach(select => {
      const team = teams.find(item => item.id === select.value);
      if (team) team.members.push({ id: select.dataset.studentId, name: select.dataset.studentName, turns: 0 });
    });
    return teams;
  }

  function collectQuestions() {
    return [...document.querySelectorAll('.question-row')].map((row, index) => ({
      question: row.querySelector('.qtext').value.trim(),
      options: [...row.querySelectorAll('.qopt')].map(input => input.value.trim()),
      correctIndex: Number(row.querySelector('.qcorrect').value),
      explanation: (data.game.questions[index] && data.game.questions[index].explanation) || '',
    }));
  }

  async function saveSetup() {
    const questions = collectQuestions();
    const incomplete = questions.find(question => !question.question || question.options.filter(Boolean).length < 2 || !question.options[question.correctIndex]);
    if (incomplete) throw new Error('Every question needs text, at least two answers, and a valid correct answer.');
    const setup = {
      teamCount: Number($('teamCount').value),
      matchType,
      rounds: Number($('rounds').value),
      durationMinutes: Number($('duration').value),
      sound: $('soundEnabled').checked,
      teams: collectTeams(),
      questions,
    };
    const saved = await request('', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setup) });
    config = { ...saved.colonyquest, teams: saved.colonyquest.teams || setup.teams };
    data.game.questions = saved.questions;
    soundOn = config.sound !== false;
    return config;
  }

  function saveLocal() {
    try { localStorage.setItem(localKey, JSON.stringify({ at: Date.now(), session })); } catch {}
  }

  function clearLocal() {
    try { localStorage.removeItem(localKey); } catch {}
  }

  function saveState() {
    if (!session) return Promise.resolve(false);
    saveLocal();
    const snapshot = JSON.parse(JSON.stringify(session));
    $('saveIndicator').textContent = 'Saving...';
    saveChain = saveChain.catch(() => {}).then(async () => {
      try {
        await request('/session', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: snapshot }) });
        $('saveIndicator').textContent = 'Saved';
        return true;
      } catch {
        $('saveIndicator').textContent = 'Saved on this computer';
        return false;
      }
    });
    return saveChain;
  }

  function freshestSession(serverSession) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey) || 'null'); } catch {}
    const serverAt = Date.parse(serverSession && serverSession.updatedAt || '') || 0;
    if (local && local.session && Number(local.at) > serverAt) return core.normalizeSession(local.session);
    return serverSession ? core.normalizeSession(serverSession) : null;
  }

  function renderSetup() {
    $('loading').classList.add('hidden');
    $('setup').classList.remove('hidden');
    $('lessonTitle').textContent = data.game.lessonTitle;
    $('lessonMeta').textContent = [data.game.subject, data.game.grade].filter(Boolean).join(' - ');
    $('teamCount').value = String(config.teamCount || 4);
    $('rounds').value = String(config.rounds || 5);
    $('duration').value = String(config.durationMinutes || 15);
    $('soundEnabled').checked = config.sound !== false;
    setMatchType(config.matchType);
    renderTeamEditor();
    renderQuestions();
    if (session) {
      $('resumeBar').classList.add('visible');
      $('resumeText').textContent = session.phase === 'ended' ? 'The completed class results are still available.' : `Continue from turn ${session.turnIndex + 1}.`;
      $('resumeBtn').textContent = session.phase === 'ended' ? 'View results' : 'Resume match';
      $('startBtn').disabled = session.phase !== 'ended';
    } else {
      $('resumeBar').classList.remove('visible');
      $('startBtn').disabled = false;
    }
  }

  function initialSession() {
    const teams = config.teams.map((team, index) => core.createTeam(team, index));
    const now = Date.now();
    return core.normalizeSession({
      phase: 'question',
      startedAt: new Date(now).toISOString(),
      endsAt: config.matchType === 'time' ? now + config.durationMinutes * 60_000 : null,
      turnIndex: 0,
      questionCursor: 0,
      currentTeamIndex: 0,
      introSeen: false,
      warsActive: false,
      teams,
      answers: [],
      events: [],
    });
  }

  async function startNewMatch() {
    showNotice('');
    $('startBtn').disabled = true;
    $('startBtn').textContent = 'Preparing colonies...';
    try {
      if (session) {
        await request('/session', { method: 'DELETE' });
        session = null;
        clearLocal();
      }
      await saveSetup();
      session = initialSession();
      await saveState();
      enterGame();
    } catch (error) {
      showNotice(error.message);
      $('startBtn').disabled = false;
    } finally {
      $('startBtn').textContent = 'Start ColonyQuest';
    }
  }

  function currentTeam() {
    return session && session.teams[session.currentTeamIndex];
  }

  function chooseParticipant(team, offset = 0) {
    if (!team || !team.members.length) return null;
    const minTurns = Math.min(...team.members.map(member => member.turns || 0));
    const preferred = team.members.filter(member => (member.turns || 0) === minTurns);
    return preferred[(session.turnIndex + offset) % preferred.length];
  }

  function setCurrentParticipant(member) {
    currentParticipant = member || null;
    const team = currentTeam();
    $('turnStudent').textContent = member ? `Next learner: ${member.name}` : 'Choose an answer together';
    $('studentPick').innerHTML = '<option value="">Choose learner</option>' + (team && team.members || []).map(item => `<option value="${esc(item.id)}"${member && member.id === item.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
  }

  function hideWorldStory() {
    worldStoryAction = null;
    $('worldStory').classList.add('hidden');
    $('worldStoryContinue').disabled = false;
  }

  function setOverlay(id) {
    hideWorldStory();
    for (const overlay of ['storyOverlay', 'questionOverlay', 'rewardOverlay', 'targetOverlay', 'eventOverlay', 'finalOverlay']) $(overlay).classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
    $('gameScreen').classList.toggle('dock-open', ['questionOverlay', 'rewardOverlay', 'targetOverlay'].includes(id));
  }

  function showWorldStory(details, onContinue) {
    setOverlay(null);
    transitionLocked = false;
    const tone = details.tone === 'storm' || details.tone === 'danger' ? details.tone : '';
    $('worldStory').className = `world-story${tone ? ` ${tone}` : ''}`;
    $('worldStoryArt').src = details.art || ASSETS.worker;
    $('worldStoryArt').alt = details.art === ASSETS.guardian ? 'A guardian ant' : details.art === ASSETS.queen ? 'The queen ant' : 'Pip the scout ant';
    $('worldStoryKicker').textContent = details.kicker || 'The story continues';
    $('worldStoryTitle').textContent = details.title;
    $('worldStoryText').textContent = details.text || details.description || '';
    $('worldStoryEffect').textContent = details.effect || '';
    $('worldStoryContinue').textContent = details.continueLabel || 'Continue journey';
    worldStoryAction = onContinue || null;
    $('worldStoryContinue').disabled = false;
    $('worldStory').classList.remove('hidden');
  }

  function storyChapter() {
    const progress = session ? turnProgress() : 0;
    return [...STORY.chapters].reverse().find(chapter => progress >= chapter.at) || STORY.chapters[0];
  }

  function chapterKey(chapter) {
    return `chapter-${chapter.title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
  }

  function chapterEvent(key) {
    const index = STORY.chapters.findIndex(chapter => chapterKey(chapter) === key);
    if (index < 0) return null;
    const chapter = STORY.chapters[index];
    return { title: chapter.title, description: chapter.line, kicker: `Chapter ${index + 1}`, tone: 'good' };
  }

  function showStoryIntro() {
    $('storyKicker').textContent = 'Chapter 1 - The Great Rain';
    $('storyTitle').textContent = 'Moonroot Meadow needs you';
    $('storyText').textContent = STORY.intro;
    setOverlay('storyOverlay');
  }

  function totalTurns() {
    return config.matchType === 'rounds' ? config.rounds * session.teams.length : Math.max(session.teams.length * 4, data.game.questions.length);
  }

  function turnProgress() {
    if (config.matchType === 'rounds') return Math.min(1, session.turnIndex / Math.max(1, totalTurns()));
    const duration = config.durationMinutes * 60_000;
    return Math.min(1, Math.max(0, 1 - ((session.endsAt || Date.now()) - Date.now()) / duration));
  }

  function matchFinished() {
    if (config.matchType === 'rounds') return session.turnIndex >= totalTurns();
    return !!session.endsAt && Date.now() >= session.endsAt;
  }

  function updateHUD() {
    if (!session) return;
    const team = currentTeam();
    $('scoreStrip').innerHTML = session.teams.map((item, index) => {
      const palette = core.TEAM_COLORS[item.colorIndex];
      return `<div class="score-card${index === session.currentTeamIndex && session.phase !== 'ended' ? ' current' : ''}" style="--team-color:${colorHex(palette.primary)}"><div class="score-name"><span>${esc(item.name)}</span><span>${core.colonyStrength(item)}</span></div><div class="score-stats"><span>${item.population} ants</span><span>${item.food} food</span><span>${item.defense} defense</span></div></div>`;
    }).join('');
    if (team) {
      const palette = core.TEAM_COLORS[team.colorIndex];
      $('turnBanner').style.setProperty('--team-color', colorHex(palette.primary));
      $('turnTeam').textContent = `${team.name}'s turn`;
    }
    const round = Math.floor(session.turnIndex / Math.max(1, session.teams.length)) + 1;
    $('roundLabel').textContent = config.matchType === 'rounds' ? `Round ${Math.min(round, config.rounds)} of ${config.rounds}` : timeLabel();
    const chapter = storyChapter();
    $('phaseLabel').textContent = session.warsActive ? 'Moonroot Rally' : chapter.title;
    $('pauseBtn').textContent = session.phase === 'paused' ? 'Resume' : 'Pause';
    $('pauseBtn').classList.toggle('active', session.phase === 'paused');
    $('muteBtn').textContent = soundOn ? 'Sound on' : 'Sound off';
    $('muteBtn').classList.toggle('active', !soundOn);
  }

  function timeLabel() {
    if (config.matchType !== 'time' || !session || !session.endsAt) return '';
    const now = session.phase === 'paused' && session.pausedAt ? session.pausedAt : Date.now();
    const seconds = Math.max(0, Math.ceil((session.endsAt - now) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left`;
  }

  function questionAtCursor() {
    return data.game.questions[session.questionCursor % data.game.questions.length];
  }

  function presentQuestion() {
    if (session.phase === 'paused' || session.phase === 'ended') return;
    answerLocked = false;
    transitionLocked = false;
    pendingOutcome = null;
    participantOffset = 0;
    const team = currentTeam();
    setCurrentParticipant(chooseParticipant(team));
    const question = questionAtCursor();
    $('questionKicker').textContent = `${team.name} - ${currentParticipant ? currentParticipant.name : 'team answer'}`;
    $('guideLine').textContent = `${storyChapter().line} Pip found a Heartseed for this turn.`;
    $('questionText').textContent = question.question;
    $('questionProgress').textContent = `Question ${(session.questionCursor % data.game.questions.length) + 1} of ${data.game.questions.length}`;
    $('answers').innerHTML = question.options.map((option, index) => `<button type="button" class="answer" data-choice="${index}"><span>${String.fromCharCode(65 + index)}.</span> ${esc(option)}</button>`).join('');
    $('feedback').className = 'feedback';
    $('feedbackNext').textContent = 'Continue';
    setOverlay('questionOverlay');
    updateHUD();
    updateWorld();
  }

  function handleOutcome(choice, correct, teacherJudged = false) {
    if (answerLocked || session.phase !== 'question') return;
    answerLocked = true;
    const question = questionAtCursor();
    pendingOutcome = {
      choice,
      correct,
      teacherJudged,
      studentId: currentParticipant && currentParticipant.id,
      studentName: currentParticipant && currentParticipant.name,
    };
    document.querySelectorAll('.answer').forEach(button => {
      const index = Number(button.dataset.choice);
      button.disabled = true;
      if (index === question.correctIndex) button.classList.add('correct');
      if (choice === index && !correct) button.classList.add('wrong');
    });
    $('feedback').className = `feedback visible${correct ? '' : ' wrong'}`;
    $('feedbackText').textContent = correct ? 'Correct! The Heartseed is awake. Your colony earned a new upgrade.' : `Try again next time. The Heartseed is still dim, but Pip found the answer: ${question.options[question.correctIndex]}.`;
    $('feedbackNext').textContent = correct ? 'Shape the colony' : 'Continue the journey';
    playTone(correct ? 'correct' : 'wrong');
  }

  async function commitOutcome() {
    if (!pendingOutcome || transitionLocked) return;
    transitionLocked = true;
    const outcome = pendingOutcome;
    pendingOutcome = null;
    const team = currentTeam();
    team.attempts += 1;
    if (outcome.correct) team.correct += 1;
    if (outcome.studentId) {
      const member = team.members.find(item => item.id === outcome.studentId);
      if (member) member.turns = (member.turns || 0) + 1;
    }
    session.answers.push({
      questionIndex: session.questionCursor % data.game.questions.length,
      teamId: team.id,
      studentId: outcome.studentId,
      studentName: outcome.studentName,
      correct: outcome.correct,
      choice: outcome.choice,
      teacherJudged: outcome.teacherJudged,
      at: new Date().toISOString(),
    });
    if (outcome.correct) {
      session.phase = 'reward';
      await saveState();
      showRewards();
    } else {
      await nextTurn();
    }
  }

  function rewardChoices() {
    const base = ['workers', 'food', 'defense', 'queen', 'expansion', 'soldiers'];
    const start = session.turnIndex % base.length;
    const choices = [base[start], base[(start + 2) % base.length], base[(start + 4) % base.length]];
    if (session.warsActive) choices[2] = 'raid';
    return choices;
  }

  function rewardChange(key, before, after) {
    if (key === 'workers') return { amount: after.workers - before.workers, secondary: after.food - before.food };
    if (key === 'food') return { amount: after.food - before.food, secondary: 0 };
    if (key === 'defense') return { amount: after.defense - before.defense, secondary: after.nestLevel - before.nestLevel };
    if (key === 'queen') return { amount: after.population - before.population, secondary: after.workers - before.workers };
    if (key === 'expansion') return { amount: after.food - before.food, secondary: after.nestLevel - before.nestLevel };
    if (key === 'soldiers') return { amount: after.soldiers - before.soldiers, secondary: Math.max(0, before.food - after.food) };
    return { amount: 0, secondary: 0 };
  }

  function rewardEffectText(key, change, team) {
    const amount = Math.max(0, Number(change && change.amount) || 0);
    const secondary = Math.max(0, Number(change && change.secondary) || 0);
    if (key === 'workers') return `+${amount} workers, +${amount} ants, and +${secondary} food - ${team.workers} workers now`;
    if (key === 'food') return `+${amount} food - ${team.food} stored in the pantry`;
    if (key === 'defense') return `+${amount} defense${secondary ? ` and +${secondary} nest level` : ''} - defense is now ${team.defense}`;
    if (key === 'queen') return `Queen level ${team.queenLevel} - +${amount} ants and +${secondary} ${secondary === 1 ? 'worker' : 'workers'}`;
    if (key === 'expansion') return `+1 territory and +${amount} food${secondary ? ` - nest level ${team.nestLevel}` : ''}`;
    if (key === 'soldiers') return `+${amount} guardians and -${secondary} food - ${team.soldiers} guardians now`;
    return '';
  }

  function previewReward(key) {
    const team = currentTeam();
    const clones = session.teams.map(item => ({ ...item, members: (item.members || []).map(member => ({ ...member })) }));
    const preview = clones.find(item => item.id === team.id);
    const before = { ...preview };
    core.applyReward(preview, key, clones);
    return rewardEffectText(key, rewardChange(key, before, preview), preview);
  }

  function showRewardStory(event, onContinue = nextTurn) {
    const key = String(event && event.key || '').replace(/^upgrade-/, '');
    const team = session.teams.find(item => item.id === (event && event.teamId)) || currentTeam();
    const story = REWARD_STORIES[key] || { title: 'The colony grows', text: 'The ants put their new reward to work inside the nest.', site: 'center' };
    const art = key === 'queen' ? ASSETS.queen : ['defense', 'soldiers'].includes(key) ? ASSETS.guardian : ASSETS.worker;
    showWorldStory({
      kicker: `A correct answer changes ${team.name}`,
      title: story.title,
      text: story.text,
      effect: rewardEffectText(key, event, team),
      art,
    }, onContinue);
    celebrate(team.id, key, rewardEffectText(key, event, team));
  }

  function showRewards() {
    transitionLocked = false;
    const team = currentTeam();
    $('rewardTitle').textContent = `${team.name}: choose your colony reward`;
    $('rewardGrid').innerHTML = rewardChoices().map(key => {
      const reward = core.REWARDS[key];
      const art = key === 'queen' ? ASSETS.queen : ['defense', 'soldiers', 'raid'].includes(key) ? ASSETS.guardian : ASSETS.worker;
      return `<button type="button" class="reward" data-reward="${key}"><span class="reward-symbol"><img src="${art}" alt=""></span><strong>${esc(reward.label)}</strong><span>${esc(reward.description)}</span><span class="reward-effect">${esc(previewReward(key))}</span></button>`;
    }).join('');
    setOverlay('rewardOverlay');
    updateWorld();
  }

  async function chooseReward(key) {
    if (session.phase !== 'reward' || transitionLocked) return;
    transitionLocked = true;
    if (key === 'raid') {
      const team = currentTeam();
      $('targetGrid').innerHTML = session.teams.filter(item => item.id !== team.id).map(item => `<button type="button" data-target="${esc(item.id)}">Challenge ${esc(item.name)}</button>`).join('');
      setOverlay('targetOverlay');
      updateWorld();
      transitionLocked = false;
      return;
    }
    const team = currentTeam();
    const before = { ...team };
    core.applyReward(team, key, session.teams);
    const change = rewardChange(key, before, team);
    const upgradeEvent = `upgrade-${key}`;
    session.phase = 'event';
    session.eventAction = 'next-turn';
    const event = { key: upgradeEvent, teamId: team.id, amount: change.amount, secondary: change.secondary, at: new Date().toISOString() };
    session.events.push(event);
    setOverlay(null);
    updateWorld();
    playTone('upgrade');
    updateHUD();
    await saveState();
    transitionLocked = false;
    showRewardStory(event);
  }

  async function chooseRaid(targetId) {
    if (session.phase !== 'reward' || transitionLocked) return;
    transitionLocked = true;
    const attacker = currentTeam();
    const defender = session.teams.find(team => team.id === targetId);
    if (!defender) return;
    const result = core.resolveRaid(attacker, defender, session.teams);
    session.phase = 'event';
    session.eventAction = 'next-turn';
    session.events.push({ key: 'raid-result', at: new Date().toISOString() });
    setOverlay(null);
    updateWorld();
    celebrate(result.success ? attacker.id : defender.id, result.success ? 'raid' : 'defense');
    playTone(result.success ? 'upgrade' : 'wrong');
    showEvent({
      title: result.success ? `${attacker.name} completes the raid` : `${defender.name} holds the line`,
      description: result.success ? `${attacker.name} carries ${result.stolen} food home. No colony is eliminated.` : `${defender.name}'s defenses protect the colony and earn extra food.`,
      kicker: 'Colony Wars',
    }, nextTurn);
    updateHUD();
    await saveState();
  }

  function eventForTurn() {
    return core.EVENTS[Math.floor(session.turnIndex / Math.max(1, session.teams.length * 2)) % core.EVENTS.length];
  }

  function shouldStartWars() {
    return !session.warsActive && turnProgress() >= 0.7;
  }

  function shouldShowEvent() {
    return session.turnIndex > 0 && session.turnIndex % (session.teams.length * 2) === 0 && !matchFinished();
  }

  async function nextTurn() {
    const previousChapter = storyChapter();
    setOverlay(null);
    session.eventAction = null;
    session.turnIndex += 1;
    session.questionCursor += 1;
    if (session.turnIndex % session.teams.length === 0) core.applyUpkeep(session.teams);
    if (matchFinished()) {
      await finishMatch();
      return;
    }
    session.currentTeamIndex = session.turnIndex % session.teams.length;
    if (shouldStartWars()) {
      session.warsActive = true;
      session.phase = 'event';
      session.eventAction = 'question';
      session.events.push({ key: 'colony-wars', at: new Date().toISOString() });
      updateWorld();
      await saveState();
      showEvent({ title: 'The Moonroot Rally begins', description: 'The moon is rising. Colonies may now enter friendly knowledge challenges to win food and earn the Ancient Acorn. Every colony stays in the adventure.', kicker: 'Chapter 4' }, continueAfterEvent);
      playTone('wars');
      return;
    }
    const nextChapter = storyChapter();
    if (nextChapter.title !== previousChapter.title) {
      const chapter = chapterEvent(chapterKey(nextChapter));
      session.phase = 'event';
      session.eventAction = 'question';
      session.events.push({ key: chapterKey(nextChapter), at: new Date().toISOString() });
      updateWorld();
      await saveState();
      showEvent(chapter, continueAfterEvent);
      playTone('upgrade');
      return;
    }
    if (shouldShowEvent()) {
      const event = eventForTurn();
      core.applyEvent(session.teams, event.key);
      session.events.push({ key: event.key, at: new Date().toISOString() });
      session.phase = 'event';
      session.eventAction = 'question';
      updateWorld();
      playWorldEvent(event.key);
      await saveState();
      showEvent(event, continueAfterEvent);
      return;
    }
    session.phase = 'question';
    updateWorld();
    await saveState();
    presentQuestion();
  }

  async function continueAfterEvent() {
    session.phase = 'question';
    session.eventAction = null;
    updateWorld();
    await saveState();
    presentQuestion();
  }

  function worldEventEffect(event) {
    if (event.key === 'fallen-fruit') return 'Watch workers carry the orchard gift into every pantry.';
    if (event.key === 'heavy-rain') return 'Stronger walls protect more food while the rain crosses the meadow.';
    if (event.key === 'food-trail') return 'More workers mean a larger harvest from Pip\'s golden trail.';
    if (event.key === 'predator') return 'Guardians and strong walls keep more of the colony stores safe.';
    if (event.key === 'new-territory') return 'A new chamber and flag appear for the colonies that need room most.';
    if (event.kicker === 'Chapter 4') return 'The final knowledge challenges are now unlocked.';
    if (String(event.kicker || '').startsWith('Chapter')) return 'Look at how far every colony has grown.';
    return '';
  }

  function showEvent(event, onContinue) {
    const guardianMoment = event.tone === 'danger' || event.tone === 'storm' || event.kicker === 'Colony Wars';
    showWorldStory({
      kicker: event.kicker || 'A Moonroot Meadow event',
      title: event.title,
      text: event.description,
      effect: worldEventEffect(event),
      tone: event.tone,
      art: guardianMoment ? ASSETS.guardian : ASSETS.worker,
    }, onContinue);
  }

  async function finishMatch() {
    if (!session || session.phase === 'ended') {
      showFinal();
      return;
    }
    session.phase = 'ended';
    session.endedAt = new Date().toISOString();
    setOverlay(null);
    updateHUD();
    await saveState();
    playTone('victory');
    showFinal();
  }

  function bestTeamBy(key) {
    return [...session.teams].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))[0];
  }

  function showFinal() {
    const ranking = core.rankTeams(session.teams);
    $('podium').innerHTML = ranking.map((entry, index) => {
      const growth = entry.breakdown.population + entry.breakdown.economy + entry.breakdown.queen + entry.breakdown.nest;
      const protection = entry.breakdown.defense + entry.breakdown.military + entry.breakdown.colonyWars;
      return `<div class="podium-place${index === 0 ? ' first' : ''}" style="--team-color:${colorHex(core.TEAM_COLORS[entry.team.colorIndex].primary)}"><b>${index + 1}. ${esc(entry.team.name)}</b><span>${entry.score} strength - ${entry.team.attempts ? Math.round(entry.team.correct / entry.team.attempts * 100) : 0}% accuracy</span><small>Knowledge ${entry.breakdown.knowledge} · Growth ${growth} · Resources ${entry.breakdown.resources + entry.breakdown.territory} · Protection ${protection}</small></div>`;
    }).join('');
    const knowledge = [...session.teams].sort((a, b) => (b.attempts ? b.correct / b.attempts : 0) - (a.attempts ? a.correct / a.attempts : 0) || b.correct - a.correct)[0];
    const awards = [
      ['Knowledge champions', knowledge],
      ['Best defense', bestTeamBy('defense')],
      ['Fastest growth', bestTeamBy('population')],
      ['Most resources', bestTeamBy('food')],
    ];
    $('awards').innerHTML = awards.map(([label, team]) => `<div class="award"><b>${label}</b><span>${esc(team.name)}</span></div>`).join('');
    setOverlay('finalOverlay');
  }

  function resumePhase() {
    if (session.phase === 'ended') return showFinal();
    if (session.phase === 'reward') return showRewards();
    if (session.phase === 'event') {
      const last = session.events[session.events.length - 1];
      if (last && String(last.key).startsWith('upgrade-')) return showRewardStory(last, nextTurn);
      const event = last && last.key === 'colony-wars'
        ? { title: 'The Moonroot Rally begins', description: 'The moon is rising. Colonies may now enter friendly knowledge challenges to win food and earn the Ancient Acorn. Every colony stays in the adventure.', kicker: 'Chapter 4' }
        : chapterEvent(last && last.key) || core.EVENTS.find(item => item.key === (last && last.key));
      const next = session.eventAction === 'next-turn' ? nextTurn : continueAfterEvent;
      return showEvent(event || { title: 'Colony event', description: 'The colonies have adapted. Continue when the class is ready.' }, next);
    }
    if (session.phase === 'paused') return showPaused();
    session.phase = 'question';
    if (!session.introSeen && session.turnIndex === 0 && !session.answers.length) return showStoryIntro();
    presentQuestion();
  }

  function showPaused() {
    $('eventKicker').textContent = 'Teacher pause';
    $('eventTitle').textContent = 'The colonies are resting';
    $('eventText').textContent = 'The timer and all turns are paused for the whole class.';
    $('eventGuide').src = ASSETS.queen;
    $('eventGuide').alt = 'The queen ant';
    $('eventMark').textContent = 'The meadow waits';
    $('eventContinue').classList.add('hidden');
    setOverlay('eventOverlay');
  }

  async function togglePause() {
    if (!session || session.phase === 'ended') return;
    if (session.phase === 'paused') {
      const pauseLength = Math.max(0, Date.now() - (session.pausedAt || Date.now()));
      if (session.endsAt) session.endsAt += pauseLength;
      session.phase = session.previousPhase || 'question';
      session.previousPhase = null;
      session.pausedAt = null;
      startAmbient();
      await saveState();
      updateHUD();
      resumePhase();
      return;
    }
    session.previousPhase = session.phase;
    session.phase = 'paused';
    session.pausedAt = Date.now();
    stopAmbient();
    await saveState();
    updateHUD();
    showPaused();
  }

  function skipQuestion() {
    if (!session || session.phase !== 'question' || transitionLocked) return;
    transitionLocked = true;
    answerLocked = true;
    pendingOutcome = null;
    nextTurn().catch(error => toast(error.message));
  }

  function enterGame() {
    $('setup').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');
    $('gameLessonTitle').textContent = data.game.lessonTitle;
    soundOn = config.sound !== false;
    initAudio();
    createRenderer();
    updateHUD();
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      updateHUD();
      if (session && session.phase !== 'paused' && session.phase !== 'ended' && config.matchType === 'time' && matchFinished()) finishMatch().catch(() => {});
    }, 500);
    resumePhase();
  }

  function leaveGameForSetup() {
    clearInterval(clockTimer);
    clockTimer = null;
    setOverlay(null);
    $('teacherTray').classList.remove('open');
    $('teacherHandle').classList.remove('hidden');
    $('gameScreen').classList.add('hidden');
    $('setup').classList.remove('hidden');
    stopAmbient();
    renderSetup();
  }

  function createRenderer() {
    if (game) {
      updateWorld();
      return;
    }
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'gameMount',
      width: Math.max(640, $('gameMount').clientWidth),
      height: Math.max(420, $('gameMount').clientHeight),
      backgroundColor: '#86c8af',
      render: { antialias: true, roundPixels: false },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: {
        preload() {
          this.load.image('cq-world', ASSETS.world);
          this.load.image('cq-worker', ASSETS.worker);
          this.load.image('cq-queen', ASSETS.queen);
          this.load.image('cq-guardian', ASSETS.guardian);
        },
        create() {
          scene = this;
          this.scale.on('resize', updateWorld);
          updateWorld();
        },
      },
    });
  }

  function ellipse(graphics, x, y, width, height, color, alpha = 1) {
    graphics.fillStyle(color, alpha);
    graphics.fillEllipse(x, y, width, height);
  }

  function fitWorldImage(key, width, height) {
    const image = scene.add.image(width / 2, height / 2, key).setDepth(-30);
    const scale = Math.max(width / Math.max(1, image.width), height / Math.max(1, image.height));
    image.setScale(scale);
    return image;
  }

  function makeAntAgent(texture, point, width, teamColor, carriesFood = false) {
    const container = scene.add.container(point.x, point.y).setDepth(5);
    const shadow = scene.add.ellipse(0, width * .19, width * .62, width * .13, 0x180f0a, .3);
    const sprite = scene.add.image(0, 0, texture);
    sprite.setDisplaySize(width, width * .67);
    const legs = scene.add.graphics();
    const gait = { phase: 0 };
    const paintLegs = () => {
      legs.clear().lineStyle(Math.max(1.4, width * .025), 0x59301b, 1);
      for (let side = -1; side <= 1; side += 2) {
        for (let leg = 0; leg < 3; leg += 1) {
          const x = (leg - 1) * width * .12;
          const step = Math.sin(gait.phase + leg * 2.1 + side) * width * .055;
          legs.beginPath().moveTo(x, width * .06);
          legs.lineTo(x + side * width * .09, width * .19);
          legs.lineTo(x + side * width * .15 + step, width * .3);
          legs.strokePath();
        }
      }
    };
    const badge = scene.add.circle(-width * .17, -width * .11, Math.max(2, width * .045), teamColor, .95);
    const cargo = scene.add.ellipse(-width * .04, -width * .24, width * .24, width * .11, 0x7cbd4d, 1).setAngle(-16).setVisible(false);
    container.add([shadow, legs, sprite, badge, cargo]);
    container.sprite = sprite;
    container.cargo = cargo;
    container.carriesFood = carriesFood;
    paintLegs();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scene.tweens.add({ targets: gait, phase: Math.PI * 2, duration: 430, repeat: -1, onUpdate: paintLegs });
    }
    const baseY = sprite.y;
    scene.tweens.add({ targets: sprite, y: baseY - Math.max(1, width * .025), duration: 170 + Math.random() * 80, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return container;
  }

  function animateAnt(agent, points, index = 0) {
    if (!points.length) return;
    let cursor = index % points.length;
    agent.x = points[cursor].x;
    agent.y = points[cursor].y;
    const travel = () => {
      if (!scene || !agent.active) return;
      cursor = (cursor + 1) % points.length;
      const next = points[cursor];
      const dx = next.x - agent.x;
      const dy = next.y - agent.y;
      agent.sprite.setFlipX(dx < 0);
      agent.sprite.setAngle(Phaser.Math.Clamp(Math.atan2(dy, Math.max(8, Math.abs(dx))) * 18, -10, 10));
      const distance = Math.hypot(dx, dy);
      const curve = tunnelCurve({ x: agent.x, y: agent.y }, next);
      const progress = { value: 0 };
      scene.tweens.add({
        targets: progress,
        value: 1,
        onUpdate: () => {
          if (!agent.active) return;
          const point = curve.getPoint(progress.value);
          agent.setPosition(point.x, point.y);
        },
        duration: Math.max(650, distance * (13 + index % 4)),
        ease: 'Sine.easeInOut',
        onComplete: () => {
          if (!agent.active) return;
          if (agent.carriesFood && cursor === Math.floor(points.length / 2)) agent.cargo.setVisible(true);
          if (agent.carriesFood && cursor === 0) {
            agent.cargo.setVisible(false);
            const delivery = scene.add.ellipse(agent.x, agent.y - 6, 8, 5, 0x9bd568, 1).setDepth(6);
            scene.tweens.add({ targets: delivery, y: agent.y + 7, alpha: 0, duration: 650, onComplete: () => delivery.destroy() });
          }
          scene.time.delayedCall(100 + (index % 3) * 90, travel);
        },
      });
    };
    scene.time.delayedCall(160 + index * 120, travel);
  }

  function tunnelCurve(a, b) {
    const bend = Math.sign(b.y - a.y) * Math.min(28, Math.abs(b.y - a.y) * .18);
    return new Phaser.Curves.CubicBezier(
      new Phaser.Math.Vector2(a.x, a.y),
      new Phaser.Math.Vector2(a.x + bend, a.y + (b.y - a.y) * .4),
      new Phaser.Math.Vector2(b.x - bend, b.y - (b.y - a.y) * .35),
      new Phaser.Math.Vector2(b.x, b.y));
  }

  function drawTunnel(graphics, points, width) {
    const curved = [];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1], b = points[index];
      const curve = tunnelCurve(a, b);
      curved.push(...curve.getPoints(18));
    }
    const stroke = (lineWidth, color, alpha) => {
      graphics.lineStyle(lineWidth, color, alpha);
      graphics.beginPath();
      graphics.moveTo(curved[0].x, curved[0].y);
      for (const point of curved.slice(1)) graphics.lineTo(point.x, point.y);
      graphics.strokePath();
    };
    stroke(width + 18, 0x432817, .9);
    stroke(width + 10, 0xb38352, .9);
    stroke(width + 3, 0x291d19, 1);
    stroke(width, 0x493629, 1);
  }

  function drawChamber(graphics, x, y, width, height, palette, active = false) {
    ellipse(graphics, x, y + 5, width + 20, height + 18, 0x201a17, .72);
    ellipse(graphics, x, y, width + 12, height + 12, 0xb68a57, 1);
    ellipse(graphics, x, y, width, height, 0x332a24, 1);
    ellipse(graphics, x, y + height * .12, width * .88, height * .64, 0x65513a, 1);
    for (let index = 0; index < 14; index += 1) {
      const angle = index * Math.PI * 2 / 14;
      ellipse(graphics, x + Math.cos(angle) * (width * .5 + 2), y + Math.sin(angle) * (height * .5 + 2), 7, 4, index % 2 ? 0xd5b47e : 0x96734c, .85);
    }
    graphics.lineStyle(active ? 2 : 1, active ? palette.light : 0xe2c38c, active ? .8 : .3);
    graphics.strokeEllipse(x, y, width, height);
  }

  function chamberTag(x, y, label, zoneWidth) {
    return scene.add.text(x, y, label, {
      fontFamily: 'Arial',
      fontSize: zoneWidth < 250 ? '9px' : '11px',
      fontStyle: 'bold',
      color: '#fff1c9',
      backgroundColor: '#213f35',
      padding: { x: 7, y: 4 },
    }).setOrigin(.5, 1).setDepth(7);
  }

  function addAmbientLife(width, height) {
    for (let index = 0; index < 18; index += 1) {
      const mote = scene.add.circle((index * 97 + 31) % width, 20 + (index * 37) % Math.max(35, height * .22), 1.5 + index % 3, index % 3 ? 0xffe797 : 0xc4f2b0, .34).setDepth(-5);
      scene.tweens.add({ targets: mote, y: mote.y - 12 - index % 10, x: mote.x + (index % 2 ? 7 : -7), alpha: .85, duration: 1700 + index * 80, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    for (let index = 0; index < 24; index += 1) {
      const dust = scene.add.circle((index * 131 + 47) % width, height * .34 + (index * 61) % Math.max(30, height * .62), 1 + index % 2, 0xffce78, .16).setDepth(-4);
      scene.tweens.add({ targets: dust, y: dust.y - 8, alpha: .42, duration: 2400 + index * 65, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  function drawColony(team, zone, teamIndex) {
    const palette = core.TEAM_COLORS[team.colorIndex];
    const graphics = scene.add.graphics().setDepth(0);
    const cx = zone.x + zone.w * .5;
    const entrance = { x: cx, y: zone.y + zone.h * .2 };
    const junction = { x: cx, y: zone.y + zone.h * .43 };
    const food = { x: zone.x + zone.w * .25, y: zone.y + zone.h * .55 };
    const guard = { x: zone.x + zone.w * .75, y: zone.y + zone.h * .54 };
    const nursery = { x: cx, y: zone.y + zone.h * .77 };
    const active = teamIndex === session.currentTeamIndex && session.phase !== 'ended';
    const chamberW = Phaser.Math.Clamp(zone.w * .32 + team.nestLevel * 3, 64, 180);
    const chamberH = Phaser.Math.Clamp(zone.h * .19 + team.nestLevel * 2, 40, 96);

    drawTunnel(graphics, [entrance, junction, nursery], 9 + Math.min(6, team.nestLevel));
    drawTunnel(graphics, [junction, food], 8 + Math.min(5, team.nestLevel));
    drawTunnel(graphics, [junction, guard], 8 + Math.min(5, team.nestLevel));
    graphics.fillStyle(0x2a160e, .95);
    graphics.fillEllipse(entrance.x, entrance.y, 40 + team.nestLevel * 4, 17);

    drawChamber(graphics, food.x, food.y, chamberW, chamberH, palette);
    drawChamber(graphics, guard.x, guard.y, chamberW + team.defense * 3, chamberH + team.defense * 2, palette, team.defense > 2);
    drawChamber(graphics, nursery.x, nursery.y, chamberW + 24 + team.queenLevel * 4, chamberH + 14 + team.queenLevel * 2, palette, active);

    // Furnishings make each chamber's job visible before its numbers change.
    for (let index = 0; index < 7; index += 1) {
      const leafX = nursery.x + (index - 3) * chamberW * .095;
      const leafY = nursery.y + chamberH * .24 + Math.sin(index * 1.8) * 4;
      ellipse(graphics, leafX, leafY, chamberW * .19, 12, index % 2 ? 0x789850 : 0x4b783e, 1);
      graphics.lineStyle(1, 0xb1c77d, .6);
      graphics.lineBetween(leafX - chamberW * .06, leafY, leafX + chamberW * .06, leafY - 2);
    }
    const barrierY = guard.y + chamberH * .22;
    const barrierW = chamberW * .58;
    for (let index = 0; index < 5; index += 1) {
      const x = guard.x - barrierW / 2 + index * barrierW / 4;
      graphics.lineStyle(6, 0x36221a, 1);
      graphics.lineBetween(x, barrierY + 9, x + 3, barrierY - 13);
      graphics.lineStyle(3, 0xc5935e, 1);
      graphics.lineBetween(x - 1, barrierY + 8, x + 2, barrierY - 13);
    }
    graphics.lineStyle(4, 0x97734d, 1);
    graphics.lineBetween(guard.x - barrierW / 2 - 4, barrierY, guard.x + barrierW / 2 + 5, barrierY);
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const shelfY = food.y + 3 + shelf * 17;
      graphics.lineStyle(5, 0x352419, 1);
      graphics.lineBetween(food.x - chamberW * .33, shelfY, food.x + chamberW * .33, shelfY);
      graphics.lineStyle(2, 0xc6a471, 1);
      graphics.lineBetween(food.x - chamberW * .33, shelfY - 2, food.x + chamberW * .33, shelfY - 2);
    }
    for (const site of [food, nursery]) {
      const lampX = site.x + chamberW * .35, lampY = site.y - chamberH * .16;
      ellipse(graphics, lampX, lampY, 23, 23, 0xeab854, .08);
      ellipse(graphics, lampX, lampY, 14, 14, 0xf2c366, .16);
      ellipse(graphics, lampX, lampY, 5, 7, 0xffe0a0, .95);
    }

    let expansion = null;
    if (team.territory > 1) {
      expansion = { x: zone.x + zone.w * (teamIndex % 2 ? .84 : .16), y: zone.y + zone.h * .87 };
      drawTunnel(graphics, [teamIndex % 2 ? guard : food, expansion], 7 + Math.min(4, team.nestLevel));
      drawChamber(graphics, expansion.x, expansion.y, Phaser.Math.Clamp(38 + team.territory * 8, 46, 92), Phaser.Math.Clamp(25 + team.territory * 4, 30, 55), palette);
    }

    chamberTag(food.x, food.y - chamberH * .48, `PANTRY  ${team.food}`, zone.w);
    chamberTag(guard.x, guard.y - chamberH * .48, `GUARD POST  ${team.defense}`, zone.w);
    chamberTag(nursery.x, nursery.y - (chamberH + 14) * .48, `NURSERY  QUEEN ${team.queenLevel}`, zone.w);
    if (expansion) chamberTag(expansion.x, expansion.y - 19, `NEW CHAMBER  ${team.territory}`, zone.w);

    const foodDots = Math.min(24, Math.max(3, Math.round(team.food / 3)));
    for (let index = 0; index < foodDots; index += 1) {
      const column = index % 6;
      const row = Math.floor(index / 6);
      const color = index % 3 === 0 ? 0xd85f42 : index % 2 ? 0xe9b84a : 0x78ad45;
      const seedX = food.x - chamberW * .28 + column * chamberW * .09;
      const seedY = food.y - 3 + (row % 2) * 17 - Math.floor(row / 2) * 5;
      ellipse(graphics, seedX, seedY + 2, 10, 6, 0x211b14, .5);
      ellipse(graphics, seedX, seedY, 9, 6, color, .98);
      ellipse(graphics, seedX - 1, seedY - 1, 3, 2, 0xffedb5, .65);
    }

    const eggCount = Math.min(12, 3 + team.queenLevel * 2);
    for (let index = 0; index < eggCount; index += 1) {
      ellipse(graphics, nursery.x - 24 + (index % 6) * 9, nursery.y + chamberH * .25 + Math.floor(index / 6) * 6, 8, 5, index % 3 ? 0xfff1cb : 0xd8f3df, .98);
    }

    for (let index = 0; index < Math.min(14, team.defense * 3); index += 1) {
      const angle = Math.PI * 2 * index / Math.max(3, Math.min(14, team.defense * 3));
      ellipse(graphics, guard.x + Math.cos(angle) * (chamberW * .47), guard.y + Math.sin(angle) * (chamberH * .45), 7, 5, index % 2 ? 0xa98a67 : 0x6f745e, .9);
    }

    const plaqueWidth = Phaser.Math.Clamp(zone.w * .48, 120, 210);
    graphics.fillStyle(0x35251a, .92);
    graphics.fillRoundedRect(zone.x + 8, zone.y + 7, plaqueWidth, 39, 5);
    graphics.lineStyle(2, palette.primary, .95);
    graphics.strokeRoundedRect(zone.x + 8, zone.y + 7, plaqueWidth, 39, 5);
    const labelSize = zone.w < 250 ? 11 : 14;
    scene.add.text(zone.x + 18, zone.y + 12, team.name, { fontFamily: 'Georgia', fontSize: `${labelSize}px`, fontStyle: 'bold', color: '#fff0c9' }).setDepth(8);
    scene.add.text(zone.x + 18, zone.y + 28, `Nest ${team.nestLevel}  |  ${team.population} ants`, { fontFamily: 'Arial', fontSize: zone.w < 250 ? '8px' : '10px', color: '#d9dfc9' }).setDepth(8);

    for (let flag = 0; flag < Math.min(4, team.territory); flag += 1) {
      const fx = zone.x + zone.w - 17 - flag * 14;
      const fy = zone.y + 43;
      graphics.lineStyle(2, 0xf8e5b5, .9);
      graphics.lineBetween(fx, fy, fx, fy - 25);
      graphics.fillStyle(palette.primary, 1);
      graphics.fillTriangle(fx, fy - 25, fx, fy - 13, fx - 11, fy - 20);
    }

    const queenWidth = Math.min(62 + team.queenLevel * 4, zone.w * .25, chamberW * .63);
    const queen = makeAntAgent('cq-queen', { x: nursery.x - 6, y: nursery.y - 9 }, queenWidth, palette.primary);
    queen.setDepth(4);
    queen.sprite.setFlipX(teamIndex % 2 === 1);
    const queenScaleX = queen.sprite.scaleX;
    const queenScaleY = queen.sprite.scaleY;
    scene.tweens.add({ targets: queen.sprite, scaleX: queenScaleX * 1.025, scaleY: queenScaleY * 1.025, duration: 1050, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const antWidth = Phaser.Math.Clamp(Math.min(zone.w / 9, zone.h / 7), 23, 44);
    const workerCount = Math.min(10, Math.max(4, Math.ceil(team.workers / 2)));
    const workerPaths = [
      [food, junction, entrance, { x: zone.x + zone.w * .18, y: zone.y + zone.h * .13 }, entrance, junction],
      [nursery, junction, food, { x: food.x + chamberW * .22, y: food.y - 4 }, junction],
      [food, junction, entrance, { x: zone.x + zone.w * .82, y: zone.y + zone.h * .14 }, entrance, junction],
      [nursery, junction, food, junction],
    ];
    const ants = [];
    for (let index = 0; index < workerCount; index += 1) {
      const path = workerPaths[index % workerPaths.length].map(point => ({ x: point.x + (index % 3 - 1) * 5, y: point.y + (index % 2 ? 3 : -3) }));
      const ant = makeAntAgent('cq-worker', path[0], antWidth * (index % 4 === 0 ? 1.08 : .9), palette.primary, index % 2 === 0);
      ants.push(ant);
      animateAnt(ant, path, index);
    }

    const guardianCount = Math.min(3, Math.max(1, Math.ceil(team.soldiers / 4)));
    for (let index = 0; index < guardianCount; index += 1) {
      const path = [
        { x: guard.x - chamberW * .18, y: guard.y },
        { x: guard.x + chamberW * .2, y: guard.y - 4 },
        { x: junction.x + 8, y: junction.y + index * 4 },
      ];
      const guardian = makeAntAgent('cq-guardian', path[0], antWidth * 1.04, palette.primary);
      ants.push(guardian);
      animateAnt(guardian, path, index + 8);
    }

    if (active) {
      const glow = scene.add.ellipse(entrance.x, entrance.y, 54, 24, palette.light, .18).setDepth(2).setStrokeStyle(2, palette.light, .8);
      scene.tweens.add({ targets: glow, scaleX: 1.3, scaleY: 1.3, alpha: .04, duration: 850, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    colonyViews.set(team.id, {
      zone,
      graphics,
      ants,
      queen,
      center: { x: cx, y: zone.y + zone.h * .62 },
      sites: { entrance, food, guard, nursery, expansion: expansion || junction, center: junction },
    });
  }

  function updateWorld() {
    if (!scene || !session) return;
    scene.tweens.killAll();
    scene.children.removeAll(true);
    colonyViews = new Map();
    const width = scene.scale.width;
    const height = scene.scale.height;
    fitWorldImage('cq-world', width, height);
    if (session.warsActive) scene.add.rectangle(width / 2, height / 2, width, height, 0x1d2944, .18).setDepth(-20);
    addAmbientLife(width, height);

    const docked = width > 850 && $('gameScreen').classList.contains('dock-open');
    const layoutWidth = docked ? width - Math.min(620, width * .44) : width;
    const count = session.teams.length;
    const columns = layoutWidth < 700 ? (count <= 2 ? 1 : 2) : count <= 3 ? count : count === 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const marginX = layoutWidth < 700 ? 7 : 14;
    const marginY = 8;
    const top = Math.min(124, Math.max(98, height * .18));
    const zoneWidth = (layoutWidth - marginX * (columns + 1)) / columns;
    const zoneHeight = (height - top - marginY * (rows + 1)) / rows;
    session.teams.forEach((team, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      drawColony(team, {
        x: marginX + col * (zoneWidth + marginX),
        y: top + marginY + row * (zoneHeight + marginY),
        w: zoneWidth,
        h: zoneHeight,
      }, index);
    });
  }

  function celebrate(teamId, kind, effectText = '') {
    if (!scene) return;
    const view = colonyViews.get(teamId);
    if (!view) return;
    const palette = core.TEAM_COLORS[session.teams.find(team => team.id === teamId).colorIndex];
    const siteName = REWARD_STORIES[kind] && REWARD_STORIES[kind].site || (kind === 'defense' ? 'guard' : 'center');
    const origin = view.sites && view.sites[siteName] || view.center;
    for (let index = 0; index < 18; index += 1) {
      const dot = scene.add.circle(origin.x, origin.y, 3 + index % 3, index % 3 === 0 ? 0xffd166 : palette.light).setDepth(10);
      const angle = Math.PI * 2 * index / 18;
      scene.tweens.add({ targets: dot, x: dot.x + Math.cos(angle) * (45 + index * 2), y: dot.y + Math.sin(angle) * (32 + index), alpha: 0, scale: .3, duration: 850, ease: 'Cubic.easeOut', onComplete: () => dot.destroy() });
    }
    const ring = scene.add.ellipse(origin.x, origin.y, 52, 30, palette.light, .12).setDepth(9).setStrokeStyle(4, palette.light, .95);
    scene.tweens.add({ targets: ring, scaleX: 2.1, scaleY: 2.1, alpha: .08, duration: 850, yoyo: true, repeat: 4, ease: 'Sine.easeInOut', onComplete: () => ring.destroy() });
    if (effectText) {
      const label = scene.add.text(origin.x, origin.y - 32, effectText.split(' - ')[0].toUpperCase(), {
        fontFamily: 'Arial', fontSize: view.zone.w < 260 ? '9px' : '13px', fontStyle: 'bold', color: '#fff5cf', backgroundColor: '#254d39', padding: { x: 7, y: 4 },
      }).setOrigin(.5).setDepth(14);
      scene.tweens.add({ targets: label, y: label.y - 18, duration: 900, yoyo: true, hold: 2100, ease: 'Sine.easeOut', onComplete: () => label.destroy() });
    }
  }

  function playWorldEvent(key) {
    if (!scene) return;
    if (key === 'heavy-rain') {
      for (let index = 0; index < 70; index += 1) {
        const drop = scene.add.rectangle((index * 71) % scene.scale.width, -20 - (index % 8) * 18, 2, 16, 0xbde8ff, .8).setDepth(12).setAngle(12);
        scene.tweens.add({ targets: drop, y: scene.scale.height + 30, x: drop.x + 90, duration: 900 + (index % 5) * 120, delay: (index % 10) * 50, onComplete: () => drop.destroy() });
      }
    }
    if (key === 'fallen-fruit') {
      const fruit = scene.add.circle(scene.scale.width * .52, -35, 24, 0xc74f3f, 1).setDepth(14).setStrokeStyle(5, 0xf4b64e, 1);
      const leaf = scene.add.ellipse(fruit.x + 13, fruit.y - 16, 18, 8, 0x6eaa4a, 1).setDepth(15).setAngle(-25);
      scene.tweens.add({ targets: [fruit, leaf], y: scene.scale.height * .32, duration: 850, ease: 'Bounce.easeOut', onComplete: () => scene.time.delayedCall(800, () => { fruit.destroy(); leaf.destroy(); }) });
    }
    if (key === 'food-trail') {
      for (let index = 0; index < 24; index += 1) {
        const seed = scene.add.ellipse(scene.scale.width * .12 + index * scene.scale.width * .032, scene.scale.height * .25 + Math.sin(index * .8) * 18, 8, 4, 0xf5c856, .25).setDepth(12).setAngle(index * 17);
        scene.tweens.add({ targets: seed, alpha: 1, scaleX: 1.35, scaleY: 1.35, duration: 420, delay: index * 35, yoyo: true, hold: 250, onComplete: () => seed.destroy() });
      }
    }
    if (key === 'predator') {
      const shadow = scene.add.ellipse(-180, scene.scale.height * .14, 210, 64, 0x111821, .35).setDepth(13).setAngle(-8);
      scene.tweens.add({ targets: shadow, x: scene.scale.width + 180, duration: 1500, ease: 'Sine.easeInOut', onComplete: () => shadow.destroy() });
    }
    if (key === 'new-territory') {
      for (let index = 0; index < 34; index += 1) {
        const spark = scene.add.circle(scene.scale.width * .5, scene.scale.height * .62, 2 + index % 3, index % 2 ? 0xffd56e : 0x8de4c0, .9).setDepth(13);
        const angle = Math.PI * 2 * index / 34;
        scene.tweens.add({ targets: spark, x: spark.x + Math.cos(angle) * (80 + index * 4), y: spark.y + Math.sin(angle) * (45 + index * 2), alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => spark.destroy() });
      }
    }
  }

  function initAudio() {
    if (!soundOn) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      startAmbient();
    } catch {}
  }

  function tone(frequency, duration, volume, delay = 0) {
    if (!soundOn || !audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(volume, audioContext.currentTime + delay + .03);
    gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + delay + duration);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(audioContext.currentTime + delay); oscillator.stop(audioContext.currentTime + delay + duration + .04);
  }

  function playTone(type) {
    initAudio();
    if (type === 'correct') { tone(523, .22, .06); tone(659, .28, .055, .12); }
    if (type === 'wrong') { tone(246, .22, .035); tone(220, .25, .03, .13); }
    if (type === 'upgrade') { tone(392, .2, .05); tone(523, .25, .05, .1); tone(784, .3, .04, .2); }
    if (type === 'wars') { tone(196, .45, .06); tone(293, .45, .055, .2); }
    if (type === 'victory') [523, 659, 784, 1046].forEach((note, index) => tone(note, .4, .055, index * .14));
  }

  function startAmbient() {
    if (!soundOn || ambientTimer || (session && session.phase === 'paused')) return;
    const play = () => {
      if (!soundOn || !audioContext) return;
      const notes = session && session.warsActive ? [146, 174, 220] : [174, 220, 261];
      notes.forEach((note, index) => tone(note, 2.8, .009, index * .08));
    };
    play(); ambientTimer = setInterval(play, 3600);
  }

  function stopAmbient() {
    clearInterval(ambientTimer); ambientTimer = null;
  }

  function toggleSound() {
    soundOn = !soundOn;
    if (soundOn) initAudio(); else stopAmbient();
    updateHUD();
  }

  $('matchType').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (button) setMatchType(button.dataset.type); });
  $('teamCount').addEventListener('change', renderTeamEditor);
  $('worldStoryContinue').addEventListener('click', async () => {
    if (!worldStoryAction || transitionLocked) return;
    const action = worldStoryAction;
    const button = $('worldStoryContinue');
    transitionLocked = true;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      transitionLocked = false;
      button.disabled = false;
      worldStoryAction = action;
      $('worldStory').classList.remove('hidden');
      toast(error.message);
    }
  });
  $('storyContinue').addEventListener('click', async () => {
    if (!session || session.introSeen) return;
    const button = $('storyContinue');
    button.disabled = true;
    session.introSeen = true;
    await saveState();
    button.disabled = false;
    presentQuestion();
  });
  $('saveSetupBtn').addEventListener('click', async () => {
    showNotice('Saving setup...');
    try { await saveSetup(); showNotice('Setup saved.'); }
    catch (error) { showNotice(error.message); }
  });
  $('startBtn').addEventListener('click', startNewMatch);
  $('resumeBtn').addEventListener('click', enterGame);
  $('discardBtn').addEventListener('click', async () => {
    if (!confirm('Discard the saved ColonyQuest match and arrange new teams?')) return;
    try { await request('/session', { method: 'DELETE' }); } catch {}
    session = null; clearLocal(); renderSetup();
  });
  $('answers').addEventListener('click', event => {
    const button = event.target.closest('[data-choice]');
    if (!button) return;
    const choice = Number(button.dataset.choice);
    handleOutcome(choice, choice === Number(questionAtCursor().correctIndex), false);
  });
  $('feedbackNext').addEventListener('click', () => commitOutcome().catch(error => toast(error.message)));
  $('rewardGrid').addEventListener('click', event => { const button = event.target.closest('[data-reward]'); if (button) chooseReward(button.dataset.reward).catch(error => toast(error.message)); });
  $('targetGrid').addEventListener('click', event => { const button = event.target.closest('[data-target]'); if (button) chooseRaid(button.dataset.target).catch(error => toast(error.message)); });
  $('revealBtn').addEventListener('click', () => {
    const question = questionAtCursor();
    document.querySelectorAll('.answer').forEach(button => button.classList.toggle('correct', Number(button.dataset.choice) === Number(question.correctIndex)));
    toast(`Answer: ${question.options[question.correctIndex]}`);
  });
  $('markCorrectBtn').addEventListener('click', () => handleOutcome(null, true, true));
  $('markWrongBtn').addEventListener('click', () => handleOutcome(null, false, true));
  $('skipQuestionBtn').addEventListener('click', skipQuestion);
  $('nextStudentBtn').addEventListener('click', () => { participantOffset += 1; setCurrentParticipant(chooseParticipant(currentTeam(), participantOffset)); });
  $('randomStudentBtn').addEventListener('click', () => {
    const members = currentTeam() && currentTeam().members || [];
    if (!members.length) return;
    const fewestTurns = Math.min(...members.map(member => member.turns || 0));
    const eligible = members.filter(member => (member.turns || 0) === fewestTurns);
    setCurrentParticipant(eligible[Math.floor(Math.random() * eligible.length)]);
  });
  $('studentPick').addEventListener('change', event => { const member = currentTeam() && currentTeam().members.find(item => item.id === event.target.value); setCurrentParticipant(member || chooseParticipant(currentTeam())); });
  $('teacherHandle').addEventListener('click', () => { $('teacherTray').classList.add('open'); $('teacherHandle').classList.add('hidden'); });
  $('closeTrayBtn').addEventListener('click', () => { $('teacherTray').classList.remove('open'); $('teacherHandle').classList.remove('hidden'); });
  $('pauseBtn').addEventListener('click', () => togglePause().catch(error => toast(error.message)));
  $('muteBtn').addEventListener('click', toggleSound);
  $('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  $('endGameBtn').addEventListener('click', () => { if (confirm('End ColonyQuest for the whole class and show the results?')) finishMatch().catch(error => toast(error.message)); });
  $('backToSetupBtn').addEventListener('click', leaveGameForSetup);
  $('playAgainBtn').addEventListener('click', async () => {
    try { await request('/session', { method: 'DELETE' }); } catch {}
    session = null; clearLocal(); leaveGameForSetup();
  });
  document.addEventListener('keydown', event => {
    if ($('questionOverlay').classList.contains('hidden') || answerLocked) return;
    const number = Number(event.key);
    if (number >= 1 && number <= 4) document.querySelector(`.answer[data-choice="${number - 1}"]`)?.click();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && session) saveState(); });

  (async function load() {
    try {
      data = await request();
      if (!data.game || !Array.isArray(data.game.questions) || !data.game.questions.length) throw new Error('This game has no questions yet. Return to LessonScope and create the question set again.');
      const savedConfig = data.game.colonyquest || {};
      config = { ...core.normalizeConfig(savedConfig), teams: savedConfig.teams || [] };
      session = freshestSession(data.session);
      renderSetup();
    } catch (error) {
      $('loading').innerHTML = `<div style="text-align:center;max-width:560px;padding:20px"><h1>ColonyQuest could not open</h1><p>${esc(error.message)}</p><a href="/" style="color:#7de7bd">Back to LessonScope</a></div>`;
    }
  }());
})();
