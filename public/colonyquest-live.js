(function () {
  'use strict';
  const $ = (id) => document.getElementById(id),
    esc = (value) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c],
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
    actionCue = null,
    watchingId = null;
  const soundtrack = new ColonyMusic((track) => {
    $('musicTrackLabel').textContent = `${track.title} — ${track.artist}`;
  });
  const openingVoice=new OpeningNarration($('openingVoice'),speaking=>{soundtrack.media.muted=speaking;});
  const openingChapters=Array.from({length:4},(_,i)=>OpeningNarrationData.clips['colony-'+i]);
  function openingChapter(elapsed){let start=0;for(let i=0;i<4;i++){const end=start+(openingChapters[i].seconds+1)*1000;if(elapsed<end||i===3)return {index:i,position:Math.max(0,(elapsed-start)/1000)};start=end;}}
  const storyReader=new ColonyStoryText(openingVoice);
  const actionVoice=new ColonyActionVoice(()=>sound&&!openingVoice.active&&!['paused','ended'].includes(state?.phase)&&!state?.me?.teacherPaused,speaking=>{soundtrack.media.muted=speaking;});
  const eventAudio = new ColonyEventAudio();
  eventAudio.voice=actionVoice;
  let duckTimer;
  eventAudio.onCue = (duration) => {
    clearTimeout(duckTimer);
    soundtrack.setVolume(Number($('musicVolume').value) / 600);
    duckTimer = setTimeout(
      () => soundtrack.setVolume(Number($('musicVolume').value) / 200),
      duration,
    );
  };
  function syncMusic() {
    eventAudio.configure(
      sound &&
        !!state &&
        !['paused', 'ended'].includes(state.phase) &&
        !document.hidden &&
        !document.body.classList.contains('offline'),
      Number($('musicVolume').value) / 100,
    );
    soundtrack.setActive(
      sound &&
        !!state &&
        !['paused', 'ended'].includes(state.phase) &&
        !document.body.classList.contains('offline'),
    );
  }
  $('musicVolume').oninput = () => {
    soundtrack.setVolume(Number($('musicVolume').value) / 200);
    syncMusic();
  };
  document.addEventListener('visibilitychange', syncMusic);
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
    if(!sound)actionVoice.stop();
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
    el.textContent = paused ? 'Ⅱ' : ['lobby', 'ended', 'story', 'spectating'].includes(state.phase) || (host && state.pacing === 'individual') ? '🐜' : sec;
    el.classList.toggle('urgent', sec <= 5 && !paused && state.phase === 'answer' && !(host && state.pacing === 'individual'));
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
  function renderActivity(s) {
    const filter = $('activityFilter').value;
    const signature = JSON.stringify([
      s.id,
      filter,
      s.events,
      s.players.map((p) => [p.id, p.name]),
    ]);
    if ($('activityLog').dataset.signature === signature) return;
    $('activityLog').dataset.signature = signature;
    const names = new Map(s.players.map((p) => [p.id, p.name]));
    const events = (s.events || [])
      .filter(
        (e) => filter === 'all' || (filter === 'raid' ? e.kind === 'raid' : e.kind !== 'raid'),
      )
      .slice()
      .reverse();
    const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
    $('activityLog').innerHTML =
      events
        .map((e) => {
          const result =
            e.kind === 'raid'
              ? `<p>${esc(e.attackerName || names.get(e.attacker) || 'Attacker')} → ${esc(e.targetName || names.get(e.target) || 'Defender')} · <strong>${e.success ? 'Raid succeeded' : 'Raid defended'}</strong></p><p>Raider: ${signed(e.attackerFoodChange ?? (e.success ? e.stolen : 0))} food · Defender: ${signed(e.targetFoodChange ?? (e.success ? -e.stolen : 5))} food</p>${e.attackerGuardsChanged != null ? `<small>Guards returned to worker roles: raider ${e.attackerGuardsChanged}, defender ${e.targetGuardsChanged}</small>` : ''}`
              : `<p>${esc(e.text)}</p>${e.results?.length ? `<details><summary>Effects on ${e.results.length} colonies</summary>${e.results.map((r) => `<p><strong>${esc(names.get(r.playerId) || 'Colony')}</strong>: ${esc(r.message)}${r.pointsLost ? ` · ${r.pointsLost} points lost` : ''}</p>`).join('')}</details>` : ''}`;
          return `<article><small>${esc(new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}${Number.isInteger(e.round) ? ` · Question ${e.round + 1}` : ''}</small>${result}</article>`;
        })
        .join('') || '<p>No events in this view yet.</p>';
  }
  $('activityFilter').onchange = () => {
    if (state) renderActivity(state);
  };
  function updateScene(next) {
    const watch = next.phase === 'spectating' && next.watching?.id === watchingId ? next.watching : null;
    const viewedId = watch?.id || next.me?.id;
    if(scene && scene.viewedPlayerId !== viewedId) {scene.update(null);scene.viewedPlayerId = viewedId;}
    if (watch) {
      // Watch colony artwork only: never copy another learner's questions or answers.
      scene?.update({...next, me:{id:watch.id,name:watch.name,colony:watch.colony,lastUpgrade:watch.lastUpgrade},events:watch.events || [],story:next.story ? {...next.story,results:[]} : null});
    } else scene?.update(next);
  }
  function setState(next) {
    const prior = state;
    state = next;
    if(next.phase==='paused'||next.phase==='ended'||(next.phase==='story'&&next.story?.key==='intro'))actionVoice.stop();
    if(prior&&next.me?.lastUpgrade&&JSON.stringify(next.me.lastUpgrade)!==JSON.stringify(prior.me?.lastUpgrade))actionVoice.play(next.me.lastUpgrade.key);
    if(next.phase==='story'&&next.story?.key==='intro'){const chapter=openingChapter(next.story.elapsed);openingVoice.sync(openingChapters[chapter.index].src,next.id+':intro:'+chapter.index,chapter.position);}else openingVoice.stop();
    offset = next.serverNow - Date.now();
    updateScene(next);
    syncMusic();
    clock();
    eventAudio.update(next, prior, host);
    if (next.phase === 'ended') {
      window.ColonyCelebration?.multiplayer(next);
      if (prior?.phase !== 'ended') {
        chime(660);
        setTimeout(() => chime(880), 180);
        setTimeout(() => chime(1100), 360);
      }
    }
    if (host) return;
    if (prior?.phase === 'answer' && ['upgrade','reveal'].includes(next.phase)) chime(next.me?.correct ? 880 : 330);
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
    pending = {
      ...message,
      matchId: state.id,
      round: state.round,
      commandId: crypto.randomUUID(),
    };
    socket.send(JSON.stringify(pending));
    renderKey = '';
    renderLearner();
  }
  function renderLearner() {
    const s = state,
      p = s.me;
    if (!p) return;
    const disconnected = document.body.classList.contains('offline');
    const watching = s.phase === 'spectating' && s.watching?.id === watchingId ? s.watching : null;
    $('myName').textContent = p.name + (watching ? ' · Watching ' + watching.name : '');
    $('chapter').textContent = season(s);
    $('rank').textContent =
      `#${s.players.findIndex((x) => x.id === (watching?.id || p.id)) + 1} of ${s.players.length}`;
    const c = watching?.colony || p.colony;
    const resources = [
      ['🌾', c.food, 'Food'],
      ['🪵', c.sticks || 0, 'Sticks'],
      ['🍃', c.leaves || 0, 'Leaves'],
      ['🐜', c.workers, 'Workers'],
      ['🛡', ColonyQuestCore.homeGuards(c), 'Guards at home'],
      ...(c.raidAway ? [['⚔', c.raidAway, 'Guards returning']] : []),
    ]
      .map(
        ([icon, value, label]) =>
          `<span><i aria-hidden="true">${icon}</i><b>${value}</b> <small>${label.toLowerCase()}</small></span>`,
      )
      .join('');
    if ($('resources').innerHTML !== resources) $('resources').innerHTML = resources;
    const world = s.world || {};
    const goal = !world.dryOccurred
      ? {
          title: 'Store food for drought',
          value: c.food,
          target: 12,
          unit: 'food',
          icon: '🌾',
        }
      : !world.rainOccurred
        ? {
            title: 'Prepare for rain',
            value: c.defense,
            target: 1,
            unit: 'wall upgrades',
            icon: '🌧',
          }
        : !['done'].includes(world.birdStage)
          ? {
              title: 'Protect food from birds',
              value: c.defense,
              target: 2,
              unit: 'wall upgrades',
              icon: '🦅',
            }
          : {
              title: 'Survive the footsteps',
              value: c.defense,
              target: 3,
              unit: 'wall upgrades',
              icon: '🥾',
            };
    const ready = goal.value >= goal.target;
    const wallName = ColonyQuestCore.fortification(c).name;
    const survival = `<div class="nest-level"><img src="/assets/colonyquest/guardian.webp" alt=""><span>${esc(wallName)} nest<small>${ColonyQuestCore.colonyRooms(c).length} ${ColonyQuestCore.colonyRooms(c).length === 1 ? 'room' : 'rooms'} · Level ${c.defense + 1} walls</small></span></div>
      <div class="survival-goal ${ready ? 'ready' : ''}"><b>${world.stompOccurred ? '✦ Adventure complete' : goal.icon + ' ' + goal.title}</b>
      <div class="survival-meter" role="progressbar" aria-label="${esc(goal.title)}" aria-valuenow="${Math.min(goal.value, goal.target)}" aria-valuemin="0" aria-valuemax="${goal.target}"><i style="width:${Math.min(100, (goal.value / goal.target) * 100)}%"></i></div>
      <small>${world.stompOccurred ? 'Your colony braved the meadow' : `${Math.min(goal.value, goal.target)} / ${goal.target} ${goal.unit}${ready ? ' · Ready ✓' : ''}`}</small></div>`;
    if ($('survival').innerHTML !== survival) $('survival').innerHTML = survival;
    const ownStanding = s.players.find((x) => x.id === p.id);
    const leaders = s.players.slice(0, 4);
    if (ownStanding && !leaders.some((x) => x.id === p.id)) leaders[3] = ownStanding;
    const best = Math.max(1, ...s.players.map((x) => x.strength));
    const rivalsHTML = leaders
      .map(
        (x) =>
          `<span class="${x.id === p.id ? 'own-colony' : ''}"><b>${s.players.findIndex((player) => player.id === x.id) + 1}. ${esc(x.id === p.id ? 'Your colony' : x.name)}</b><strong>${x.strength}</strong> pts<i style="width:${Math.max(2, (x.strength / best) * 100)}%"></i></span>`,
      )
      .join('');
    if ($('rivals').innerHTML !== rivalsHTML) $('rivals').innerHTML = rivalsHTML;
    // Only show explanatory banners during the gap between questions.
    $('survival').hidden = s.phase !== 'upgrade';
    $('event').hidden = s.phase !== 'reveal';
    $('rivals').hidden = !['upgrade', 'reveal', 'ended'].includes(s.phase);
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
      s.story?.id,
      s.story?.key === 'intro' ? openingChapter(s.story.elapsed).index : 0,
      p.choice,
      p.correct,
      p.upgraded,
      p.upgrades.map(({food, ...option}) => option),
      pending?.commandId,
      disconnected,
      watchingId,
      s.phase === 'spectating' ? s.spectators?.map(p=>[p.id,p.name,p.round,p.finished]) : null,
    ]);
    document.querySelectorAll('.raid-target').forEach(button => {
      const u = p.upgrades[Number(button.dataset.upgrade)];
      if (u?.key === 'raid') button.querySelector('.raid-stats').textContent = `🌾 ${u.food} food · 🛡 ${u.guards} guards · Wall ${u.wallLevel}`;
    });
    if (key === renderKey) return;
    renderKey = key;
    $('learner').classList.toggle('preview', s.preview);
    $('learner').classList.toggle('story-playing', s.phase === 'story' && s.story?.key !== 'intro');
    $('roundLabel').textContent = s.preview
      ? 'PRACTICE · NO LEARNER MARKS SAVED'
      : `${s.solo ? 'VS COMPUTER · ' : ''}QUESTION ${s.round + 1} OF ${s.total}`;
    $('explanation').textContent = '';
    if(s.phase!=='story'||s.story?.key!=='intro')$('instruction').classList.remove('spoken-story');
    $('choices').className = 'choices';
    $('choices').innerHTML = '';
    $('finished').hidden = true;
    if (s.phase === 'story' && s.story) {
      const beat = s.story;
      $('roundLabel').textContent = 'THE MOONROOT MEADOW ADVENTURE';
      $('question').textContent = beat.title;
      if(beat.key !== 'intro')$('instruction').textContent = '';
      if (beat.key === 'intro') {
        const chapter = openingChapter(beat.elapsed).index;
        $('roundLabel').textContent = `PIP’S FIELD GUIDE · ${chapter + 1} / 4`;
        $('question').textContent = [
          'Build our home',
          'Prepare for danger',
          'Choose a raid wisely',
          'Protect each other',
        ][chapter];
        storyReader.attach($('instruction'),'colony-'+chapter);
        return;
      }
      const result = beat.results.find((r) => r.playerId === p.id);
      $('choices').innerHTML =
        `<details class="scene-details"><summary>What is happening?</summary><p>${esc(beat.line)}</p><div class="story-character"><img src="/assets/colonyquest/${esc(beat.art)}.webp" alt="${esc(beat.speaker)}"><strong>${esc(beat.speaker)}</strong>${beat.speaker === 'Dot' ? '<span class="builder-hat" aria-hidden="true">⛑</span>' : ''}</div>${result?.message ? `<div class="story-outcome">${esc(result.message)}</div>` : ''}</details>`;
      if (beat.key === 'acorn')
        $('explanation').textContent = 'Ancient Acorn champions: ' + beat.winners.join(', ');
      return;
    }
    if (s.phase === 'lobby') {
      $('question').textContent = 'Your colony is ready!';
      $('instruction').textContent =
        'Wait for your teacher. Answer a question, then choose one upgrade. Your workers collect supplies automatically.';
      return;
    }
    if (s.phase === 'paused') {
      $('question').textContent = s.individuallyPaused ? 'Pause and listen' : 'The meadow is resting';
      $('instruction').textContent =
        'Your teacher will resume the game. Your answers and colony are safe.';
      return;
    }
    if (s.phase === 'spectating') {
      $('question').textContent = 'Your questions are complete!';
      $('roundLabel').textContent = 'WATCH THE MEADOW';
      $('instruction').textContent = 'Choose a colony to watch while your classmates finish.';
      $('choices').innerHTML = `<label class="watch-colony">Watch a colony<select id="watchColony"><option value="">My colony</option>${(s.spectators || []).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${p.finished ? 'Finished' : 'Question '+(p.round+1)}</option>`).join('')}</select></label>`;
      if (!(s.spectators || []).some(p=>p.id===watchingId)) watchingId=null;
      $('watchColony').value=watchingId || '';
      $('watchColony').onchange=()=>{
        watchingId=$('watchColony').value || null;
        if(socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'watch',matchId:s.id,target:watchingId}));
        updateScene(state);renderLearner();
      };
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
            (button.onclick = () =>
              submit({
                type: 'answer',
                choice: Number(button.dataset.choice),
              })),
        );
    } else if (s.phase === 'upgrade' && p.correct && !p.upgraded) {
      $('question').textContent = 'Correct! Grow your colony.';
      $('instruction').textContent = pending
        ? 'Saving your upgrade…'
        : 'Choose one upgrade. Raids run automatically.';
      $('explanation').textContent =
        'Correct answer: ' + s.question.options[s.question.correctIndex];
      $('choices').classList.add('upgrades');
      const upgradeCard = (u, i) =>
        `<button data-upgrade="${i}" ${!u.allowed || pending || disconnected ? 'disabled' : ''}><span class="symbol" aria-hidden="true"><img src="/assets/colonyquest/${u.key === 'queen' ? 'queen' : ['defense', 'soldiers', 'raid'].includes(u.key) ? 'guardian' : 'pip-worker'}.webp" alt=""><i>${symbols[u.key]}</i></span>${esc(u.label)}<small>${esc(!u.allowed ? u.reason : u.cost?.sticks ? `${u.cost.sticks} sticks + ${u.cost.leaves} leaves` : u.key === 'workers' ? 'Collects food and materials automatically' : u.key === 'supplies' ? '+3 sticks · +2 leaves' : u.key === 'food' ? '+5 food' : u.key === 'queen' ? 'Hatches after two rounds' : 'Protects your colony')}</small></button>`;
      const raidOptions=p.upgrades.map((u,i)=>({u,i})).filter(({u})=>u.key==='raid');
      const raidButton=({u,i})=>`<button data-upgrade="${i}" class="raid-target" ${!u.allowed || pending || disconnected ? 'disabled' : ''}><strong>⚔ ${esc(u.label)}</strong><span class="raid-stats">🌾 ${u.food} food · 🛡 ${u.guards} guards · Wall ${u.wallLevel}</span><small>${esc(u.reason)}</small></button>`;
      // Keep a few actionable rivals in view; every other colony stays reachable.
      const ordered=[...raidOptions.filter(({u})=>u.allowed),...raidOptions.filter(({u})=>!u.allowed)];
      $('choices').innerHTML =
        p.upgrades.map((u, i) => (u.key === 'raid' ? '' : upgradeCard(u, i))).join('') +
        `<section class="raid-picker"><h3>Or raid a rival</h3><p>Choose a colony. Your guards go on this turn.</p><div class="raid-targets">${ordered.slice(0,4).map(raidButton).join('') || '<p>No rival colonies yet.</p>'}</div>${ordered.length>4?`<details class="more-rivals"><summary>All other colonies (${ordered.length-4})</summary><div class="raid-targets">${ordered.slice(4).map(raidButton).join('')}</div></details>`:''}</section>`;
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
      const ticket = await request('/ticket', {solo: !host && new URLSearchParams(location.search).get('solo') === '1'});
      if (stopped) return;
      socket = new WebSocket(
        (location.protocol === 'https:' ? 'wss://' : 'ws://') +
          location.host +
          '/ws/colonyquest-live',
      );
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: ticket.token }));
      socket.onmessage = (event) => {
        lastReceived = Date.now();
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') {
          const wasOffline = document.body.classList.contains('offline');
          document.body.classList.remove('offline');
          $('connection').textContent = msg.state.preview ? 'Practice vs 10 computer colonies' : msg.state.solo ? 'You vs Computer colony' : 'Connected';
          error('');
          retries = 0;
          setState(msg.state);
          if (wasOffline && pending) socket.send(JSON.stringify(pending));
          if (wasOffline && watchingId && msg.state.phase === 'spectating') socket.send(JSON.stringify({type:'watch',matchId:msg.state.id,target:watchingId}));
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
        setTimeout(
          connect,
          Math.min(8000, 700 * 2 ** Math.min(retries++, 4)) + Math.random() * 400,
        );
      };
      socket.onerror = () => {};
    } catch (e) {
      if (e.status === 401) {
        location.replace('/play/' + encodeURIComponent(gameId) + '?activity='+(new URLSearchParams(location.search).get('solo')==='1'?'colonyquest-solo':'colonyquest-live'));
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
      answer: s.pacing === 'individual' ? 'Colonies playing at their own pace' : 'Choose an answer',
      upgrade: 'Colony upgrades',
      reveal: 'Next question shortly',
      story: s.story?.title || 'Meadow adventure',
      paused: 'Paused',
      ended: 'Game complete',
    }[s.phase];
    $('hostCount').textContent =
      s.pacing === 'individual' ? `${s.players.length} colonies · ${s.players.filter(p=>p.connected).length} connected · ${s.finishedCount || 0}/${s.players.length} finished` : `${s.players.length} colonies · ${s.players.filter((p) => p.connected).length} connected · ${s.players.filter((p) => p.answered).length}/${s.players.length} answered`;
    $('start').hidden = s.phase !== 'lobby';
    $('pause').hidden = !['answer', 'upgrade', 'reveal', 'story'].includes(s.phase);
    $('resume').hidden = s.phase !== 'paused';
    $('end').hidden = s.phase === 'ended';
    $('hostSeason').textContent = season(s);
    $('hostQuestion').textContent =
      s.phase === 'lobby'
        ? 'Your colonies are gathering.'
        : s.phase === 'ended'
          ? 'The meadow champions have arrived!'
          : s.phase === 'story'
            ? s.story?.line || ''
            : s.pacing === 'individual' ? 'Answer → choose an upgrade → watch your colony grow' : s.question?.question || '';
    $('projectedQuestion').textContent = $('hostQuestion').textContent;
    $('projectedCount').textContent = $('hostCount').textContent;
    if(s.phase==='story'&&s.story?.key==='intro')storyReader.attach($('hostQuestion'),'colony-'+openingChapter(s.story.elapsed).index);else $('hostQuestion').classList.remove('spoken-story');
    $('leaderboard').innerHTML =
      s.players
        .map(
          (p, i) =>
            `<article class="colony-card ${p.answered ? 'answered' : ''}"><strong>${i + 1}. ${esc(p.name)}</strong><div class="mini-ants">🐜 ${'🏡'.repeat(Math.min(4, p.rooms))}</div><b>${p.strength}</b> colony points<small>🌾 ${p.food} · 🐜 ${p.workers} · 🛡 ${p.soldiers}</small><small>${p.teacherPaused ? 'Paused by teacher' : s.phase === 'story' ? 'Meadow adventure' : !p.connected ? 'Reconnecting…' : s.pacing === 'individual' ? p.finished ? '✓ Finished · watching' : `Question ${p.questionNumber}/${s.total} · ${p.stage === 'upgrade' ? 'Choosing upgrade' : p.stage === 'reveal' ? 'Colony in action' : 'Answering'}` : p.answered ? '✓ Answer saved' : 'Thinking…'}</small>${s.pacing === 'individual' && ['answer','paused'].includes(s.phase) && !p.npc && !p.finished ? `<button type="button" data-player-pause="${esc(p.id)}" data-paused="${!p.teacherPaused}">${p.teacherPaused ? 'Resume learner' : 'Pause learner'}</button>` : ''}</article>`,
        )
        .join('') ||
      '<article class="colony-card"><strong>Waiting for your learners</strong><p>Share the learner link above.</p></article>';
    renderActivity(s);
    $('attendance').innerHTML =
      data.attendance.map((p) => `<span>${p.joined ? '✓' : '○'} ${esc(p.name)}</span>`).join('') ||
      '<p>Learners appear here when they join.</p>';
  }
  if (host) {
    $('leaderboard').addEventListener('click', async event => {
      const button = event.target.closest('[data-player-pause]');
      if (!button || hostBusy) return;
      hostBusy = true; hostRevision++; button.disabled = true;
      try { renderHost(await request('/player-pause', {playerId:button.dataset.playerPause, paused:button.dataset.paused === 'true', matchId:state.id})); }
      catch (err) { error(err.message); }
      finally { hostBusy = false; button.disabled = false; }
    });
    $('teacher').hidden = false;
    scene = new ColonyScene($('boardCanvas'), true);
    $('smartboard').href = '/colonyquest/' + encodeURIComponent(gameId);
    $('manage').href = '/game-participants.html?game=' + encodeURIComponent(gameId);
    const practice = document.createElement('a');
    practice.className = 'button';
    practice.href = '/colonyquest-live-play/' + encodeURIComponent(gameId);
    practice.target = '_blank';
    practice.rel = 'noopener';
    practice.textContent = 'Test against 10 computer colonies';
    $('setup').append(practice);
    const join =
      location.origin + '/play/' + encodeURIComponent(gameId) + '?activity=colonyquest-live';
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
              ? {
                  rosterIds: [...$('classes').querySelectorAll('input:checked')].map(
                    (i) => i.value,
                  ),
                }
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
