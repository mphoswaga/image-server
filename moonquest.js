// Discrete, durable classroom rounds. No learner answer key leaves this module
// until reveal; published sessions own a snapshot of the reviewed game.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const duels = require('./moonquest-duels');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const uid = () => crypto.randomUUID();
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const text = (value, max = 300) => String(value || '').trim().slice(0, max);
const choices = value => value == null ? [] : Array.isArray(value) ? value : [value];
const isCorrect = (q, value) => q.answerMode === 'all' ? choices(value).length === q.accepted.length && q.accepted.every(id => choices(value).includes(id)) : choices(value).length === 1 && q.accepted.includes(choices(value)[0]);
const array = (value, max) => Array.isArray(value) && value.length <= max ? value : fail('Too many items or invalid list.');

function validateGame(input) {
  const diagrams = array(input.diagrams, 10).map((d, index) => {
    const diagramName = text(d.title, 120) || `Diagram ${index + 1}`;
    if (!/^[a-f0-9-]{36}$/.test(d.asset || '')) fail('Upload a diagram first.');
    const regions = array(d.regions, 30).map(r => {
      const points = array(r.points, 80).map(p => {
        if (!Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) fail('Diagram regions must be inside the image.');
        return p;
      });
      if (points.length < 3 || !text(r.label)) fail('Name every region and draw at least three corners.');
      const area = Math.abs(points.reduce((sum, p, i) => { const n = points[(i + 1) % points.length]; return sum + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
      if (area < 0.0001) fail('A region is too small. Draw a larger area.');
      return { id: text(r.id, 80), label: text(r.label, 100), points };
    });
    if (!regions.length) fail(`“${diagramName}” has no saved answer areas. Enter an area label, then draw a rectangle on that diagram. A label alone does not create an area.`);
    if (new Set(regions.map(r => r.id)).size !== regions.length || regions.some(r => !r.id)) fail(`“${diagramName}” has an invalid answer area. Remove and redraw that area, then check its linked questions.`);
    return { id: text(d.id, 80), title: text(d.title, 120), asset: d.asset, regions };
  });
  if (!diagrams.length || diagrams.some(d => !d.id) || new Set(diagrams.map(d => d.id)).size !== diagrams.length) fail('Add a diagram with a unique ID.');
  const questions = array(input.questions, 50).map(q => {
    const d = diagrams.find(d => d.id === q.diagramId);
    const accepted = [...new Set(array(q.accepted, 30))];
    if (!d || !accepted.length || accepted.some(id => !d.regions.some(r => r.id === id))) fail('Choose the correct region for every question.');
    if (!text(q.prompt) || !text(q.concept) || !text(q.explanation)) fail('Add a question, learning objective and explanation.');
    if (q.answerMode && !['one', 'all'].includes(q.answerMode)) fail('Choose a valid answer mode.');
    return { answerMode: q.answerMode || 'one', id: text(q.id, 80), diagramId: d.id, prompt: text(q.prompt, 600), concept: text(q.concept), explanation: text(q.explanation, 800), accepted };
  });
  if (!questions.length || questions.some(q => !q.id) || new Set(questions.map(q => q.id)).size !== questions.length) fail('Add uniquely identified questions.');
  if (input.reviewed !== true) fail('Review and confirm the answer keys before saving.');
  const seconds = (n, fallback, max) => Number.isInteger(n) && n >= 5 && n <= max ? n : fallback;
  return { title: text(input.title, 120) || 'Save the Moon Festival', subject: text(input.subject, 100), grade: text(input.grade, 80), diagrams, questions, reviewed: true,
    timing: { automatic: input.timing?.automatic !== false, choose: seconds(input.timing?.choose, 12, 180), discuss: seconds(input.timing?.discuss, 20, 120), reconsider: seconds(input.timing?.reconsider, 8, 60) } };
}

function createStore(dir = path.join(DATA_DIR, 'moonquest'), clock = Date.now) {
  fs.mkdirSync(dir, { recursive: true });
  const boot = uid();
  const cache = new Map();
  const file = (kind, id) => {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) fail('Invalid MoonQuest ID.');
    return path.join(dir, `${kind}-${id}.json`);
  };
  const read = (kind, id) => {
    const f = file(kind, id);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fail('MoonQuest record not found.');
  };
  const save = (kind, record) => writeJsonAtomic(file(kind, record.id), record);
  function saveSession(s) {
    s.seq++; s.updatedAt = clock(); s.boot = boot;
    save('session', s); cache.set(s.id, s);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    return s;
  }
  function session(id) {
    let s = cache.get(id);
    if (!s) {
      s = read('session', id);
      if (s.boot !== boot && !['lobby', 'ended'].includes(s.phase)) {
        s.remaining = s.deadline ? Math.max(0, s.deadline - s.updatedAt) : null;
        s.paused = true; s.deadline = null; s.recovered = true;
        saveSession(s);
      } else cache.set(id, s);
    }
    return copy(s);
  }
  function list(kind, teacherId) {
    return fs.readdirSync(dir).filter(f => f.startsWith(kind + '-') && f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(r => teacherId == null || r.teacherId === teacherId);
  }
  function saveDraft(teacherId, input) {
    const id = input.id || uid(), f = file('draft', id);
    const prior = fs.existsSync(f) ? read('draft', id) : null;
    if (prior && prior.teacherId !== teacherId) fail('This draft belongs to another teacher.');
    if (prior && input.version !== prior.version) fail('This draft changed in another tab. Your browser copy is kept; reopen the draft before saving again.');
    const payload = input.payload;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.diagrams) || !Array.isArray(payload.questions) || payload.diagrams.length > 10 || payload.questions.length > 50 || JSON.stringify(payload).length > 500000) fail('The draft is too large or invalid.');
    const record = {id, teacherId, version:(prior?.version || 0)+1, updatedAt:clock(), payload:copy(payload), editor:copy(input.editor || {})};
    if (JSON.stringify(record.editor).length > 50000) fail('The unfinished area is too large.');
    save('draft', record); return record;
  }
  function deleteDraft(teacherId, id) {
    const f=file('draft',id); if (!fs.existsSync(f)) return;
    if(read('draft',id).teacherId !== teacherId) fail('This draft belongs to another teacher.');
    fs.unlinkSync(f);
  }
  function saveGame(teacherId, input) {
    const normalized = validateGame(input);
    const prior = input.id ? read('game', input.id) : null;
    if (prior && prior.teacherId !== teacherId) fail('This game belongs to another teacher.');
    if (prior && input.version !== prior.version) fail('This game changed in another tab. Reopen it before saving.');
    const g = { ...normalized, id: prior?.id || uid(), teacherId, version: (prior?.version || 0) + 1, createdAt: prior?.createdAt || clock(), updatedAt: clock() };
    save('game', g); return g;
  }
  function createSession(teacherId, gameId, roster, test = false, mode = 'cooperative') {
    const game = read('game', gameId);
    if (game.timing.automatic !== false) game.timing = { ...game.timing, automatic: true, flow: 'single', choose: 25, reveal: 8 };
    if(!['cooperative','duels'].includes(mode))fail('Choose a valid game mode.');
    if(mode==='duels')game.timing={...game.timing,automatic:true,flow:'single',choose:25,reveal:8};
    if (game.teacherId !== teacherId) fail('This game belongs to another teacher.');
    if (!test && (!roster?.id || !roster.students?.length)) fail('Select a class with learners first.');
    const students = test ? Array.from({ length: 6 }, (_, i) => ({ id: 'practice-' + i, name: 'Practice learner ' + (i + 1) })) : roster.students.map(s => ({ id: String(s.id), name: s.name }));
    const s = { id: uid(), teacherId, game, rosterId: test ? null : roster.id, className: test ? 'Practice crew' : roster.name, students,
      test, code: crypto.randomBytes(5).toString('hex').toUpperCase(), boardToken: crypto.randomBytes(24).toString('hex'), phase: 'lobby', paused: false, deadline: null,
      duels: mode==='duels'?duels.create(students):null,
      story: {enabled: !!game.timing.automatic, history: [], spent: {}}, seq: 0, round: -1, rounds: [], nextQuestion: 0, members: {}, queue: [], createdAt: clock(), boot };
    return saveSession(s);
  }
  const current = s => s.rounds[s.round];
  function stats(s, r = current(s)) {
    const out = { correct: 0, wrong: 0, unanswered: 0, initialCorrect: 0, improved: 0, changedToWrong: 0, distribution: {} };
    if (!r) return out;
    for (const id of r.expected) {
      const a = r.answers[id]; const first = a?.first; const final = a?.final ?? first;
      if (first && isCorrect(r.question, first)) out.initialCorrect++;
      if (!final) { out.unanswered++; continue; }
      for (const area of choices(final)) out.distribution[area] = (out.distribution[area] || 0) + 1;
      const right = isCorrect(r.question, final);
      out[right ? 'correct' : 'wrong']++;
      if (first && !isCorrect(r.question, first) && right) out.improved++;
      if (first && isCorrect(r.question, first) && !right) out.changedToWrong++;
    }
    return out;
  }
  function advance(s) {
    const next = s.game.timing.flow === 'single' && s.phase === 'choose' ? 'reveal' : { choose: 'discuss', discuss: 'reconsider', reconsider: 'reveal' }[s.phase];
    if (!next) fail('This stage needs the teacher to continue.');
    s.phase = next; s.deadline = next === 'reveal' && !s.game.timing.automatic ? null : clock() + s.game.timing[next] * 1000;
    if (next === 'reveal') {
      const r = current(s); r.revealedAt = clock();
      const score = stats(s); const n = score.correct + score.wrong;
      const single = s.game.timing.flow === 'single';
      const misconception = single ? score.wrong / Math.max(1, s.duels?n:r.expected.length) > .3 : n > 0 && score.wrong / n > .7;
      if (s.game.timing.automatic && (misconception || (!single && n / Math.max(1, r.expected.length) < .8))) {
        s.teachingPause = misconception ? 'misconception' : 'participation';
        s.paused = true; s.remaining = 10000; s.deadline = null;
      }
      if (!r.question.parentId && misconception) {
        s.queue.push({ id: uid(), parentId: r.question.id, sourceRound: s.round, status: 'needs-review', eligibleAfter: s.round + 2,
          lowParticipation: n / Math.max(1, r.expected.length) < .8 });
      }
    }
  }
  const storyChapters = [
    {title:'Light the entrance',options:[{id:'bridge',title:'Build a lantern bridge',icon:'🏮',result:'The rabbit carries your lanterns across the bridge. The entrance glows again.'},{id:'stars',title:'Follow the guiding stars',icon:'⭐',result:'The rabbit follows your star trail and finds the entrance lights.'}]},
    {title:'Bring back the festival',options:[{id:'mooncakes',title:'Find the missing mooncakes',icon:'🥮',result:'The rabbit follows the glowing footprints and brings mooncakes to the courtyard.'},{id:'garden',title:'Wake the lantern garden',icon:'🌸',result:'The rabbit waters the moon garden. A canopy of glowing lantern flowers opens.'}]},
    {title:'Reach the moon lantern',options:[{id:'kite',title:'Fly the star kite',icon:'🪁',result:'Your star kite lifts the rabbit’s light high above Vinschool.'},{id:'drums',title:'Lead the lantern parade',icon:'🏮',result:'The rabbit leads your lantern parade. The whole school shines.'}]}
  ];
  function sparks(s,id){return s.rounds.filter(r=>r.revealedAt&&r.expected.includes(id)&&isCorrect(r.question,r.answers[id]?.final??r.answers[id]?.first)).length;}
  function maybeStory(s){
    const r=current(s);if(!s.story?.enabled||!r?.revealedAt||r.storyHandled)return false;
    r.storyHandled=true;
    const interval=Math.max(2,Math.ceil(s.game.questions.length/4));
    if(s.nextQuestion>=s.game.questions.length||(s.round+1)%interval!==0||s.story.history.length>=3)return false;
    const chapter=storyChapters[s.story.history.length];
    const eligible=Object.keys(s.members).filter(id=>!s.members[id].absent&&!(s.removedStudents||[]).includes(id)&&(s.duels||sparks(s,id)-2*(s.story.spent[id]||0)>=2));
    s.story.current={...copy(chapter),id:uid(),eligible,votes:{}};
    s.phase='story-vote';s.deadline=clock()+8000;s.teachingPause=null;return true;
  }
  function finishStoryVote(s){
    const c=s.story.current,counts=c.options.map(o=>Object.values(c.votes).filter(v=>v===o.id).length);
    const tied=counts[0]===counts[1]&&counts[0]>0;
    c.winner=counts[0]===counts[1]?(tied?crypto.randomInt(2):0):counts[0]>counts[1]?0:1;
    if(s.duels)c.teamResults=[0,1].map(team=>{
      const totals=c.options.map(o=>Object.entries(c.votes).filter(([id,v])=>s.duels.teams[id]===team&&v===o.id).length);
      const tied=totals[0]===totals[1]&&totals[0]>0;
      return {team,winner:totals[0]===totals[1]?(tied?crypto.randomInt(2):0):totals[0]>totals[1]?0:1,tied,noVotes:totals.every(n=>!n)};
    });
    c.tied=tied;c.noVotes=counts.every(n=>!n);s.story.history.push(copy(c));
    s.phase='story-action';s.deadline=clock()+5000;
  }
  function vote(id,studentId,body){
    const s=tick(session(id)),c=s.story?.current;
    if(s.phase!=='story-vote'||s.paused||!c||body.checkpoint!==c.id)fail('This story vote is closed.');
    if(!c.eligible.includes(studentId)||s.members[studentId]?.absent||(s.removedStudents||[]).includes(studentId))fail('Earn two correct answers to vote at a story checkpoint.');
    if(!c.options.some(o=>o.id===body.choice))fail('Choose one of the two story actions.');
    if(c.votes[studentId]){if(c.votes[studentId]===body.choice)return s;fail('Your story vote is already locked.');}
    c.votes[studentId]=body.choice;s.story.spent[studentId]=(s.story.spent[studentId]||0)+1;
    return saveSession(s);
  }
  function tick(s) {
    if (!s.paused && s.deadline && clock() >= s.deadline) {
      if(s.phase==='story-vote')finishStoryVote(s);
      else if(s.phase==='story-action')nextRound(s);
      else if (s.phase === 'intro' || (s.phase === 'reveal' && s.game.timing.automatic)) nextRound(s);
      else advance(s);
      saveSession(s);
    }
    return s;
  }
  function begin(s, question) {
    const expected = Object.entries(s.members).filter(([, m]) => !m.absent).map(([id]) => id);
    if (!expected.length) fail('Wait for learners to join, or run Test game.');
    s.rounds.push({ question: copy(question), expected, answers: {}, events: [], startedAt: clock() });
    s.round++; if(s.duels)current(s).duelGroups=duels.pair(s,expected); s.phase = s.game.timing.automatic ? 'choose' : 'read';
    s.deadline = s.game.timing.automatic ? clock() + s.game.timing.choose * 1000 : null;
    s.teachingPause = null;
  }
  function nextRound(s) {
    if(maybeStory(s))return;
    const follow = s.queue.find(q => q.status === 'approved' && s.round >= q.eligibleAfter);
    if (!Object.values(s.members).some(m => !m.absent)) {
      if (s.phase === 'lobby') fail('Wait for learners to join, or scan the test QR.');
      s.paused = true; s.remaining = 10000; s.deadline = null; s.teachingPause = 'attendance';
    } else if (follow) { begin(s, follow.question); follow.status = 'asked'; }
    else if (s.nextQuestion < s.game.questions.length) begin(s, s.game.questions[s.nextQuestion++]);
    else { s.phase = 'ended'; s.deadline = null; }
  }
  function command(id, teacherId, action, body = {}) {
    const s = tick(session(id));
    if (s.teacherId !== teacherId) fail('This session belongs to another teacher.');
    if (body.seq !== s.seq && !(body.round === s.round && body.phase === s.phase && body.paused === s.paused)) fail('The room has updated. Check the current stage and try again.');
    if(action==='set-team'){
      if(!s.duels||s.phase!=='lobby')fail('Adjust teams before starting the mission.');
      if(!s.students.some(st=>st.id===body.studentId)||![0,1].includes(body.team))fail('Choose a learner and team.');
      s.duels.teams[body.studentId]=body.team;
    } else if (action === 'continue-meeting') {
      if (!s.paused || s.teachingPause !== 'misconception') fail('There is no class meeting to finish.');
      s.paused = false; s.recovered = false; s.teachingPause = null; s.remaining = null; nextRound(s);
    } else if (action === 'pause') {
      if (['lobby', 'ended'].includes(s.phase)) fail('There is no running round to pause.');
      if (s.paused) { s.paused = false; s.deadline = s.remaining == null ? null : clock() + s.remaining; s.recovered = false; s.teachingPause = null; }
      else { s.remaining = s.deadline ? Math.max(0, s.deadline - clock()) : null; s.deadline = null; s.paused = true; }
    } else if (action === 'remove-learner') {
      if (!s.students.some(st => st.id === body.studentId) || typeof body.removed !== 'boolean') fail('Choose a learner in this room.');
      s.removedStudents ||= [];
      s.removedStudents = s.removedStudents.filter(id => id !== body.studentId);
      if (body.removed) {
        s.removedStudents.push(body.studentId);
        if (s.members[body.studentId]) s.members[body.studentId].absent = true;
        const r = current(s);
        // Preserve every saved answer. Only change the current participation
        // denominator before reveal; historical rounds remain untouched.
        if (r && !r.revealedAt) r.expected = r.expected.filter(id => id !== body.studentId);
      } else if (s.members[body.studentId]) s.members[body.studentId].absent = false;
    } else if (action === 'absent') {
      if (!['lobby', 'reveal'].includes(s.phase)) fail('Change attendance between rounds.');
      if ((s.removedStudents || []).includes(body.studentId)) fail('Add this learner back first.');
      if (s.members[body.studentId]) s.members[body.studentId].absent = !!body.absent;
    } else if (action === 'rotate-board') { s.boardToken = crypto.randomBytes(24).toString('hex');
    } else if (action === 'end') { s.phase = 'ended'; s.deadline = null; s.paused = false;
    } else {
      if (s.paused) fail('Resume the game first.');
      if (action === 'launch') {
        if (s.phase !== 'lobby') fail('This mission has already started.');
        if (!Object.keys(s.members).length) fail('Wait for learners to join first.');
        s.phase = 'intro'; s.deadline = clock() + 24000;
      } else if (action === 'skip-intro') {
        if (s.phase !== 'intro') fail('The introduction has already finished.');
        nextRound(s);
      } else if (action === 'next') {
        if (!['lobby', 'reveal'].includes(s.phase)) fail('Finish this round first.');
        if (s.game.timing.automatic) nextRound(s);
        else {
          if (s.nextQuestion >= s.game.questions.length) fail('All prepared questions are complete. Choose a queued challenge or finish.');
          begin(s, s.game.questions[s.nextQuestion++]);
        }
      } else if (action === 'open') {
        if (s.phase !== 'read') fail('Answers are already open or this round is over.');
        s.phase = 'choose'; s.deadline = clock() + s.game.timing.choose * 1000;
      } else if (action === 'advance') { advance(s);
      } else if (action === 'extend') {
        if (s.game.timing.flow === 'single') fail('Learners can request one shared ten-second extension.');
        if (!s.deadline) fail('This stage has no timer.');
        s.deadline += 10000;
      } else if (action === 'challenge') {
        if (s.phase !== 'reveal') fail('Finish this round first.');
        const q = s.queue.find(q => q.id === body.queueId && q.status === 'approved');
        if (!q || s.round < q.eligibleAfter) fail('Let two other questions pass before revisiting this concept.');
        begin(s, q.question); q.status = 'asked';
      } else fail('Unknown classroom action.');
    }
    return saveSession(s);
  }
  function join(id, studentId) {
    const s = tick(session(id));
    if (s.phase === 'ended') fail('This game has finished.');
    if ((s.removedStudents || []).includes(studentId)) fail('Your teacher has removed you from this game.');
    if (!s.students.some(x => x.id === studentId)) fail('Learner not in this session.');
    if (!s.members[studentId]) { s.members[studentId] = { joinedAt: clock(), absent: false }; saveSession(s); }
    return s;
  }
  function joinPractice(id, deviceKey) {
    const s = tick(session(id));
    if (!s.test || s.phase === 'ended') fail('This is not an active teacher test room.');
    if (!/^[a-f0-9-]{36}$/.test(deviceKey || '')) fail('Reopen the test link to join.');
    s.testDevices ||= {};
    let studentId = s.testDevices[deviceKey];
    if (!studentId) {
      const taken = new Set(Object.values(s.testDevices));
      studentId = s.students.find(st => !taken.has(st.id) && !(s.removedStudents || []).includes(st.id))?.id;
      if (!studentId) fail('All six practice learners are in use. Start a new test room for more devices.');
      s.testDevices[deviceKey] = studentId;
      // A physical-device rehearsal should count only those devices, not idle bots.
      if (s.game.timing.automatic && s.phase === 'lobby') {
        const devices = new Set(Object.values(s.testDevices));
        s.members = Object.fromEntries(Object.entries(s.members).filter(([id]) => devices.has(id)));
      }
      s.members[studentId] ||= { joinedAt: clock(), absent: false };
      saveSession(s);
    }
    if ((s.removedStudents || []).includes(studentId)) fail('Your teacher has removed you from this game.');
    return { studentId, name: s.students.find(st => st.id === studentId).name };
  }
  function avatar(id,studentId,body){
    const s=tick(session(id));
    if(!s.duels||s.phase!=='lobby'||!s.members[studentId]||(s.removedStudents||[]).includes(studentId))fail('Choose your rabbit in the lobby.');
    if(!['bow','scarf','star'].includes(body.avatar))fail('Choose one of the rabbit styles.');
    s.duels.avatars[studentId]=body.avatar;return saveSession(s);
  }
  function requestTime(id, studentId, body) {
    const s = tick(session(id)), r = current(s);
    if (!r || body.round !== s.round || s.phase !== 'choose' || s.paused || !s.deadline || s.game.timing.flow !== 'single') fail('The answer timer is not open.');
    if (!r.expected.includes(studentId) || !s.members[studentId] || s.members[studentId].absent || (s.removedStudents || []).includes(studentId)) fail('Only active learners in this round can request time.');
    if (r.extraTimeUsed) return s;
    r.extraTimeUsed = true;
    s.deadline += 10000;
    return saveSession(s);
  }
  function answer(id, studentId, body) {
    const s = tick(session(id)); const r = current(s);
    if ((s.removedStudents || []).includes(studentId)) fail('Your teacher has removed you from this game.');
    if (!r || !r.expected.includes(studentId)) fail('Join the next round when your teacher starts it.');
    if (typeof body.eventId !== 'string' || body.eventId.length > 80 || !body.eventId) fail('Missing answer receipt ID.');
    if (r.events.some(e => e.studentId === studentId && e.eventId === body.eventId)) return s;
    if (s.paused || !['choose', 'reconsider'].includes(s.phase) || body.phase !== s.phase || body.round !== s.round) fail('This answer stage has closed. Your previous saved choice is kept.');
    const diagram = s.game.diagrams.find(d => d.id === r.question.diagramId);
    const submitted = choices(body.regionIds ?? body.regionId);
    const required = r.question.answerMode === 'all' ? r.question.accepted.length : 1;
    if (submitted.length !== required || new Set(submitted).size !== required || submitted.some(id => !diagram.regions.some(r => r.id === id))) fail(`Choose ${required} different area${required === 1 ? '' : 's'} on this diagram.`);
    const selection = r.question.answerMode === 'all' ? submitted : submitted[0];
    const prev = r.answers[studentId] || {};
    if (s.game.timing.flow === 'single' && prev.first && body.changeConfirmed !== true) fail('Your answer is locked. Confirm that you want to change it first.');
    if (s.game.timing.flow !== 'single' && s.game.timing.automatic && s.phase === 'choose' && prev.first) fail('Your first choice is saved. Discuss it before reconsidering.');
    if (r.events.filter(e => e.studentId === studentId).length >= 100) fail('Too many answer changes in this round.');
    r.answers[studentId] = s.game.timing.flow === 'single' ? { first: prev.first ?? selection, final: selection, confirmed: true } : { ...prev, [s.phase === 'choose' ? 'first' : 'final']: selection, confirmed: s.phase === 'reconsider' || prev.confirmed || false };
    r.events.push({ studentId, eventId: body.eventId, phase: s.phase, regionId: selection, at: clock() });
    if (s.game.timing.flow !== 'single' && s.phase === 'choose' && r.expected.every(id => r.answers[id]?.first)) advance(s);
    return saveSession(s);
  }
  function review(id, teacherId, queueId, input) {
    const s = session(id);
    if (s.teacherId !== teacherId) fail('This session belongs to another teacher.');
    const q = s.queue.find(q => q.id === queueId);
    if (!q || q.status === 'asked') fail('This challenge is unavailable.');
    if (input.skip) q.status = 'skipped';
    else {
      const original = s.game.questions.find(x => x.id === q.parentId);
      if (!text(input.prompt) || !text(input.explanation)) fail('Review the challenge and explanation first.');
      q.question = { ...original, id: q.id, parentId: q.parentId, prompt: text(input.prompt, 600), explanation: text(input.explanation, 800) };
      q.status = 'approved';
    }
    return saveSession(s);
  }
  function saveSuggestion(id, teacherId, queueId, suggestion) {
    const s = session(id);
    if (s.teacherId !== teacherId) fail('This session belongs to another teacher.');
    const q = s.queue.find(q => q.id === queueId);
    if (!q || q.status !== 'needs-review') fail('This challenge has already been reviewed.');
    q.suggestion = suggestion; return saveSession(s);
  }
  function snapshot(id, role, studentId) {
    const s = tick(session(id)); const r = current(s); const revealed = s.phase === 'reveal' || s.phase === 'ended';
    const q = r?.question;
    const view = { id: s.id, title: s.game.title, className: s.className, test: s.test, seq: s.seq, phase: s.phase, paused: s.paused, recovered: s.recovered,
      extraTimeUsed: !!r?.extraTimeUsed, automatic: !!s.game.timing.automatic, singleTimer: s.game.timing.flow === 'single', teachingPause: s.teachingPause || null, serverNow: clock(), deadline: s.deadline, round: s.round, total: s.game.questions.length, remainingQuestions: s.game.questions.length - s.nextQuestion,
      joined: Object.keys(s.members).filter(id => !(s.removedStudents || []).includes(id)).length, expected: r?.expected.length || 0, answered: r ? r.expected.filter(id => r.answers[id]?.final || r.answers[id]?.first).length : 0,
      question: q ? { id: q.id, prompt: q.prompt, concept: q.concept, answerMode: q.answerMode || 'one', selectionCount: q.answerMode === 'all' ? q.accepted.length : 1, ...(revealed ? { accepted: q.accepted, explanation: q.explanation } : {}) } : null,
      diagram: q ? s.game.diagrams.find(d => d.id === q.diagramId) : null,
      stats: revealed ? stats(s) : null,
      lanterns: s.rounds.filter(r => r.revealedAt).reduce((n, r) => n + stats(s, r).correct, 0) };
    view.duels=duels.snapshot(s,studentId,role,isCorrect);
    view.revealedAt=r?.revealedAt||null;
    if(s.story?.enabled){
      view.storyProgress=s.story.history.length;
      if(role==='student')view.reward={sparks:sparks(s,studentId),available:Math.max(0,sparks(s,studentId)-2*(s.story.spent[studentId]||0))};
      if(['story-vote','story-action'].includes(s.phase)){
        const c=s.story.current;view.story={id:c.id,title:c.title,options:c.options,winner:c.winner,tied:c.tied,noVotes:c.noVotes,eligibleCount:c.eligible.length,voted:Object.keys(c.votes).length,...(c.teamResults?{teamResults:c.teamResults}:{})};
        if(role==='student'){view.story.canVote=c.eligible.includes(studentId)&&!c.votes[studentId]&&!s.members[studentId]?.absent;view.story.myVote=c.votes[studentId]||null;}
      }
    }
    if (role === 'board' && s.phase === 'lobby') view.code = s.code;
    if (s.phase === 'intro') view.introElapsedMs = Math.max(0, 24000 - (s.paused ? s.remaining : s.deadline - clock()));
    if (role !== 'student') view.crew = s.students.filter(st => !(s.removedStudents || []).includes(st.id) && (r ? r.expected.includes(st.id) : !!s.members[st.id])).map(st => ({ name: st.name, answered: !!(r?.answers[st.id]?.first || r?.answers[st.id]?.final), confirmed: !!r?.answers[st.id]?.confirmed }));
    if (role === 'student') { view.mine = r?.answers[studentId] || {}; view.heroName = s.students.find(st => st.id === studentId)?.name || ''; if (revealed) view.myCorrect = choices(view.mine.final ?? view.mine.first).length ? isCorrect(q, view.mine.final ?? view.mine.first) : null; view.canAnswer = !!r?.expected.includes(studentId); }
    if (role === 'teacher') {
      const lastRevealed=s.rounds.findLast(r=>r.revealedAt);
      view.unansweredRound=lastRevealed?s.rounds.indexOf(lastRevealed):-1;
      view.unansweredLearners = lastRevealed ? s.students.filter(st=>lastRevealed.expected.includes(st.id)&&!lastRevealed.answers[st.id]?.first&&!lastRevealed.answers[st.id]?.final).map(st=>({id:st.id,name:st.name})) : [];
      Object.assign(view, { liveStats: stats(s), code: s.code, boardToken: s.boardToken, queue: s.queue.map(item => {
        const original = s.game.questions.find(q => q.id === item.parentId);
        const diagram = s.game.diagrams.find(d => d.id === original.diagramId);
        return { ...item, originalPrompt: original.prompt, acceptedLabels: diagram.regions.filter(r => original.accepted.includes(r.id)).map(r => r.label) };
      }),
        learners: s.students.map(x => ({ ...x, removed: (s.removedStudents || []).includes(x.id), joined: !!s.members[x.id], absent: !!s.members[x.id]?.absent,
          answered: !!r?.answers[x.id]?.first, confirmed: !!r?.answers[x.id]?.confirmed })) });
    }
    return view;
  }
  function report(id, teacherId) {
    const s = session(id);
    if (s.teacherId !== teacherId) fail('This session belongs to another teacher.');
    return { id: s.id, title: s.game.title, className: s.className, test: s.test, formative: true,
      rounds: s.rounds.map((r, i) => ({ number: i + 1, prompt: r.question.prompt, concept: r.question.concept, followUp: !!r.question.parentId, completed: !!r.revealedAt, stats: stats(s, r) })),
      students: s.students.map(st => ({ ...st, rounds: s.rounds.map(r => {
        const a = r.answers[st.id] || {}; const d = s.game.diagrams.find(d => d.id === r.question.diagramId);
        const label = value => choices(value).map(id => d.regions.find(x => x.id === id)?.label || '').join(' + ');
        return { initial: label(a.first), revised: label(a.final ?? a.first), initialCorrect: a.first ? isCorrect(r.question, a.first) : null,
          revisedCorrect: (a.final ?? a.first) ? isCorrect(r.question, a.final ?? a.first) : null, confirmed: !!a.confirmed, expected: r.expected.includes(st.id) };
      }) })) };
  }
  return { dir, read, list, saveDraft, deleteDraft, saveGame, createSession, session, saveSession, stats, command, join, joinPractice, answer, requestTime, avatar, vote, snapshot, review, saveSuggestion, report,
    findCode(code) { if (!/^[A-F0-9]{10}$/.test(code || '')) fail('Enter the ten-character MoonQuest code.'); return list('session').find(s => s.code === code); },
    sessions() { return fs.readdirSync(dir).filter(f => f.startsWith('session-')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } };
}
module.exports = { createStore, validateGame };
