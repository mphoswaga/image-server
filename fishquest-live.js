const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const { FishMatch } = require('./fishquest');
const { send, decode } = require('./fishquest-transport');

// Match simulation is intentionally process-local for the first release. Run
// one LessonScope web process; horizontal scaling requires a shared realtime
// coordinator (for example Redis) so every socket sees the same authority.
const DIR = path.join(DATA_DIR, 'fishquest');
const fileFor = matchKey => path.join(DIR, `${String(matchKey).replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
const soloKey = (gameId, studentId) => `${gameId}.solo.${crypto.createHash('sha256').update(String(studentId)).digest('hex').slice(0, 16)}`;

function createFishQuestLive({ app, games, roster, requireAuth, requireGameAccess, jwtSecret }) {
  fs.mkdirSync(DIR, { recursive: true });
  const matches = new Map();
  const clients = new Map();
  let wss = null;

  function isFish(game) { return !!(game && Array.isArray(game.questions) && game.questions.length); }
  function readyGame(game) { return game ? { ...game, fishquest: { durationMinutes: 10, lateJoin: true, playMode: 'live', ...(game.fishquest || {}) } } : null; }
  function saveState(matchKey, state) { writeJsonAtomic(fileFor(matchKey), state); }
  function loadState(matchKey) { try { return JSON.parse(fs.readFileSync(fileFor(matchKey), 'utf8')); } catch { return null; } }
  function getMatch(matchKey, gameId = matchKey) {
    if (matches.has(matchKey)) return matches.get(matchKey);
    const game = readyGame(games.getGame(gameId));
    if (!isFish(game)) return null;
    const stored = loadState(matchKey);
    if (!stored) return null;
    const match = new FishMatch(game, { persist: state => saveState(matchKey, state) });
    match.state = stored;
    match.lastTick = Date.now();
    if (['running', 'paused'].includes(match.state.phase)) { match.end('server_restart'); finalize(game, match); }
    matches.set(matchKey, match);
    return match;
  }
  function openMatch(game, { preview = false, replacePreview = false, matchKey = game.id, solo = false } = {}) {
    const current = getMatch(matchKey, game.id);
    if (current && current.state.phase !== 'ended' && !(replacePreview && current.state.preview)) return current;
    if (current && current.state.preview && current.state.phase !== 'ended') current.end('preview_replaced');
    const match = new FishMatch(game, { persist: state => saveState(matchKey, state) });
    match.state.preview = preview;
    match.state.solo = solo;
    match.save();
    matches.set(matchKey, match);
    return match;
  }
  function owner(req, res) {
    const game = readyGame(games.getGame(req.params.id));
    if (!game) { res.status(404).json({ error: 'Game not found.' }); return null; }
    if (game.teacherId !== req.userId) { res.status(403).json({ error: 'Not your game.' }); return null; }
    if (!isFish(game)) { res.status(409).json({ error: 'This is not a FishQuest game.' }); return null; }
    return game;
  }
  function rosterAttendance(game, match) {
    const joined = new Set((match ? match.state.players : []).map(p => games.normalizeStudentId(p.studentId)));
    const r = game.rosterId ? roster.getRoster(game.teacherId, game.rosterId) : null;
    return r ? r.students.map(s => ({ studentId: s.id, name: s.name, joined: joined.has(games.normalizeStudentId(s.id)) })) : [];
  }
  function teacherPayload(game, match) {
    return {
      game: { id: game.id, lessonTitle: game.lessonTitle, roomCode: game.roomCode, questions: game.questions, fishquest: game.fishquest },
      match: match ? match.snapshot(null, true) : null,
      attendance: rosterAttendance(game, match),
    };
  }
  function finalize(game, match) {
    if (!match || match.state.resultsSavedAt) return;
    for (const p of match.state.players) {
      const first = new Map();
      for (const a of p.attempts) if (['correct', 'incorrect', 'timeout'].includes(a.outcome) && !first.has(a.questionIndex)) first.set(a.questionIndex, a);
      if (!first.size || String(p.studentId).startsWith('__TEACHER_') || p.npc) continue;
      const answers = game.questions.map((_, i) => first.has(i) ? first.get(i).choice : -1);
      const score = [...first.values()].filter(a => a.correct).length;
      games.recordResult(game.id, {
        studentId: p.studentId, name: p.name, score, total: game.questions.length, answers,
        arcadeScore: p.score, gameType: 'fishquest', resultId: `${match.state.id}:${p.studentId}`,
        fishquest: { matchId: match.state.id, mass: Math.round(p.mass), collections: p.collections, swallows: p.swallows, attempts: p.attempts },
      });
    }
    match.state.resultsSavedAt = new Date().toISOString();
    try { match.save(); }
    catch (err) { delete match.state.resultsSavedAt; throw err; }
  }
  function broadcast(matchKey) {
    const match = matches.get(matchKey) || getMatch(matchKey);
    if (!match) return;
    const group = clients.get(matchKey);
    if (!group || !group.size) return;
    const shared = match.snapshot(null);
    for (const ws of group) if (ws.readyState === ws.OPEN && ws.playerId && !ws.replaced) {
      try { send(ws, { type: 'state', state: match.snapshot(ws.playerId, false, shared) }); }
      catch { ws.terminate(); }
    }
  }

  app.get('/vendor/phaser.min.js', (req, res) => res.sendFile(require.resolve('phaser/dist/phaser.min.js')));
  app.get('/api/game/:id/fishquest', requireAuth, (req, res) => {
    const game = owner(req, res); if (!game) return;
    res.json(teacherPayload(game, getMatch(game.id)));
  });
  app.patch('/api/game/:id/fishquest', requireAuth, (req, res) => {
    let game = owner(req, res); if (!game) return;
    const match = getMatch(game.id);
    if (match && match.state.phase !== 'ended') return res.status(409).json({ error: 'End the current room before changing its questions.' });
    try { game = games.updateFishQuest(game.id, req.body || {}); res.json(teacherPayload(game, null)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/api/game/:id/fishquest/open', requireAuth, (req, res) => {
    const game = owner(req, res); if (!game) return;
    res.json(teacherPayload(game, openMatch(game, { replacePreview: true })));
  });
  app.post('/api/game/:id/fishquest/start', requireAuth, (req, res) => {
    const game = owner(req, res); if (!game) return;
    const match = getMatch(game.id);
    if (!match) return res.status(409).json({ error: 'Open the lobby first.' });
    try { match.start(); broadcast(game.id); res.json(teacherPayload(game, match)); }
    catch (err) { res.status(409).json({ error: err.message }); }
  });
  app.post('/api/game/:id/fishquest/end', requireAuth, (req, res) => {
    const game = owner(req, res); if (!game) return;
    const match = getMatch(game.id);
    if (!match) return res.status(409).json({ error: 'No room is open.' });
    match.end('teacher'); finalize(game, match); broadcast(game.id);
    res.json(teacherPayload(game, match));
  });
  app.post('/api/game/:id/fishquest/pause', requireAuth, (req, res) => {
    const game = owner(req, res); if (!game) return;
    const match = getMatch(game.id);
    if (!match) return res.status(409).json({ error: 'No room is open.' });
    try { match.pause(); broadcast(game.id); res.json(teacherPayload(game, match)); }
    catch (err) { res.status(409).json({ error: err.message }); }
  });
  app.post('/api/game/:id/fishquest/resume', requireAuth, (req, res) => {
    const game = owner(req, res); if (!game) return;
    const match = getMatch(game.id);
    if (!match) return res.status(409).json({ error: 'No room is open.' });
    try { match.resume(); broadcast(game.id); res.json(teacherPayload(game, match)); }
    catch (err) { res.status(409).json({ error: err.message }); }
  });
  app.post('/api/game/:id/fishquest/ticket', requireGameAccess, (req, res) => {
    const game = readyGame(games.getGame(req.params.id));
    if (!isFish(game)) return res.status(404).json({ error: 'FishQuest game not found.' });
    const teacherPreview = req.userId && req.userId === game.teacherId;
    const identity = req.gameSession && req.gameSession.gameId === game.id
      ? { studentId: req.gameSession.studentId, name: req.gameSession.name }
      : teacherPreview
        ? { studentId: `__TEACHER_TEST__:${req.userId}`, name: `${(req.user && (req.user.name || req.user.email)) || 'Teacher'} (test)` }
        : null;
    if (!identity) return res.status(403).json({ error: 'Join this lesson game again before opening FishQuest.' });
    let matchKey = game.id, match;
    const solo = game.fishquest.playMode === 'homework';
    if (solo) {
      matchKey = soloKey(game.id, identity.studentId);
      match = getMatch(matchKey, game.id);
      if (!match || match.state.phase === 'ended') match = openMatch(game, { matchKey, solo: true });
    } else match = getMatch(game.id);
    if (teacherPreview && (!match || match.state.phase === 'ended')) match = openMatch(game, { preview: true });
    if (!match || (!teacherPreview && match.state.preview)) return res.status(409).json({ error: 'The teacher has not opened the FishQuest room yet.' });
    const preview = teacherPreview && !!match.state.preview;
    if (preview) matchKey = game.id;
    const token = jwt.sign({ type: 'fishquest', gameId: game.id, matchKey, ...identity, preview, solo }, jwtSecret, { expiresIn: '2h' });
    res.json({ token });
  });

  function attach(server) {
    wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws/fishquest') { socket.destroy(); return; }
      try {
        const origin = req.headers.origin && new URL(req.headers.origin);
        if (origin && origin.host !== req.headers.host) { socket.destroy(); return; }
      } catch { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
    });
    wss.on('connection', ws => {
      ws.isAlive = true;
      ws.on('error', () => ws.terminate());
      ws.on('pong', () => { ws.isAlive = true; });
      const authTimer = setTimeout(() => ws.close(4001, 'Authentication required'), 5000);
      ws.on('message', raw => {
        const message = decode(ws, raw);
        if (!message || ws.replaced) return;
        if (!ws.playerId) {
          if (message.type !== 'auth') return;
          try {
            const claim = jwt.verify(message.token, jwtSecret);
            if (claim.type !== 'fishquest') throw Error('Bad ticket');
            const game = games.getGame(claim.gameId), matchKey = claim.matchKey || claim.gameId, match = getMatch(matchKey, claim.gameId);
            if (!isFish(game) || !match) throw Error('Room closed');
            const p = match.join({ studentId: claim.studentId, name: claim.name });
            if ((claim.preview || claim.solo) && match.state.phase === 'lobby') {
              match.addNpcs();match.start(1);
              p.protectedUntil = 0;
              match.save();
            }
            clearTimeout(authTimer); ws.gameId = game.id; ws.matchKey = matchKey; ws.playerId = p.id;
            if (!clients.has(matchKey)) clients.set(matchKey, new Set());
            clients.get(matchKey).add(ws);
            for (const old of clients.get(matchKey)) if (old !== ws && old.playerId === p.id) { old.replaced = true; old.close(4002, 'Opened on another device'); }
            send(ws, { type: 'state', state: match.snapshot(p.id) });
          } catch { ws.close(4003, 'Join the room again'); }
          return;
        }
        try {
          const match = getMatch(ws.matchKey, ws.gameId); if (!match) return;
          if (message.type === 'input') match.input(ws.playerId, message);
          if (message.type === 'answer') {
            match.answer(ws.playerId, message);
            send(ws, { type: 'answer_ack', interactionId: message.interactionId, accepted: true });
          }
        } catch (err) {
          if (message.type === 'answer') send(ws, { type: 'answer_ack', interactionId: message.interactionId, accepted: false, error: 'Please try your answer again.' });
          else send(ws, { type: 'error', error: 'Please reconnect to the ocean.' });
        } finally {
          if (message.type === 'answer') { try { broadcast(ws.matchKey); } catch (err) { console.error('FishQuest broadcast failed:', err.message); } }
        }
      });
      ws.on('close', () => {
        clearTimeout(authTimer);
        if (!ws.gameId) return;
        const group = clients.get(ws.matchKey); if (group) group.delete(ws);
        try {
          const match = getMatch(ws.matchKey, ws.gameId);
          if (match && ![...(group || [])].some(other => other.playerId === ws.playerId && !other.replaced)) match.disconnect(ws.playerId);
        } catch (err) { console.error('FishQuest disconnect save failed:', err.message); }
        if (group && !group.size) clients.delete(ws.matchKey);
      });
    });
    const heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false; try { ws.ping(); } catch { ws.terminate(); }
      }
    }, 15000);
    heartbeat.unref();
    wss.on('close', () => clearInterval(heartbeat));
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      for (const [matchKey, match] of matches) {
        const before = match.state.phase;
        try { match.tick(); }
        catch (err) { match.state.phase = 'ended'; match.state.reason = 'storage_error'; match.state.endedAt = Date.now(); console.error('FishQuest match stopped safely:', err.message); }
        if (match.state.phase === 'ended' && !match.state.resultsSavedAt && Date.now() >= (match.retryResultsAt || 0)) {
          match.retryResultsAt = Date.now() + 5000;
          try { finalize(readyGame(games.getGame(match.state.gameId)), match); } catch (err) { console.error('FishQuest results will retry on next read:', err.message); }
        }
        try {
          if ((match.state.phase === 'running' ? frame % 2 === 0 : frame % 20 === 0) || before !== match.state.phase) broadcast(matchKey);
        } catch (err) { console.error('FishQuest broadcast failed:', err.message); }
        if (match.state.phase === 'ended' && match.state.resultsSavedAt && !clients.has(matchKey)) matches.delete(matchKey);
      }
    }, 50);
    timer.unref();
    wss.on('close', () => clearInterval(timer));
    return wss;
  }
  return { attach, getMatch, openMatch, finalize };
}

module.exports = { createFishQuestLive };
