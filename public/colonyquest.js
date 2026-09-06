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
  let raidPresentation = null;
  let weatherEffects = [];
  const ASSETS = {
    world: '/assets/colonyquest/moonroot-meadow.webp',
    worker: '/assets/colonyquest/pip-worker.webp',
    queen: '/assets/colonyquest/queen.webp',
    guardian: '/assets/colonyquest/guardian.webp',
  };
  const STORY = {
    intro: 'The Great Rain is coming to Moonroot Meadow. Queen Aurelia and one worker need your help to build a safe home. Store ten seeds, build a food store, recruit a guardian, and strengthen the walls before the rain arrives. Each correct answer earns one upgrade. Every colony has a part in this story.',
    chapters: [
      { at: 0, title: 'First Light', line: 'Wake the workers and gather the first seeds.' },
      { at: .3, title: 'Deep Roots', line: 'Open warm chambers beneath the ancient oak.' },
      { at: .6, title: 'Storm Watch', line: 'Prepare the nests as clouds return to the meadow.' },
      { at: .7, title: 'Moonroot Rally', line: 'Friendly knowledge challenges decide who carries the Ancient Acorn.' },
    ],
  };
  const REWARD_STORIES = {
    workers: { title: 'The foraging trail comes alive', text: 'One new worker emerges beside the queen, then joins the foraging trail. Watch the new ant take its first steps.', site: 'nursery' },
    food: { title: 'Five more seeds for the colony', text: 'The worker brings a small bundle of five seeds into the existing food store.', site: 'food' },
    defense: { title: 'The nest walls grow stronger', text: 'The workers rebuild the room walls and tunnel supports with stronger materials. Their new home is ready for the rain.', site: 'nursery' },
    queen: { title: 'One new egg in the nursery', text: 'The queen settles one egg onto the leaf bedding. After two round-ends it hatches into a worker. Watch its progress in the queen chamber.', site: 'nursery' },
    expansion: { title: 'A hidden tunnel opens', text: 'Workers clear the deep roots, raise a new colony flag, and discover another chamber to explore.', site: 'expansion' },
    soldiers: { title: 'One new guardian reports for duty', text: 'One soldier joins the colony and begins its patrol in the existing nest.', site: 'guard' },
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
    $('gameScreen').classList.remove('story-open');
    worldStoryAction = null;
    $('worldStory').classList.add('hidden');
    $('worldStoryContinue').disabled = false;
  }

  function setOverlay(id) {
    stopRaidPresentation();
    stopWeather();
    hideWorldStory();
    for (const overlay of ['storyOverlay', 'questionOverlay', 'rewardOverlay', 'targetOverlay', 'eventOverlay', 'finalOverlay']) $(overlay).classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
    $('gameScreen').classList.toggle('dock-open', ['questionOverlay', 'rewardOverlay', 'targetOverlay'].includes(id));
  }

  function showWorldStory(details, onContinue) {
    setOverlay(null);
    $('gameScreen').classList.add('story-open');
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
    const now = session.phase === 'paused' && session.pausedAt ? session.pausedAt : Date.now();
    return Math.min(1, Math.max(0, 1 - ((session.endsAt || now) - now) / duration));
  }

  function matchFinished() {
    if (config.matchType === 'rounds') return session.turnIndex >= totalTurns();
    return !!session.endsAt && Date.now() >= session.endsAt;
  }

  function updateHUD() {
    if (!session) return;
    const team = currentTeam();
    const goals = core.rainPreparation(team);
    $('rainSummary').textContent = `Great Rain: ${goals.filter(goal => goal.done).length}/4 ready`;
    $('rainTeam').textContent = team.name;
    $('rainGoals').innerHTML = goals.map(goal => `<li class="${goal.done ? 'ready' : ''}"><input type="checkbox" disabled${goal.done ? ' checked' : ''} aria-label="${esc(goal.label)}"><span>${esc(goal.label)}</span><b>${esc(goal.value)}</b></li>`).join('');
    $('rainApproach').value = turnProgress();
    $('scoreStrip').innerHTML = session.teams.map((item, index) => {
      const palette = core.TEAM_COLORS[item.colorIndex];
      return `<div class="score-card${index === session.currentTeamIndex && session.phase !== 'ended' ? ' current' : ''}" style="--team-color:${colorHex(palette.primary)}"><div class="score-name"><span>${esc(item.name)}</span><span>${core.colonyStrength(item)}</span></div><div class="score-stats"><span>1 queen</span><span>${item.workers} workers</span><span>${item.soldiers} soldiers</span><span>${item.food} food</span><span>${core.fortification(item).name}</span></div></div>`;
    }).join('');
    const options = session.teams.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    if ($('colonyViewPick').innerHTML !== options) $('colonyViewPick').innerHTML = options;
    if (team) {
      const palette = core.TEAM_COLORS[team.colorIndex];
      $('turnBanner').style.setProperty('--team-color', colorHex(palette.primary));
      $('turnTeam').textContent = `${team.name}'s turn`;
    }
    const round = Math.floor(session.turnIndex / Math.max(1, session.teams.length)) + 1;
    $('roundLabel').textContent = config.matchType === 'rounds' ? `Round ${Math.min(round, config.rounds)} of ${config.rounds}` : timeLabel();
    const chapter = storyChapter();
    $('phaseLabel').textContent = session.phase === 'ended' ? session.stormSeen ? 'After the rain' : 'The Great Rain' : session.warsActive ? 'Moonroot Rally' : chapter.title;
    $('pauseBtn').textContent = session.phase === 'paused' ? 'Resume' : 'Pause';
    $('pauseBtn').disabled = session.phase === 'ended';
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
    focusColony(team.id);
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
    return Object.keys(core.REWARDS);
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
    if (key === 'workers') return `+${amount} ${amount === 1 ? 'worker' : 'workers'} - ${team.workers} workers now`;
    if (key === 'food') return `+${amount} food - ${team.food} seeds stored`;
    if (key === 'defense') return `${core.fortification(team).name} walls throughout the colony - defense ${team.defense}`;
    if (key === 'queen') return `+${Math.max(0, amount - secondary)} ${amount - secondary === 1 ? 'egg' : 'eggs'} - queen level ${team.queenLevel}`;
    if (key === 'expansion') return `+1 permanent room: ${core.colonyRooms(team).at(-1).label} - ${core.colonyRooms(team).length} rooms`;
    if (key === 'soldiers') return `+${amount} ${amount === 1 ? 'soldier' : 'soldiers'} - ${team.soldiers} ${team.soldiers === 1 ? 'soldier' : 'soldiers'} now`;
    return '';
  }

  function previewReward(key) {
    const team = currentTeam();
    const eligibility = core.rewardAvailability(team, key);
    if (!eligibility.allowed) return eligibility.reason;
    if (key === 'raid') return 'Visit another colony and bring food home';
    if (key === 'defense' && team.defense >= core.FORTIFICATIONS.length - 1) return 'Maximum fortification reached';
    const clones = session.teams.map(item => ({ ...item, eggs: (item.eggs || []).map(egg => ({ ...egg })), members: (item.members || []).map(member => ({ ...member })) }));
    const preview = clones.find(item => item.id === team.id);
    const before = { ...preview };
    core.applyReward(preview, key, clones);
    const effect = rewardEffectText(key, rewardChange(key, before, preview), preview);
    return key === 'expansion' ? `+1 ${core.colonyRooms(preview).at(-1).label}. ${core.roomBenefit(core.colonyRooms(preview).at(-1))}` : effect;
  }

  function showRewardStory(event, onContinue = nextTurn) {
    if (session.phase !== 'event') return;
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
    focusColony(team.id, story.site);
  }

  function showRewards() {
    if (session.phase !== 'reward') return;
    transitionLocked = false;
    const team = currentTeam();
    $('rewardTitle').textContent = `${team.name}: choose your colony reward`;
    $('rewardGrid').innerHTML = rewardChoices().map(key => {
      const reward = core.REWARDS[key];
      const art = key === 'queen' ? ASSETS.queen : ['defense', 'soldiers', 'raid'].includes(key) ? ASSETS.guardian : ASSETS.worker;
      const unavailable = !core.rewardAvailability(team, key).allowed;
      return `<button type="button" class="reward" data-reward="${key}"${unavailable ? ' disabled' : ''}><span class="reward-symbol"><img src="${art}" alt=""></span><strong>${esc(reward.label)}</strong><span>${esc(reward.description)}</span><span class="reward-effect">${esc(previewReward(key))}</span></button>`;
    }).join('');
    setOverlay('rewardOverlay');
    updateWorld();
  }

  async function chooseReward(key) {
    if (session.phase !== 'reward' || transitionLocked) return;
    if (!core.rewardAvailability(currentTeam(), key).allowed) return;
    transitionLocked = true;
    if (key === 'raid') {
      const team = currentTeam();
      $('targetGrid').innerHTML = session.teams.filter(item => item.id !== team.id).map(item => {
        const eligibility = core.raidAvailability(team, item, session);
        const forecast = core.raidForecast(team, item);
        return `<button type="button" data-target="${esc(item.id)}"${!eligibility.allowed ? ' disabled' : ''}>${esc(item.name)}<small>${esc(core.TEAM_COLORS[item.colorIndex].name)} ants · ${item.food} food · ${item.soldiers} soldiers · ${esc(core.fortification(item).name)} walls</small><small>${!eligibility.allowed ? esc(eligibility.reason) : forecast.success ? 'Your party can pass these defenses' : 'Strong defenses: build up your colony first'}</small></button>`;
      }).join('');
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
    if (!core.raidAvailability(attacker, defender, session).allowed) { transitionLocked = false; return; }
    const result = core.resolveRaid(attacker, defender, session.teams, session);
    if (result.blocked) { transitionLocked = false; return; }
    session.phase = 'event';
    session.eventAction = 'next-turn';
    const event = { key: 'raid-result', attackerId: attacker.id, defenderId: defender.id, ...result, turnIndex: session.turnIndex, at: new Date().toISOString() };
    session.events.push(event);
    setOverlay(null);
    updateWorld();
    showRaidStory(event, true);
    updateHUD();
    await saveState();
  }

  function eventForTurn() {
    return core.EVENTS[Math.floor(session.turnIndex / Math.max(1, session.teams.length * 2)) % core.EVENTS.length];
  }

  function stopRaidPresentation() {
    const raid = raidPresentation;
    if (!raid) return;
    raidPresentation = null;
    raid.tween?.stop();
    for (const ant of raid.hidden) if (ant.active) ant.setVisible(true);
    for (const label of raid.labels) if (label.active) label.setVisible(true);
    for (const actor of raid.actors) {
      if (!actor.active) continue;
      scene.tweens.killTweensOf(actor.sprite);
      scene.tweens.killTweensOf(actor.gait);
      actor.destroy();
    }
    raid.trail?.destroy();
    scene.cameras.main.setZoom(1).setScroll(0, $('worldViewport').scrollTop);
    $('worldViewport').removeAttribute('data-raid-phase');
    $('gameScreen').classList.remove('raid-playing');
  }

  function showRaidStory(event, animate = false) {
    const attacker = session.teams.find(team => team.id === event.attackerId);
    const defender = session.teams.find(team => team.id === event.defenderId);
    if (!attacker || !defender) return showEvent({ title: 'The raid is over', description: 'The colonies are ready for their next turn.' }, nextTurn);
    const finish = () => {
      stopRaidPresentation();
      showWorldStory({
        kicker: 'Back in the meadow',
        title: event.success ? `${attacker.name} returns home` : `${defender.name} holds the line`,
        text: event.success ? `The raiders brought ${event.stolen} seeds back from ${defender.name}. The workers put them in their food store. Let this colony recover for two of your turns before visiting again.` : `${core.raidForecast(attacker, defender).reason} The raiders return home safely. The defending colony earns five seeds.`,
        effect: event.success ? `+${event.stolen} food for ${attacker.name}` : `+5 food for ${defender.name}`,
        art: ASSETS.guardian,
      }, nextTurn);
      focusColony(event.success ? attacker.id : defender.id, 'food');
    };
    if (!animate || !scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    const home = colonyViews.get(attacker.id), away = colonyViews.get(defender.id);
    if (!home || !away) return finish();
    showWorldStory({ kicker: `${core.TEAM_COLORS[attacker.colorIndex].name} ants on the move`, title: `${attacker.name} sets out`, text: `Follow the raiding party to ${defender.name}'s nest.`, effect: 'Leaving the queen chamber', art: ASSETS.guardian, continueLabel: 'Skip animation' }, finish);
    const party = home.ants.filter(ant => ant.getData('role') === 'soldier').slice(0, 6);
    if (!party.length) return finish();
    // These are visual stand-ins for existing ants, not extra recruits or a second raid result.
    const hidden = [...party];
    const actors = party.map(() => makeAntAgent(attacker.soldiers ? 'cq-guardian' : 'cq-worker', home.sites.nursery, 34, core.TEAM_COLORS[attacker.colorIndex].primary));
    for (const ant of hidden) ant.setVisible(false);
    const destination = event.success ? { x: away.sites.food.x + 37, y: away.sites.food.y + 22 } : { x: away.sites.entrance.x - 28, y: away.sites.entrance.y - 15 };
    const points = [{ x: home.sites.nursery.x + 37, y: home.sites.nursery.y + 22 }, home.sites.entrance, { x: home.sites.entrance.x, y: home.sites.entrance.y - 28 }, { x: away.sites.entrance.x, y: away.sites.entrance.y - 28 }, away.sites.entrance, destination];
    const route = new Phaser.Curves.Path(points[0].x, points[0].y);
    for (const point of points.slice(1)) route.lineTo(point.x, point.y);
    const trail = scene.add.graphics().setDepth(4);
    for (const point of route.getSpacedPoints(45)) ellipse(trail, point.x, point.y + 8, 3, 3, core.TEAM_COLORS[attacker.colorIndex].light, .65);
    const defenders = away.ants.filter(ant => ant.getData('role') === 'soldier').slice(0, 4);
    for (const [index, ant] of defenders.entries()) {
      ant.setVisible(false); hidden.push(ant);
      const guard = makeAntAgent('cq-guardian', { x: away.sites.entrance.x + (index - 1.5) * 19, y: away.sites.entrance.y + 10 }, 34, core.TEAM_COLORS[defender.colorIndex].primary);
      guard.sprite.setFlipX(away.sites.entrance.x > home.sites.entrance.x);
      actors.push(guard);
    }
    const labels = [...colonyViews.values()].flatMap(view => view.labels);
    for (const label of labels) label.setVisible(false);
    const raid = { event, actors, hidden, labels, trail, tween: null };
    raidPresentation = raid;
    $('gameScreen').classList.add('raid-playing');
    const progress = { value: 0 };
    const camera = scene.cameras.main;
    camera.setZoom(1.6);
    let lastPhase = '';
    raid.tween = scene.tweens.add({ targets: progress, value: 1, duration: 10500, ease: 'Linear',
      onUpdate: () => {
        if (raidPresentation !== raid) return;
        const p = progress.value;
        const phase = p < .42 ? 'outbound' : p < .56 ? 'at-nest' : 'returning';
        const distance = p < .42 ? p / .42 : p < .56 ? 1 : (1 - p) / .44;
        for (let index = 0; index < party.length; index += 1) {
          const ant = actors[index];
          const t = Phaser.Math.Clamp(distance - index * .018, 0, 1);
          const point = route.getPoint(t), ahead = route.getPoint(Math.min(1, t + .01));
          ant.setPosition(point.x, point.y + index % 2 * 8);
          ant.sprite.setFlipX(phase === 'returning' ? ahead.x >= point.x : ahead.x < point.x);
          ant.cargo.setVisible(phase === 'returning' && event.success && event.stolen > 0);
        }
        camera.centerOn(actors[0].x, actors[0].y + 25);
        if (phase !== lastPhase) {
          lastPhase = phase;
          $('worldViewport').dataset.raidPhase = phase;
          $('worldStoryTitle').textContent = phase === 'outbound' ? `${attacker.name} crosses the meadow` : phase === 'at-nest' ? event.success ? 'The raiders reach the food store' : 'The guardians block the entrance' : `${attacker.name} heads home`;
          $('worldStoryEffect').textContent = phase === 'outbound' ? `Destination: ${defender.name}` : phase === 'at-nest' ? event.success ? `${event.stolen} seeds collected` : 'The nest is protected' : event.success ? 'Carrying the seeds home' : 'Returning safely without food';
          if (phase === 'at-nest') playTone(event.success ? 'upgrade' : 'wrong');
        }
      }, onComplete: finish,
    });
  }

  function shouldStartWars() {
    return !session.warsActive && turnProgress() >= 0.7;
  }

  function shouldShowEvent() {
    return session.turnIndex > 0 && session.turnIndex % (session.teams.length * 2) === 0 && !matchFinished();
  }

  async function nextTurn() {
    const previousChapter = storyChapter().title;
    setOverlay(null);
    session.eventAction = null;
    session.turnIndex += 1;
    session.questionCursor += 1;
    let reports = null;
    if (session.turnIndex % session.teams.length === 0) {
      reports = session.teams.map(team => ({ teamId: team.id, ...core.roundEconomy(team), workersBefore: team.workers }));
      core.applyUpkeep(session.teams);
      reports = reports.map(report => ({ teamId: report.teamId, gathered: report.gathered, eaten: report.eaten, hatched: session.teams.find(team => team.id === report.teamId).workers - report.workersBefore }));
    }
    if (matchFinished()) {
      await finishMatch();
      return;
    }
    session.currentTeamIndex = session.turnIndex % session.teams.length;
    if (reports) {
      const event = { key: 'round-supplies', chapterBefore: previousChapter, reports, reportIndex: 0, at: new Date().toISOString() };
      session.events.push(event);
      session.phase = 'event';
      session.eventAction = 'question';
      updateWorld();
      await saveState();
      showRoundStory(event);
      return;
    }
    await beginTurn(previousChapter);
  }

  function showRoundStory(event) {
    if (session.phase !== 'event') return;
    const report = event.reports[event.reportIndex || 0];
    if (!report) { showWorldStory({ title: 'The foraging round is complete', text: 'The colonies are ready for their next question.' }, () => beginTurn(event.chapterBefore)); return; }
    const team = session.teams.find(item => item.id === report.teamId);
    const egg = team.eggs?.[0];
    showWorldStory({
      kicker: 'The workers come home',
      title: `${team.name}: round harvest`,
      text: `${report.gathered} seeds gathered. The colony ate ${report.eaten}. ${report.hatched ? 'One egg hatched! A new worker takes its first steps.' : egg ? `The next egg hatches in ${Math.max(1, egg.roundsLeft)} round${egg.roundsLeft === 1 ? '' : 's'}.` : 'Every worker brings two seeds each round.'}`,
      effect: `${team.food} seeds stored${report.hatched ? ' · +1 worker' : ''}`,
      continueLabel: event.reportIndex < event.reports.length - 1 ? 'Next colony' : 'Continue journey',
      art: report.hatched ? ASSETS.queen : ASSETS.worker,
    }, async () => {
      if ((event.reportIndex || 0) < event.reports.length - 1) {
        event.reportIndex = (event.reportIndex || 0) + 1;
        updateWorld();
        await saveState();
        showRoundStory(event);
      } else await beginTurn(event.chapterBefore);
    });
    focusColony(team.id, report.hatched ? 'nursery' : 'food');
    celebrate(team.id, report.hatched ? 'workers' : 'food', report.hatched ? '+1 worker' : `+${report.gathered} seeds gathered`);
  }

  async function beginTurn(previousChapter) {
    if (session.phase === 'ended' || session.phase === 'paused') return;
    if (shouldStartWars()) {
      session.warsActive = true;
      session.phase = 'event';
      session.eventAction = 'question';
      session.events.push({ key: 'colony-wars', at: new Date().toISOString() });
      updateWorld();
      await saveState();
      showEvent({ title: 'The Moonroot Rally begins', description: 'The moon is rising. Keep building, gathering, or raiding as the colonies compete for the Ancient Acorn. Every colony stays in the adventure.', kicker: 'Chapter 4' }, continueAfterEvent);
      playTone('wars');
      return;
    }
    const nextChapter = storyChapter();
    if (nextChapter.title !== previousChapter) {
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
    if (event.kicker === 'Chapter 4') return 'The Great Rain is close. Choose what your colony still needs.';
    if (String(event.kicker || '').startsWith('Chapter')) return 'Look at how far every colony has grown.';
    return '';
  }

  function showEvent(event, onContinue) {
    if (session.phase === 'paused' || session.phase === 'ended') return;
    const guardianMoment = event.tone === 'danger' || event.tone === 'storm' || event.kicker === 'Colony Wars';
    showWorldStory({
      kicker: event.kicker || 'A Moonroot Meadow event',
      title: event.title,
      text: event.description,
      effect: worldEventEffect(event),
      tone: event.tone,
      art: guardianMoment ? ASSETS.guardian : ASSETS.worker,
    }, onContinue);
    if (event.key) playWorldEvent(event.key);
  }

  async function finishMatch() {
    $('teacherTray').classList.remove('open');
    if (!session || session.phase === 'ended') {
      if (session) session.stormSeen ? showFinal() : showRainFinale();
      return;
    }
    session.phase = 'ended';
    session.endedAt = new Date().toISOString();
    session.stormSeen = false;
    setOverlay(null);
    updateHUD();
    await saveState();
    playTone('victory');
    updateWorld();
    showRainFinale();
  }

  function showRainFinale() {
    $('worldViewport').scrollTo({ top: 0, behavior: 'auto' });
    showWorldStory({
      kicker: 'The Great Rain arrives',
      title: 'The colonies shelter together',
      text: session.teams.map(team => `${team.name}: ${core.rainOutcome(team).protectedFood} seeds kept dry, ${core.rainOutcome(team).ready}/4 preparations ready.`).join(' '),
      effect: 'Every colony survives. See what your choices built.',
      art: ASSETS.queen,
      continueLabel: 'See colony stories',
    }, async () => {
      session.stormSeen = true;
      await saveState();
      showFinal();
    });
    playWorldEvent('heavy-rain');
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
    const improved = session.teams.filter(team => core.learningImprovement(session, team.id) > 0).sort((a, b) => core.learningImprovement(session, b.id) - core.learningImprovement(session, a.id))[0];
    const awards = [
      ['Knowledge champions', knowledge],
      ['Best defense', bestTeamBy('defense')],
      ['Largest family', bestTeamBy('population')],
      ['Most resources', bestTeamBy('food')],
    ];
    if (improved) awards.push(['Most improved answers', improved]);
    $('awards').innerHTML = awards.map(([label, team]) => `<div class="award"><b>${label}</b><span>${esc(team.name)}</span></div>`).join('');
    $('colonyStories').innerHTML = session.teams.map(team => {
      const outcome = core.rainOutcome(team);
      const improvement = core.learningImprovement(session, team.id);
      const missing = core.rainPreparation(team).filter(goal => !goal.done).map(goal => goal.label.toLowerCase());
      return `<article class="colony-ending"><h3>${esc(team.name)}: ${outcome.ready}/4 ready</h3><p>${esc(outcome.text)}</p><p>${team.workers} workers · ${team.soldiers} guardians · ${core.colonyRooms(team).length} rooms · ${team.correct}/${team.attempts} correct answers.</p><p>${improvement === null ? 'More answers will help show your learning progress.' : improvement > 0 ? `Your accuracy improved by ${improvement} percentage points from the first half to the second half.` : 'Keep practising the questions you found challenging.'}</p><strong>${missing.length ? `Next adventure: ${esc(missing[0])}.` : 'All four preparations complete.'}</strong></article>`;
    }).join('');
    setOverlay('finalOverlay');
  }

  function resumePhase() {
    if (session.phase === 'ended') return session.stormSeen ? showFinal() : showRainFinale();
    if (session.phase === 'reward') return showRewards();
    if (session.phase === 'event') {
      const last = session.events[session.events.length - 1];
      if (last?.key === 'round-supplies') return showRoundStory(last);
      if (last?.key === 'raid-result' && last.attackerId) return showRaidStory(last);
      if (last && String(last.key).startsWith('upgrade-')) return showRewardStory(last, nextTurn);
      const event = last && last.key === 'colony-wars'
        ? { title: 'The Moonroot Rally begins', description: 'The moon is rising. Keep building, gathering, or raiding as the colonies compete for the Ancient Acorn. Every colony stays in the adventure.', kicker: 'Chapter 4' }
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
    $('rainPlan').open = window.innerWidth > 850;
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
      input: { mouse: { preventDefaultWheel: false } },
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
          this.scale.on('resize', () => { updateWorld(); restoreWorldFocus(); });
          updateWorld();
          restoreWorldFocus();
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

  function makeAntAgent(texture, point, width, teamColor, carriesFood = false, animateLegs = true) {
    const container = scene.add.container(point.x, point.y).setDepth(5);
    const shadow = scene.add.ellipse(0, width * .19, width * .62, width * .13, 0x180f0a, .3);
    const sprite = scene.add.image(0, 0, naturalAntTexture(texture, teamColor));
    sprite.setDisplaySize(width, width * .67);
    const legs = scene.add.graphics();
    const gait = { phase: 0 };
    const paintLegs = () => {
      legs.clear().lineStyle(Math.max(1.4, width * .025), teamColor, 1);
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
    container.gait = gait;
    container.cargo = cargo;
    container.carriesFood = carriesFood;
    paintLegs();
    if (animateLegs && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scene.tweens.add({ targets: gait, phase: Math.PI * 2, duration: 430, repeat: -1, onUpdate: paintLegs });
    }
    const baseY = sprite.y;
    scene.tweens.add({ targets: sprite, y: baseY - Math.max(1, width * .025), duration: 170 + Math.random() * 80, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return container;
  }

  function naturalAntTexture(sourceKey, color) {
    const key = `${sourceKey}-natural-${color}`;
    if (scene.textures.exists(key)) return key;
    const source = scene.textures.get(sourceKey).getSourceImage();
    const canvas = scene.textures.createCanvas(key, 256, 256);
    const ctx = canvas.getContext();
    ctx.drawImage(source, 0, 0, 256, 256);
    const pixels = ctx.getImageData(0, 0, 256, 256);
    const base = [color >> 16 & 255, color >> 8 & 255, color & 255];
    // Reuse the sprite's shading and alpha, with a cached natural-colour shell for each team.
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (!pixels.data[i + 3]) continue;
      const light = (pixels.data[i] * .3 + pixels.data[i + 1] * .59 + pixels.data[i + 2] * .11) / 255;
      const shine = Math.max(0, light - .65) * 120;
      for (let channel = 0; channel < 3; channel += 1) pixels.data[i + channel] = Math.min(255, base[channel] * (.3 + light * 1.5) + shine);
    }
    ctx.putImageData(pixels, 0, 0);
    canvas.refresh();
    return key;
  }

  function animateAnt(agent, points, index = 0, previous = null, startDelay = 0) {
    if (!points.length) return;
    let cursor = index % points.length;
    agent.x = previous ? previous.x : points[cursor].x;
    agent.y = previous ? previous.y : points[cursor].y;
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
    scene.time.delayedCall(Math.max(startDelay, 160 + index * 120), travel);
  }

  function tunnelCurve(a, b) {
    const bend = Math.sign(b.y - a.y) * Math.min(28, Math.abs(b.y - a.y) * .18);
    return new Phaser.Curves.CubicBezier(
      new Phaser.Math.Vector2(a.x, a.y),
      new Phaser.Math.Vector2(a.x + bend, a.y + (b.y - a.y) * .4),
      new Phaser.Math.Vector2(b.x - bend, b.y - (b.y - a.y) * .35),
      new Phaser.Math.Vector2(b.x, b.y));
  }

  function drawTunnel(graphics, points, width, material = core.FORTIFICATIONS[0]) {
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
    stroke(width + 10, material.wall, .95);
    stroke(width + 3, 0x291d19, 1);
    stroke(width, material.floor, 1);
  }

  function drawChamber(graphics, x, y, width, height, palette, active = false, material = core.FORTIFICATIONS[0], defense = 0) {
    ellipse(graphics, x, y + 5, width + 20, height + 18, 0x201a17, .72);
    ellipse(graphics, x, y, width + 12 + Math.min(4, defense) * 2, height + 12 + Math.min(4, defense) * 2, material.wall, 1);
    ellipse(graphics, x, y, width, height, 0x332a24, 1);
    ellipse(graphics, x, y + height * .12, width * .88, height * .64, material.floor, 1);
    for (let index = 0; index < 14; index += 1) {
      const angle = index * Math.PI * 2 / 14;
      const px = x + Math.cos(angle) * (width * .5 + 3), py = y + Math.sin(angle) * (height * .5 + 3);
      if (defense === 0) ellipse(graphics, px, py, 7, 4, index % 2 ? material.edge : material.wall, .85);
      else if (defense >= 4) {
        ellipse(graphics, px, py, 5, 5, 0x253d49, 1);
        ellipse(graphics, px - 1, py - 1, 2, 2, 0xe7faff, 1);
      } else {
        graphics.lineStyle(defense === 1 ? 4 : 2, material.edge, 1);
        graphics.lineBetween(x + Math.cos(angle) * width * .49, y + Math.sin(angle) * height * .49, x + Math.cos(angle) * (width * .5 + 8), y + Math.sin(angle) * (height * .5 + 8));
      }
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
      wordWrap: { width: Math.max(100, zoneWidth * .75) }, align: 'center',
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

  function furnishRoom(graphics, room, team, roomWidth, roomHeight) {
    const { x, y, kind } = room;
    if (kind === 'food' || kind === 'expansion' && room.expansion % 4 === 2) {
      for (let row = 0; row < 2; row += 1) {
        graphics.lineStyle(4, 0xc6a471, 1);
        graphics.lineBetween(x - roomWidth * .34, y + row * 18, x + roomWidth * .34, y + row * 18);
      }
      const stored = Math.min(30, team.food);
      for (let i = 0; i < stored; i += 1) {
        ellipse(graphics, x - roomWidth * .29 + (i % 10) * roomWidth * .064, y - 5 + Math.floor(i / 10) * 8, 7, 5, [0xf1cc66, 0x8bbc5e, 0xdb7857][i % 3]);
      }
    } else if (kind === 'guard') {
      for (let i = 0; i < 6; i += 1) {
        graphics.lineStyle(5, 0xb79463, 1);
        const px = x + (i - 2.5) * roomWidth * .1;
        graphics.lineBetween(px, y + roomHeight * .26, px + 2, y + roomHeight * .06);
      }
      graphics.lineStyle(3, 0x5b4130, 1);
      graphics.lineBetween(x - roomWidth * .3, y + roomHeight * .2, x + roomWidth * .3, y + roomHeight * .2);
    } else if (kind === 'nursery' || kind === 'workers') {
      for (let i = 0; i < 7; i += 1) ellipse(graphics, x + (i - 3) * roomWidth * .09, y + roomHeight * .23 + Math.sin(i) * 3, roomWidth * .18, 12, i % 2 ? 0x789850 : 0x4b783e);
      if (kind === 'nursery') {
        if (!team.pantryBuilt) for (let i = 0; i < Math.min(20, team.food); i += 1) ellipse(graphics, x - roomWidth * .34 + i % 5 * 6, y - 15 + Math.floor(i / 5) * 5, 5, 4, 0xf1cc66);
        const young = Math.max(0, team.population - 1 - team.workers - team.soldiers);
        for (let i = 0; i < young; i += 1) ellipse(graphics, x - roomWidth * .27 + i % 10 * roomWidth * .06, y + roomHeight * .17 + Math.floor(i / 10) * 6, 6, 4, 0xfff1cb);
      }
    } else if (room.expansion % 4 === 1) {
      for (let i = 0; i < 5; i += 1) {
        const mx = x + (i - 2) * roomWidth * .13, my = y + Math.sin(i) * 5;
        graphics.lineStyle(4, 0xd9d7b4, 1); graphics.lineBetween(mx, my, mx, my + 14);
        ellipse(graphics, mx, my, 17, 9, i % 2 ? 0xd99185 : 0x94cbd1);
      }
    } else if (room.expansion % 4 === 0) {
      ellipse(graphics, x, y + 9, roomWidth * .7, roomHeight * .42, 0x245568);
      ellipse(graphics, x, y + 6, roomWidth * .61, roomHeight * .3, 0x71ced8);
      graphics.lineStyle(1, 0xd9ffff, .8); graphics.strokeEllipse(x, y + 6, roomWidth * .38, 10);
    } else {
      graphics.fillStyle(0xb68a57); graphics.fillRoundedRect(x - roomWidth * .3, y, roomWidth * .6, 9, 2);
      graphics.lineStyle(4, 0x7e6550); graphics.lineBetween(x - 13, y - 5, x + 9, y - 17);
      graphics.lineStyle(6, 0xb4c8c9); graphics.lineBetween(x + 3, y - 21, x + 14, y - 11);
    }
  }

  function drawColony(team, zone, teamIndex, previous = null) {
    const palette = core.TEAM_COLORS[team.colorIndex];
    const material = core.fortification(team);
    const graphics = scene.add.graphics().setDepth(0);
    const cx = zone.x + zone.w / 2;
    const entrance = { x: cx, y: zone.y + 60 };
    const active = teamIndex === session.currentTeamIndex && session.phase !== 'ended';
    const roomWidth = Math.min(166, zone.w * .41);
    const roomHeight = 96;
    const rooms = core.colonyRooms(team).map((room, index) => ({
      ...room,
      x: index === 0 ? cx : zone.x + zone.w * ((index - 1) % 2 ? .75 : .25),
      y: zone.y + 156 + Math.ceil(index / 2) * 166,
    }));
    const nursery = rooms[0];
    const preservePositions = previous && previous.zone.x === zone.x && previous.zone.y === zone.y && previous.zone.w === zone.w && previous.roomCount === rooms.length;
    const food = rooms.find(room => room.kind === 'food') || nursery;
    const guards = rooms.filter(room => room.kind === 'guard');
    const guard = guards.at(-1) || nursery;
    const sites = { entrance, nursery, food, guard, center: nursery, expansion: rooms.at(-1) };
    const lastEvent = session.events.at(-1);
    const harvest = session.phase === 'event' && lastEvent?.key === 'round-supplies' ? lastEvent.reports[lastEvent.reportIndex || 0] : null;

    drawTunnel(graphics, [entrance, nursery], 14, material);
    for (let index = 1; index < rooms.length; index += 1) {
      const room = rooms[index];
      const junction = { x: cx, y: room.y - 75 };
      if (index % 2 === 1) {
        const previousY = index === 1 ? nursery.y : rooms[index - 2].y - 75;
        drawTunnel(graphics, [{ x: cx, y: previousY }, junction], 14, material);
      }
      drawTunnel(graphics, [junction, room], 12, material);
    }
    for (const room of rooms) {
      const newRoom = room === rooms.at(-1) && session.phase === 'event' && lastEvent?.key === 'upgrade-expansion' && lastEvent.teamId === team.id;
      const roomGraphics = newRoom ? scene.add.graphics().setDepth(1) : graphics;
      drawChamber(roomGraphics, room.x, room.y, roomWidth, roomHeight, palette, active && room.kind === 'nursery', material, team.defense);
      furnishRoom(roomGraphics, room, team, roomWidth, roomHeight);
      if (newRoom && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        roomGraphics.setAlpha(0);
        scene.tweens.add({ targets: roomGraphics, alpha: 1, duration: 1600 });
      }
      const egg = team.eggs?.[0];
      const detail = room.kind === 'food' ? ` · ${team.food} food` : room.kind === 'guard' ? ` · ${Math.min(8, Math.max(0, team.soldiers - guards.indexOf(room) * 8))} soldiers` : room.kind === 'nursery' ? egg ? ` · egg: ${Math.max(1, egg.roundsLeft)} rounds` : ` · level ${team.queenLevel}` : '';
      const tag = chamberTag(room.x, room.y - roomHeight / 2 - 3, room.label + detail, zone.w);
      tag.setInteractive({ useHandCursor: true }).on('pointerdown', pointer => {
        if (pointer.event?.target === game.canvas) toast(core.roomBenefit(room));
      });
      if (room.kind === 'expansion') {
        const flagX = room.x + roomWidth * .42, flagY = room.y - 16;
        graphics.lineStyle(2, 0xe5dcbf, 1); graphics.lineBetween(flagX, flagY, flagX, flagY - 25);
        graphics.fillStyle(palette.primary, 1); graphics.fillTriangle(flagX, flagY - 25, flagX + 14, flagY - 19, flagX, flagY - 12);
      }
    }
    ellipse(graphics, entrance.x, entrance.y, 48, 19, 0x261a13);
    graphics.lineStyle(3, material.wall, 1); graphics.strokeEllipse(entrance.x, entrance.y, 48, 19);
    const title = scene.add.text(zone.x + 12, zone.y + 2, team.name, {
      fontFamily: 'Arial', fontSize: '14px', fontStyle: 'bold', color: '#f1fff5',
      backgroundColor: '#1c4036', padding: { x: 9, y: 6 }, wordWrap: { width: zone.w - 44 },
    }).setDepth(8);
    title.setInteractive({ useHandCursor: true }).on('pointerdown', pointer => {
      if (pointer.event?.target === game.canvas) focusColony(team.id);
    });
    const subtitle = scene.add.text(zone.x + 13, zone.y + 33, `${palette.name} ants · ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · ${material.name}`, {
      fontFamily: 'Arial', fontSize: '11px', color: '#ffffff', backgroundColor: '#263d33', padding: { x: 5, y: 3 },
    }).setDepth(8);

    const queen = makeAntAgent('cq-queen', { x: nursery.x, y: nursery.y - 4 }, Math.min(55 + team.queenLevel * 4, roomWidth * .65), palette.primary);
    queen.setData('role', 'queen');
    const ants = [];
    const pathTo = room => {
      if (room === nursery) return [nursery, entrance];
      const points = [nursery];
      for (let y = nursery.y + 91; y <= room.y - 74; y += 166) points.push({ x: cx, y });
      points.push(room);
      return points;
    };
    for (let index = 0; index < team.workers; index += 1) {
      const lastEvent = session.events.at(-1);
      const building = index === 0 && session.phase === 'event' && lastEvent?.key === 'upgrade-expansion' && lastEvent.teamId === team.id;
      const room = building ? sites.expansion : index % 3 === 0 ? food : rooms[index % rooms.length];
      const route = pathTo(room);
      const surface = { x: cx + (index % 2 ? -1 : 1) * zone.w * .3, y: entrance.y - 19 };
      const path = building ? [{ x: room.x - 12, y: room.y }, { x: room.x + 14, y: room.y + 5 }, { x: room.x, y: room.y - 8 }] : [...route.slice().reverse(), entrance, surface, entrance, ...route];
      const recruit = index === team.workers - 1 && session.phase === 'event' && (lastEvent?.key === 'upgrade-workers' && lastEvent.teamId === team.id || harvest?.teamId === team.id && harvest.hatched);
      if (recruit) path.unshift({ x: nursery.x + roomWidth * .28, y: nursery.y + 4 });
      const ant = makeAntAgent('cq-worker', path[0], 29, palette.primary, !building, index < 48);
      ant.setData('role', 'worker');
      ants.push(ant);
      if (index === 0 && (harvest?.teamId === team.id && harvest.gathered > 0 || session.phase === 'event' && lastEvent?.key === 'upgrade-food' && lastEvent.teamId === team.id)) deliverHarvest(ant, [surface, entrance, ...pathTo(food)]);
      else animateAnt(ant, path, recruit ? 0 : index, preservePositions && !recruit ? previous.workers[index] : null, recruit ? 1400 : 0);
      if (recruit) revealRecruit(ant);
    }
    for (let index = 0; index < team.soldiers; index += 1) {
      const room = guards[Math.floor(index / 8)] || nursery;
      const slot = guards[Math.floor(index / 8)] ? index % 8 : index - guards.length * 8;
      const x = room.x + ((slot % 4) - 1.5) * roomWidth * .19;
      const y = room.y - 13 + Math.floor(slot / 4) * 24;
      const path = [{ x, y }, { x: x + 10, y: y - 5 }, { x: x - 8, y: y + 3 }];
      const soldier = makeAntAgent('cq-guardian', path[0], 30, palette.primary, false, index < 48);
      soldier.setData('role', 'soldier');
      ants.push(soldier);
      animateAnt(soldier, path, index, preservePositions ? previous.soldiers[index] : null);
      const lastEvent = session.events.at(-1);
      if (index === team.soldiers - 1 && session.phase === 'event' && lastEvent?.key === 'upgrade-soldiers' && lastEvent.teamId === team.id) revealRecruit(soldier);
    }
    colonyViews.set(team.id, { zone, graphics, ants, queen, rooms, center: nursery, sites, labels: [title, subtitle] });
  }

  function revealRecruit(ant) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ant.setScale(.2).setAlpha(.35);
    scene.tweens.add({ targets: ant, scaleX: 1, scaleY: 1, alpha: 1, duration: 850, ease: 'Sine.easeOut' });
  }

  function deliverHarvest(ant, points) {
    ant.setPosition(points[0].x, points[0].y);
    ant.cargo.setVisible(true);
    const route = new Phaser.Curves.Path(points[0].x, points[0].y);
    for (const point of points.slice(1)) route.lineTo(point.x, point.y);
    const progress = { value: 0 };
    scene.tweens.add({ targets: progress, value: 1, duration: 2400, ease: 'Sine.easeInOut', onUpdate: () => {
      if (!ant.active) return;
      const point = route.getPoint(progress.value);
      ant.sprite.setFlipX(point.x < ant.x);
      ant.setPosition(point.x, point.y);
    }, onComplete: () => {
      if (!ant.active) return;
      ant.cargo.setVisible(false);
      const seed = scene.add.ellipse(ant.x + 9, ant.y, 9, 6, 0xf1cc66).setDepth(8);
      scene.tweens.add({ targets: seed, y: seed.y + 10, duration: 450, onComplete: () => seed.destroy() });
    } });
  }

  function focusColony(teamId, siteName = 'nursery') {
    const view = colonyViews.get(teamId);
    if (!view) return;
    $('colonyViewPick').value = teamId;
    const target = view.sites[siteName] || view.center;
    const viewport = $('worldViewport');
    const lowerPanel = !$('worldStory').classList.contains('hidden') ? $('worldStory').offsetHeight + 45 : 80;
    const visibleHeight = viewport.clientHeight - lowerPanel;
    viewport.scrollTo({ top: Math.max(0, target.y - visibleHeight * .48), behavior: 'auto' });
    if (scene) scene.cameras.main.scrollY = viewport.scrollTop;
  }

  function restoreWorldFocus() {
    if (!session) return;
    const event = session.events.at(-1);
    if (session.phase === 'ended' && !session.stormSeen) { playWorldEvent('heavy-rain'); return; }
    if (session.phase === 'event' && event?.key === 'round-supplies') {
      const report = event.reports[event.reportIndex || 0];
      if (report) focusColony(report.teamId, report.hatched ? 'nursery' : 'food');
      return;
    }
    const key = String(event && event.key || '').replace(/^upgrade-/, '');
    if (session.phase === 'event' && REWARD_STORIES[key]) {
      const team = session.teams.find(item => item.id === event.teamId) || currentTeam();
      focusColony(team.id, REWARD_STORIES[key].site);
      celebrate(team.id, key, rewardEffectText(key, event, team));
    } else if (currentTeam()) focusColony(currentTeam().id);
  }

  function updateWorld() {
    if (!scene || !session) return;
    stopWeather();
    if (raidPresentation) {
      const event = raidPresentation.event;
      stopRaidPresentation();
      if (session.phase === 'event') showRaidStory(event);
    }
    const previous = new Map([...colonyViews].map(([id, view]) => [id, {
      zone: view.zone, roomCount: view.rooms.length,
      workers: view.ants.filter(ant => ant.getData('role') === 'worker').map(ant => ({ x: ant.x, y: ant.y })),
      soldiers: view.ants.filter(ant => ant.getData('role') === 'soldier').map(ant => ({ x: ant.x, y: ant.y })),
    }]));
    scene.tweens.killAll();
    scene.children.removeAll(true);
    colonyViews = new Map();
    const width = scene.scale.width;
    const height = scene.scale.height;
    const layoutWidth = width > 850 ? width - Math.min(620, width * .44) : width;
    const count = session.teams.length;
    const columns = layoutWidth < 600 ? 1 : layoutWidth < 1050 ? 2 : Math.min(3, count);
    const zoneWidth = (layoutWidth - 18 * (columns + 1)) / columns;
    const rows = Math.ceil(count / columns);
    const rowHeights = Array.from({ length: rows }, (_, row) => {
      const roomCounts = session.teams.slice(row * columns, (row + 1) * columns).map(team => core.colonyRooms(team).length);
      return 242 + Math.ceil((Math.max(...roomCounts) - 1) / 2) * 166;
    });
    const worldHeight = Math.max(height, 145 + rowHeights.reduce((a, b) => a + b + 28, 0) + 190);
    $('worldScrollSpace').style.height = `${worldHeight}px`;
    fitWorldImage('cq-world', width, height);
    // Tile only the soil portion beneath the first screen to keep the surface above ground.
    const texture = scene.textures.get('cq-world').getSourceImage();
    const soilScale = width / texture.width;
    const soilHeight = texture.height * .6 * soilScale;
    for (let y = height; y < worldHeight; y += soilHeight - 1) {
      const soil = scene.add.image(width / 2, y, 'cq-world').setOrigin(.5, 0).setDepth(-30);
      soil.setCrop(0, texture.height * .4, texture.width, texture.height * .6);
      soil.setScale(soilScale);
      soil.y -= texture.height * .4 * soilScale;
    }
    scene.cameras.main.setBounds(0, 0, width, worldHeight);
    scene.cameras.main.scrollY = $('worldViewport').scrollTop;
    addAmbientLife(layoutWidth, height);
    let rowTop = 133;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const index = row * columns + col;
        if (index >= count) break;
        drawColony(session.teams[index], { x: 18 + col * (zoneWidth + 18), y: rowTop, w: zoneWidth, h: rowHeights[row] }, index, previous.get(session.teams[index].id));
      }
      rowTop += rowHeights[row] + 28;
    }
    $('worldViewport').setAttribute('aria-label', `Colony world, largest colony has ${Math.max(...session.teams.map(team => core.colonyRooms(team).length))} rooms`);
    $('worldViewport').setAttribute('aria-description', session.teams.map(team => {
      const view = colonyViews.get(team.id);
      const workers = view.ants.filter(ant => ant.getData('role') === 'worker').length;
      const soldiers = view.ants.filter(ant => ant.getData('role') === 'soldier').length;
      return `${team.name}: 1 queen, ${workers} workers, ${soldiers} soldiers. ${view.rooms.length} rooms: ${view.rooms.map(room => room.label).join(', ')}. ${core.fortification(team).name} walls. ${core.TEAM_COLORS[team.colorIndex].name} ants.`;
    }).join(' '));
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
      const labelWidth = Math.min(300, view.zone.w - 32);
      const labelX = Phaser.Math.Clamp(origin.x, view.zone.x + labelWidth / 2 + 14, view.zone.x + view.zone.w - labelWidth / 2 - 14);
      const label = scene.add.text(labelX, origin.y - 68, effectText.split(' - ')[0].toUpperCase(), {
        fontFamily: 'Arial', fontSize: view.zone.w < 400 ? '11px' : '13px', fontStyle: 'bold', color: '#fff5cf', backgroundColor: '#254d39', padding: { x: 7, y: 4 }, wordWrap: { width: labelWidth }, align: 'center',
      }).setOrigin(.5, 1).setDepth(14);
      scene.tweens.add({ targets: label, y: label.y - 18, duration: 900, yoyo: true, hold: 2100, ease: 'Sine.easeOut', onComplete: () => label.destroy() });
    }
  }

  function stopWeather() {
    if (!scene) return;
    for (const effect of weatherEffects) {
      if (!effect.active) continue;
      scene.tweens.killTweensOf(effect);
      effect.destroy();
    }
    weatherEffects = [];
  }

  function playWorldEvent(key) {
    if (!scene) return;
    if (key === 'heavy-rain') {
      stopWeather();
      const cloud = scene.add.graphics().setDepth(-3);
      cloud.fillStyle(0x344f63, .4);
      cloud.fillRect(0, 0, scene.scale.width, Math.min(185, scene.scale.height * .27));
      weatherEffects.push(cloud);
      const floor = Math.min(215, scene.scale.height * .32);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (let index = 0; index < 70; index += 1) {
        const drop = scene.add.rectangle((index * 71) % scene.scale.width, -20 - (index % 8) * 18, 2, 16, 0xbde8ff, .8).setDepth(12).setAngle(12);
        weatherEffects.push(drop);
        if (reducedMotion) drop.y = index * 17 % floor;
        else scene.tweens.add({ targets: drop, y: floor, x: drop.x + 55, duration: 750 + (index % 5) * 80, delay: (index % 10) * 50, repeat: -1 });
      }
      for (const view of colonyViews.values()) {
        const water = scene.add.ellipse(view.sites.entrance.x, view.sites.entrance.y + 11, 67, 8, 0x7dc3d9, .55).setDepth(2);
        weatherEffects.push(water);
        if (!reducedMotion) scene.tweens.add({ targets: water, scaleX: 1.12, alpha: .25, duration: 900, yoyo: true, repeat: -1 });
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
  $('worldViewport').addEventListener('scroll', () => {
    if (scene && !raidPresentation) scene.cameras.main.scrollY = $('worldViewport').scrollTop;
    $('worldDepth').textContent = `Depth ${Math.round($('worldViewport').scrollTop / 16)}`;
  }, { passive: true });
  $('worldSurface').addEventListener('click', () => $('worldViewport').scrollTo({ top: 0, behavior: 'smooth' }));
  $('colonyViewPick').addEventListener('change', event => focusColony(event.target.value));
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
  $('targetBack').addEventListener('click', () => { if (session.phase === 'reward' && !transitionLocked) showRewards(); });
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
