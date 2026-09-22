(() => {
  'use strict';

  const core = window.ColonyQuestCore;
  const $ = id => document.getElementById(id);
  const gameId = location.pathname.split('/').filter(Boolean).pop();
  const testMode = new URLSearchParams(location.search).get('test') === '1';
  const localKey = `lessonscope:colonyquest:${testMode ? 'test:' : ''}${gameId}`;
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
  let rendererShutdown = Promise.resolve();
  let startingMatch = false;
  let soundOn = true;
  let winnerCelebrationPlayed = false;
  let audioContext = null;
  let audioOutput = null;
  let effectsBus = null;
  let ambientTimer = null;
  let musicBus = null;
  let musicStep = 0;
  let musicNextTime = 0;
  const musicVoices = new Set();
  let worldStoryAction = null;
  let worldStoryTimer = null;
  let worldEventPresentation = [];
  let raidPresentation = null;
  let actionCamera = false;
  let trackedActionActor = null;
  const ACTION_SPEED = .6;
  let weatherEffects = [];
  let weatherTimers = [];
  let weatherAudioStops = [];
  const ASSETS = {
    world: '/assets/colonyquest/moonroot-meadow.webp',
    worker: '/assets/colonyquest/pip-worker.webp',
    queen: '/assets/colonyquest/queen.webp',
    guardian: '/assets/colonyquest/guardian.webp',
  };
  const STORY = {
    intro: 'Beneath Moonroot Meadow, a tiny colony is waking. Dark clouds are gathering, food is scarce, and each team begins with only a queen, one worker, and a small room. Every correct answer earns one important choice: send workers for food, grow the colony, train guards, dig rooms, or strengthen the walls. Workers keep bringing food home, but every soldier also eats from the store. Build the walls to Level 2 before the Great Rain or water will enter the nest. After rain, food trips earn double food—but hungry birds approach! Reach Level 3 walls before the birds arrive to protect your pantry. Weaker walls let birds steal 40% of stored food. Guards sent raiding are away for 45 active seconds. Then the ground will shake as a giant human crosses the meadow. Only Level 4 walls can withstand the footsteps; weaker colonies lose 25% of their game points. Learn together, choose carefully, and survive to carry the Ancient Acorn.',
    chapters: [
      { at: 0, title: 'First Light', line: 'Help Pip wake a worker and gather the first seeds.' },
      { at: .25, title: 'Deep Roots', line: 'The wind is rising. Dig safe rooms under the old tree.' },
      { at: .5, title: 'Storm Watch', line: 'Dark clouds are close. Store food and strengthen the nest.' },
      { at: .7, title: 'Moonroot Rally', line: 'Guard ants may challenge rival colonies for precious food.' },
      { at: .88, title: 'Final Warning', line: 'Thunder is over the meadow. Finish the rain jobs now.' },
    ],
  };
  const REWARD_STORIES = {
    workers: { title: 'Pip wakes a new worker', text: 'The new worker stretches its legs, follows Pip, and begins bringing one seed home every trip.', site: 'nursery', speaker: 'Pip', speech: 'Wake up! We have seeds to find.' },
    food: { title: 'Pip finds five bright seeds', text: 'A worker carries every seed through the entrance and stores it safely underground.', site: 'food', speaker: 'Pip', speech: 'Carry all five seeds to the pantry!' },
    defense: { title: 'Dot strengthens the walls', text: 'Dot the builder repairs every room with a stronger material. The nest can protect more food from rain.', site: 'nursery', speaker: 'Dot', speech: 'New walls make every room safer.' },
    queen: { title: 'Queen Aurelia lays one egg', text: 'The nurse ants place the egg in the warm queen room. It will hatch in two rounds.', site: 'nursery', speaker: 'Queen Aurelia', speech: 'Keep this little egg warm and safe.' },
    expansion: { title: 'Dot opens a new room', text: 'Workers dig through the soil, carry away the dirt, and connect one new room to the colony.', site: 'expansion', speaker: 'Dot', speech: 'Dig together. The new room is this way!' },
    soldiers: { title: 'Bramble joins the guard', text: 'Bramble trains one new guard ant. The guard patrols the entrance and can defend or challenge another colony.', site: 'guard', speaker: 'Bramble', speech: 'Stand tall. Guard the colony entrance!' },
  };
  const WORLD_EVENT_SCENES = Object.freeze({
    'fallen-fruit': { action: 'Gather the berry', resultTitle: 'The berry is safely stored!', speaker: 'Pip', speech: 'Workers, follow me to the berry!', site: 'food', result: 'The workers carried the berry pieces into the pantry.' },
    'heavy-rain': { action: 'Close the entrances', resultTitle: 'The colony is ready for the rain!', speaker: 'Dot', speech: 'Seal the tunnels before the water comes!', site: 'entrance', result: 'The ants closed the entrances and moved exposed food to safety.' },
    'food-trail': { action: 'Follow Pip', resultTitle: 'The seed trail leads home!', speaker: 'Pip', speech: 'I found seeds. Follow my trail!', site: 'entrance', result: 'The workers followed Pip and carried the bright seeds home.' },
    predator: { action: 'Call Bramble', resultTitle: 'The spider retreats!', speaker: 'Bramble', speech: 'Guards with me. Workers, take cover!', site: 'entrance', result: 'Bramble faced the spider while the workers protected the food.' },
    'tunnel-collapse': { action: 'Help Dot repair it', resultTitle: 'The tunnel is open again!', speaker: 'Dot', speech: 'Move one stone at a time. We can open this path!', site: 'nursery', result: 'Dot and the workers cleared the fallen soil and reopened the tunnel.' },
    'lost-ant': { action: 'Guide the ant home', resultTitle: 'The lost scout is home!', speaker: 'Pip', speech: 'Follow our scent trail. You are nearly home!', site: 'entrance', result: 'The lost scout reached the colony and shared a map to five seeds.' },
    'new-territory': { action: 'Explore the soft soil', resultTitle: 'A safe new path is open!', speaker: 'Dot', speech: 'This soil is safe to dig. Let us explore!', site: 'expansion', result: 'The workers opened a safe path beneath the hidden root.' },
  });
  const COLONY_LAYOUT = Object.freeze({
    gap: 14,
    minimumWidth: 205,
    roomStep: 142,
    baseHeight: 218,
  });
  const MAX_MOVING_ANTS_PER_ROLE = 24;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function colorHex(value) {
    return `#${Number(value || 0).toString(16).padStart(6, '0')}`;
  }

  async function request(path = '', options = {}) {
    if (testMode && options.method && options.method !== 'GET') {
      const payload = JSON.parse(options.body || '{}');
      return path === '' ? { colonyquest: payload, questions: payload.questions } : { ok: true };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(`/api/game/${encodeURIComponent(gameId)}/colonyquest${path}${testMode ? '?test=1' : ''}`, { ...options, signal: controller.signal });
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
      $('resumeText').textContent = session.phase === 'ended' ? 'The winner and team results are ready.' : `Continue from turn ${session.turnIndex + 1}.`;
      $('resumeBtn').textContent = session.phase === 'ended' ? 'See the winner' : 'Continue game';
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
      // Show the mission briefing once at the start of each new match. Saved
      // matches remember it, so resuming never repeats the opening.
      introSeen: false,
      warsActive: false,
      teams,
      answers: [],
      events: [],
    });
  }

  async function startNewMatch() {
    if (startingMatch) return;
    startingMatch = true;
    showNotice('');
    $('startBtn').disabled = true;
    $('startBtn').textContent = 'Preparing colonies...';
    try {
      await rendererShutdown;
      await saveChain.catch(() => {});
      if (session) {
        await request('/session', { method: 'DELETE' });
        session = null;
        clearLocal();
      }
      await saveSetup();
      resetMatchRuntime();
      winnerCelebrationPlayed = false;
      session = initialSession();
      await saveState();
      await enterGame();
    } catch (error) {
      showNotice(error.message);
      $('startBtn').disabled = false;
    } finally {
      startingMatch = false;
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
    $('turnStudent').textContent = member ? `Next learner: ${member.name} · Other teams: choose the upgrade they need` : 'Choose together · Other teams: predict the best upgrade';
    $('studentPick').innerHTML = '<option value="">Choose learner</option>' + (team && team.members || []).map(item => `<option value="${esc(item.id)}"${member && member.id === item.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
  }

  function hideWorldStory() {
    resetActionCamera();
    clearTimeout(worldStoryTimer);
    worldStoryTimer = null;
    clearWorldEventPresentation();
    $('gameScreen').classList.remove('story-open');
    worldStoryAction = null;
    $('worldStory').classList.add('hidden');
    $('worldStoryContinue').disabled = false;
  }

  function clearWorldEventPresentation() {
    if (scene) {
      for (const object of worldEventPresentation) {
        if (!object || !object.active) continue;
        scene.tweens.killTweensOf(object);
        object.destroy();
      }
    }
    worldEventPresentation = [];
  }

  function setOverlay(id) {
    stopRaidPresentation();
    stopWeather();
    hideWorldStory();
    for (const overlay of ['storyOverlay', 'questionOverlay', 'rewardOverlay', 'targetOverlay', 'eventOverlay', 'finalOverlay']) $(overlay).classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
    $('gameScreen').classList.toggle('dock-open', ['questionOverlay', 'rewardOverlay', 'targetOverlay'].includes(id));
    $('gameScreen').classList.toggle('question-open', id === 'questionOverlay');
    $('gameScreen').classList.toggle('full-overlay-open', ['storyOverlay', 'finalOverlay'].includes(id));
  }

  function setWorldStoryContent(details, onContinue) {
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

  function showWorldStory(details, onContinue) {
    setOverlay(null);
    $('gameScreen').classList.add('story-open');
    transitionLocked = false;
    setWorldStoryContent(details, onContinue);
  }

  function replaceWorldStory(details, onContinue) {
    clearTimeout(worldStoryTimer);
    worldStoryTimer = null;
    $('gameScreen').classList.add('story-open');
    transitionLocked = false;
    setWorldStoryContent(details, onContinue);
  }

  function holdWorldStory(duration = 1800, label = 'Watch the ants...') {
    const button = $('worldStoryContinue');
    const readyLabel = button.textContent;
    const expectedAction = worldStoryAction;
    clearTimeout(worldStoryTimer);
    button.disabled = true;
    button.textContent = label;
    const wait = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : Math.max(3500, duration / (actionCamera ? ACTION_SPEED : 1) + 650);
    worldStoryTimer = setTimeout(() => {
      worldStoryTimer = null;
      if (worldStoryAction !== expectedAction || $('worldStory').classList.contains('hidden')) return;
      button.textContent = readyLabel;
      button.disabled = false;
    }, wait);
  }

  async function waitForWorldReady(timeout = 3000) {
    const started = Date.now();
    while ((!scene || !colonyViews.size) && Date.now() - started < timeout) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return !!scene && colonyViews.size > 0;
  }

  function storyChapter() {
    const progress = session ? turnProgress() : 0;
    return [...STORY.chapters].reverse().find(chapter => progress >= chapter.at) || STORY.chapters[0];
  }

  function chapterMission(team) {
    return { title: 'Protect your colony', goals: core.rainPreparation(team) };
  }

  function stormStatus(progress) {
    if (progress >= .88) return { stage: 'danger', text: 'Thunder overhead - the Great Rain is almost here' };
    if (progress >= .68) return { stage: 'near', text: 'Dark clouds are crossing the meadow' };
    if (progress >= .42) return { stage: 'watch', text: 'The wind is rising' };
    return { stage: 'calm', text: 'The Great Rain is still far away' };
  }

  function chapterKey(chapter) {
    return `chapter-${chapter.title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
  }

  function chapterEvent(key) {
    const index = STORY.chapters.findIndex(chapter => chapterKey(chapter) === key);
    if (index < 0) return null;
    const chapter = STORY.chapters[index];
    const tone = chapter.title === 'Final Warning' ? 'storm' : chapter.title === 'Moonroot Rally' ? 'danger' : 'good';
    return { key, title: chapter.title, description: chapter.line, kicker: `Chapter ${index + 1}`, tone };
  }

  function showStoryIntro() {
    $('storyKicker').textContent = 'The Moonroot Meadow Mission';
    $('storyTitle').textContent = 'Build. Prepare. Survive.';
    $('storyText').textContent = STORY.intro;
    setOverlay('storyOverlay');
    restartStoryCrawl();
  }

  function restartStoryCrawl() {
    const crawl = $('storyCrawl');
    crawl.classList.remove('is-moving', 'is-paused');
    void crawl.offsetWidth;
    crawl.classList.add('is-moving');
    $('storyPause').textContent = 'Pause story';
    $('storyPause').setAttribute('aria-pressed', 'false');
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
    updateBirdPanel();
    const team = currentTeam();
    const mission = chapterMission(team);
    const goals = mission.goals;
    const weather = stormStatus(turnProgress());
    $('rainSummary').textContent = `${mission.title}: ${goals.filter(goal => goal.done).length}/${goals.length} ready`;
    $('rainTeam').textContent = `${team.name} · Workers bring 1 food per trip (12 seconds); each guard eats 1 every 30 seconds.`;
    $('rainGoals').innerHTML = goals.map(goal => `<li class="${goal.done ? 'ready' : ''}"><input type="checkbox" disabled${goal.done ? ' checked' : ''} aria-label="${esc(goal.label)}"><span>${esc(goal.label)}</span><b>${esc(goal.value)}</b></li>`).join('');
    $('rainApproach').value = turnProgress();
    $('stormLabel').textContent = session.rainOccurred ? 'Rain passed · Level 4 walls before the final footstep' : `Rain in ${config.matchType === 'time' ? Math.max(0, Math.ceil((.5 - turnProgress()) * config.durationMinutes * 60)) + ' seconds' : Math.max(1, Math.ceil(totalTurns() / 2) - session.turnIndex) + ' question turns'} · Level 2 walls keep food dry`;
    $('gameScreen').dataset.stormStage = weather.stage;
    $('scoreStrip').innerHTML = session.teams.map((item, index) => {
      const palette = core.TEAM_COLORS[item.colorIndex];
      return `<div class="score-card${index === session.currentTeamIndex && session.phase !== 'ended' ? ' current' : ''}" style="--team-color:${colorHex(palette.primary)}"><div class="score-name"><span>${esc(item.name)}</span><span>${core.colonyStrength(item)} pts</span></div><div class="score-stats"><span>1 queen</span><span>${item.workers} workers</span><span>${item.soldiers} guards</span><span>${item.food} food</span><span>Walls level ${item.defense + 1}</span></div></div>`;
    }).join('');
    const options = session.teams.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    session.teams.forEach((item, index) => {
      if (!item.raidAway) return;
      const note = document.createElement('small');
      note.textContent = `${core.homeGuards(item)} guards home · ${item.raidAway} returning from raid`;
      $('scoreStrip').children[index]?.append(note);
    });
    if ($('colonyViewPick').innerHTML !== options) $('colonyViewPick').innerHTML = options;
    if (team) {
      const palette = core.TEAM_COLORS[team.colorIndex];
      $('turnBanner').style.setProperty('--team-color', colorHex(palette.primary));
      $('turnTeam').textContent = `${team.name}'s turn`;
    }
    const round = Math.floor(session.turnIndex / Math.max(1, session.teams.length)) + 1;
    $('roundLabel').textContent = config.matchType === 'rounds' ? `Round ${Math.min(round, config.rounds)} of ${config.rounds}` : timeLabel();
    const chapter = storyChapter();
    $('phaseLabel').textContent = session.phase === 'ended' ? 'Journey complete' : session.rainOccurred ? 'Final footstep · Level 4 walls' : `${$('stormLabel').textContent.split(' · ')[0]} · Level 2 walls`;
    if (session.phase !== 'ended' && ['rush', 'warning', 'attack'].includes(session.birdStage)) $('phaseLabel').textContent = session.birdStage === 'rush' ? 'Food rush · Prepare for birds' : 'Birds · Level 3 walls protect food';
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

  function updateBirdPanel() {
    const panel = $('birdPanel');
    const stage = session.birdStage;
    const visible = ['rush', 'warning', 'attack', 'result'].includes(stage) && session.phase !== 'ended';
    panel.classList.toggle('hidden', !visible);
    $('gameScreen').classList.toggle('bird-active', visible);
    if (!visible) return;
    const seconds = Math.ceil(session.birdStageMs / 1000);
    const title = { rush: 'Food rush! Each trip brings double food', warning: 'Shadows over the meadow! Birds approaching', attack: 'Birds are swooping! Protect the pantry', result: 'The birds have flown away' }[stage];
    panel.innerHTML = `<strong>${title}${stage === 'result' ? '' : ` · ${seconds}s`}${session.phase === 'paused' ? ' · Paused' : ''}</strong><small>Level 3 walls protect your food. Birds steal 40% of stored food through weaker walls (rounded up). Workers are safe.</small><div class="bird-colonies">${session.teams.map(team => `<div><b>${esc(team.name)}</b><span>${stage === 'result' ? `${team.birdFoodLoss || 0} food stolen` : `Walls level ${team.defense + 1} · ${team.defense >= 2 ? 'Food protected' : 'Strengthen walls to level 3'}`}</span></div>`).join('')}</div>`;
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
    $('guideLine').textContent = `${storyChapter().line} Get this right to win one upgrade.`;
    $('questionText').textContent = question.question;
    $('questionProgress').textContent = `Question ${(session.questionCursor % data.game.questions.length) + 1} of ${data.game.questions.length}`;
    $('answers').innerHTML = question.options.map((option, index) => `<button type="button" class="answer" data-choice="${index}"><span>${String.fromCharCode(65 + index)}.</span> ${esc(option)}</button>`).join('');
    $('feedback').className = 'feedback';
    $('feedbackNext').textContent = 'Next';
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
    $('feedbackText').textContent = correct ? 'Correct! Your team won one colony upgrade.' : `Good try. The right answer is ${question.options[question.correctIndex]}.`;
    $('feedbackNext').style.display = 'none';
    playTone(correct ? 'correct' : 'wrong');
    // Keep the answer feedback long enough to read, then move on without
    // asking the teacher to dismiss a second message every turn.
    window.setTimeout(() => commitOutcome().catch(error => toast(error.message)), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 1100);
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
    // Raiding remains a strategic growth choice. Its result plays in the
    // meadow and then advances automatically, rather than opening report
    // panels that the teacher must clear.
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
    if (key === 'defense') return `${core.fortification(team).name} walls around the colony - wall level ${team.defense}`;
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
    if (key === 'defense' && team.defense >= core.FORTIFICATIONS.length - 1) return 'The walls are as strong as they can be';
    const clones = session.teams.map(item => ({ ...item, eggs: (item.eggs || []).map(egg => ({ ...egg })), members: (item.members || []).map(member => ({ ...member })) }));
    const preview = clones.find(item => item.id === team.id);
    const before = { ...preview };
    core.applyReward(preview, key, clones);
    const effect = rewardEffectText(key, rewardChange(key, before, preview), preview);
    return key === 'expansion' ? `+1 ${core.colonyRooms(preview).at(-1).label}. ${core.roomBenefit(core.colonyRooms(preview).at(-1))}` : effect;
  }

  async function showGrowth(event) {
    if (session.phase !== 'event') return;
    const key = String(event && event.key || '').replace(/^upgrade-/, '');
    const team = session.teams.find(item => item.id === (event && event.teamId)) || currentTeam();
    const story = REWARD_STORIES[key] || { title: 'The colony grows', text: 'The ants put their new reward to work inside the nest.', site: 'center' };
    setOverlay(null);
    celebrate(team.id, key);
    focusColony(team.id, story.site, true);
    const actionDuration = playUpgradeAction(team.id, key);
    updateHUD();
    // The ants visibly build, gather, hatch, or strengthen their home. A
    // short automatic beat preserves that reward without a story popup.
    await new Promise(resolve => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : Math.max(1200, actionDuration / ACTION_SPEED + 250)));
    resetActionCamera();
    if (session && session.phase === 'event') await nextTurn();
  }

  function showRewards() {
    if (session.phase !== 'reward') return;
    transitionLocked = false;
    const team = currentTeam();
    $('rewardTitle').textContent = `${team.name}: pick one upgrade`;
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
        const comparison = `${forecast.attackers} attacking guards vs ${forecast.defenders} home guards. Rooms and walls add ${forecast.supportBonus || 0} defense power`;
        return `<button type="button" data-target="${esc(item.id)}"${!eligibility.allowed ? ' disabled' : ''}>${esc(item.name)}<small>${esc(core.TEAM_COLORS[item.colorIndex].name)} ants · ${item.food} food · ${item.soldiers} guards · ${esc(core.fortification(item).name)} walls</small><small>${!eligibility.allowed ? esc(eligibility.reason) : `${esc(comparison)}. ${forecast.success ? 'Your group is favoured.' : 'Some guards may need to rest afterward.'}`}</small></button>`;
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
    await showGrowth(event);
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

  function worldEventFocusTeam(event) {
    const teams = session.teams || [];
    if (!teams.length) return null;
    if (event && event.focusTeamId) return teams.find(team => team.id === event.focusTeamId) || currentTeam();
    if (['lost-ant', 'fallen-fruit', 'new-territory'].includes(event && event.key)) {
      return [...teams].sort((a, b) => core.colonyStrength(a) - core.colonyStrength(b))[0];
    }
    if (['predator', 'heavy-rain', 'tunnel-collapse'].includes(event && event.key)) {
      return [...teams].sort((a, b) => (a.defense * 3 + a.soldiers + a.workers) - (b.defense * 3 + b.soldiers + b.workers))[0];
    }
    return currentTeam() || teams[0];
  }

  function worldEventSnapshot() {
    return new Map(session.teams.map(team => [team.id, {
      food: team.food,
      workers: team.workers,
      rooms: core.colonyRooms(team).length,
    }]));
  }

  function worldEventEffects(before) {
    return session.teams.map(team => {
      const old = before.get(team.id) || { food: team.food, workers: team.workers, rooms: core.colonyRooms(team).length };
      return {
        teamId: team.id,
        foodDelta: team.food - old.food,
        workersDelta: team.workers - old.workers,
        roomsDelta: core.colonyRooms(team).length - old.rooms,
      };
    });
  }

  function stopRaidPresentation() {
    const raid = raidPresentation;
    $('raidHud').classList.add('hidden');
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
    for (const effect of raid.effects || []) if (effect.active) effect.destroy();
    raid.trail?.destroy();
    if (scene) scene.cameras.main.setZoom(1).setScroll(0, $('worldViewport').scrollTop);
    $('worldViewport').removeAttribute('data-raid-phase');
    $('gameScreen').classList.remove('raid-playing');
  }

  function setRaidHud(event, attacker, defender, phase) {
    const attackColor = colorHex(core.TEAM_COLORS[attacker.colorIndex].primary);
    const defenseColor = colorHex(core.TEAM_COLORS[defender.colorIndex].primary);
    const resolved = phase === 'result' || phase === 'returning';
    $('raidAttacker').textContent = attacker.name;
    $('raidDefender').textContent = defender.name;
    $('raidAttackCount').textContent = `${resolved ? attacker.soldiers : event.attackers} guards${resolved && event.attackerLosses ? ` · ${event.attackerLosses} resting` : ''}`;
    $('raidDefenseCount').textContent = `${resolved ? defender.soldiers : event.defenders} guards${resolved && event.defenderLosses ? ` · ${event.defenderLosses} resting` : ''}`;
    $('raidPhase').textContent = phase === 'outbound' ? 'Marching' : phase === 'at-nest' ? 'Battle!' : event.success ? 'Raid won' : 'Raid stopped';
    $('raidPower').textContent = `${event.attack} power vs ${event.guard} defense`;
    document.querySelector('.raid-side.attacking').style.setProperty('--raid-color', attackColor);
    document.querySelector('.raid-side.defending').style.setProperty('--raid-color', defenseColor);
    $('raidHud').classList.remove('hidden');
  }

  function showBattleBurst(point, colors, effects) {
    if (!scene) return;
    scene.cameras.main.shake(280, .006);
    for (let index = 0; index < 12; index += 1) {
      const angle = Math.PI * 2 * index / 12;
      const spark = scene.add.circle(point.x, point.y, 3 + index % 3, colors[index % colors.length], .95).setDepth(18);
      effects.push(spark);
      scene.tweens.add({ targets: spark, x: point.x + Math.cos(angle) * (35 + index * 3), y: point.y + Math.sin(angle) * (22 + index * 2), alpha: 0, duration: 620, ease: 'Cubic.easeOut' });
    }
  }

  function raidLossLine(event) {
    const resting = [];
    if (event.attackerLosses) resting.push(`${event.attackerLosses} attacking ${event.attackerLosses === 1 ? 'guard returns' : 'guards return'} inside to rest and work`);
    if (event.defenderLosses) resting.push(`${event.defenderLosses} defending ${event.defenderLosses === 1 ? 'guard returns' : 'guards return'} inside to rest and work`);
    return resting.length ? `${resting.join(' and ')}.` : 'Every guard returns safely.';
  }

  function showRaidStory(event, animate = false) {
    const attacker = session.teams.find(team => team.id === event.attackerId);
    const defender = session.teams.find(team => team.id === event.defenderId);
    if (!attacker || !defender) return showEvent({ title: 'The raid is over', description: 'The colonies are ready for their next turn.' }, nextTurn);
    const attackers = Math.max(1, event.attackers || attacker.soldiers + (event.attackerLosses || 0));
    const defenders = Math.max(0, event.defenders || defender.soldiers + (event.defenderLosses || 0));
    event.attackers = attackers;
    event.defenders = defenders;
    event.attack = event.attack || attackers * 5;
    event.guard = event.guard || defenders * 5 + (event.wallBonus || 0);
    const finish = async () => {
      stopRaidPresentation();
      setOverlay(null);
      focusColony(event.success ? attacker.id : defender.id, event.success ? 'food' : 'guard');
      updateHUD();
      // Keep the battle and its colony change visible, then continue without
      // asking the class to click through a written raid report.
      await new Promise(resolve => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 700));
      if (session && session.phase === 'event') await nextTurn();
    };
    if (!animate || !scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    const home = colonyViews.get(attacker.id), away = colonyViews.get(defender.id);
    if (!home || !away) return finish();
    setOverlay(null);
    playAntSound('march');
    const attackerActorCount = Math.min(8, attackers);
    const defenderActorCount = Math.min(8, defenders);
    const party = home.ants.filter(ant => ant.getData('role') === 'soldier').slice(0, attackerActorCount);
    const homeGuards = away.ants.filter(ant => ant.getData('role') === 'soldier').slice(0, defenderActorCount);
    // Stand-ins preserve the pre-battle groups even though the result is already saved.
    const hidden = [...party, ...homeGuards];
    const attackActors = Array.from({ length: attackerActorCount }, (_, index) => makeAntAgent('cq-guardian', { x: home.sites.entrance.x + (index % 3 - 1) * 15, y: home.sites.entrance.y + Math.floor(index / 3) * 8 }, 36, core.TEAM_COLORS[attacker.colorIndex].primary));
    for (const ant of hidden) ant.setVisible(false);
    const destination = { x: away.sites.entrance.x - Math.sign(away.sites.entrance.x - home.sites.entrance.x || 1) * 34, y: away.sites.entrance.y - 12 };
    const points = [{ x: home.sites.nursery.x + 37, y: home.sites.nursery.y + 22 }, home.sites.entrance, { x: home.sites.entrance.x, y: home.sites.entrance.y - 28 }, { x: away.sites.entrance.x, y: away.sites.entrance.y - 28 }, away.sites.entrance, destination];
    const route = new Phaser.Curves.Path(points[0].x, points[0].y);
    for (const point of points.slice(1)) route.lineTo(point.x, point.y);
    const trail = scene.add.graphics().setDepth(4);
    for (const point of route.getSpacedPoints(45)) ellipse(trail, point.x, point.y + 8, 3, 3, core.TEAM_COLORS[attacker.colorIndex].light, .65);
    const defenseActors = Array.from({ length: defenderActorCount }, (_, index) => {
      const guard = makeAntAgent('cq-guardian', { x: away.sites.entrance.x + (index % 3 - 1) * 17, y: away.sites.entrance.y + 8 + Math.floor(index / 3) * 9 }, 36, core.TEAM_COLORS[defender.colorIndex].primary);
      guard.sprite.setFlipX(away.sites.entrance.x > home.sites.entrance.x);
      return guard;
    });
    const actors = [...attackActors, ...defenseActors];
    const labels = [...colonyViews.values()].flatMap(view => view.labels);
    for (const label of labels) label.setVisible(false);
    const effects = [];
    const raid = { event, actors, hidden, labels, trail, effects, tween: null };
    raidPresentation = raid;
    $('gameScreen').classList.add('raid-playing');
    setRaidHud(event, attacker, defender, 'outbound');
    const progress = { value: 0 };
    const camera = scene.cameras.main;
    camera.setZoom(1.35);
    const meeting = route.getPoint(1);
    const attackLossVisuals = event.attackerLosses ? Math.max(1, Math.round(event.attackerLosses / attackers * attackerActorCount)) : 0;
    const defenseLossVisuals = event.defenderLosses && defenderActorCount ? Math.max(1, Math.round(event.defenderLosses / defenders * defenderActorCount)) : 0;
    let lastPhase = '';
    raid.tween = scene.tweens.add({ targets: progress, value: 1, duration: 4200, ease: 'Linear',
      onUpdate: () => {
        if (raidPresentation !== raid) return;
        const p = progress.value;
        const phase = p < .34 ? 'outbound' : p < .68 ? 'at-nest' : 'returning';
        const battleProgress = Phaser.Math.Clamp((p - .34) / .34, 0, 1);
        const distance = phase === 'outbound' ? p / .34 : phase === 'returning' ? (1 - p) / .32 : 1;
        for (let index = 0; index < attackActors.length; index += 1) {
          const ant = attackActors[index];
          const lost = index >= attackActors.length - attackLossVisuals;
          if (phase === 'at-nest') {
            const side = Math.sign(home.sites.entrance.x - away.sites.entrance.x || -1);
            const lunge = Math.sin(battleProgress * Math.PI * 10 + index) * 8;
            ant.setPosition(meeting.x + side * (20 + (index % 3) * 11) - side * lunge, meeting.y + (index % 3 - 1) * 12);
            ant.sprite.setFlipX(side > 0);
            if (lost && battleProgress > .58) ant.setAlpha(1).setAngle(0);
          } else {
            const t = Phaser.Math.Clamp(distance - index * .014, 0, 1);
            const point = route.getPoint(t), ahead = route.getPoint(Math.min(1, t + .01));
            ant.setPosition(point.x, point.y + index % 3 * 7).setAlpha(1).setAngle(0);
            ant.sprite.setFlipX(phase === 'returning' ? ahead.x >= point.x : ahead.x < point.x);
            ant.cargo.setVisible(phase === 'returning' && event.success && event.stolen > 0);
          }
        }
        for (let index = 0; index < defenseActors.length; index += 1) {
          const ant = defenseActors[index];
          const lost = index >= defenseActors.length - defenseLossVisuals;
          const side = Math.sign(away.sites.entrance.x - home.sites.entrance.x || 1);
          const lunge = phase === 'at-nest' ? Math.sin(battleProgress * Math.PI * 10 + index + 1) * 7 : 0;
          ant.setPosition(meeting.x + side * (22 + (index % 3) * 11) - side * lunge, meeting.y + (index % 3 - 1) * 12);
          ant.sprite.setFlipX(side < 0);
          if (lost && phase !== 'outbound' && battleProgress > .58) ant.setAlpha(1).setAngle(0);
        }
        const lead = attackActors.find(actor => actor.visible) || attackActors[0];
        camera.setZoom(phase === 'at-nest' ? 2.15 : phase === 'outbound' ? 1.55 + distance * .35 : 1.7);
        camera.centerOn(phase === 'at-nest' ? meeting.x : lead.x, (phase === 'at-nest' ? meeting.y : lead.y) + 18);
        if (phase !== lastPhase) {
          lastPhase = phase;
          $('worldViewport').dataset.raidPhase = phase;
          setRaidHud(event, attacker, defender, phase);
          $('worldStoryTitle').textContent = phase === 'outbound' ? `${attacker.name} crosses the meadow` : phase === 'at-nest' ? 'The guard ants clash at the entrance!' : event.success ? `${attacker.name} carries food home` : `${attacker.name} retreats`;
          $('worldStoryEffect').textContent = phase === 'outbound' ? `${attackers} guards against ${defenders} guards and ${core.fortification(defender).name.toLowerCase()} walls` : phase === 'at-nest' ? `${event.attack} attack power vs ${event.guard} defense power` : raidLossLine(event);
          if (phase === 'at-nest') {
            showBattleBurst(meeting, [core.TEAM_COLORS[attacker.colorIndex].light, core.TEAM_COLORS[defender.colorIndex].light, 0xffd66b], effects);
            playAntSound('battle');
            playTone('battle');
          }
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
      updateWorld();
      await saveState();
      // Food collection and hatching remain visible in each colony, but the
      // game no longer pauses once per colony to narrate them.
      reports.filter(report => report.hatched).forEach(report => celebrate(report.teamId, 'workers', '+1 worker'));
    }
    await beginTurn(previousChapter);
    if (!session.rainOccurred && session.teams.every(team => team.attempts >= 1) && turnProgress() >= .5) {
      core.applyRain(session); updateHUD(); playWorldEvent('heavy-rain'); await saveState();
    }
  }

  function showRoundStory(event) {
    if (session.phase !== 'event') return;
    const report = event.reports[event.reportIndex || 0];
    if (!report) { showWorldStory({ title: 'The foraging round is complete', text: 'The colonies are ready for their next question.' }, () => beginTurn(event.chapterBefore)); return; }
    const team = session.teams.find(item => item.id === report.teamId);
    const egg = team.eggs?.[0];
    showWorldStory({
      kicker: 'The workers come home',
      title: `${team.name}: food report`,
      text: `${report.gathered} seeds gathered. The colony ate ${report.eaten}. ${report.hatched ? 'One egg hatched! A new worker takes its first steps.' : egg ? `The next egg hatches in ${Math.max(1, egg.roundsLeft)} round${egg.roundsLeft === 1 ? '' : 's'}.` : 'Every completed worker trip brings one seed home.'}`,
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
    if (report.hatched) holdWorldStory(playHatchAction(team.id), 'Watch the egg hatch...');
    else holdWorldStory(2600, 'Watch the workers bring food home...');
  }

  async function beginTurn(previousChapter) {
    if (session.phase === 'ended' || session.phase === 'paused') return;
    if (shouldStartWars()) {
      session.warsActive = true;
      session.events.push({ key: 'colony-wars', at: new Date().toISOString() });
      updateWorld();
      await saveState();
      playTone('wars');
    }
    const nextChapter = storyChapter();
    if (nextChapter.title !== previousChapter) {
      const chapter = chapterEvent(chapterKey(nextChapter));
      session.events.push({ key: chapterKey(nextChapter), at: new Date().toISOString() });
      updateWorld();
      await saveState();
      playTone('upgrade');
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
    if (event.key === 'food-trail') return 'More workers can bring home more food from Pip\'s golden trail.';
    if (event.key === 'predator') return 'Guardians and strong walls keep more of the colony stores safe.';
    if (event.key === 'tunnel-collapse') return 'Workers and strong walls help clear the tunnel without losing food.';
    if (event.key === 'lost-ant') return 'Guide the scout home to discover five seeds for the colony that needs help.';
    if (event.key === 'new-territory') return 'A new room and flag appear for the colonies that need more space.';
    if (event.key === 'chapter-final-warning') return 'Lightning is above Moonroot Meadow. Finish every rain job now.';
    if (event.kicker === 'Chapter 4') return 'The Great Rain is close. Choose what your colony still needs.';
    if (String(event.kicker || '').startsWith('Chapter')) return 'Look at how far every colony has grown.';
    return '';
  }

  function worldEventResultEffect(event, team) {
    const effect = (event.effects || []).find(item => item.teamId === team?.id);
    if (!effect) return worldEventEffect(event);
    const changes = [];
    if (effect.foodDelta > 0) changes.push(`+${effect.foodDelta} food`);
    if (effect.foodDelta < 0) changes.push(`${Math.abs(effect.foodDelta)} food could not be saved`);
    if (effect.workersDelta > 0) changes.push(`+${effect.workersDelta} worker`);
    if (effect.roomsDelta > 0) changes.push(`+${effect.roomsDelta} room`);
    if (!changes.length) changes.push('The colony protected everything');
    return `${team.name}: ${changes.join(' · ')}`;
  }

  function showEvent(event, onContinue) {
    if (session.phase === 'paused' || session.phase === 'ended') return;
    const eventScene = WORLD_EVENT_SCENES[event && event.key];
    const guardianMoment = event.tone === 'danger' || event.tone === 'storm' || event.kicker === 'Colony Wars';
    if (eventScene) {
      const team = worldEventFocusTeam(event);
      showWorldStory({
        kicker: event.kicker || 'A Moonroot Meadow event',
        title: event.title,
        text: event.description,
        effect: worldEventEffect(event),
        tone: event.tone,
        art: guardianMoment ? ASSETS.guardian : ASSETS.worker,
        continueLabel: eventScene.action,
      }, async () => {
        clearWorldEventPresentation();
        await waitForWorldReady();
        if (!session || session.phase === 'paused' || session.phase === 'ended') return;
        updateWorld();
        focusColony(team.id, eventScene.site);
        const duration = playWorldEvent(event.key, team.id);
        await new Promise(resolve => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? duration : duration / ACTION_SPEED + 650));
        if (!session || session.phase === 'paused' || session.phase === 'ended') return;
        replaceWorldStory({
          kicker: `${eventScene.speaker} reports back`,
          title: eventScene.resultTitle,
          text: eventScene.result,
          effect: worldEventResultEffect(event, team),
          tone: event.tone,
          art: guardianMoment ? ASSETS.guardian : ASSETS.worker,
          continueLabel: 'Continue journey',
        }, onContinue);
        showAntSpeech(team.id, eventScene.speaker, eventScene.result, eventScene.site, 3200);
      });
      focusColony(team.id, eventScene.site);
      stageWorldEvent(event.key, team.id);
      worldEventPresentation.push(...showAntSpeech(team.id, eventScene.speaker, eventScene.speech, eventScene.site, 0));
      return;
    }
    showWorldStory({
      kicker: event.kicker || 'A Moonroot Meadow event',
      title: event.title,
      text: event.description,
      effect: worldEventEffect(event),
      tone: event.tone,
      art: guardianMoment ? ASSETS.guardian : ASSETS.worker,
    }, onContinue);
    if (event.key === 'chapter-final-warning') playWorldEvent('heavy-rain');
  }

  async function finishMatch() {
    $('teacherTray').classList.remove('open');
    if (!session || session.phase === 'ended') {
      if (session) session.stormSeen ? showFinal() : showRainFinale();
      return;
    }
    const stomp = core.applyHumanStomp(session);
    session.phase = 'ended';
    stopAmbient();
    session.endedAt = new Date().toISOString();
    session.stormSeen = true;
    setOverlay(null);
    updateHUD();
    await saveState();
    playTone('victory');
    updateWorld();
    if (stomp && scene) playHumanFootsteps();
    else showFinal();
  }

  function playHumanFootsteps() {
    $('gameScreen').classList.add('human-crossing');
    $('worldViewport').scrollTo({ top: 0, behavior: 'auto' });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = scene.scale.width;
    const height = scene.scale.height;
    const groundY = Math.min(height * .34, 225);
    const firstX = width * .4;
    const secondX = width * .72;
    const warning = scene.add.text(width / 2, Math.max(74, groundY - 105), 'THE GROUND IS SHAKING...', {
      fontFamily: 'Georgia, serif', fontSize: `${Math.max(24, Math.min(42, width * .032))}px`, fontStyle: 'bold',
      color: '#fff1bb', backgroundColor: '#1c1915dd', padding: { x: 18, y: 10 }, align: 'center',
      stroke: '#4b2e1f', strokeThickness: 4,
    }).setOrigin(.5).setDepth(112).setAlpha(0);
    const announce = (message, color = '#fff1bb') => {
      warning.setText(message).setColor(color).setAlpha(1).setScale(1);
      if (!reduced) scene.tweens.add({ targets: warning, scaleX: 1.06, scaleY: 1.06, yoyo: true, duration: 260, ease: 'Sine.easeInOut' });
    };
    const shadow = scene.add.ellipse(-180, groundY + 5, Math.min(390, width * .35), 58, 0x151510, .46).setDepth(80);
    const leg = scene.add.image(-240, -80, 'cq-human-leg').setOrigin(.5, 1).setDepth(100);
    // Keep the trouser leg visible as well as the boot; the ants should see a
    // giant human step, not a detached shoe crossing the top of the screen.
    leg.setDisplaySize(Math.min(220, height * .32), Math.min(330, height * .47));
    leg.setAngle(-9);

    const groundImpact = (x, intensity = 1) => {
      playFootstep(0, intensity);
      if (!reduced) scene.cameras.main.shake(390, .014 * intensity);
      const print = scene.add.ellipse(x, groundY + 3, Math.min(118, width * .1), 28, 0x171711, .38).setDepth(79).setAngle(-8);
      const ring = scene.add.ellipse(x, groundY + 5, 90, 20, 0xf2ddae, .15).setStrokeStyle(4, 0xffefc8, .72).setDepth(87);
      scene.tweens.add({ targets: ring, scaleX: 2.55, scaleY: 2.2, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
      scene.tweens.add({ targets: print, alpha: .16, duration: 2200, delay: 700 });
      for (let index = 0; index < 16; index += 1) {
        const side = index % 2 ? 1 : -1;
        const dust = scene.add.circle(x + side * (18 + index % 4 * 8), groundY - 1, 3 + index % 3, index % 3 ? 0xc8a66d : 0xe5c991, .76).setDepth(88);
        scene.tweens.add({ targets: dust, x: dust.x + side * (36 + index * 3), y: dust.y - 18 - (index % 5) * 7, scaleX: 1.7, scaleY: 1.7, alpha: 0, duration: 430 + index * 24, ease: 'Cubic.easeOut', onComplete: () => dust.destroy() });
      }
    };

    const collapse = () => {
      for (const team of session.teams) {
        const view = colonyViews.get(team.id);
        if (!view) continue;
        if (team.collapsePenalty > 0) {
          view.graphics.setAlpha(.4);
          const cracks = scene.add.graphics().setDepth(89);
          cracks.lineStyle(5, 0x20140e, .95);
          const { x, y } = view.center;
          cracks.beginPath(); cracks.moveTo(x - 55, y - 35);
          cracks.lineTo(x - 15, y - 8); cracks.lineTo(x - 30, y + 10); cracks.lineTo(x + 40, y + 40); cracks.strokePath();
        }
        scene.add.text(view.center.x - 70, view.center.y - 10,
          team.defense < 3 ? 'Walls collapsed\n−25% game points' : 'Level 4+ walls held!',
          { fontSize: '16px', color: '#fff', backgroundColor: '#49382b', padding: { x: 5, y: 5 } }).setDepth(90);
      }
    };

    if (reduced) {
      shadow.x = firstX;
      leg.setPosition(firstX, groundY);
      leg.setAngle(0);
      groundImpact(firstX, .82);
      collapse();
      playFootstep(.72, .72);
    } else {
      announce('THE GROUND IS SHAKING...');
      playHumanRumble(2.2);
      scene.cameras.main.shake(1500, .0028);
      scene.tweens.add({ targets: shadow, x: firstX, scaleX: .7, alpha: .66, duration: 1550, delay: 1150, ease: 'Cubic.easeIn' });
      scene.tweens.add({ targets: leg, x: firstX, y: groundY, angle: 0, duration: 1550, delay: 1150, ease: 'Cubic.easeIn', onStart: () => announce('A GIANT HUMAN IS CROSSING THE MEADOW!'), onComplete: () => {
        announce('FIRST FOOTSTEP — CHECK THE WALLS!', '#ffffff');
        groundImpact(firstX, 1);
        collapse();
        scene.tweens.add({ targets: leg, x: secondX, y: groundY - 155, angle: 9, duration: 1150, delay: 1300, ease: 'Sine.easeInOut', onStart: () => announce('THE NEXT STEP IS COMING...'), onComplete: () => {
          leg.setFlipX(true);
          scene.tweens.add({ targets: leg, x: secondX, y: groundY, angle: -2, duration: 820, ease: 'Cubic.easeIn', onComplete: () => {
            announce('SECOND FOOTSTEP!', '#ffffff');
            groundImpact(secondX, .9);
            scene.tweens.add({ targets: leg, x: width + 280, y: groundY - 115, angle: -8, duration: 1250, delay: 1250, ease: 'Cubic.easeIn', onStart: () => announce('THE HUMAN IS MOVING AWAY...'), onComplete: () => announce('THE COLONIES THAT PREPARED HAVE SURVIVED!', '#b9ffd1') });
          } });
        } });
        scene.tweens.add({ targets: shadow, x: secondX, scaleX: .52, alpha: .28, duration: 1150, delay: 1300, ease: 'Sine.easeInOut', onComplete: () => {
          scene.tweens.add({ targets: shadow, scaleX: .74, alpha: .62, duration: 820, ease: 'Cubic.easeIn', onComplete: () => {
            scene.tweens.add({ targets: shadow, x: width + 230, alpha: 0, duration: 1250, delay: 1250 });
          } });
        } });
      } });
    }
    // A renderer resize must not strand the ending by cancelling a scene timer.
    setTimeout(showFinal, reduced ? 2400 : 9600);
  }

  function showRainFinale() { showFinal(); }

  function showWinnerJourney() {
    const first = core.rankTeams(session.teams)[0];
    if (!first) return showFinal();
    const winner = first.team;
    const rooms = core.colonyRooms(winner);
    const outcome = core.rainOutcome(winner);
    showWorldStory({
      kicker: 'Final chapter - morning returns',
      title: `${winner.name} carries the Ancient Acorn`,
      text: `Follow Pip through ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}. The colony has ${winner.workers} workers, ${winner.soldiers} guards, and ${core.fortification(winner).name.toLowerCase()} walls. It kept ${outcome.protectedFood} seeds dry through the storm.`,
      effect: `${first.score} colony strength · ${winner.correct}/${winner.attempts} answers right`,
      art: ASSETS.queen,
      continueLabel: 'See every team result',
    }, showFinal);
    focusColony(winner.id, rooms.length > 1 ? 'expansion' : 'nursery');
    celebrate(winner.id, 'queen', 'THE ANCIENT ACORN IS SAFE');
  }

  function bestTeamBy(key) {
    return [...session.teams].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))[0];
  }

  function showFinal() {
    $('gameScreen').classList.remove('human-crossing');
    const ranking = core.rankTeams(session.teams);
    const first = ranking[0];
    const firstAccuracy = first && first.team.attempts ? first.team.correct / first.team.attempts : 0;
    const tiedWinners = first ? ranking.filter(entry => entry.score === first.score && entry.team.correct === first.team.correct && (entry.team.attempts ? entry.team.correct / entry.team.attempts : 0) === firstAccuracy) : [];
    const isTie = tiedWinners.length > 1;
    const winner = first && first.team;
    playWinnerCelebration();
    const winnerRooms = winner ? core.colonyRooms(winner).length : 0;
    const winnerAnts = winner ? 1 + winner.workers + winner.soldiers : 0;
    const winnerNames = tiedWinners.map(entry => entry.team.name);
    $('winnerBanner').classList.toggle('tie', isTie);
    $('winnerBanner').style.setProperty('--winner-color', winner ? colorHex(core.TEAM_COLORS[winner.colorIndex].primary) : '#2f7b55');
    $('winnerLabel').textContent = isTie ? 'Draw' : 'Winner';
    $('winnerTitle').textContent = isTie ? `${winnerNames.join(' and ')} share the win!` : winner ? `${winner.name} wins the Ancient Acorn!` : 'The game is complete';
    if (isTie) {
      $('winnerReason').textContent = `The teams tied with ${first.score} colony strength and the same number of right answers.`;
    } else if (ranking[1] && first.score === ranking[1].score) {
      $('winnerReason').textContent = first.team.correct !== ranking[1].team.correct
        ? `${winner.name} tied on colony strength, then won with more right answers.`
        : `${winner.name} tied on colony strength and right answers, then won with better accuracy.`;
    } else {
      $('winnerReason').textContent = winner ? `${winner.name} built the strongest colony. Right answers and smart upgrades helped the team win.` : 'Every team helped the meadow.';
    }
    $('winnerFacts').innerHTML = winner ? [
      [first.score, 'colony strength'],
      [`${winner.correct}/${winner.attempts}`, 'answers right'],
      [winnerAnts, 'ants'],
      [winnerRooms, 'rooms'],
    ].map(([value, label]) => `<span class="winner-fact"><b>${esc(value)}</b>${esc(label)}</span>`).join('') : '';
    $('podium').innerHTML = ranking.map((entry, index) => {
      const growth = entry.breakdown.population + entry.breakdown.economy + entry.breakdown.queen + entry.breakdown.nest;
      const protection = entry.breakdown.defense + entry.breakdown.military + entry.breakdown.colonyWars;
      const accuracy = entry.team.attempts ? Math.round(entry.team.correct / entry.team.attempts * 100) : 0;
      const tiedFirst = isTie && tiedWinners.some(item => item.team.id === entry.team.id);
      const place = tiedFirst ? 'Winner' : index === 0 ? 'Winner' : `Place ${index + 1}`;
      return `<div class="podium-place${index === 0 || tiedFirst ? ' first' : ''}" style="--team-color:${colorHex(core.TEAM_COLORS[entry.team.colorIndex].primary)}"><b>${place}: ${esc(entry.team.name)}</b><span>${entry.score} colony strength</span><span>${entry.team.correct}/${entry.team.attempts} answers right (${accuracy}%)</span><small>Answer points ${entry.breakdown.knowledge} · Colony points ${growth} · Food and land ${entry.breakdown.resources + entry.breakdown.territory} · Safety points ${protection} · Collapse penalty ${entry.team.collapsePenalty || 0}</small><small>Challenge record: ${entry.team.successfulAttacks} won · ${entry.team.successfulDefenses} defended · ${entry.team.guardsDefeated || 0} rival guards sent to rest · ${entry.team.guardsLost || 0} guards changed to worker duty</small></div>`;
    }).join('');
    const knowledge = [...session.teams].sort((a, b) => (b.attempts ? b.correct / b.attempts : 0) - (a.attempts ? a.correct / a.attempts : 0) || b.correct - a.correct)[0];
    const improved = session.teams.filter(team => core.learningImprovement(session, team.id) > 0).sort((a, b) => core.learningImprovement(session, b.id) - core.learningImprovement(session, a.id))[0];
    const awards = [
      ['Best at questions', knowledge],
      ['Strongest walls', bestTeamBy('defense')],
      ['Most ants', bestTeamBy('population')],
      ['Most food', bestTeamBy('food')],
    ];
    if (improved) awards.push(['Biggest answer improvement', improved]);
    const battleLeader = [...session.teams].sort((a, b) => (b.guardsDefeated || 0) - (a.guardsDefeated || 0))[0];
    if (battleLeader && battleLeader.guardsDefeated > 0) awards.push(['Bravest guard team', battleLeader]);
    $('awards').innerHTML = awards.map(([label, team]) => `<div class="award"><b>${label}</b><span>${esc(team.name)}</span></div>`).join('');
    $('colonyStories').innerHTML = session.teams.map(team => {
      const outcome = core.rainOutcome(team);
      const improvement = core.learningImprovement(session, team.id);
      const missing = core.rainPreparation(team).filter(goal => !goal.done).map(goal => goal.label.toLowerCase());
      return `<article class="colony-ending"><h3>${esc(team.name)}: Walls level ${team.defense + 1}</h3><p>${session.rainOccurred ? team.defense >= 1 ? 'Reinforced entrances kept the rain out.' : `Rain entered: ${team.rainLoss || 0} food lost.` : 'The game ended before the rain.'}</p><p>${team.workers} workers · ${team.soldiers} guards · ${core.colonyRooms(team).length} rooms · ${team.correct}/${team.attempts} answers right.</p><p>${team.successfulAttacks || team.successfulDefenses ? `Challenge story: ${team.successfulAttacks} won, ${team.successfulDefenses} defended, and ${team.guardsLost || 0} guards changed to worker duty.` : 'This colony did not enter a challenge.'}</p><p>${improvement === null ? 'Answer more questions next time to show what you know.' : improvement > 0 ? 'Your team got more answers right near the end.' : 'Next time, read each answer and talk before you choose.'}</p><strong>${missing.length ? `Build next: ${esc(missing[0])}.` : 'Your walls are ready.'}</strong></article>`;
    }).join('');
    setOverlay('finalOverlay');
  }

  function resumePhase() {
    if (session.phase === 'ended') return session.stormSeen ? showFinal() : showRainFinale();
    if (session.phase === 'reward') return showRewards();
    if (session.phase === 'event') {
      const last = session.events[session.events.length - 1];
      // Older saved matches can still contain a narrative event. Resume them
      // into the streamlined loop instead of reopening the old click-through
      // panels.
      if (last && String(last.key).startsWith('upgrade-')) return showGrowth(last);
      if (last?.key === 'raid-result') return showRaidStory(last, true);
      return continueAfterEvent();
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

  function resetMatchRuntime() {
    clearTimeout(worldStoryTimer);
    worldStoryTimer = null;
    answerLocked = false;
    pendingOutcome = null;
    transitionLocked = false;
    currentParticipant = null;
    participantOffset = 0;
    worldStoryAction = null;
    worldEventPresentation = [];
    raidPresentation = null;
    weatherEffects = [];
    weatherTimers = [];
    for (const stop of weatherAudioStops) stop?.();
    weatherAudioStops = [];
  }

  async function enterGame() {
    await rendererShutdown;
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

  function destroyRenderer() {
    if (!game) return rendererShutdown;
    const oldGame = game;
    const oldScene = scene;
    game = null;
    scene = null;
    colonyViews = new Map();
    if (oldScene) {
      oldScene.tweens.killAll();
      oldScene.time.removeAllEvents();
    }
    rendererShutdown = new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        $('gameMount').replaceChildren();
        resolve();
      };
      oldGame.events.once(Phaser.Core.Events.DESTROY, finish);
      oldGame.destroy(true);
      // Phaser destroys on its next frame. The timeout only protects setup if a
      // browser has suspended animation frames while the game is hidden.
      setTimeout(() => {
        if (oldGame.pendingDestroy && typeof oldGame.runDestroy === 'function') oldGame.runDestroy();
        finish();
      }, 750);
    });
    return rendererShutdown;
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
    destroyRenderer();
    resetMatchRuntime();
    $('worldViewport').scrollTop = 0;
    $('worldScrollSpace').style.height = '';
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
          this.load.image('cq-human-leg', '/assets/colonyquest/human-leg-shoe.png');
        },
        update(time, delta) {
          if (!session || document.hidden) return;
          updateForagingWorkers();
          updateBirdFlight();
          if (['warning', 'attack'].includes(session.birdStage) && ['question', 'reward'].includes(session.phase) && time - (this.lastBirdCall || 0) > 2800) {
            this.lastBirdCall = time;
            playBirdArrivalSound();
          }
          if (soundOn && ['question', 'reward'].includes(session.phase) && session.teams.some(team => team.workers + core.homeGuards(team) > 0) && time - (this.lastBushSound || 0) > 800) {
            this.lastBushSound = time;
            noiseBurst({ duration: .4, volume: .027, filterType: 'bandpass', frequency: 1700, q: .5, decay: 1.7 });
            noiseBurst({ duration: .18, volume: .018, delay: .22, filterType: 'highpass', frequency: 2400, decay: 2 });
          }
          const reports = core.advanceEconomy(session, Math.min(delta, 250));
          if (reports.some(report => report.returned)) { updateWorld(); updateHUD(); saveState(); }
          if (core.advanceBirdEvent(session, Math.min(delta, 250))) {
            updateWorld();
            if (session.birdStage === 'warning') { resetActionCamera(); $('worldViewport').scrollTo({ top: 0, behavior: 'smooth' }); }
            updateHUD();
            saveState();
          }
          if (time - (this.lastBirdHUD || 0) > 500) { this.lastBirdHUD = time; updateBirdPanel(); }
          if (reports.some(r => r.gathered || r.eaten)) {
            updateHUD(); saveLocal();
            this.children.list.forEach(child => {
              const id = child.getData?.('foodTeamId');
              if (id) child.setText(`Pantry · ${session.teams.find(t => t.id === id)?.food || 0} food`);
            });
          }
          if (time - (this.lastEconomySave || 0) > 5000 && ['question','reward'].includes(session.phase)) { this.lastEconomySave = time; saveState(); }
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
    if (animateLegs && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const baseY = sprite.y;
      scene.tweens.add({ targets: sprite, y: baseY - Math.max(1, width * .025), duration: 170 + Math.random() * 80, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
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
    if (agent.getData('role') === 'worker') {
      const route = new Phaser.Curves.Path(points[0].x, points[0].y);
      points.slice(1).forEach(point => route.lineTo(point.x, point.y));
      route.lineTo(points[0].x, points[0].y);
      // Permanent workers share the scene update loop. Creating a separate
      // 25fps timer for every worker eventually overwhelmed long matches.
      agent.setData('forageRoute', route);
      return;
    }
    let cursor = index % points.length;
    agent.x = previous ? previous.x : points[cursor].x;
    agent.y = previous ? previous.y : points[cursor].y;
    if (index >= MAX_MOVING_ANTS_PER_ROLE && !startDelay) return;
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

  function updateForagingWorkers() {
    if (!session) return;
    for (const view of colonyViews.values()) {
      for (const agent of view.ants) {
        const route = agent.getData?.('forageRoute');
        if (!route || !agent.active) continue;
        const team = session.teams.find(item => item.id === agent.getData('teamId'));
        const progress = team?.forageProgress?.[agent.getData('workerIndex')] || 0;
        const point = route.getPoint(progress);
        agent.sprite?.setFlipX(point.x < agent.x);
        agent.setPosition(point.x, point.y);
        agent.cargo?.setVisible(progress >= .5);
      }
    }
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
    const entrance = { x: cx, y: zone.y + 50 };
    const active = teamIndex === session.currentTeamIndex && session.phase !== 'ended';
    const roomWidth = Math.min(138, zone.w * .44);
    const roomHeight = 80;
    const rooms = core.colonyRooms(team).map((room, index) => ({
      ...room,
      x: index === 0 ? cx : zone.x + zone.w * ((index - 1) % 2 ? .75 : .25),
      y: zone.y + 136 + Math.ceil(index / 2) * COLONY_LAYOUT.roomStep,
    }));
    const nursery = rooms[0];
    const preservePositions = previous && previous.zone.x === zone.x && previous.zone.y === zone.y && previous.zone.w === zone.w && previous.roomCount === rooms.length;
    const food = rooms.find(room => room.kind === 'food') || nursery;
    const guards = rooms.filter(room => room.kind === 'guard');
    const guard = guards.at(-1) || nursery;
    const sites = { entrance, nursery, food, guard, center: nursery, expansion: rooms.at(-1) };
    const lastEvent = session.events.at(-1);
    const harvest = session.phase === 'event' && lastEvent?.key === 'round-supplies' ? lastEvent.reports[lastEvent.reportIndex || 0] : null;
    const sheltering = session.phase === 'ended';

    drawTunnel(graphics, [entrance, nursery], 14, material);
    for (let index = 1; index < rooms.length; index += 1) {
      const room = rooms[index];
      const junction = { x: cx, y: room.y - 62 };
      if (index % 2 === 1) {
        const previousY = index === 1 ? nursery.y : rooms[index - 2].y - 62;
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
        scene.tweens.add({ targets: roomGraphics, alpha: 1, delay: 2000, duration: 1500 });
      }
      const egg = team.eggs?.[0];
      const detail = room.kind === 'food' ? ` · ${team.food} food` : room.kind === 'guard' ? ` · ${Math.min(8, Math.max(0, team.soldiers - guards.indexOf(room) * 8))} soldiers` : room.kind === 'nursery' ? egg ? ` · egg: ${Math.max(1, egg.roundsLeft)} rounds` : ` · level ${team.queenLevel}` : '';
      const tag = chamberTag(room.x, room.y - roomHeight / 2 - 3, room.label + detail, zone.w);
      if (room.kind === 'food') tag.setData('foodTeamId', team.id);
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
    if (team.defense >= 1) { graphics.lineStyle(8, material.wall, 1); graphics.lineBetween(entrance.x - 26, entrance.y - 7, entrance.x + 26, entrance.y - 7); }
    const title = scene.add.text(zone.x + 12, zone.y + 2, team.name, {
      fontFamily: 'Arial', fontSize: '14px', fontStyle: 'bold', color: '#f1fff5',
      backgroundColor: '#1c4036', padding: { x: 9, y: 6 }, wordWrap: { width: zone.w - 44 },
    }).setDepth(8);
    title.setInteractive({ useHandCursor: true }).on('pointerdown', pointer => {
      if (pointer.event?.target === game.canvas) focusColony(team.id);
    });
    const subtitle = scene.add.text(zone.x + 13, zone.y + 33, `${palette.name} ants · ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · Walls level ${team.defense + 1}`, {
      fontFamily: 'Arial', fontSize: '11px', color: '#ffffff', backgroundColor: '#263d33', padding: { x: 5, y: 3 },
    }).setDepth(8);

    const queen = makeAntAgent('cq-queen', { x: nursery.x, y: nursery.y - 4 }, Math.min(55 + team.queenLevel * 4, roomWidth * .65), palette.primary);
    queen.setData('role', 'queen');
    const ants = [];
    const pathTo = room => {
      if (room === nursery) return [nursery, entrance];
      const points = [nursery];
      for (let y = nursery.y + 76; y <= room.y - 61; y += COLONY_LAYOUT.roomStep) points.push({ x: cx, y });
      points.push(room);
      return points;
    };
    for (let index = 0; index < team.workers; index += 1) {
      const lastEvent = session.events.at(-1);
      const building = index === 0 && session.phase === 'event' && lastEvent?.key === 'upgrade-expansion' && lastEvent.teamId === team.id;
      const room = building ? sites.expansion : index % 3 === 0 ? food : rooms[index % rooms.length];
      const route = pathTo(room);
      const surface = { x: cx + (index % 2 ? -1 : 1) * zone.w * .3, y: entrance.y - 19 };
      const indoorPath = route.length > 1 ? [...route.slice().reverse(), ...route] : [{ x: nursery.x - 18, y: nursery.y }, { x: nursery.x + 18, y: nursery.y + 5 }];
      const path = building ? [{ x: room.x - 12, y: room.y }, { x: room.x + 14, y: room.y + 5 }, { x: room.x, y: room.y - 8 }] : sheltering ? indoorPath : [...route.slice().reverse(), entrance, surface, entrance, ...route];
      const recruit = index === team.workers - 1 && session.phase === 'event' && (lastEvent?.key === 'upgrade-workers' && lastEvent.teamId === team.id || harvest?.teamId === team.id && harvest.hatched);
      if (recruit) path.unshift({ x: nursery.x + roomWidth * .28, y: nursery.y + 4 });
      const ant = makeAntAgent('cq-worker', path[0], 29, palette.primary, !building, index < MAX_MOVING_ANTS_PER_ROLE);
      ant.setData('role', 'worker');
      ant.setData('teamId', team.id); ant.setData('workerIndex', index);
      ants.push(ant);
      if (!sheltering && index === 0 && (harvest?.teamId === team.id && harvest.gathered > 0 || session.phase === 'event' && lastEvent?.key === 'upgrade-food' && lastEvent.teamId === team.id)) deliverHarvest(ant, [surface, entrance, ...pathTo(food)]);
      else animateAnt(ant, path, recruit ? 0 : index, preservePositions && !recruit ? previous.workers[index] : null, recruit ? 1400 : 0);
      if (recruit) revealRecruit(ant);
    }
    for (let index = 0; index < core.homeGuards(team); index += 1) {
      const room = guards[Math.floor(index / 8)] || nursery;
      const slot = guards[Math.floor(index / 8)] ? index % 8 : index - guards.length * 8;
      const x = room.x + ((slot % 4) - 1.5) * roomWidth * .19;
      const y = room.y - 13 + Math.floor(slot / 4) * 24;
      const path = [{ x, y }, { x: x + 10, y: y - 5 }, { x: x - 8, y: y + 3 }];
      const soldier = makeAntAgent('cq-guardian', path[0], 30, palette.primary, false, index < MAX_MOVING_ANTS_PER_ROLE);
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

  function resetActionCamera() {
    actionCamera = false;
    trackedActionActor = null;
    if (!scene) return;
    scene.tweens.timeScale = 1;
    scene.time.timeScale = 1;
    const camera = scene.cameras.main;
    camera.stopFollow();
    camera.panEffect.reset();
    camera.zoomEffect.reset();
    camera.setZoom(1).setScroll(camera.scrollX, $('worldViewport').scrollTop);
    $('worldViewport').removeAttribute('data-action-focus');
  }

  function focusColony(teamId, siteName = 'nursery', upgrade = false) {
    const view = colonyViews.get(teamId);
    if (!view) return;
    $('colonyViewPick').value = teamId;
    const target = view.sites[siteName] || view.center;
    const viewport = $('worldViewport');
    const lowerPanel = !$('worldStory').classList.contains('hidden') ? $('worldStory').offsetHeight + 45 : 80;
    const visibleHeight = viewport.clientHeight - lowerPanel;
    viewport.scrollTo({ top: Math.max(0, target.y - visibleHeight * .48), behavior: 'auto' });
    if (scene) {
      const camera = scene.cameras.main;
      if (upgrade || !$('worldStory').classList.contains('hidden')) {
        actionCamera = true;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scene.tweens.timeScale = reduced ? 1 : ACTION_SPEED;
        scene.time.timeScale = reduced ? 1 : ACTION_SPEED;
        // Frame the room above the story banner, including space for dialogue.
        const zoom = Math.max(1.25, Math.min(2.2, viewport.clientWidth / 280, Math.max(180, visibleHeight) / 150));
        const centerY = target.y + lowerPanel / (2 * zoom) - 15;
        $('worldViewport').dataset.actionFocus = `${teamId}:${siteName}`;
        if (reduced) camera.setZoom(zoom).centerOn(target.x, centerY);
        else {
          camera.zoomTo(zoom, upgrade ? 250 : 750, 'Sine.easeInOut', true);
          camera.pan(target.x, centerY, upgrade ? 250 : 750, 'Sine.easeInOut', true);
        }
        return;
      }
      resetActionCamera();
      camera.scrollX = Phaser.Math.Clamp(target.x - viewport.clientWidth / 2, 0, Math.max(0, camera.getBounds().width - viewport.clientWidth));
      camera.scrollY = viewport.scrollTop;
    }
  }

  function restoreWorldFocus() {
    if (!session) return;
    const event = session.events.at(-1);
    if (session.phase === 'ended' && !session.stormSeen) { playWorldEvent('heavy-rain'); return; }
    if (session.phase === 'event' && event?.key === 'round-supplies') {
      const report = event.reports[event.reportIndex || 0];
      if (report) {
        focusColony(report.teamId, report.hatched ? 'nursery' : 'food');
        if (report.hatched && !$('worldStory').classList.contains('hidden')) holdWorldStory(playHatchAction(report.teamId), 'Watch the egg hatch...');
      }
      return;
    }
    if (session.phase === 'event' && WORLD_EVENT_SCENES[event?.key]) {
      const eventScene = WORLD_EVENT_SCENES[event.key];
      const team = worldEventFocusTeam(event);
      if (team) {
        focusColony(team.id, eventScene.site);
        stageWorldEvent(event.key, team.id);
        if (!$('worldStory').classList.contains('hidden')) worldEventPresentation.push(...showAntSpeech(team.id, eventScene.speaker, eventScene.speech, eventScene.site, 0));
      }
      return;
    }
    const key = String(event && event.key || '').replace(/^upgrade-/, '');
    if (session.phase === 'event' && REWARD_STORIES[key]) {
      const team = session.teams.find(item => item.id === event.teamId) || currentTeam();
      focusColony(team.id, REWARD_STORIES[key].site);
      celebrate(team.id, key);
      if (!$('worldStory').classList.contains('hidden')) {
        const actionDuration = playUpgradeAction(team.id, key);
        showAntSpeech(team.id, REWARD_STORIES[key].speaker, REWARD_STORIES[key].speech, REWARD_STORIES[key].site, actionDuration + 700);
        holdWorldStory(actionDuration, 'Watch the colony change...');
      }
    } else if (currentTeam()) focusColony(currentTeam().id);
  }

  function updateWorld() {
    if (!scene || !session) return;
    clearWorldEventPresentation();
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
    scene.time.removeAllEvents();
    scene.children.removeAll(true);
    colonyViews = new Map();
    const width = scene.scale.width;
    const height = scene.scale.height;
    const count = session.teams.length;
    const worldWidth = Math.max(width, count * COLONY_LAYOUT.minimumWidth + (count + 1) * COLONY_LAYOUT.gap);
    const zoneWidth = (worldWidth - (count + 1) * COLONY_LAYOUT.gap) / count;
    const largestRoomCount = Math.max(...session.teams.map(team => core.colonyRooms(team).length));
    const colonyHeight = COLONY_LAYOUT.baseHeight + Math.ceil((largestRoomCount - 1) / 2) * COLONY_LAYOUT.roomStep;
    const worldHeight = Math.max(height, 133 + colonyHeight + 170);
    $('worldScrollSpace').style.height = `${worldHeight}px`;
    fitWorldImage('cq-world', worldWidth, height);
    // Tile only the soil portion beneath the first screen to keep the surface above ground.
    const texture = scene.textures.get('cq-world').getSourceImage();
    const soilScale = worldWidth / texture.width;
    const soilHeight = texture.height * .6 * soilScale;
    for (let y = height; y < worldHeight; y += soilHeight - 1) {
      const soil = scene.add.image(worldWidth / 2, y, 'cq-world').setOrigin(.5, 0).setDepth(-30);
      soil.setCrop(0, texture.height * .4, texture.width, texture.height * .6);
      soil.setScale(soilScale);
      soil.y -= texture.height * .4 * soilScale;
    }
    scene.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    scene.cameras.main.scrollY = $('worldViewport').scrollTop;
    addAmbientLife(worldWidth, height);
    for (let index = 0; index < count; index += 1) {
      drawColony(session.teams[index], {
        x: COLONY_LAYOUT.gap + index * (zoneWidth + COLONY_LAYOUT.gap),
        y: 133,
        w: zoneWidth,
        h: colonyHeight,
      }, index, previous.get(session.teams[index].id));
    }
    addStormAtmosphere();
    drawBirdWave();
    $('worldViewport').dataset.layout = 'shared-surface';
    $('worldViewport').dataset.surfaceColonies = String(count);
    $('worldViewport').setAttribute('aria-label', `Colony world. All ${count} colony entrances begin at the meadow surface. The largest colony has ${largestRoomCount} rooms.`);
    $('worldViewport').setAttribute('aria-description', session.teams.map(team => {
      const view = colonyViews.get(team.id);
      const workers = view.ants.filter(ant => ant.getData('role') === 'worker').length;
      const soldiers = view.ants.filter(ant => ant.getData('role') === 'soldier').length;
      return `${team.name}: 1 queen, ${workers} workers, ${soldiers} guard ants. ${view.rooms.length} rooms: ${view.rooms.map(room => room.label).join(', ')}. ${core.fortification(team).name} walls. ${core.TEAM_COLORS[team.colorIndex].name} ants.`;
    }).join(' '));
  }

  function drawBirdWave() {
    if (!scene) return;
    scene.birdActors = [];
    $('worldViewport').dataset.birdScene = session.birdStage || 'none';
    if (!['warning', 'attack', 'result'].includes(session.birdStage)) return;
    session.teams.forEach(team => {
      const view = colonyViews.get(team.id);
      if (!view) return;
      for (let index = 0; index < (team.birdsIncoming || core.birdCount(team)); index += 1) {
        const x = view.zone.x + view.zone.w * (index + 1) / ((team.birdsIncoming || core.birdCount(team)) + 1);
        const bird = scene.add.container(x, 30).setDepth(18);
        const shadow = scene.add.ellipse(x, 128, 115, 17, 0x152721, .18).setDepth(5);
        const wing = (far) => {
          const feathers = scene.add.graphics();
          feathers.fillStyle(far ? 0x493d33 : 0x76553a);
          feathers.fillPoints([{x:5,y:2},{x:-3,y:-18},{x:-28,y:-45},{x:-67,y:-53},{x:-57,y:-40},{x:-50,y:-34},{x:-38,y:-18},{x:-17,y:5}], true);
          for (let f = 0; f < 6; f++) {
            feathers.lineStyle(2, far ? 0x2b2928 : 0xb58b60, .85);
            feathers.lineBetween(-8-f*6, -9-f*4, -30-f*6, -22-f*5);
          }
          return feathers;
        };
        const farWing = wing(true).setPosition(-2, -3);
        const tail = scene.add.graphics();
        tail.fillStyle(0x382e28); tail.fillPoints([{x:-17,y:-4},{x:-60,y:-11},{x:-48,y:2},{x:-59,y:9},{x:-17,y:8}], true);
        const body = scene.add.ellipse(0, 0, 58, 27, 0x8e6747).setAngle(-8);
        const breast = scene.add.ellipse(13, 5, 30, 21, 0xd6b181).setAngle(-16);
        const head = scene.add.ellipse(28, -10, 27, 24, 0x745139);
        const cheek = scene.add.ellipse(31, -5, 17, 10, 0xe0c69b);
        const beak = scene.add.triangle(45, -7, 0, 0, 16, 4, 0, 8, 0x302b25);
        const eye = scene.add.circle(33, -13, 3, 0x151916);
        const glint = scene.add.circle(34, -14, .9, 0xffffff);
        const nearWing = wing(false);
        const feet = scene.add.graphics().lineStyle(2, 0x4a3527);
        feet.lineBetween(2, 12, -3, 20); feet.lineBetween(-3, 20, 5, 21);
        feet.lineBetween(12, 12, 9, 20); feet.lineBetween(9, 20, 17, 21);
        const seed = scene.add.ellipse(48, -2, 10, 6, 0xf2ce64).setVisible(false);
        bird.add([farWing, tail, feet, body, breast, head, cheek, beak, eye, glint, nearWing, seed]);
        scene.birdActors.push({ bird, shadow, nearWing, farWing, seed, team, index, x, zone: view.zone });
      }
    });
    updateBirdFlight();
  }

  function updateBirdFlight() {
    if (!scene?.birdActors?.length || !session) return;
    const stage = session.birdStage;
    const duration = stage === 'warning' ? 8000 : stage === 'attack' ? 10000 : 8000;
    const elapsed = duration - session.birdStageMs;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const actor of scene.birdActors) {
      const { bird, shadow, nearWing, farWing, seed, team, index, x, zone } = actor;
      if (!bird.active) continue;
      const t = Math.max(0, elapsed - index * 300) / 1000;
      const protectedFood = team.defense >= 2;
      const approach = Math.min(1, t / 7);
      const swoop = Math.sin(Math.min(1, t / 6) * Math.PI);
      const departure = Math.min(1, t / 3);
      bird.setVisible(stage !== 'result' || departure < 1);
      const scale = stage === 'warning' ? .25 + approach * .55 : 1;
      bird.setScale(scale);
      bird.x = reduced ? x : stage === 'warning' ? x - zone.w * .7 * (1 - approach) : stage === 'attack' ? x + Math.sin(t * .8) * 35 : x + departure * zone.w;
      bird.y = reduced ? 78 : stage === 'warning' ? 15 + approach * 65 : stage === 'attack' ? 65 + swoop * (protectedFood ? 22 : 65) : 80 - departure * 130;
      bird.angle = reduced ? 0 : stage === 'attack' ? Math.cos(t * .9) * 12 : -8;
      nearWing.setAngle(reduced ? -15 : Math.sin(t * 10) * 33);
      farWing.setAngle(reduced ? 15 : -Math.sin(t * 10) * 25);
      shadow.setPosition(bird.x + 12, 139).setScale(scale * (stage === 'attack' ? 1 + swoop * .4 : 1));
      shadow.setAlpha(stage === 'result' ? .2 * (1-departure) : .1 + scale * .14);
      seed.setVisible(!protectedFood && (stage === 'attack' && t > 5 || stage === 'result' && team.birdFoodLoss > 0));
    }
  }

  function playBirdArrivalSound() {
    if (!soundOn || !audioContext || !effectsBus) return;
    noiseBurst({ duration: .55, volume: .045, filterType: 'bandpass', frequency: 850, q: .6, decay: 1.5 });
    noiseBurst({ duration: .35, volume: .03, delay: .35, filterType: 'bandpass', frequency: 1400, q: .6, decay: 2 });
    const call = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    call.frequency.setValueAtTime(1700, now);
    call.frequency.exponentialRampToValueAtTime(900, now + .22);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.022, now + .035);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .25);
    call.connect(gain); gain.connect(effectsBus);
    call.onended = () => { call.disconnect(); gain.disconnect(); };
    call.start(now); call.stop(now + .28);
  }

  function celebrate(teamId, kind, effectText = '') {
    if (!scene) return;
    const view = colonyViews.get(teamId);
    if (!view) return;
    const palette = core.TEAM_COLORS[session.teams.find(team => team.id === teamId).colorIndex];
    const siteName = REWARD_STORIES[kind] && REWARD_STORIES[kind].site || (kind === 'defense' ? 'guard' : 'center');
    const origin = view.sites && view.sites[siteName] || view.center;
    for (let index = 0; index < 12; index += 1) {
      const dot = scene.add.circle(origin.x, origin.y, 3 + index % 3, index % 3 === 0 ? 0xffd166 : palette.light).setDepth(10);
      const angle = Math.PI * 2 * index / 12;
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

  function showAntSpeech(teamId, speaker, message, siteName = 'nursery', duration = 2800) {
    if (!scene || !speaker || !message) return [];
    const view = colonyViews.get(teamId);
    if (!view) return [];
    const site = view.sites[siteName] || view.center;
    const width = Math.max(118, Math.min(205, view.zone.w - 18));
    const x = Phaser.Math.Clamp(site.x, view.zone.x + width / 2 + 5, view.zone.x + view.zone.w - width / 2 - 5);
    const y = Math.max(view.zone.y + 72, site.y - 55);
    const bubble = scene.add.text(x, y, `${speaker}: ${message}`, {
      fontFamily: 'Arial', fontSize: view.zone.w < 260 ? '10px' : '12px', fontStyle: 'bold',
      color: '#18382f', backgroundColor: '#fff9e8', padding: { x: 9, y: 7 },
      wordWrap: { width: width - 18 }, align: 'center',
    }).setOrigin(.5, 1).setDepth(30).setStroke('#fff9e8', 2);
    const pointer = scene.add.triangle(x, y + 6, 0, 0, 14, 0, 7, 9, 0xfff9e8, 1).setOrigin(.5, 0).setDepth(29);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      bubble.setScale(.75).setAlpha(.2);
      pointer.setAlpha(.2);
      scene.tweens.add({ targets: [bubble, pointer], alpha: 1, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.easeOut' });
    }
    if (duration > 0) {
      scene.time.delayedCall(duration, () => {
        if (!bubble.active) return;
        scene.tweens.add({ targets: [bubble, pointer], alpha: 0, y: '-=8', duration: 320, onComplete: () => { bubble.destroy(); pointer.destroy(); } });
      });
    }
    return [bubble, pointer];
  }

  function moveActionActor(actor, points, duration, onComplete) {
    if (!scene || !actor || !points.length) return;
    actor.setPosition(points[0].x, points[0].y);
    if (actionCamera && !trackedActionActor && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      trackedActionActor = actor;
      const camera = scene.cameras.main;
      camera.panEffect.reset();
      camera.startFollow(actor, false, .08, .08, 0, -($('worldStory').offsetHeight + 45) / (2 * Math.max(1.25, camera.zoom)) + 15);
    }
    const route = new Phaser.Curves.Path(points[0].x, points[0].y);
    for (const point of points.slice(1)) route.lineTo(point.x, point.y);
    const progress = { value: 0 };
    scene.tweens.add({
      targets: progress,
      value: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        if (!actor.active) return;
        const point = route.getPoint(progress.value);
        actor.sprite.setFlipX(point.x < actor.x);
        actor.setPosition(point.x, point.y);
      },
      onComplete: () => {
        if (trackedActionActor === actor) {
          scene.cameras.main.stopFollow();
          trackedActionActor = null;
        }
        if (actor.active && onComplete) onComplete(actor);
      },
    });
  }

  function actionWorker(view, palette, point, width = 32, guardian = false) {
    return makeAntAgent(guardian ? 'cq-guardian' : 'cq-worker', point, width, palette.primary, false, false).setDepth(18);
  }

  function depositVisibleSeeds(point, count = 5) {
    for (let index = 0; index < count; index += 1) {
      const seed = scene.add.ellipse(point.x, point.y - 10, 9, 6, [0xf1cc66, 0x8bbc5e, 0xdb7857][index % 3], 1).setDepth(19).setAngle(index * 28);
      scene.tweens.add({
        targets: seed,
        x: point.x + (index - (count - 1) / 2) * 8,
        y: point.y + 9 + Math.floor(index / 3) * 5,
        duration: 420,
        delay: index * 70,
        ease: 'Bounce.easeOut',
        onComplete: () => scene.time.delayedCall(700, () => { if (seed.active) seed.destroy(); }),
      });
    }
  }

  function playUpgradeAction(teamId, kind) {
    if (!scene) return 250;
    const view = colonyViews.get(teamId);
    if (!view) return 250;
    const team = session.teams.find(item => item.id === teamId);
    const palette = core.TEAM_COLORS[team.colorIndex];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return 250;
    const nursery = view.sites.nursery;
    const entrance = view.sites.entrance;
    const site = view.sites[REWARD_STORIES[kind]?.site || 'center'] || view.center;

    if (kind === 'workers') {
      playAntSound('scuttle');
      const recruit = view.ants.filter(ant => ant.getData('role') === 'worker').at(-1);
      if (recruit) {
        recruit.setDepth(19);
        scene.tweens.add({ targets: recruit, scaleX: 1.35, scaleY: .72, duration: 260, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
        const wakeRing = scene.add.ellipse(nursery.x, nursery.y, 48, 28, palette.light, .12).setStrokeStyle(4, palette.light, 1).setDepth(17);
        scene.tweens.add({ targets: wakeRing, scaleX: 2, scaleY: 2, alpha: 0, duration: 1150, onComplete: () => wakeRing.destroy() });
      }
      return 1500;
    }

    if (kind === 'food') {
      playAntSound('forage');
      const surface = { x: entrance.x + Math.min(60, view.zone.w * .27), y: entrance.y - 24 };
      const carrier = actionWorker(view, palette, surface);
      carrier.cargo.setVisible(true);
      for (let index = 0; index < 5; index += 1) {
        const seed = scene.add.ellipse(-11 + index * 5, -10 - index % 2 * 5, 7, 5, [0xf1cc66, 0x8bbc5e, 0xdb7857][index % 3], 1);
        carrier.add(seed);
      }
      moveActionActor(carrier, [surface, entrance, { x: entrance.x, y: (entrance.y + site.y) / 2 }, site], 2200, actor => {
        actor.cargo.setVisible(false);
        depositVisibleSeeds(site, 5);
        scene.tweens.add({ targets: actor, alpha: 0, duration: 260, onComplete: () => actor.destroy(true) });
      });
      return 3200;
    }

    if (kind === 'defense') {
      playAntSound('build');
      const builder = actionWorker(view, palette, nursery);
      const route = [nursery, ...view.rooms.slice(1, 8)];
      moveActionActor(builder, route, 2300, actor => scene.tweens.add({ targets: actor, alpha: 0, duration: 250, onComplete: () => actor.destroy(true) }));
      for (const room of view.rooms.slice(0, 8)) {
        const ring = scene.add.ellipse(room.x, room.y, 72, 44, palette.light, .04).setStrokeStyle(4, core.fortification(team).edge, .95).setDepth(12);
        scene.tweens.add({ targets: ring, scaleX: 1.75, scaleY: 1.75, alpha: 0, duration: 1050, delay: 280 + view.rooms.indexOf(room) * 190, onComplete: () => ring.destroy() });
        for (let block = 0; block < 3; block += 1) {
          const material = scene.add.rectangle(room.x - 17 + block * 17, room.y - 3, 13, 8, core.fortification(team).wall, 1).setStrokeStyle(1, core.fortification(team).edge, 1).setDepth(13).setAlpha(0);
          scene.tweens.add({ targets: material, alpha: 1, y: room.y + 6, duration: 320, delay: 450 + view.rooms.indexOf(room) * 190 + block * 70, yoyo: true, hold: 420, onComplete: () => material.destroy() });
        }
      }
      return 2700;
    }

    if (kind === 'queen') {
      playAntSound('hatch');
      const egg = scene.add.ellipse(site.x + 24, site.y + 13, 14, 10, 0xfff4d2, 1).setStrokeStyle(2, 0xd9b976, 1).setDepth(12).setScale(.2);
      scene.tweens.add({ targets: egg, scaleX: 1.25, scaleY: 1.25, duration: 700, yoyo: true, hold: 900, onComplete: () => egg.destroy() });
      return 2800;
    }

    if (kind === 'soldiers') {
      playAntSound('guard');
      const shield = scene.add.ellipse(site.x, site.y, 44, 44, palette.light, .12).setStrokeStyle(5, palette.light, 1).setDepth(12);
      scene.tweens.add({ targets: shield, scaleX: 1.8, scaleY: 1.8, alpha: 0, duration: 1250, onComplete: () => shield.destroy() });
      const guard = view.ants.filter(ant => ant.getData('role') === 'soldier').at(-1);
      if (guard) scene.tweens.add({ targets: guard, angle: { from: -7, to: 7 }, duration: 190, yoyo: true, repeat: 5 });
      return 1600;
    }

    if (kind === 'expansion') {
      playAntSound('dig');
      const builders = [-10, 10].map(offset => actionWorker(view, palette, { x: nursery.x + offset, y: nursery.y }, 29));
      builders.forEach((builder, index) => moveActionActor(builder, [nursery, { x: (nursery.x + site.x) / 2, y: (nursery.y + site.y) / 2 }, { x: site.x + (index ? 13 : -13), y: site.y }], 1450 + index * 140, actor => {
        scene.tweens.add({ targets: actor, x: actor.x + (index ? -9 : 9), angle: index ? -12 : 12, duration: 180, yoyo: true, repeat: 4, onComplete: () => scene.tweens.add({ targets: actor, alpha: 0, duration: 250, onComplete: () => actor.destroy(true) }) });
      }));
      for (let index = 0; index < 14; index += 1) {
        const dirt = scene.add.circle(site.x + (index % 5 - 2) * 6, site.y, 3 + index % 3, index % 2 ? 0x8b5b35 : 0xc08a52, .95).setDepth(12);
        scene.tweens.add({ targets: dirt, x: dirt.x + (index % 2 ? 1 : -1) * (22 + index * 2), y: dirt.y - 16 - index % 5 * 6, alpha: 0, duration: 850 + index * 25, delay: 1050, ease: 'Cubic.easeOut', onComplete: () => dirt.destroy() });
      }
      return 4000;
    }
    return 1400;
  }

  function playHatchAction(teamId) {
    if (!scene) return 250;
    const view = colonyViews.get(teamId);
    const team = session.teams.find(item => item.id === teamId);
    if (!view || !team || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 250;
    const site = view.sites.nursery;
    const palette = core.TEAM_COLORS[team.colorIndex];
    playAntSound('hatch');
    const egg = scene.add.ellipse(site.x + 20, site.y + 5, 20, 27, 0xfff4d2, 1).setStrokeStyle(3, 0xd9b976, 1).setDepth(20);
    const crack = scene.add.graphics().setDepth(21).setAlpha(0);
    crack.lineStyle(2, 0x765c3c, 1).beginPath().moveTo(site.x + 15, site.y - 4).lineTo(site.x + 21, site.y + 1).lineTo(site.x + 16, site.y + 7).lineTo(site.x + 23, site.y + 12).strokePath();
    scene.tweens.add({ targets: egg, angle: { from: -8, to: 8 }, duration: 170, yoyo: true, repeat: 4, onComplete: () => {
      crack.setAlpha(1);
      scene.tweens.add({ targets: [egg, crack], scaleX: 1.28, scaleY: 1.28, alpha: 0, duration: 480, delay: 420, onComplete: () => { egg.destroy(); crack.destroy(); } });
      const baby = actionWorker(view, palette, { x: site.x + 20, y: site.y + 8 }, 24).setScale(.25).setAlpha(.2);
      scene.tweens.add({ targets: baby, scaleX: 1, scaleY: 1, alpha: 1, y: baby.y - 12, duration: 700, delay: 420, ease: 'Back.easeOut', onComplete: () => scene.time.delayedCall(650, () => { if (baby.active) baby.destroy(true); }) });
    } });
    showAntSpeech(teamId, 'Queen Aurelia', 'Crack! A new worker is ready.', 'nursery', 4300);
    return 4300;
  }

  function stopWeather() {
    for (const timer of weatherTimers) timer?.remove?.(false);
    weatherTimers = [];
    for (const stop of weatherAudioStops) stop?.();
    weatherAudioStops = [];
    if (!scene) return;
    for (const effect of weatherEffects) {
      if (!effect.active) continue;
      scene.tweens.killTweensOf(effect);
      effect.destroy();
    }
    weatherEffects = [];
  }

  function lightningStrike(withThunder = true, intensity = 1) {
    if (!scene) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = scene.scale.width;
    const height = scene.scale.height;
    const strikeX = width * (.2 + Math.random() * .6);
    const flash = scene.add.rectangle(width / 2, height / 2, width, height, 0xe8f8ff, reducedMotion ? .18 : .7 * intensity).setScrollFactor(0).setDepth(40);
    const afterFlash = scene.add.rectangle(width / 2, height / 2, width, height, 0xcbe8ff, 0).setScrollFactor(0).setDepth(40);
    const bolt = scene.add.graphics().setScrollFactor(0).setDepth(41);
    const points = [
      { x: strikeX, y: -10 }, { x: strikeX - 18, y: 43 }, { x: strikeX + 4, y: 72 },
      { x: strikeX - 26, y: 112 }, { x: strikeX - 8, y: 148 }, { x: strikeX - 43, y: Math.min(225, height * .34) },
    ];
    bolt.lineStyle(7, 0xe9f7ff, .35).beginPath().moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => bolt.lineTo(point.x, point.y));
    bolt.strokePath();
    bolt.lineStyle(3, 0xffffff, 1).beginPath().moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => bolt.lineTo(point.x, point.y));
    bolt.strokePath();
    bolt.lineStyle(2, 0xeefaff, .9).beginPath().moveTo(points[2].x, points[2].y).lineTo(points[2].x + 36, points[2].y + 24).lineTo(points[2].x + 23, points[2].y + 48).strokePath();
    bolt.beginPath().moveTo(points[3].x, points[3].y).lineTo(points[3].x - 31, points[3].y + 20).lineTo(points[3].x - 19, points[3].y + 43).strokePath();
    weatherEffects.push(flash, afterFlash, bolt);
    if (!reducedMotion) {
      scene.tweens.add({ targets: [flash, bolt], alpha: 0, duration: 150, ease: 'Cubic.easeOut' });
      scene.tweens.add({ targets: afterFlash, alpha: .32 * intensity, duration: 35, delay: 125, yoyo: true, hold: 30 });
      const shake = scene.time.delayedCall(190, () => scene?.cameras?.main?.shake(360, .0045 * intensity));
      weatherTimers.push(shake);
    }
    const cleanup = scene.time.delayedCall(620, () => {
      for (const effect of [flash, afterFlash, bolt]) if (effect.active) effect.destroy();
    });
    weatherTimers.push(cleanup);
    if (withThunder) playThunder(.18, intensity);
  }

  function addRainField(count, intensity = 1) {
    if (!scene) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = scene.scale.width;
    const height = scene.scale.height;
    const floor = Math.min(225, height * .34);
    for (let index = 0; index < count; index += 1) {
      const foreground = index % 5 === 0;
      const startX = (index * 67 + (index % 7) * 19) % width;
      const drop = scene.add.rectangle(startX, -18 - (index % 11) * 17, foreground ? 3 : 2, (foreground ? 24 : 14) + index % 5 * 2, foreground ? 0xdaf4ff : 0xaadcf4, (foreground ? .9 : .55) * intensity).setDepth(foreground ? 16 : 12).setAngle(13);
      weatherEffects.push(drop);
      if (reducedMotion) {
        drop.y = index * 17 % floor;
        continue;
      }
      scene.tweens.add({ targets: drop, y: floor + 4, x: startX + 48, duration: 610 + (index % 7) * 65, delay: (index % 13) * 42, repeat: -1, ease: 'Linear' });
      if (index % 4 === 0) {
        const splash = scene.add.ellipse(startX + 48, floor + 3, 8, 3, 0xcceeff, 0).setStrokeStyle(1, 0xdaf5ff, .75).setDepth(15);
        weatherEffects.push(splash);
        scene.tweens.add({ targets: splash, alpha: { from: 0, to: .72 }, scaleX: { from: .35, to: 2.1 }, scaleY: { from: .35, to: 1.35 }, duration: 260, delay: 610 + (index % 13) * 42, repeat: -1, repeatDelay: 410 + (index % 7) * 65 });
      }
    }
  }

  function addFloodWater(view, colony) {
    if (!scene || !view || !colony) return;
    const entrance = view.sites.entrance;
    const nursery = view.sites.nursery;
    const protectedWalls = colony.defense >= 1;
    const puddle = scene.add.ellipse(entrance.x + 10, entrance.y + 10, Math.min(100, view.zone.w * .55), 16, 0x5eb9dc, .55).setStrokeStyle(2, 0xbcecff, .8).setDepth(14);
    weatherEffects.push(puddle);
    scene.tweens.add({ targets: puddle, scaleX: 1.2, alpha: .3, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (protectedWalls) {
      const barrier = scene.add.graphics().setDepth(17);
      barrier.lineStyle(5, 0xd7f6ff, .9).beginPath().arc(entrance.x, entrance.y + 4, 35, Math.PI, Math.PI * 2).strokePath();
      weatherEffects.push(barrier);
      for (let index = 0; index < 5; index += 1) {
        const deflection = scene.add.circle(entrance.x - 24 + index * 12, entrance.y - 3, 2 + index % 2, 0xcaf2ff, .9).setDepth(18);
        weatherEffects.push(deflection);
        scene.tweens.add({ targets: deflection, x: deflection.x + (index < 3 ? -26 : 26), y: deflection.y - 18 - index * 3, alpha: 0, duration: 520 + index * 55, repeat: -1, repeatDelay: 260 });
      }
      return;
    }
    const dx = nursery.x - entrance.x;
    const dy = nursery.y - entrance.y;
    const stream = scene.add.graphics().setDepth(18);
    stream.lineStyle(13, 0x4aaad3, .72).beginPath().moveTo(entrance.x, entrance.y + 5).lineTo(entrance.x + dx * .45, entrance.y + dy * .45).lineTo(nursery.x, nursery.y).strokePath();
    stream.lineStyle(4, 0xbceeff, .8).beginPath().moveTo(entrance.x, entrance.y + 3).lineTo(entrance.x + dx * .45, entrance.y + dy * .45).lineTo(nursery.x, nursery.y).strokePath();
    weatherEffects.push(stream);
    scene.tweens.add({ targets: stream, alpha: { from: .45, to: 1 }, duration: 330, yoyo: true, repeat: -1 });
    for (let index = 0; index < 3; index += 1) {
      const progress = .48 + index * .23;
      const pool = scene.add.ellipse(entrance.x + dx * progress, entrance.y + dy * progress + 8, 42 + index * 19, 12 + index * 5, 0x4aaad3, .55).setStrokeStyle(2, 0x9ee4f9, .65).setDepth(17);
      weatherEffects.push(pool);
      scene.tweens.add({ targets: pool, scaleX: 1.23, scaleY: 1.12, alpha: .32, duration: 560 + index * 120, yoyo: true, repeat: -1 });
    }
    const warning = scene.add.text(nursery.x, nursery.y - 32, 'WATER ENTERING', { fontFamily: 'Arial', fontSize: '11px', fontStyle: 'bold', color: '#e8fbff', backgroundColor: '#126889', padding: { x: 6, y: 4 } }).setOrigin(.5).setDepth(24);
    weatherEffects.push(warning);
    scene.tweens.add({ targets: warning, alpha: .58, duration: 410, yoyo: true, repeat: -1 });
  }

  function addStormAtmosphere() {
    if (!scene || !session || session.phase === 'ended') return;
    const progress = turnProgress();
    if (progress < .42) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const width = scene.scale.width;
    const height = scene.scale.height;
    const veil = scene.add.rectangle(width / 2, height / 2, width, height, 0x162c3c, Math.min(.3, .07 + progress * .2)).setScrollFactor(0).setDepth(10);
    weatherEffects.push(veil);
    const cloud = scene.add.graphics().setDepth(-3);
    cloud.fillStyle(0x263b4e, .22 + progress * .35);
    cloud.fillRect(0, 0, width, Math.min(190, height * .3));
    weatherEffects.push(cloud);
    if (progress >= .68) {
      addRainField(reducedMotion ? 14 : 32, .62);
    }
    if (progress >= .88 && !reducedMotion) {
      const timer = scene.time.addEvent({ delay: 5200, loop: true, callback: () => lightningStrike(true) });
      weatherTimers.push(timer);
    }
  }

  function createMeadowSpider(point, scale = 1) {
    const spider = scene.add.container(point.x, point.y).setDepth(24).setScale(scale);
    const legs = scene.add.graphics();
    legs.lineStyle(5, 0x39271f, 1);
    for (let side = -1; side <= 1; side += 2) {
      for (let leg = 0; leg < 4; leg += 1) {
        const y = -14 + leg * 10;
        legs.beginPath().moveTo(side * 4, y * .45).lineTo(side * (24 + leg * 3), y - 8).lineTo(side * (38 + leg * 4), y + (leg < 2 ? -2 : 9)).strokePath();
      }
    }
    const body = scene.add.ellipse(0, 5, 43, 39, 0x2c201d, 1).setStrokeStyle(3, 0x6f4a32, 1);
    const head = scene.add.circle(0, -19, 16, 0x3b2922, 1).setStrokeStyle(2, 0x7f5639, 1);
    const mark = scene.add.ellipse(0, 7, 12, 18, 0xb96532, .9);
    const eyeLeft = scene.add.circle(-6, -23, 3, 0xffdf7c, 1);
    const eyeRight = scene.add.circle(6, -23, 3, 0xffdf7c, 1);
    spider.add([legs, body, mark, head, eyeLeft, eyeRight]);
    return spider;
  }

  function stageWorldEvent(key, teamId) {
    if (!scene) return;
    clearWorldEventPresentation();
    const view = colonyViews.get(teamId);
    const team = session.teams.find(item => item.id === teamId);
    if (!view || !team) return;
    const palette = core.TEAM_COLORS[team.colorIndex];
    const entrance = view.sites.entrance;
    const nursery = view.sites.nursery;
    if (key === 'predator') {
      const spider = createMeadowSpider({ x: entrance.x + Math.min(78, view.zone.w * .3), y: entrance.y - 35 }, .72);
      worldEventPresentation.push(spider);
      scene.tweens.add({ targets: spider, x: spider.x - 12, y: spider.y + 4, angle: 3, duration: 720, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    if (key === 'tunnel-collapse') {
      const fall = { x: (entrance.x + nursery.x) / 2, y: (entrance.y + nursery.y) / 2 };
      const warning = scene.add.ellipse(fall.x, fall.y, 72, 42, 0xf2b94b, .2).setStrokeStyle(3, 0xffdb78, .9).setDepth(20);
      const blocked = scene.add.text(fall.x + Math.min(76, view.zone.w * .22), fall.y + 3, 'TUNNEL BLOCKED', {
        fontFamily: 'Arial', fontSize: '10px', fontStyle: 'bold', color: '#fff5ce', backgroundColor: '#8b3f27', padding: { x: 6, y: 4 },
      }).setOrigin(.5).setDepth(24);
      worldEventPresentation.push(warning, blocked);
      scene.tweens.add({ targets: warning, alpha: .5, scaleX: 1.12, scaleY: 1.12, duration: 520, yoyo: true, repeat: -1 });
      for (let index = 0; index < 7; index += 1) {
        const stone = scene.add.polygon(fall.x + (index % 3 - 1) * 12, fall.y + Math.floor(index / 3) * 9, [-8, 4, -5, -5, 3, -8, 9, 0, 5, 7], index % 2 ? 0xa36f45 : 0xc08a52, 1).setStrokeStyle(2, 0xf2c078, .9).setDepth(22).setAngle(index * 19);
        worldEventPresentation.push(stone);
      }
    }
    if (key === 'lost-ant') {
      const lost = actionWorker(view, palette, { x: entrance.x + Math.min(88, view.zone.w * .34), y: entrance.y - 31 }, 25);
      lost.setAngle(-13);
      worldEventPresentation.push(lost);
      scene.tweens.add({ targets: lost, x: lost.x - 8, angle: 13, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    if (key === 'fallen-fruit') {
      const fruit = scene.add.circle(entrance.x + 35, Math.max(16, entrance.y - 92), 21, 0xc74f3f, 1).setDepth(22).setStrokeStyle(4, 0xf4b64e, 1);
      const leaf = scene.add.ellipse(fruit.x + 12, fruit.y - 15, 17, 8, 0x6eaa4a, 1).setDepth(23).setAngle(-25);
      worldEventPresentation.push(fruit, leaf);
      scene.tweens.add({ targets: [fruit, leaf], y: '+=5', duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    if (key === 'heavy-rain') lightningStrike(false);
  }

  function playWorldEvent(key, teamId) {
    if (!scene) return 250;
    const view = colonyViews.get(teamId) || colonyViews.values().next().value;
    const team = session.teams.find(item => item.id === teamId) || currentTeam();
    const palette = team ? core.TEAM_COLORS[team.colorIndex] : core.TEAM_COLORS[0];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return 300;
    if (key === 'heavy-rain') {
      stopWeather();
      const cloud = scene.add.graphics().setDepth(-3);
      cloud.fillStyle(0x20384d, .72);
      cloud.fillRect(0, 0, scene.scale.width, Math.min(185, scene.scale.height * .27));
      weatherEffects.push(cloud);
      const mist = scene.add.rectangle(scene.scale.width / 2, Math.min(225, scene.scale.height * .34), scene.scale.width, 48, 0x8ed8ed, .13).setDepth(11);
      weatherEffects.push(mist);
      scene.tweens.add({ targets: mist, alpha: .25, scaleY: 1.35, duration: 700, yoyo: true, repeat: -1 });
      addRainField(68, 1);
      for (const [id, colonyView] of colonyViews) addFloodWater(colonyView, session.teams.find(item => item.id === id));
      const stopRain = playRainSound(4.8, 1);
      if (stopRain) weatherAudioStops.push(stopRain);
      lightningStrike(true, 1.08);
      weatherTimers.push(scene.time.addEvent({ delay: 4050, loop: true, callback: () => lightningStrike(true, .92) }));
      if (view) {
        for (let index = 0; index < Math.min(2, team.workers); index += 1) {
          const runner = actionWorker(view, palette, { x: view.sites.entrance.x + (index ? 12 : -12), y: view.sites.entrance.y - 22 }, 28);
          moveActionActor(runner, [{ x: runner.x, y: runner.y }, view.sites.entrance, view.sites.nursery], 1650 + index * 160, actor => scene.tweens.add({ targets: actor, alpha: 0, duration: 220, onComplete: () => actor.destroy(true) }));
        }
      }
      return 3400;
    }
    if (key === 'fallen-fruit') {
      const fruitX = view ? view.sites.entrance.x + 30 : scene.scale.width * .52;
      const fruit = scene.add.circle(fruitX, -35, 24, 0xc74f3f, 1).setDepth(14).setStrokeStyle(5, 0xf4b64e, 1);
      const leaf = scene.add.ellipse(fruit.x + 13, fruit.y - 16, 18, 8, 0x6eaa4a, 1).setDepth(15).setAngle(-25);
      scene.tweens.add({ targets: [fruit, leaf], y: scene.scale.height * .32, duration: 850, ease: 'Bounce.easeOut', onComplete: () => scene.time.delayedCall(800, () => { fruit.destroy(); leaf.destroy(); }) });
      if (view) {
        const pickup = { x: fruitX, y: view.sites.entrance.y - 20 };
        const carrier = actionWorker(view, palette, pickup);
        carrier.cargo.setVisible(true);
        moveActionActor(carrier, [pickup, view.sites.entrance, view.sites.food], 2200, actor => { depositVisibleSeeds(view.sites.food, 5); actor.destroy(true); });
      }
      return 2600;
    }
    if (key === 'food-trail') {
      const startX = view ? view.zone.x + 14 : scene.scale.width * .12;
      const trailWidth = view ? Math.max(80, view.zone.w - 28) : scene.scale.width * .76;
      for (let index = 0; index < 18; index += 1) {
        const seed = scene.add.ellipse(startX + index / 17 * trailWidth, scene.scale.height * .22 + Math.sin(index * .8) * 15, 8, 4, 0xf5c856, .25).setDepth(12).setAngle(index * 17);
        scene.tweens.add({ targets: seed, alpha: 1, scaleX: 1.35, scaleY: 1.35, duration: 420, delay: index * 35, yoyo: true, hold: 250, onComplete: () => seed.destroy() });
      }
      if (view) {
        const surface = { x: startX + trailWidth, y: view.sites.entrance.y - 24 };
        const follower = actionWorker(view, palette, surface);
        follower.cargo.setVisible(true);
        moveActionActor(follower, [surface, view.sites.entrance, view.sites.food], 2100, actor => { depositVisibleSeeds(view.sites.food, 5); actor.destroy(true); });
      }
      return 2500;
    }
    if (key === 'predator') {
      const entrance = view ? view.sites.entrance : { x: scene.scale.width / 2, y: scene.scale.height * .25 };
      const spider = createMeadowSpider({ x: entrance.x + Math.min(120, view ? view.zone.w * .45 : 120), y: entrance.y - 38 }, .9);
      const guardStart = view ? view.sites.guard : { x: entrance.x, y: entrance.y + 90 };
      const guard = view ? actionWorker(view, palette, guardStart, 33, true) : null;
      scene.tweens.add({ targets: spider, x: entrance.x + 28, y: entrance.y - 24, duration: 1050, ease: 'Sine.easeInOut' });
      if (guard) moveActionActor(guard, [guardStart, entrance], 950, actor => {
        scene.cameras.main.shake(230, .004);
        playTone('battle');
        scene.tweens.add({ targets: actor, x: actor.x + 17, angle: -12, duration: 180, yoyo: true, repeat: 2 });
        scene.tweens.add({ targets: spider, x: entrance.x + Math.min(150, view.zone.w * .6), y: entrance.y - 80, angle: 24, alpha: .1, duration: 900, delay: 260, ease: 'Cubic.easeIn', onComplete: () => spider.destroy(true) });
        scene.time.delayedCall(1450, () => { if (actor.active) actor.destroy(true); });
      });
      else scene.tweens.add({ targets: spider, x: entrance.x + 140, alpha: 0, duration: 950, delay: 1050, onComplete: () => spider.destroy(true) });
      return 2700;
    }
    if (key === 'tunnel-collapse' && view) {
      const fall = { x: (view.sites.entrance.x + view.sites.nursery.x) / 2, y: (view.sites.entrance.y + view.sites.nursery.y) / 2 };
      const stones = [];
      for (let index = 0; index < 8; index += 1) {
        const stone = scene.add.polygon(fall.x + (index % 4 - 1.5) * 11, fall.y + Math.floor(index / 4) * 11, [-8, 4, -5, -5, 3, -8, 9, 0, 5, 7], index % 2 ? 0x70513c : 0x8c6748, 1).setStrokeStyle(2, 0xc39a6b, .75).setDepth(22).setAngle(index * 21);
        stones.push(stone);
      }
      const helpers = [0, 1].slice(0, Math.max(1, Math.min(2, team.workers))).map(index => actionWorker(view, palette, { x: view.sites.nursery.x + (index ? 12 : -12), y: view.sites.nursery.y }, 28));
      helpers.forEach((helper, index) => moveActionActor(helper, [{ x: helper.x, y: helper.y }, fall], 900 + index * 130, actor => {
        scene.tweens.add({ targets: actor, x: actor.x + (index ? -8 : 8), angle: index ? -10 : 10, duration: 150, yoyo: true, repeat: 5 });
      }));
      scene.time.delayedCall(1050, () => stones.forEach((stone, index) => scene.tweens.add({ targets: stone, x: stone.x + (index % 2 ? 1 : -1) * (35 + index * 3), y: stone.y + 18 + index % 3 * 6, alpha: 0, duration: 850, delay: index * 45, ease: 'Cubic.easeOut', onComplete: () => stone.destroy() })));
      scene.time.delayedCall(2350, () => helpers.forEach(helper => { if (helper.active) helper.destroy(true); }));
      return 2600;
    }
    if (key === 'lost-ant' && view) {
      const start = { x: view.sites.entrance.x + Math.min(105, view.zone.w * .4), y: view.sites.entrance.y - 34 };
      const lost = actionWorker(view, palette, start, 25);
      const trail = scene.add.graphics().setDepth(13);
      trail.lineStyle(3, palette.light, .8).beginPath().moveTo(start.x, start.y).lineTo(view.sites.entrance.x, view.sites.entrance.y).lineTo(view.sites.nursery.x, view.sites.nursery.y).strokePath();
      scene.tweens.add({ targets: trail, alpha: 0, duration: 2200, delay: 500, onComplete: () => trail.destroy() });
      moveActionActor(lost, [start, view.sites.entrance, view.sites.nursery], 2200, actor => {
        depositVisibleSeeds(view.sites.nursery, 5);
        scene.tweens.add({ targets: actor, scaleX: 1.18, scaleY: 1.18, duration: 220, yoyo: true, repeat: 2, onComplete: () => actor.destroy(true) });
      });
      return 2750;
    }
    if (key === 'new-territory') {
      const origin = view ? view.sites.expansion : { x: scene.scale.width * .5, y: scene.scale.height * .62 };
      for (let index = 0; index < 34; index += 1) {
        const spark = scene.add.circle(origin.x, origin.y, 2 + index % 3, index % 2 ? 0xffd56e : 0x8de4c0, .9).setDepth(13);
        const angle = Math.PI * 2 * index / 34;
        scene.tweens.add({ targets: spark, x: spark.x + Math.cos(angle) * (80 + index * 4), y: spark.y + Math.sin(angle) * (45 + index * 2), alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => spark.destroy() });
      }
      if (view) {
        const explorer = actionWorker(view, palette, view.sites.nursery);
        moveActionActor(explorer, [view.sites.nursery, origin], 1750, actor => scene.tweens.add({ targets: actor, alpha: 0, duration: 350, onComplete: () => actor.destroy(true) }));
      }
      return 2300;
    }
    return 1800;
  }

  function initAudio() {
    if (!soundOn) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (!audioOutput) {
        const limiter = audioContext.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 8;
        limiter.ratio.value = 8;
        limiter.attack.value = .004;
        limiter.release.value = .18;
        const classroomGain = audioContext.createGain();
        classroomGain.gain.value = 2.25;
        classroomGain.connect(limiter);
        limiter.connect(audioContext.destination);
        audioOutput = classroomGain;
        effectsBus = audioContext.createGain();
        effectsBus.gain.value = Number($('effectsVolume').value) / 100;
        effectsBus.connect(audioOutput);
      }
      if (audioContext.state === 'suspended') audioContext.resume();
      startAmbient();
    } catch {}
  }

  function noiseBurst({ duration, volume, delay = 0, filterType = 'lowpass', frequency = 180, q = .8, decay = 2.2 }) {
    if (!soundOn || !audioContext || !audioOutput) return null;
    const length = Math.max(1, Math.floor(audioContext.sampleRate * duration));
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      const envelope = decay > 0 ? Math.pow(1 - index / channel.length, decay) : 1;
      channel[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime + delay;
    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + Math.min(.055, duration * .14));
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter); filter.connect(gain); gain.connect(effectsBus);
    source.start(start); source.stop(start + duration + .04);
    return source;
  }

  function playThunder(delay = 0, intensity = 1) {
    initAudio();
    if (!soundOn || !audioContext) return;
    try {
      noiseBurst({ duration: .28, volume: .052 * intensity, delay, filterType: 'highpass', frequency: 1050, q: .7, decay: 4.2 });
      noiseBurst({ duration: 2.25, volume: .105 * intensity, delay: delay + .025, filterType: 'lowpass', frequency: 175, q: .75, decay: 1.8 });
      noiseBurst({ duration: 1.65, volume: .055 * intensity, delay: delay + .34, filterType: 'bandpass', frequency: 285, q: 1.15, decay: 1.6 });
      tone(47, 1.45, .07 * intensity, delay + .04);
      tone(66, .82, .045 * intensity, delay + .36);
    } catch {}
  }

  function playRainSound(duration = 4.5, intensity = 1) {
    initAudio();
    if (!soundOn || !audioContext || !audioOutput) return null;
    try {
      const length = Math.max(1, Math.floor(audioContext.sampleRate * duration));
      const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
      const channel = buffer.getChannelData(0);
      let brown = 0;
      for (let index = 0; index < channel.length; index += 1) {
        const white = Math.random() * 2 - 1;
        brown = (brown + .025 * white) / 1.025;
        channel[index] = white * .72 + brown * 3.2;
      }
      const source = audioContext.createBufferSource();
      const highpass = audioContext.createBiquadFilter();
      const presence = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      source.buffer = buffer;
      highpass.type = 'highpass'; highpass.frequency.value = 480;
      presence.type = 'peaking'; presence.frequency.value = 2450; presence.Q.value = .7; presence.gain.value = 5;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.04 * intensity, now + .24);
      gain.gain.setValueAtTime(.04 * intensity, now + Math.max(.3, duration - .65));
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      source.connect(highpass); highpass.connect(presence); presence.connect(gain); gain.connect(effectsBus);
      source.start(now); source.stop(now + duration + .05);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        const stopAt = audioContext.currentTime + .12;
        gain.gain.cancelScheduledValues(audioContext.currentTime);
        gain.gain.setValueAtTime(Math.max(.0001, gain.gain.value), audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(.0001, stopAt);
        try { source.stop(stopAt + .02); } catch {}
      };
    } catch { return null; }
  }

  function playFootstep(delay = 0, intensity = 1) {
    initAudio();
    if (!soundOn || !audioContext) return;
    try {
      noiseBurst({ duration: .62, volume: .095 * intensity, delay, filterType: 'lowpass', frequency: 235, q: .85, decay: 3.4 });
      noiseBurst({ duration: .2, volume: .045 * intensity, delay: delay + .015, filterType: 'bandpass', frequency: 720, q: 1.1, decay: 4.6 });
      tone(43, .52, .092 * intensity, delay);
      tone(71, .28, .05 * intensity, delay + .025);
    } catch {}
  }

  function playHumanRumble(duration = 2.2) {
    initAudio();
    if (!soundOn || !audioContext) return;
    try {
      noiseBurst({ duration, volume: .045, filterType: 'lowpass', frequency: 92, q: .9, decay: .35 });
      tone(31, duration, .038);
      tone(39, duration * .78, .028, .3);
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
    oscillator.connect(gain); gain.connect(effectsBus);
    oscillator.start(audioContext.currentTime + delay); oscillator.stop(audioContext.currentTime + delay + duration + .04);
  }

  function antRustle(duration = .12, volume = .014, delay = 0) {
    if (!soundOn || !audioContext) return;
    const length = Math.max(1, Math.floor(audioContext.sampleRate * duration));
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2.8);
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = 'bandpass'; filter.frequency.value = 1150; filter.Q.value = 1.6;
    gain.gain.setValueAtTime(.0001, audioContext.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(volume, audioContext.currentTime + delay + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + delay + duration);
    source.buffer = buffer;
    source.connect(filter); filter.connect(gain); gain.connect(effectsBus);
    source.start(audioContext.currentTime + delay); source.stop(audioContext.currentTime + delay + duration + .03);
  }

  function playAntSound(kind) {
    initAudio();
    if (!soundOn || !audioContext) return;
    // Ant movement and actions need to remain audible from the back of a classroom.
    if (kind === 'scuttle') { antRustle(.08, .025); antRustle(.07, .021, .11); tone(185, .1, .027, .03); }
    if (kind === 'forage') { tone(330, .1, .04); tone(440, .09, .032, .16); antRustle(.1, .022, .27); }
    if (kind === 'build' || kind === 'dig') {
      for (let i = 0; i < 5; i++) {
        noiseBurst({ duration: .22, volume: .055, delay: i * .2, filterType: 'bandpass', frequency: kind === 'dig' ? 750 : 430, decay: 2 });
        tone(kind === 'dig' ? 105 : 145, .09, .04, i * .2 + .035);
      }
    }
    if (kind === 'hatch') { tone(620, .12, .04); tone(784, .16, .034, .15); }
    if (kind === 'guard') { tone(118, .16, .045); tone(156, .13, .036, .15); }
    if (kind === 'march') { antRustle(.07, .024); antRustle(.07, .024, .15); antRustle(.07, .024, .3); }
    if (kind === 'battle') { antRustle(.13, .04); tone(92, .14, .045, .06); }
  }

  function playTone(type) {
    initAudio();
    if (type === 'correct') { tone(523, .22, .06); tone(659, .28, .055, .12); }
    if (type === 'wrong') { tone(246, .22, .035); tone(220, .25, .03, .13); }
    if (type === 'upgrade') { tone(392, .2, .05); tone(523, .25, .05, .1); tone(784, .3, .04, .2); }
    if (type === 'wars') { tone(196, .45, .06); tone(293, .45, .055, .2); }
    if (type === 'battle') { tone(110, .22, .055); tone(165, .18, .05, .18); tone(98, .3, .055, .36); }
    if (type === 'victory') [523, 659, 784, 1046].forEach((note, index) => tone(note, .4, .055, index * .14));
  }

  function playWinnerCelebration() {
    initAudio();
    if (!soundOn || !audioContext || winnerCelebrationPlayed) return;
    winnerCelebrationPlayed = true;
    const melody = [523, 659, 784, 1046, 988, 784, 880, 1046, 1175, 1046];
    melody.forEach((note, index) => tone(note, .22, .045, index * .16));
    [262, 330, 392, 523, 392].forEach((note, index) => tone(note, .35, .018, index * .32));
    ['scuttle', 'hatch', 'guard'].forEach((kind, index) => setTimeout(() => playAntSound(kind), index * 210));
  }

  function startAmbient() {
    if (!soundOn || !audioContext || !audioOutput || ambientTimer || document.hidden || !session || ['paused', 'ended'].includes(session.phase)) return;
    if (!musicBus) { musicBus = audioContext.createGain(); musicBus.connect(audioOutput); }
    musicBus.gain.setValueAtTime(Number($('musicVolume').value) / 100, audioContext.currentTime);
    // Original 104 BPM meadow theme: soft plucks, warm chords and a light bass pulse.
    // Schedule against the audio clock, rather than relying on timer precision.
    const beat = 60 / 104;
    const chords = [[60,64,67], [55,59,62], [57,60,64], [53,57,60]];
    const melody = [72,0,76,79,76,0,74,72, 71,0,74,79,74,0,71,67, 69,0,72,76,79,76,72,0, 69,72,77,76,74,0,72,0];
    const note = (midi, time, duration, volume, type = 'sine') => {
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      envelope.gain.setValueAtTime(.0001, time);
      envelope.gain.exponentialRampToValueAtTime(volume, time + .025);
      envelope.gain.exponentialRampToValueAtTime(.0001, time + duration);
      oscillator.connect(envelope); envelope.connect(musicBus);
      musicVoices.add(oscillator);
      oscillator.onended = () => { musicVoices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
      oscillator.start(time); oscillator.stop(time + duration + .03);
    };
    musicNextTime = audioContext.currentTime + .05;
    const schedule = () => {
      if (musicNextTime < audioContext.currentTime) musicNextTime = audioContext.currentTime + .05;
      while (musicNextTime < audioContext.currentTime + .15) {
        const step = musicStep % 32;
        const chord = chords[Math.floor(step / 8)];
        const duck = session.birdStage === 'attack' || session.birdStage === 'rain' || session.phase === 'event' ? .5 : 1;
        if (melody[step]) note(melody[step], musicNextTime, beat * .7, .033 * duck, 'triangle');
        if (step % 8 === 0) chord.forEach(midi => note(midi, musicNextTime, beat * 3.6, .012 * duck));
        if (step % 4 === 0) note(chord[0] - 12, musicNextTime, beat * .8, .035 * duck);
        musicNextTime += beat / 2;
        musicStep += 1;
      }
    };
    schedule(); ambientTimer = setInterval(schedule, 50);
  }

  function stopAmbient() {
    clearInterval(ambientTimer); ambientTimer = null;
    for (const oscillator of musicVoices) { try { oscillator.stop(); } catch {} }
    musicVoices.clear();
  }

  $('effectsVolume').addEventListener('input', () => {
    const volume = Number($('effectsVolume').value);
    $('effectsVolumeLabel').textContent = `Game sounds ${volume}%`;
    if (effectsBus) effectsBus.gain.setTargetAtTime(soundOn ? volume / 100 : 0, audioContext.currentTime, .03);
  });

  $('musicVolume').addEventListener('input', () => {
    const volume = Number($('musicVolume').value);
    $('musicVolumeLabel').textContent = `Music ${volume}%`;
    if (musicBus) musicBus.gain.setTargetAtTime(volume / 100, audioContext.currentTime, .05);
  });

  function toggleSound() {
    soundOn = !soundOn;
    if (soundOn) initAudio(); else stopAmbient();
    if (effectsBus) effectsBus.gain.setTargetAtTime(soundOn ? Number($('effectsVolume').value) / 100 : 0, audioContext.currentTime, .03);
    updateHUD();
  }

  $('matchType').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (button) setMatchType(button.dataset.type); });
  $('worldViewport').addEventListener('scroll', () => {
    if (scene && !raidPresentation && !actionCamera) scene.cameras.main.scrollY = $('worldViewport').scrollTop;
    $('worldDepth').textContent = `Depth ${Math.round($('worldViewport').scrollTop / 16)}`;
  }, { passive: true });
  $('worldSurface').addEventListener('click', () => { resetActionCamera(); $('worldViewport').scrollTo({ top: 0, behavior: 'smooth' }); });
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
  $('storyPause').addEventListener('click', () => {
    const crawl = $('storyCrawl');
    const paused = crawl.classList.toggle('is-paused');
    $('storyPause').textContent = paused ? 'Play story' : 'Pause story';
    $('storyPause').setAttribute('aria-pressed', String(paused));
  });
  $('storyReplay').addEventListener('click', restartStoryCrawl);
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
  $('resumeBtn').addEventListener('click', () => enterGame().catch(error => showNotice(error.message)));
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
  // A fetch started while the page is being hidden is not guaranteed to finish
  // (notably during WebKit reloads). State transitions already save remotely;
  // keep the synchronous local snapshot as the reliable navigation fallback.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (session) saveLocal(); stopAmbient(); }
    else if (!$('gameScreen').classList.contains('hidden')) startAmbient();
  });

  (async function load() {
    try {
      data = await request();
      if (testMode && data.game) {
        data.session = null;
        data.roster = null;
        data.game.colonyquest = { ...data.game.colonyquest, teams: [] };
        data.game.lessonTitle = `Teacher test — ${data.game.lessonTitle}`;
        const banner = document.createElement('div');
        banner.textContent = 'Teacher test • Practice teams only. No learner marks or live game changes are saved.';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;text-align:center;background:#173b32;color:white;padding:6px;font-size:13px;pointer-events:none';
        document.body.appendChild(banner);
      }
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
