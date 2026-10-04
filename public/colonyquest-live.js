(function () {
  'use strict';
  const $ = (id) => document.getElementById(id),
    esc = (value) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  const gameId = location.pathname.split('/').filter(Boolean).at(-1),
    host = location.pathname.startsWith('/colonyquest-live/');
  const api = '/api/game/' + encodeURIComponent(gameId) + '/colonyquest-live';
  let state = null,
    offset = 0,
    scene = null,
    audio = null,
    sound = false,
    renderKey = '',
    pending = null,
    socket = null,
    stopped = false,
    retries = 0,
    lastReceived = Date.now(),
    lastBeep = '',
    actionCue = null;
  const soundtrack = new ColonyMusic((track) => {
    $('musicTrackLabel').textContent = `${track.title} — ${track.artist}`;
  });
  function syncMusic() {
    soundtrack.setActive(
      sound &&
        !!state &&
        !['paused', 'ended'].includes(state.phase) &&
        !document.body.classList.contains('offline'),
    );
  }
  $('musicVolume').oninput = () => soundtrack.setVolume(Number($('musicVolume').value) / 200);
  $('colonyCanvas').addEventListener('colony-action', (event) => {
    actionCue = { text: event.detail, until: scene.clock + 4800 };
  });
  const symbols = {
    workers: '🐜',
    food: '🌾',
    supplies: '🍃',
    expansion: '🏡',
    defense: '🪨',
    soldiers: '🛡️',
    queen: '🥚',
    raid: '⚔️',
  };
  function error(message) {
    $('error').hidden = !message;
    $('error').textContent = message || '';
  }
  async function request(suffix = '', body) {
    const response = await fetch(api + suffix, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = Error(data.error || 'Connection interrupted. Please try again.');
      e.status = response.status;
      throw e;
    }
    return data;
  }
  function chime(freq = 620) {
    if (!sound) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
      const o = audio.createOscillator(),
        g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.055, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
      o.connect(g);
      g.connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.2);
    } catch {}
  }
  $('sound').onclick = () => {
    sound = !sound;
    $('sound').textContent = sound ? 'Sound on' : 'Sound off';
    if (sound) chime();
    syncMusic();
  };
  $('fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else
      (host && !$('hostRoom').hidden ? $('hostWorld') : document.documentElement)
        .requestFullscreen?.()
        .catch(() => {});
  };
  function season(s) {
    const w = s?.world || {};
    if (w.birdStage === 'warning') return 'Birds approaching · strengthen your walls';
    if (w.birdStage === 'attack') return 'Birds overhead · guards stand ready';
    if (w.birdStage === 'rain') return 'The great rain · walls protect your food';
    if (w.rainOccurred) return 'Green meadow · rebuild and flourish';
    if (w.dryOccurred) return 'Dry season · feed your workers';
    return 'Gathering season · store 12 food for the drought';
  }
  function clock() {
    if (!state) return;
    const paused = state.phase === 'paused';
    const sec = paused
      ? Math.ceil((state.remaining || 0) / 1000)
      : Math.max(0, Math.ceil((state.deadline - (Date.now() + offset)) / 1000));
    const el = $(host ? 'hostTimer' : 'timer');
    el.textContent = paused ? 'Ⅱ' : ['lobby', 'ended'].includes(state.phase) ? '🐜' : sec;
    el.classList.toggle('urgent', sec <= 5 && !paused);
    if (
      !host &&
      state.phase === 'answer' &&
      sec > 0 &&
      sec <= 3 &&
      !document.body.classList.contains('offline')
    ) {
      const key = state.id + ':' + state.round + ':' + sec;
      if (key !== lastBeep) {
        lastBeep = key;
        chime(450 + sec * 100);
      }
    }
  }
  setInterval(clock, 200);
  function setState(next) {
    const prior = state;
    state = next;
    offset = next.serverNow - Date.now();
    scene?.update(next);
    syncMusic();
    clock();
    if (host) return;
    if (prior?.phase === 'answer' && next.phase === 'upgrade') chime(next.me?.correct ? 880 : 330);
    renderLearner();
  }
  function submit(message) {
    if (
      pending ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      document.body.classList.contains('offline')
    )
      return;
    pending = { ...message, matchId: state.id, round: state.round, commandId: crypto.randomUUID() };
    socket.send(JSON.stringify(pending));
    renderKey = '';
    renderLearner();
  }
  function renderLearner() {
    const s = state,
      p = s.me;
    if (!p) return;
    const disconnected = document.body.classList.contains('offline');
    $('myName').textContent = p.name;
    $('chapter').textContent = season(s);
    $('rank').textContent = `#${s.players.findIndex((x) => x.id === p.id) + 1} of ${s.players.length}`;
    const c = p.colony;
    $('resources').innerHTML =
      `<span>🌾 ${c.food} food</span><span>🪵 ${c.sticks || 0}</span><span>🍃 ${c.leaves || 0}</span><span>🐜 ${c.workers} workers</span><span>🛡 ${c.soldiers} guards</span>`;
    $('rivals').innerHTML = s.players
      .filter((x) => x.id !== p.id)
      .slice(0, 4)
      .map((x) => `<span>${esc(x.name)} · ${x.strength} pts</span>`)
      .join('');
    const recent = s.events.at(-1);
    const activeCue = actionCue && scene.clock < actionCue.until;
    $('event').classList.toggle('action-cue', !!activeCue);
    $('event').textContent = activeCue
      ? actionCue.text
      : recent && Date.now() + offset - recent.at < 9000
        ? recent.text
        : season(s);
    if (
      pending &&
      (pending.matchId !== s.id ||
        pending.round !== s.round ||
        (pending.type === 'answer' && p.choice !== null) ||
        (pending.type === 'upgrade' && p.upgraded))
    ) {
      pending = null;
      renderKey = '';
    }
    const key = JSON.stringify([
      s.phase,
      s.round,
      p.choice,
      p.correct,
      p.upgraded,
      p.upgrades,
      pending?.commandId,
      disconnected,
    ]);
    if (key === renderKey) return;
    renderKey = key;
    $('learner').classList.toggle('preview', s.preview);
    $('roundLabel').textContent = s.preview
      ? 'PRACTICE · NO LEARNER MARKS SAVED'
      : `QUESTION ${s.round + 1} OF ${s.total}`;
    $('explanation').textContent = '';
    $('choices').className = 'choices';
    $('choices').innerHTML = '';
    $('finished').hidden = true;
    if (s.phase === 'lobby') {
      $('question').textContent = 'Your colony is ready!';
      $('instruction').textContent =
        'Wait for your teacher. Answer a question, then choose one upgrade. Your workers collect supplies automatically.';
      return;
    }
    if (s.phase === 'paused') {
      $('question').textContent = 'The meadow is resting';
      $('instruction').textContent = 'Your teacher will resume the game. Your answers and colony are safe.';
      return;
    }
    if (s.phase === 'ended') {
      $('question').textContent = 'Your colony made it through!';
      const own = s.players.find((x) => x.id === p.id);
      $('instruction').textContent =
        `${own?.score || 0} correct · ${own?.answeredCount || 0} answered · ${s.total} questions`;
      $('explanation').textContent = s.preview
        ? 'Practice complete. Your class results were not changed.'
        : 'Your answers are saved. Colony points and learning results are counted separately.';
      $('finished').hidden = false;
      $('finished').innerHTML =
        '<h2>🌿 Champions of the meadow</h2>' +
        s.players
          .slice(0, 3)
          .map(
            (x, i) =>
              `<p><strong>${['🥇', '🥈', '🥉'][i]} ${esc(x.name)}</strong> · ${x.strength} colony points</p>`,
          )
          .join('');
      return;
    }
    $('question').textContent = s.question.question;
    if (s.phase === 'answer') {
      $('instruction').textContent = disconnected
        ? 'Reconnecting — your saved answer is safe.'
        : pending
          ? 'Saving your answer…'
          : p.choice !== null
            ? 'Answer locked in. Watch your colony while the others finish.'
            : 'Choose one answer. Correct answers earn a colony upgrade.';
      $('choices').innerHTML = s.question.options
        .map(
          (option, i) =>
            `<button data-choice="${i}" class="${(p.choice ?? pending?.choice) === i ? 'selected' : ''}" ${p.choice !== null || pending || disconnected ? 'disabled' : ''}>${String.fromCharCode(65 + i)}. ${esc(option)}${(p.choice ?? pending?.choice) === i ? '<small>✓ Your choice</small>' : ''}</button>`,
        )
        .join('');
      $('choices')
        .querySelectorAll('[data-choice]')
        .forEach(
          (button) =>
            (button.onclick = () => submit({ type: 'answer', choice: Number(button.dataset.choice) })),
        );
    } else if (s.phase === 'upgrade' && p.correct && !p.upgraded) {
      $('question').textContent = 'Correct! Grow your colony.';
      $('instruction').textContent = pending
        ? 'Saving your upgrade…'
        : 'Choose one upgrade. Raids run automatically.';
      $('explanation').textContent = 'Correct answer: ' + s.question.options[s.question.correctIndex];
      $('choices').classList.add('upgrades');
      $('choices').innerHTML = p.upgrades
        .map(
          (u, i) =>
            `<button data-upgrade="${i}" ${!u.allowed || pending || disconnected ? 'disabled' : ''}><span class="symbol">${symbols[u.key]}</span>${esc(u.label)}<small>${esc(!u.allowed ? (u.cost?.sticks ? `Need ${u.cost.sticks} sticks + ${u.cost.leaves} leaves` : u.reason) : u.key === 'raid' ? u.reason : u.cost?.sticks ? `${u.cost.sticks} sticks + ${u.cost.leaves} leaves` : u.key === 'workers' ? 'Collects food and materials automatically' : u.key === 'supplies' ? '+3 sticks · +2 leaves' : u.key === 'food' ? '+5 food' : u.key === 'queen' ? 'Hatches after two rounds' : 'Protects your colony')}</small></button>`,
        )
        .join('');
      $('choices')
        .querySelectorAll('[data-upgrade]')
        .forEach(
          (button) =>
            (button.onclick = () => {
              const u = p.upgrades[Number(button.dataset.upgrade)];
              submit({ type: 'upgrade', key: u.key, target: u.target });
            }),
        );
    } else {
      $('instruction').textContent = p.correct
        ? 'Upgrade complete. Your ants are on the move!'
        : p.choice === null
          ? 'Time finished. Try the next question!'
          : 'Keep growing — try the next question!';
      $('choices').innerHTML = s.question.options
        .map(
          (option, i) =>
            `<button disabled class="${i === s.question.correctIndex ? 'correct' : i === p.choice ? 'incorrect' : ''}">${String.fromCharCode(65 + i)}. ${esc(option)}${i === s.question.correctIndex ? '<small>✓ Correct answer</small>' : ''}</button>`,
        )
        .join('');
      $('explanation').textContent = s.question.explanation || '';
    }
  }
  async function connect() {
    if (stopped) return;
    $('connection').textContent = 'Connecting…';
    document.body.classList.add('offline');
    syncMusic();
    try {
      const ticket = await request('/ticket', {});
      if (stopped) return;
      socket = new WebSocket(
        (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/colonyquest-live',
      );
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: ticket.token }));
      socket.onmessage = (event) => {
        lastReceived = Date.now();
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') {
          const wasOffline = document.body.classList.contains('offline');
          document.body.classList.remove('offline');
          $('connection').textContent = msg.state.preview ? 'Practice vs computer' : 'Connected';
          error('');
          retries = 0;
          setState(msg.state);
          if (wasOffline && pending) socket.send(JSON.stringify(pending));
        }
        if (msg.type === 'ack' && pending?.commandId === msg.commandId) {
          pending = null;
          renderKey = '';
          if (!msg.accepted) error(msg.error);
          renderLearner();
        }
      };
      socket.onclose = (e) => {
        document.body.classList.add('offline');
        syncMusic();
        renderKey = '';
        if (state) renderLearner();
        if (e.code === 4002 || e.code === 4003) {
          stopped = true;
          $('connection').textContent = 'Disconnected';
          error(
            e.code === 4002
              ? 'This colony is open on another device.'
              : 'This room is unavailable. Return to the learner link or ask your teacher.',
          );
          return;
        }
        $('connection').textContent = 'Reconnecting…';
        setTimeout(connect, Math.min(8000, 700 * 2 ** Math.min(retries++, 4)) + Math.random() * 400);
      };
      socket.onerror = () => {};
    } catch (e) {
      if (e.status === 401) {
        location.replace('/play/' + encodeURIComponent(gameId) + '?activity=colonyquest-live');
        return;
      }
      if (e.status === 403) {
        stopped = true;
        $('connection').textContent = 'Room unavailable';
        error(e.message);
        return;
      }
      $('connection').textContent = 'Waiting for teacher';
      error(e.message);
      setTimeout(connect, 3000);
    }
  }
  async function showReport() {
    const id = $('history').value;
    if (!id) return;
    try {
      const r = await request('/report?match=' + encodeURIComponent(id));
      const model = {
        title: r.title + ' · Individual colonies',
        note: 'Each learner answers independently. Percentages use submitted answers; unanswered questions are shown separately. Colony strength and raids do not change learning marks.',
        metricLabel: 'Question accuracy',
        rows: r.questions.map((q, i) => ({
          label: 'Q' + (i + 1),
          text: q.question,
          value: q.answered ? Math.round((q.correct / q.answered) * 100) : null,
          n: q.answered,
          detail: `${q.correct} correct · ${q.answered - q.correct} incorrect · ${r.learners.length - q.answered} unanswered`,
          needsReview: r.learners
            .filter((p) => p.answers.some((a) => a.round === i && !a.correct))
            .map((p) => p.name),
        })),
        learners: r.learners.map((p) => ({
          name: p.name,
          value: p.answered ? Math.round((p.correct / p.answered) * 100) : null,
          detail: `${p.correct} correct · ${p.answered} answered · ${r.total - p.answered} unanswered${p.removed ? ' · left the game' : ''}`,
        })),
      };
      $('report').hidden = false;
      $('report').innerHTML =
        LearningReport.html(model) +
        `<button id="answersCsv">Download learner answers CSV</button><details><summary>Colony standings · separate from learning marks</summary><div class="table-scroll"><table><thead><tr><th>Learner</th><th>Colony points</th><th>Correct answers</th><th>Unanswered</th></tr></thead><tbody>${[
          ...r.learners,
        ]
          .sort((a, b) => b.strength - a.strength)
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}</td><td>${p.strength}</td><td>${p.correct}</td><td>${r.total - p.answered}</td></tr>`,
          )
          .join('')}</tbody></table></div></details>`;
      $('answersCsv').onclick = () => {
        const cell = (v) =>
          '"' +
          String(v ?? '')
            .replace(/^\s*[=+@-]/, "'$&")
            .replace(/"/g, '""') +
          '"';
        const rows = [
          ['Learner', 'Student ID', 'Question', 'Chosen answer', 'Result'],
          ...r.learners.flatMap((p) =>
            r.questions.map((q, i) => {
              const a = p.answers.find((a) => a.round === i);
              return [
                p.name,
                p.studentId,
                q.question,
                a ? q.options[a.choice] : '',
                a ? (a.correct ? 'Correct' : 'Incorrect') : 'Unanswered',
              ];
            }),
          ),
        ];
        const url = URL.createObjectURL(
          new Blob(['\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], {
            type: 'text/csv;charset=utf-8',
          }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = 'colonyquest-learner-answers.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      $('report').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      error(e.message);
    }
  }
  let hostBusy = false,
    hostPolling = false,
    hostRevision = 0,
    hostSignature = '';
  async function refreshHost() {
    if (hostBusy || hostPolling) return;
    hostPolling = true;
    const revision = hostRevision;
    try {
      const data = await request();
      if (revision === hostRevision && !hostBusy) {
        renderHost(data);
        $('connection').textContent = 'Live classroom';
        error('');
      }
    } catch (e) {
      if (revision === hostRevision && !hostBusy) {
        $('connection').textContent = 'Connection interrupted';
        error(e.status === 401 ? 'Sign in to LessonScope to open your control room.' : e.message);
      }
    } finally {
      hostPolling = false;
    }
  }
  function renderHost(data) {
    $('lessonTitle').textContent = data.title;
    $('hostRoom').hidden = !data.match;
    $('setup').hidden = !!data.match && data.match.phase !== 'ended';
    if (!$('classes').children.length)
      $('classes').innerHTML = data.classes
        .map(
          (c) =>
            `<label><input type="checkbox" value="${esc(c.id)}" ${data.rosterIds.includes(String(c.id)) ? 'checked' : ''}>${esc(c.name)} · ${c.count} learners</label>`,
        )
        .join('');
    const historySig = JSON.stringify(data.history);
    if (historySig !== hostSignature) {
      hostSignature = historySig;
      const selected = $('history').value;
      $('history').innerHTML =
        '<option value="">Choose a session</option>' +
        data.history
          .map(
            (h) =>
              `<option value="${esc(h.id)}">${h.startedAt ? esc(new Date(h.startedAt).toLocaleString()) : 'Lobby'} · ${h.endedAt ? 'Completed' : 'In progress'}</option>`,
          )
          .join('');
      if (data.history.some((h) => h.id === selected)) $('history').value = selected;
    }
    if (!data.match) {
      state = null;
      syncMusic();
      return;
    }
    setState(data.match);
    const s = state;
    $('hostPhase').textContent = {
      lobby: 'Lobby open',
      answer: 'Choose an answer',
      upgrade: 'Colony upgrades',
      reveal: 'Next question shortly',
      paused: 'Paused',
      ended: 'Game complete',
    }[s.phase];
    $('hostCount').textContent =
      `${s.players.length} colonies · ${s.players.filter((p) => p.connected).length} connected · ${s.players.filter((p) => p.answered).length}/${s.players.length} answered`;
    $('start').hidden = s.phase !== 'lobby';
    $('pause').hidden = !['answer', 'upgrade', 'reveal'].includes(s.phase);
    $('resume').hidden = s.phase !== 'paused';
    $('end').hidden = s.phase === 'ended';
    $('hostSeason').textContent = season(s);
    $('hostQuestion').textContent =
      s.phase === 'lobby'
        ? 'Your colonies are gathering.'
        : s.phase === 'ended'
          ? 'The meadow champions have arrived!'
          : s.question?.question || '';
    $('projectedQuestion').textContent = $('hostQuestion').textContent;
    $('projectedCount').textContent = $('hostCount').textContent;
    $('leaderboard').innerHTML =
      s.players
        .map(
          (p, i) =>
            `<article class="colony-card ${p.answered ? 'answered' : ''}"><strong>${i + 1}. ${esc(p.name)}</strong><div class="mini-ants">🐜 ${'🏡'.repeat(Math.min(4, p.rooms))}</div><b>${p.strength}</b> colony points<small>🌾 ${p.food} · 🐜 ${p.workers} · 🛡 ${p.soldiers}</small><small>${p.answered ? '✓ Answer saved' : p.connected ? 'Thinking…' : 'Reconnecting…'}</small></article>`,
        )
        .join('') ||
      '<article class="colony-card"><strong>Waiting for your learners</strong><p>Share the learner link above.</p></article>';
    $('attendance').innerHTML =
      data.attendance.map((p) => `<span>${p.joined ? '✓' : '○'} ${esc(p.name)}</span>`).join('') ||
      '<p>Learners appear here when they join.</p>';
  }
  if (host) {
    $('teacher').hidden = false;
    scene = new ColonyScene($('boardCanvas'), true);
    $('smartboard').href = '/colonyquest/' + encodeURIComponent(gameId);
    $('manage').href = '/game-participants.html?game=' + encodeURIComponent(gameId);
    const practice = document.createElement('a');
    practice.className = 'button';
    practice.href = '/colonyquest-live-play/' + encodeURIComponent(gameId);
    practice.target = '_blank';
    practice.rel = 'noopener';
    practice.textContent = 'Test against computer colonies';
    $('setup').append(practice);
    const join = location.origin + '/play/' + encodeURIComponent(gameId) + '?activity=colonyquest-live';
    $('joinLink').value = join;
    $('copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(join);
        $('copy').textContent = 'Link copied';
        setTimeout(() => ($('copy').textContent = 'Copy learner link'), 1800);
      } catch {
        $('joinLink').select();
        error('Copy the selected learner link.');
      }
    };
    for (const cmd of ['open', 'start', 'pause', 'resume', 'end'])
      $(cmd).onclick = async () => {
        if (hostBusy) return;
        if (cmd === 'end' && !confirm('End this multiplayer game and save the results?')) return;
        hostBusy = true;
        hostRevision++;
        $(cmd).disabled = true;
        try {
          const body =
            cmd === 'open'
              ? { rosterIds: [...$('classes').querySelectorAll('input:checked')].map((i) => i.value) }
              : {};
          renderHost(await request('/' + cmd, body));
          error('');
        } catch (e) {
          error(e.message);
        } finally {
          hostBusy = false;
          $(cmd).disabled = false;
        }
      };
    $('viewReport').onclick = showReport;
    refreshHost();
    setInterval(refreshHost, 2500);
  } else {
    $('learner').hidden = false;
    scene = new ColonyScene($('colonyCanvas'));
    connect();
    setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
        if (Date.now() - lastReceived > 18000) socket.close();
      }
    }, 5000);
    window.addEventListener('online', () => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    });
  }
})();
