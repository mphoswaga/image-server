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

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function colorHex(value) {
    return `#${Number(value || 0).toString(16).padStart(6, '0')}`;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  function setOverlay(id) {
    for (const overlay of ['questionOverlay', 'rewardOverlay', 'targetOverlay', 'eventOverlay', 'finalOverlay']) $(overlay).classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
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
    $('phaseLabel').textContent = session.warsActive ? 'Colony Wars' : 'Growth phase';
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
    $('questionText').textContent = question.question;
    $('questionProgress').textContent = `Question ${(session.questionCursor % data.game.questions.length) + 1} of ${data.game.questions.length}`;
    $('answers').innerHTML = question.options.map((option, index) => `<button type="button" class="answer" data-choice="${index}"><span>${String.fromCharCode(65 + index)}.</span> ${esc(option)}</button>`).join('');
    $('feedback').className = 'feedback';
    $('feedbackNext').textContent = 'Continue';
    setOverlay('questionOverlay');
    updateHUD();
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
    $('feedbackText').textContent = correct ? 'Correct - this colony earned an upgrade.' : `Good try. The answer is ${question.options[question.correctIndex]}.`;
    $('feedbackNext').textContent = correct ? 'Choose reward' : 'Next team';
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

  function showRewards() {
    transitionLocked = false;
    const team = currentTeam();
    $('rewardTitle').textContent = `${team.name}: choose your colony reward`;
    $('rewardGrid').innerHTML = rewardChoices().map(key => {
      const reward = core.REWARDS[key];
      return `<button type="button" class="reward" data-reward="${key}"><span class="reward-symbol">${reward.label.charAt(0)}</span><strong>${esc(reward.label)}</strong><span>${esc(reward.description)}</span></button>`;
    }).join('');
    setOverlay('rewardOverlay');
  }

  async function chooseReward(key) {
    if (session.phase !== 'reward' || transitionLocked) return;
    transitionLocked = true;
    if (key === 'raid') {
      const team = currentTeam();
      $('targetGrid').innerHTML = session.teams.filter(item => item.id !== team.id).map(item => `<button type="button" data-target="${esc(item.id)}">Challenge ${esc(item.name)}</button>`).join('');
      setOverlay('targetOverlay');
      transitionLocked = false;
      return;
    }
    const team = currentTeam();
    core.applyReward(team, key, session.teams);
    const upgradeEvent = `upgrade-${key}`;
    session.phase = 'event';
    session.eventAction = 'next-turn';
    session.events.push({ key: upgradeEvent, at: new Date().toISOString() });
    setOverlay(null);
    updateWorld();
    celebrate(team.id, key);
    playTone('upgrade');
    updateHUD();
    toast(`${core.REWARDS[key].label} upgraded for ${team.name}`);
    await saveState();
    await wait(850);
    const latestEvent = session.events[session.events.length - 1];
    if (session.phase === 'event' && latestEvent && latestEvent.key === upgradeEvent) await nextTurn();
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
      showEvent({ title: 'Colony Wars have begun', description: 'Knowledge raids are now available. Colonies can win food, but every team stays in the game.', kicker: 'Final phase' }, continueAfterEvent);
      playTone('wars');
      return;
    }
    if (shouldShowEvent()) {
      const event = eventForTurn();
      core.applyEvent(session.teams, event.key);
      session.events.push({ key: event.key, at: new Date().toISOString() });
      session.phase = 'event';
      session.eventAction = 'question';
      playWorldEvent(event.key);
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

  function showEvent(event, onContinue) {
    $('eventKicker').textContent = event.kicker || 'World event';
    $('eventTitle').textContent = event.title;
    $('eventText').textContent = event.description;
    $('eventMark').textContent = event.kicker === 'Final phase' ? 'W' : '!';
    $('eventContinue').classList.remove('hidden');
    $('eventContinue').disabled = false;
    $('eventContinue').onclick = () => {
      $('eventContinue').disabled = true;
      Promise.resolve(onContinue && onContinue()).catch(error => {
        transitionLocked = false;
        $('eventContinue').disabled = false;
        toast(error.message);
      });
    };
    setOverlay('eventOverlay');
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
      const event = last && last.key === 'colony-wars'
        ? { title: 'Colony Wars have begun', description: 'Knowledge raids are now available. Colonies can win food, but every team stays in the game.', kicker: 'Final phase' }
        : core.EVENTS.find(item => item.key === (last && last.key));
      const next = session.eventAction === 'next-turn' ? nextTurn : continueAfterEvent;
      return showEvent(event || { title: 'Colony event', description: 'The colonies have adapted. Continue when the class is ready.' }, next);
    }
    if (session.phase === 'paused') return showPaused();
    session.phase = 'question';
    presentQuestion();
  }

  function showPaused() {
    $('eventKicker').textContent = 'Teacher pause';
    $('eventTitle').textContent = 'The colonies are resting';
    $('eventText').textContent = 'The timer and all turns are paused for the whole class.';
    $('eventMark').textContent = 'II';
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

  function drawAnt(targetScene, x, y, color, soldier, scale = 1) {
    const container = targetScene.add.container(x, y);
    const legs = targetScene.add.graphics();
    legs.lineStyle(soldier ? 2.2 : 1.7, 0x161d1d, .95);
    for (const offset of [-5, 0, 5]) {
      legs.lineBetween(offset, -2, offset - 6, -7);
      legs.lineBetween(offset, 2, offset - 6, 7);
    }
    const abdomen = targetScene.add.ellipse(7, 0, soldier ? 13 : 11, soldier ? 10 : 8, color);
    const body = targetScene.add.ellipse(0, 0, 9, 7, color);
    const head = targetScene.add.circle(-7, 0, soldier ? 5 : 4, soldier ? 0x2a2020 : color);
    const leaf = targetScene.add.ellipse(0, -8, 8, 4, 0x75c043).setVisible(false);
    container.add([legs, abdomen, body, head, leaf]);
    container.setScale(scale);
    container.leaf = leaf;
    container.legs = legs;
    return container;
  }

  function roamAnt(ant, zone, index) {
    if (!scene || !ant.active) return;
    const surfaceY = zone.y + zone.h * .19;
    const homeX = zone.x + zone.w * (.42 + (index % 4) * .05);
    const homeY = zone.y + zone.h * (.64 + (index % 3) * .07);
    const forageX = zone.x + zone.w * (.12 + ((index * 17) % 72) / 100);
    const forageY = surfaceY - 8 - (index % 3) * 6;
    ant.x = homeX;
    ant.y = homeY;
    const duration = 2300 + (index % 5) * 260;
    scene.tweens.add({ targets: ant.legs, angle: index % 2 ? 8 : -8, duration: 120 + index % 3 * 20, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({
      targets: ant,
      x: forageX,
      y: forageY,
      angle: index % 2 ? -8 : 8,
      duration,
      delay: index * 90,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      hold: 180,
      repeatDelay: 160,
      onYoyo: () => { if (ant.active) ant.leaf.setVisible(true); },
      onRepeat: () => { if (ant.active) ant.leaf.setVisible(false); },
    });
  }

  function drawColony(team, zone) {
    const palette = core.TEAM_COLORS[team.colorIndex];
    const graphics = scene.add.graphics();
    graphics.fillStyle(palette.primary, .08);
    graphics.fillRoundedRect(zone.x + 3, zone.y + 3, zone.w - 6, zone.h - 6, 12);
    graphics.lineStyle(2, palette.light, .5);
    graphics.strokeRoundedRect(zone.x + 3, zone.y + 3, zone.w - 6, zone.h - 6, 12);
    const surfaceY = zone.y + zone.h * .19;
    graphics.fillStyle(0x74ad5f, .95);
    graphics.fillRect(zone.x + 4, surfaceY - 7, zone.w - 8, 13);
    graphics.lineStyle(2, 0xb8df77, .82);
    for (let blade = 0; blade < Math.max(6, Math.floor(zone.w / 42)); blade += 1) {
      const grassX = zone.x + 14 + (blade * 41) % Math.max(20, zone.w - 25);
      graphics.lineBetween(grassX, surfaceY - 6, grassX + (blade % 2 ? 5 : -4), surfaceY - 20 - blade % 3 * 3);
    }
    for (let stone = 0; stone < Math.min(8, 3 + team.territory); stone += 1) {
      ellipse(graphics, zone.x + 28 + (stone * 67) % Math.max(30, zone.w - 52), surfaceY + 20 + stone % 2 * 10, 10 + stone % 4, 6 + stone % 3, 0x9b765f, .46);
    }
    graphics.fillStyle(0x3b2a22, .92);
    graphics.fillEllipse(zone.x + zone.w * .5, surfaceY + 4, 34 + team.nestLevel * 3, 15);

    graphics.lineStyle(8 + Math.min(5, team.nestLevel), 0x2e211c, .62);
    graphics.beginPath();
    graphics.moveTo(zone.x + zone.w * .5, surfaceY + 8);
    graphics.lineTo(zone.x + zone.w * .49, zone.y + zone.h * .43);
    graphics.lineTo(zone.x + zone.w * .3, zone.y + zone.h * .61);
    graphics.moveTo(zone.x + zone.w * .49, zone.y + zone.h * .43);
    graphics.lineTo(zone.x + zone.w * .7, zone.y + zone.h * .59);
    graphics.moveTo(zone.x + zone.w * .49, zone.y + zone.h * .5);
    graphics.lineTo(zone.x + zone.w * .5, zone.y + zone.h * .82);
    graphics.strokePath();

    const chamberColor = 0x2f211c;
    ellipse(graphics, zone.x + zone.w * .3, zone.y + zone.h * .64, 70 + team.food * .3, 42 + team.nestLevel * 2, chamberColor, .72);
    ellipse(graphics, zone.x + zone.w * .7, zone.y + zone.h * .62, 72 + team.defense * 4, 45 + team.nestLevel * 2, chamberColor, .72);
    ellipse(graphics, zone.x + zone.w * .5, zone.y + zone.h * .83, 88 + team.queenLevel * 5, 48 + team.queenLevel * 2, chamberColor, .78);
    graphics.lineStyle(Math.min(7, 1 + team.defense), palette.light, .85);
    graphics.strokeEllipse(zone.x + zone.w * .7, zone.y + zone.h * .62, 72 + team.defense * 4, 45 + team.nestLevel * 2);

    const foodDots = Math.min(16, Math.max(2, Math.round(team.food / 7)));
    for (let index = 0; index < foodDots; index += 1) {
      ellipse(graphics, zone.x + zone.w * .25 + (index % 5) * 9, zone.y + zone.h * .62 + Math.floor(index / 5) * 7, 7, 4, index % 2 ? 0xe9c46a : 0x7ac943, .95);
    }

    const eggCount = Math.min(8, 2 + team.queenLevel);
    for (let index = 0; index < eggCount; index += 1) {
      ellipse(graphics, zone.x + zone.w * .47 + (index % 4) * 8, zone.y + zone.h * .84 + Math.floor(index / 4) * 7, 7, 4, 0xf7edcf, .95);
    }

    if (team.defense > 1) {
      graphics.lineStyle(Math.min(8, 2 + team.defense), palette.light, .9);
      graphics.strokeCircle(zone.x + zone.w * .5, surfaceY + 3, 20 + team.defense * 2);
    }

    const queen = drawAnt(scene, zone.x + zone.w * .5, zone.y + zone.h * .82, palette.light, false, 1.7 + team.queenLevel * .06);
    queen.setDepth(4);
    const labelSize = zone.w < 260 ? 12 : 15;
    const title = scene.add.text(zone.x + 13, zone.y + 13, team.name, { fontFamily: 'Arial', fontSize: `${labelSize}px`, fontStyle: 'bold', color: '#ffffff', stroke: '#102f34', strokeThickness: 4 });
    const level = scene.add.text(zone.x + 13, zone.y + 32, `Nest ${team.nestLevel}  |  Territory ${team.territory}`, { fontFamily: 'Arial', fontSize: zone.w < 260 ? '9px' : '11px', color: '#e5fff4', stroke: '#102f34', strokeThickness: 3 });
    title.setDepth(5); level.setDepth(5);

    for (let flag = 0; flag < Math.min(5, team.territory); flag += 1) {
      const fx = zone.x + zone.w - 22 - flag * 16;
      graphics.lineStyle(2, 0xf7ecd3, .9); graphics.lineBetween(fx, surfaceY - 5, fx, surfaceY - 28);
      graphics.fillStyle(palette.primary, 1); graphics.fillTriangle(fx, surfaceY - 28, fx, surfaceY - 17, fx - 11, surfaceY - 23);
    }

    const visibleAnts = Math.min(14, Math.max(4, Math.round(team.population / 2)));
    const ants = [];
    for (let index = 0; index < visibleAnts; index += 1) {
      const soldier = index < Math.min(team.soldiers, 5);
      const ant = drawAnt(scene, 0, 0, soldier ? palette.dark : palette.primary, soldier, soldier ? 1.22 : 1);
      ant.setDepth(3);
      ants.push(ant);
      roamAnt(ant, zone, index);
    }
    colonyViews.set(team.id, { zone, graphics, ants, queen, title, level });
  }

  function updateWorld() {
    if (!scene || !session) return;
    scene.tweens.killAll();
    scene.children.removeAll(true);
    colonyViews = new Map();
    const width = scene.scale.width;
    const height = scene.scale.height;
    const background = scene.add.graphics();
    background.fillStyle(session.warsActive ? 0x6fa69a : 0x8bc9b1, 1);
    background.fillRect(0, 0, width, height);
    background.fillStyle(session.warsActive ? 0x4a302b : 0x5d4032, 1);
    background.fillRect(0, 98, width, height - 98);
    background.fillStyle(0x3c2a24, .24);
    for (let y = 140; y < height; y += 42) background.fillRect(0, y, width, 2);
    background.lineStyle(2, 0xdaf5b4, .65);
    for (let index = 0; index < 14; index += 1) {
      const x = (index * 137) % Math.max(1, width);
      background.beginPath(); background.moveTo(x, 0); background.lineTo(x + ((index % 3) - 1) * 18, 65 + (index % 4) * 8); background.strokePath();
    }
    for (let index = 0; index < 80; index += 1) {
      const x = (index * 83 + 29) % Math.max(1, width);
      const y = 118 + ((index * 59) % Math.max(1, height - 125));
      ellipse(background, x, y, 2 + index % 4, 2 + index % 3, index % 3 ? 0x8f6c54 : 0xc39b72, .24);
    }
    background.setDepth(-10);

    const count = session.teams.length;
    const columns = width < 700 ? (count <= 2 ? 1 : 2) : count <= 3 ? count : count === 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const margin = 10;
    const top = 108;
    const zoneWidth = (width - margin * (columns + 1)) / columns;
    const zoneHeight = (height - top - margin * (rows + 1)) / rows;
    session.teams.forEach((team, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      drawColony(team, { x: margin + col * (zoneWidth + margin), y: top + margin + row * (zoneHeight + margin), w: zoneWidth, h: zoneHeight });
    });
  }

  function celebrate(teamId, kind) {
    if (!scene) return;
    const view = colonyViews.get(teamId);
    if (!view) return;
    const palette = core.TEAM_COLORS[session.teams.find(team => team.id === teamId).colorIndex];
    for (let index = 0; index < 18; index += 1) {
      const dot = scene.add.circle(view.zone.x + view.zone.w / 2, view.zone.y + view.zone.h / 2, 3 + index % 3, index % 3 === 0 ? 0xffd166 : palette.light).setDepth(10);
      const angle = Math.PI * 2 * index / 18;
      scene.tweens.add({ targets: dot, x: dot.x + Math.cos(angle) * (45 + index * 2), y: dot.y + Math.sin(angle) * (32 + index), alpha: 0, scale: .3, duration: 850, ease: 'Cubic.easeOut', onComplete: () => dot.destroy() });
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
