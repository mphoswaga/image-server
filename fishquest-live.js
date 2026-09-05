const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const { FishMatch } = require('./fishquest');

// Match simulation is intentionally process-local for the first release. Run
// one LessonScope web process; horizontal scaling requires a shared realtime
// coordinator (for example Redis) so every socket sees the same authority.
const DIR = path.join(DATA_DIR, 'fishquest');
const fileFor = gameId => path.join(DIR, `${gameId}.json`);

function createFishQuestLive({ app, games, roster, requireAuth, requireGameAccess, jwtSecret }) {
  fs.mkdirSync(DIR, { recursive: true });
  const matches = new Map();
  const clients = new Map();
  let wss = null;

  function isFish(game) { return !!(game && Array.isArray(game.questions) && game.questions.length); }
  function readyGame(game) { return game ? { ...game, fishquest: game.fishquest || { durationMinutes: 10, lateJoin: true } } : null; }
  function saveState(gameId, state) { writeJsonAtomic(fileFor(gameId), state); }
  function loadState(gameId) { try { return JSON.parse(fs.readFileSync(fileFor(gameId), 'utf8')); } catch { return null; } }
  function getMatch(gameId) {
    if (matches.has(gameId)) return matches.get(gameId);
    const game = readyGame(games.getGame(gameId));
    if (!isFish(game)) return null;
    const stored = loadState(gameId);
    if (!stored) return null;
    const match = new FishMatch(game, { persist: state => saveState(gameId, state) });
    match.state = stored;
    match.lastTick = Date.now();
    if (match.state.phase === 'running') { match.end('server_restart'); finalize(game, match); }
    matches.set(gameId, match);
    return match;
  }
  function openMatch(game, { preview = false, replacePreview = false } = {}) {
    const current = getMatch(game.id);
    if (current && current.state.phase !== 'ended' && !(replacePreview && current.state.preview)) return current;
    if (current && current.state.preview && current.state.phase !== 'ended') current.end('preview_replaced');
    const match = new FishMatch(game, { persist: state => saveState(game.id, state) });
    match.state.preview = preview;
    match.save();
    matches.set(game.id, match);
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
      if (!first.size || String(p.studentId).startsWith('__TEACHER_')) continue;
      const answers = game.questions.map((_, i) => first.has(i) ? first.get(i).choice : -1);
      const score = [...first.values()].filter(a => a.correct).length;
      games.recordResult(game.id, {
        studentId: p.studentId, name: p.name, score, total: game.questions.length, answers,
        arcadeScore: p.score, gameType: 'fishquest', resultId: `${match.state.id}:${p.studentId}`,
        fishquest: { matchId: match.state.id, mass: Math.round(p.mass), collections: p.collections, swallows: p.swallows, attempts: p.attempts },
      });
    }
    match.state.resultsSavedAt = new Date().toISOString();
    match.save();
  }
  function broadcast(gameId) {
    const match = getMatch(gameId);
    if (!match) return;
    const group = clients.get(gameId);
    if (!group) return;
    for (const ws of group) if (ws.readyState === ws.OPEN && ws.playerId) ws.send(JSON.stringify({ type: 'state', state: match.snapshot(ws.playerId) }));
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
    let match = getMatch(game.id);
    if (teacherPreview && (!match || match.state.phase === 'ended')) match = openMatch(game, { preview: true });
    if (!match || (!teacherPreview && match.state.preview)) return res.status(409).json({ error: 'The teacher has not opened the FishQuest room yet.' });
    const preview = teacherPreview && !!match.state.preview;
    const token = jwt.sign({ type: 'fishquest', gameId: game.id, ...identity, preview }, jwtSecret, { expiresIn: '2h' });
    res.json({ token });
  });

  function attach(server) {
    wss = new WebSocketServer({ noServer: true });
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
      const authTimer = setTimeout(() => ws.close(4001, 'Authentication required'), 5000);
      ws.on('message', raw => {
        let message; try { message = JSON.parse(String(raw)); } catch { return; }
        if (!ws.playerId) {
          if (message.type !== 'auth') return;
          try {
            const claim = jwt.verify(message.token, jwtSecret);
            if (claim.type !== 'fishquest') throw Error('Bad ticket');
            const game = games.getGame(claim.gameId), match = getMatch(claim.gameId);
            if (!isFish(game) || !match) throw Error('Room closed');
            const p = match.join({ studentId: claim.studentId, name: claim.name });
            if (claim.preview && match.state.preview && match.state.phase === 'lobby') {
              const bot = match.join({ studentId: '__TEACHER_PREVIEW_BOT__', name: 'Practice fish' });
              p.mass = 100;
              bot.mass = 100;
              bot.x = Math.max(80, Math.min(2320, p.x + (p.x > 1200 ? -130 : 130))); bot.y = p.y;
              match.start();
              p.protectedUntil = 0; bot.protectedUntil = 0;
              match.save();
            }
            clearTimeout(authTimer); ws.gameId = game.id; ws.playerId = p.id;
            if (!clients.has(game.id)) clients.set(game.id, new Set());
            for (const old of clients.get(game.id)) if (old !== ws && old.playerId === p.id) old.close(4002, 'Opened on another device');
            clients.get(game.id).add(ws);
            ws.send(JSON.stringify({ type: 'state', state: match.snapshot(p.id) }));
          } catch { ws.close(4003, 'Join the room again'); }
          return;
        }
        const match = getMatch(ws.gameId); if (!match) return;
        try {
          if (message.type === 'input') match.input(ws.playerId, message);
          if (message.type === 'answer') match.answer(ws.playerId, message);
        } catch (err) { ws.send(JSON.stringify({ type: 'error', error: err.message })); }
      });
      ws.on('close', () => {
        clearTimeout(authTimer);
        if (!ws.gameId) return;
        const group = clients.get(ws.gameId); if (group) group.delete(ws);
        const match = getMatch(ws.gameId);
        if (match && ![...(group || [])].some(other => other.playerId === ws.playerId)) match.disconnect(ws.playerId);
      });
    });
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      for (const [gameId, match] of matches) {
        const before = match.state.phase;
        try { match.tick(); }
        catch (err) { match.state.phase = 'ended'; match.state.reason = 'storage_error'; match.state.endedAt = Date.now(); console.error('FishQuest match stopped safely:', err.message); }
        if (before !== 'ended' && match.state.phase === 'ended') {
          try { finalize(readyGame(games.getGame(gameId)), match); } catch (err) { console.error('FishQuest results will retry on next read:', err.message); }
        }
        if (frame % 2 === 0 || before !== match.state.phase) broadcast(gameId);
      }
    }, 50);
    timer.unref();
    return wss;
  }
  return { attach, getMatch, openMatch, finalize };
}

module.exports = { createFishQuestLive };
