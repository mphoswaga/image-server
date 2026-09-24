// Discrete, durable classroom rounds. No learner answer key leaves this module
// until reveal; published sessions own a snapshot of the reviewed game.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const uid = () => crypto.randomUUID();
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const text = (value, max = 300) => String(value || '').trim().slice(0, max);
const array = (value, max) => Array.isArray(value) && value.length <= max ? value : fail('Too many items or invalid list.');

function validateGame(input) {
  const diagrams = array(input.diagrams, 10).map(d => {
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
    if (!regions.length || new Set(regions.map(r => r.id)).size !== regions.length || regions.some(r => !r.id)) fail('Each diagram needs uniquely named regions.');
    return { id: text(d.id, 80), title: text(d.title, 120), asset: d.asset, regions };
  });
  if (!diagrams.length || diagrams.some(d => !d.id) || new Set(diagrams.map(d => d.id)).size !== diagrams.length) fail('Add a diagram with a unique ID.');
  const questions = array(input.questions, 50).map(q => {
    const d = diagrams.find(d => d.id === q.diagramId);
    const accepted = [...new Set(array(q.accepted, 30))];
    if (!d || !accepted.length || accepted.some(id => !d.regions.some(r => r.id === id))) fail('Choose the correct region for every question.');
    if (!text(q.prompt) || !text(q.concept) || !text(q.explanation)) fail('Add a question, learning objective and explanation.');
    return { id: text(q.id, 80), diagramId: d.id, prompt: text(q.prompt, 600), concept: text(q.concept), explanation: text(q.explanation, 800), accepted };
  });
  if (!questions.length || questions.some(q => !q.id) || new Set(questions.map(q => q.id)).size !== questions.length) fail('Add uniquely identified questions.');
  if (input.reviewed !== true) fail('Review and confirm the answer keys before saving.');
  const seconds = (n, fallback, max) => Number.isInteger(n) && n >= 5 && n <= max ? n : fallback;
  return { title: text(input.title, 120) || 'Save the Moon Festival', subject: text(input.subject, 100), grade: text(input.grade, 80), diagrams, questions, reviewed: true,
    timing: { choose: seconds(input.timing?.choose, 30, 180), discuss: seconds(input.timing?.discuss, 20, 120), reconsider: seconds(input.timing?.reconsider, 8, 60) } };
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
  function saveGame(teacherId, input) {
    const normalized = validateGame(input);
    const prior = input.id ? read('game', input.id) : null;
    if (prior && prior.teacherId !== teacherId) fail('This game belongs to another teacher.');
    if (prior && input.version !== prior.version) fail('This game changed in another tab. Reopen it before saving.');
    const g = { ...normalized, id: prior?.id || uid(), teacherId, version: (prior?.version || 0) + 1, createdAt: prior?.createdAt || clock(), updatedAt: clock() };
    save('game', g); return g;
  }
  function createSession(teacherId, gameId, roster, test = false) {
    const game = read('game', gameId);
    if (game.teacherId !== teacherId) fail('This game belongs to another teacher.');
    if (!test && (!roster?.id || !roster.students?.length)) fail('Select a class with learners first.');
    const students = test ? Array.from({ length: 6 }, (_, i) => ({ id: 'practice-' + i, name: 'Practice learner ' + (i + 1) })) : roster.students.map(s => ({ id: String(s.id), name: s.name }));
    const s = { id: uid(), teacherId, game, rosterId: test ? null : roster.id, className: test ? 'Practice crew' : roster.name, students,
      test, code: crypto.randomBytes(5).toString('hex').toUpperCase(), boardToken: crypto.randomBytes(24).toString('hex'), phase: 'lobby', paused: false, deadline: null,
      seq: 0, round: -1, rounds: [], nextQuestion: 0, members: {}, queue: [], createdAt: clock(), boot };
    return saveSession(s);
  }
  const current = s => s.rounds[s.round];
  function stats(s, r = current(s)) {
    const out = { correct: 0, wrong: 0, unanswered: 0, initialCorrect: 0, improved: 0, changedToWrong: 0, distribution: {} };
    if (!r) return out;
    for (const id of r.expected) {
      const a = r.answers[id]; const first = a?.first; const final = a?.final ?? first;
      if (first && r.question.accepted.includes(first)) out.initialCorrect++;
      if (!final) { out.unanswered++; continue; }
      out.distribution[final] = (out.distribution[final] || 0) + 1;
      const right = r.question.accepted.includes(final);
      out[right ? 'correct' : 'wrong']++;
      if (first && !r.question.accepted.includes(first) && right) out.improved++;
      if (first && r.question.accepted.includes(first) && !right) out.changedToWrong++;
    }
    return out;
  }
  function advance(s) {
    const next = { choose: 'discuss', discuss: 'reconsider', reconsider: 'reveal' }[s.phase];
    if (!next) fail('This stage needs the teacher to continue.');
    s.phase = next; s.deadline = next === 'reveal' ? null : clock() + s.game.timing[next] * 1000;
    if (next === 'reveal') {
      const r = current(s); r.revealedAt = clock();
      const score = stats(s); const n = score.correct + score.wrong;
      if (!r.question.parentId && n > 0 && score.wrong / n > .7) {
        s.queue.push({ id: uid(), parentId: r.question.id, sourceRound: s.round, status: 'needs-review', eligibleAfter: s.round + 2,
          lowParticipation: n / Math.max(1, r.expected.length) < .8 });
      }
    }
  }
  function tick(s) {
    if (!s.paused && s.deadline && clock() >= s.deadline) { advance(s); saveSession(s); }
    return s;
  }
  function begin(s, question) {
    const expected = Object.entries(s.members).filter(([, m]) => !m.absent).map(([id]) => id);
    if (!expected.length) fail('Wait for learners to join, or run Test game.');
    s.rounds.push({ question: copy(question), expected, answers: {}, events: [], startedAt: clock() });
    s.round++; s.phase = 'read'; s.deadline = null;
  }
  function command(id, teacherId, action, body = {}) {
    const s = tick(session(id));
    if (s.teacherId !== teacherId) fail('This session belongs to another teacher.');
    if (body.seq !== s.seq && !(body.round === s.round && body.phase === s.phase && body.paused === s.paused)) fail('The room has updated. Check the current stage and try again.');
    if (action === 'pause') {
      if (['lobby', 'ended'].includes(s.phase)) fail('There is no running round to pause.');
      if (s.paused) { s.paused = false; s.deadline = s.remaining == null ? null : clock() + s.remaining; s.recovered = false; }
      else { s.remaining = s.deadline ? Math.max(0, s.deadline - clock()) : null; s.deadline = null; s.paused = true; }
    } else if (action === 'absent') {
      if (!['lobby', 'reveal'].includes(s.phase)) fail('Change attendance between rounds.');
      if (s.members[body.studentId]) s.members[body.studentId].absent = !!body.absent;
    } else if (action === 'rotate-board') { s.boardToken = crypto.randomBytes(24).toString('hex');
    } else if (action === 'end') { s.phase = 'ended'; s.deadline = null; s.paused = false;
    } else {
      if (s.paused) fail('Resume the game first.');
      if (action === 'next') {
        if (!['lobby', 'reveal'].includes(s.phase)) fail('Finish this round first.');
        if (s.nextQuestion >= s.game.questions.length) fail('All prepared questions are complete. Choose a queued challenge or finish.');
        begin(s, s.game.questions[s.nextQuestion++]);
      } else if (action === 'open') {
        if (s.phase !== 'read') fail('Answers are already open or this round is over.');
        s.phase = 'choose'; s.deadline = clock() + s.game.timing.choose * 1000;
      } else if (action === 'advance') { advance(s);
      } else if (action === 'extend') {
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
    if (!s.students.some(x => x.id === studentId)) fail('Learner not in this session.');
    if (!s.members[studentId]) { s.members[studentId] = { joinedAt: clock(), absent: false }; saveSession(s); }
    return s;
  }
  function answer(id, studentId, body) {
    const s = tick(session(id)); const r = current(s);
    if (!r || !r.expected.includes(studentId)) fail('Join the next round when your teacher starts it.');
    if (typeof body.eventId !== 'string' || body.eventId.length > 80 || !body.eventId) fail('Missing answer receipt ID.');
    if (r.events.some(e => e.studentId === studentId && e.eventId === body.eventId)) return s;
    if (s.paused || !['choose', 'reconsider'].includes(s.phase) || body.phase !== s.phase || body.round !== s.round) fail('This answer stage has closed. Your previous saved choice is kept.');
    const diagram = s.game.diagrams.find(d => d.id === r.question.diagramId);
    if (!diagram.regions.some(r => r.id === body.regionId)) fail('Choose an area on this diagram.');
    const prev = r.answers[studentId] || {};
    if (r.events.filter(e => e.studentId === studentId).length >= 100) fail('Too many answer changes in this round.');
    r.answers[studentId] = { ...prev, [s.phase === 'choose' ? 'first' : 'final']: body.regionId, confirmed: s.phase === 'reconsider' || prev.confirmed || false };
    r.events.push({ studentId, eventId: body.eventId, phase: s.phase, regionId: body.regionId, at: clock() });
    if (s.phase === 'choose' && r.expected.every(id => r.answers[id]?.first)) advance(s);
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
      serverNow: clock(), deadline: s.deadline, round: s.round, total: s.game.questions.length, remainingQuestions: s.game.questions.length - s.nextQuestion,
      joined: Object.keys(s.members).length, expected: r?.expected.length || 0, answered: r ? Object.values(r.answers).filter(a => a.final || a.first).length : 0,
      question: q ? { id: q.id, prompt: q.prompt, ...(revealed ? { accepted: q.accepted, explanation: q.explanation } : {}) } : null,
      diagram: q ? s.game.diagrams.find(d => d.id === q.diagramId) : null,
      stats: revealed ? stats(s) : null,
      lanterns: s.rounds.filter(r => r.revealedAt).reduce((n, r) => n + stats(s, r).correct, 0) };
    if (role === 'board' && s.phase === 'lobby') view.code = s.code;
    if (role === 'student') { view.mine = r?.answers[studentId] || {}; view.canAnswer = !!r?.expected.includes(studentId); }
    if (role === 'teacher') {
      Object.assign(view, { code: s.code, boardToken: s.boardToken, queue: s.queue.map(item => {
        const original = s.game.questions.find(q => q.id === item.parentId);
        const diagram = s.game.diagrams.find(d => d.id === original.diagramId);
        return { ...item, originalPrompt: original.prompt, acceptedLabels: diagram.regions.filter(r => original.accepted.includes(r.id)).map(r => r.label) };
      }),
        learners: s.students.map(x => ({ ...x, joined: !!s.members[x.id], absent: !!s.members[x.id]?.absent,
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
        const label = id => d.regions.find(x => x.id === id)?.label || '';
        return { initial: label(a.first), revised: label(a.final ?? a.first), initialCorrect: a.first ? r.question.accepted.includes(a.first) : null,
          revisedCorrect: (a.final ?? a.first) ? r.question.accepted.includes(a.final ?? a.first) : null, confirmed: !!a.confirmed, expected: r.expected.includes(st.id) };
      }) })) };
  }
  return { dir, read, list, saveGame, createSession, session, saveSession, stats, command, join, answer, snapshot, review, saveSuggestion, report,
    findCode(code) { if (!/^[A-F0-9]{10}$/.test(code || '')) fail('Enter the ten-character MoonQuest code.'); return list('session').find(s => s.code === code); },
    sessions() { return fs.readdirSync(dir).filter(f => f.startsWith('session-')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } };
}
module.exports = { createStore, validateGame };
