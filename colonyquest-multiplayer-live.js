'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const { DATA_DIR } = require('./storage');
const { send, decode } = require('./fishquest-transport');
const { ColonyMatch, ACTIVE } = require('./colonyquest-multiplayer');
const DIR = path.join(DATA_DIR, 'colonyquest-multiplayer');
const clean = (value) => String(value).replace(/[^a-zA-Z0-9._-]/g, '_');

// Like FishQuest, live rooms use one web process. State writes are ordered and
// atomic; recovering a running room pauses its clock until the teacher resumes.
function createColonyQuestMultiplayer({
  app,
  games,
  roster,
  requireAuth,
  requireGameAccess,
  gameSessionCanAccess = () => true,
  jwtSecret,
}) {
  fs.mkdirSync(DIR, { recursive: true });
  const matches = new Map(),
    queues = new Map(),
    groups = new Map(),
    broadcastTimers = new Map(),
    histories = new Map(),
    queueDepths = new Map();
  let wss;
  const file = (key, suffix) => path.join(DIR, `${clean(key)}.${suffix}.json`);
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(name, 'utf8'));
    } catch {
      return null;
    }
  };
  async function atomic(name, data) {
    const temp = name + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.promises.writeFile(temp, JSON.stringify(data));
      await fs.promises.rename(temp, name);
    } finally {
      await fs.promises.unlink(temp).catch(() => {});
    }
  }
  async function save(key, match) {
    await atomic(file(key, match.state.id), match.state);
    await atomic(file(key, 'active'), { id: match.state.id });
    const cached = histories.get(key);
    if (cached) {
      const s = match.state,
        entry = { id: s.id, startedAt: s.startedAt, endedAt: s.endedAt };
      const index = cached.findIndex((h) => h.id === s.id);
      if (index < 0) cached.push(entry);
      else cached[index] = entry;
    }
  }
  function getMatch(key, gameId = key) {
    if (matches.has(key)) return matches.get(key);
    const active = read(file(key, 'active')),
      state = active && read(file(key, active.id));
    if (!state) return null;
    const game = games.getGame(gameId);
    if (!game) return null;
    const match = new ColonyMatch(game, { state });
    match.restore();
    matches.set(key, match);
    return match;
  }
  function enqueue(key, fn) {
    const depth = queueDepths.get(key) || 0;
    if (depth >= 128) return Promise.reject(Error('The room is busy. Please try your choice again.'));
    queueDepths.set(key, depth + 1);
    const task = (queues.get(key) || Promise.resolve()).then(fn);
    const tail = task.catch(() => {});
    queues.set(key, tail);
    tail.finally(() => {
      const depth = (queueDepths.get(key) || 1) - 1;
      if (depth) queueDepths.set(key, depth);
      else queueDepths.delete(key);
      if (queues.get(key) === tail) queues.delete(key);
    });
    return task;
  }
  async function mutate(key, fn) {
    return enqueue(key, async () => {
      const match = getMatch(key, key.split('.preview.')[0]);
      if (!match) throw Error('Open the lobby first.');
      const before = structuredClone(match.state);
      try {
        const result = fn(match);
        await save(key, match);
        broadcast(key);
        return result;
      } catch (error) {
        match.state = before;
        throw error;
      }
    });
  }
  async function openMatch(game, { rosterIds = [], preview = false, key = game.id } = {}) {
    return enqueue(key, async () => {
      const old = getMatch(key, game.id);
      if (old && old.state.phase !== 'ended') return old;
      if (old) await finalize(key, old);
      const match = new ColonyMatch(game, { preview, rosterIds });
      await save(key, match);
      matches.set(key, match);
      return match;
    });
  }
  function classes(game) {
    return games
      .getRosterIds(game)
      .map((id) => roster.getRoster(game.teacherId, id))
      .filter(Boolean);
  }
  function eligible(game, match, identity, assignedClasses = null) {
    if (games.isStudentRemoved(game, identity.studentId)) return false;
    if (!gameSessionCanAccess(game, { ...identity, gameId: game.id })) return false;
    const selected = match.state.rosterIds;
    if (!selected.length) return !games.getRosterIds(game).length;
    const normalized = games.normalizeStudentId(identity.studentId);
    return (assignedClasses || classes(game))
      .filter((c) => selected.includes(String(c.id)))
      .some(
        (c) =>
          (!identity.rosterId || String(c.id) === String(identity.rosterId)) &&
          (c.students || []).some((s) => games.normalizeStudentId(s.id) === normalized),
      );
  }
  function owner(req, res) {
    const game = games.getGame(req.params.id);
    if (!game) {
      res.status(404).json({ error: 'Game not found.' });
      return null;
    }
    if (game.teacherId !== req.userId) {
      res.status(403).json({ error: 'This game belongs to another teacher.' });
      return null;
    }
    return game;
  }
  function history(gameId) {
    if (!histories.has(gameId))
      histories.set(
        gameId,
        fs
          .readdirSync(DIR)
          .filter(
            (n) =>
              n.startsWith(clean(gameId) + '.') &&
              !n.includes('.preview.') &&
              !n.endsWith('.active.json') &&
              n.endsWith('.json'),
          )
          .map((n) => read(path.join(DIR, n)))
          .filter(Boolean)
          .map((s) => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt })),
      );
    return [...histories.get(gameId)].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }
  function payload(game, match) {
    const selected = match?.state.rosterIds || games.getRosterIds(game).map(String);
    return {
      title: game.lessonTitle,
      match: match?.snapshot(null, true) || null,
      classes: classes(game).map((c) => ({ id: c.id, name: c.name, count: c.students.length })),
      rosterIds: selected,
      attendance: classes(game)
        .filter((c) => selected.includes(String(c.id)))
        .flatMap((c) =>
          c.students
            .filter((s) => !games.isStudentRemoved(game, s.id))
            .map((s) => ({
              name: s.name,
              studentId: s.id,
              className: c.name,
              joined: !!match?.state.players.some(
                (p) => !p.removed && p.studentId === games.normalizeStudentId(s.id),
              ),
            })),
        ),
      history: history(game.id),
    };
  }
  async function finalize(key, match) {
    const s = match.state;
    if (s.resultsSavedAt || s.phase !== 'ended') return;
    if (!s.preview)
      for (const p of s.players) {
        if (p.npc || !p.answers.length) continue;
        games.recordResult(s.gameId, {
          studentId: p.studentId,
          name: p.name,
          rosterId: p.rosterId,
          score: p.answers.filter((a) => a.correct).length,
          total: s.questions.length,
          answers: s.questions.map((_, i) => p.answers.find((a) => a.round === i)?.choice ?? -1),
          gameType: 'colonyquest-live',
          arcadeScore: require('./public/colonyquest-core').colonyStrength(p.colony),
          resultId: `${s.id}:${p.studentId}`,
        });
      }
    s.resultsSavedAt = Date.now();
    try {
      await save(key, match);
    } catch (e) {
      delete s.resultsSavedAt;
      throw e;
    }
  }
  const route = '/api/game/:id/colonyquest-live';
  app.get(route, requireAuth, (req, res) => {
    const g = owner(req, res);
    if (g) res.json(payload(g, getMatch(g.id)));
  });
  app.post(route + '/open', requireAuth, async (req, res) => {
    const g = owner(req, res);
    if (!g) return;
    try {
      if (!g.questions?.length) throw Error('Add questions before opening a room.');
      const assigned = games.getRosterIds(g).map(String),
        ids = Array.isArray(req.body?.rosterIds) ? [...new Set(req.body.rosterIds.map(String))] : assigned;
      if (assigned.length && !ids.length) throw Error('Choose a class for this game.');
      if (ids.some((id) => !assigned.includes(id))) throw Error('Choose a class assigned to this game.');
      res.json(payload(g, await openMatch(g, { rosterIds: ids })));
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  });
  for (const command of ['start', 'pause', 'resume', 'end'])
    app.post(route + '/' + command, requireAuth, async (req, res) => {
      const g = owner(req, res);
      if (!g) return;
      try {
        await mutate(g.id, (m) => m[command]());
        if (command === 'end') await enqueue(g.id, () => finalize(g.id, getMatch(g.id)));
        res.json(payload(g, getMatch(g.id)));
      } catch (e) {
        res.status(409).json({ error: e.message });
      }
    });
  app.get(route + '/report', requireAuth, (req, res) => {
    const g = owner(req, res);
    if (!g) return;
    const id = String(req.query.match || ''),
      state = id ? read(file(g.id, id)) : getMatch(g.id)?.state;
    if (!state || state.gameId !== g.id || state.preview)
      return res.status(404).json({ error: 'Report not found.' });
    res.json(new ColonyMatch(g, { state }).report());
  });
  app.post(route + '/ticket', requireGameAccess, async (req, res) => {
    const g = games.getGame(req.params.id);
    if (!g) return res.status(404).json({ error: 'Game not found.' });
    const preview = req.userId === g.teacherId;
    const identity = preview
      ? { studentId: `__TEACHER_${req.userId}`, name: 'Your practice colony' }
      : req.gameSession?.gameId === g.id
        ? req.gameSession
        : null;
    if (!identity) return res.status(403).json({ error: 'Please sign in to this game.' });
    identity.studentId = games.normalizeStudentId(identity.studentId);
    try {
      const key = preview
        ? `${g.id}.preview.${crypto.createHash('sha256').update(req.userId).digest('hex').slice(0, 12)}`
        : g.id;
      const m = preview ? await openMatch(g, { key, preview: true }) : getMatch(key);
      if (
        !m ||
        (m.state.phase === 'ended' && !m.state.players.some((p) => p.studentId === identity.studentId))
      )
        return res.status(409).json({ error: 'Waiting for your teacher to open a new ColonyQuest lobby.' });
      if (!preview && !eligible(g, m, identity))
        return res.status(403).json({ error: 'Your class is not in this room, or you have been removed.' });
      res.json({
        token: jwt.sign(
          {
            type: 'colonyquest-live',
            gameId: g.id,
            key,
            matchId: m.state.id,
            studentId: identity.studentId,
            name: identity.name,
            rosterId: identity.rosterId || null,
            preview,
          },
          jwtSecret,
          { expiresIn: '2h' },
        ),
      });
    } catch (e) {
      res.status(409).json({ error: e.message });
    }
  });
  function broadcast(key) {
    if (broadcastTimers.has(key)) return;
    const timer = setTimeout(() => {
      broadcastTimers.delete(key);
      try {
        broadcastNow(key);
      } catch (e) {
        console.error('ColonyQuest update failed:', e.message);
      }
    }, 150);
    timer.unref();
    broadcastTimers.set(key, timer);
  }
  function broadcastNow(key) {
    const match = matches.get(key);
    if (!match) return;
    const game = games.getGame(match.state.gameId),
      assigned = game ? classes(game) : [];
    for (const ws of groups.get(key) || [])
      if (!ws.replaced) {
        if (!game || (!ws.identity.preview && !eligible(game, match, ws.identity, assigned))) {
          ws.replaced = true;
          ws.close(4003, 'Your access to this room changed');
          continue;
        }
        send(ws, { type: 'state', state: match.snapshot(ws.playerId) });
      }
  }
  function attach(server) {
    wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws/colonyquest-live') return;
      try {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
    });
    wss.on('connection', (ws) => {
      ws.alive = true;
      ws.on('pong', () => {
        ws.alive = true;
      });
      ws.on('error', () => {});
      const timer = setTimeout(() => ws.close(4003, 'Please join the game again'), 5000);
      timer.unref();
      ws.on('message', async (raw) => {
        const receivedAt = Date.now(),
          message = decode(ws, raw);
        if (!message || ws.replaced) return;
        if (!ws.playerId) {
          if (message.type !== 'auth' || ws.authenticating) return;
          ws.authenticating = true;
          try {
            const claim = jwt.verify(message.token, jwtSecret);
            if (claim.type !== 'colonyquest-live') throw Error('Wrong ticket');
            const g = games.getGame(claim.gameId),
              m = getMatch(claim.key, claim.gameId);
            if (
              !g ||
              !m ||
              m.state.id !== claim.matchId ||
              m.state.preview !== !!claim.preview ||
              (!claim.preview && !eligible(g, m, claim))
            )
              throw Error('Room unavailable');
            await mutate(claim.key, (match) => {
              if (ws.readyState !== 1) throw Error('Connection closed');
              if (match.state.id !== claim.matchId) throw Error('Room changed');
              const existing = match.state.players.find((p) => p.studentId === claim.studentId);
              if (existing && existing.removed) existing.removed = false; // fresh eligibility above confirms the teacher added them back
              const p = match.join(claim);
              ws.key = claim.key;
              ws.gameId = g.id;
              ws.playerId = p.id;
              ws.identity = claim;
              if (claim.preview && match.state.phase === 'lobby') {
                ['Fern', 'Clover', 'Acorn'].forEach((name, i) =>
                  match.join({ studentId: `npc-${i}`, name, npc: true }),
                );
                match.start();
              } else if (claim.preview && match.state.phase === 'paused') match.resume();
            });
            if (ws.readyState !== 1) {
              await mutate(claim.key, (m) => {
                const p = m.player(ws.playerId);
                if (p) p.connected = false;
              });
              return;
            }
            clearTimeout(timer);
            if (!groups.has(ws.key)) groups.set(ws.key, new Set());
            for (const old of groups.get(ws.key))
              if (old.playerId === ws.playerId) {
                old.replaced = true;
                old.close(4002, 'Opened on another device');
              }
            groups.get(ws.key).add(ws);
            send(ws, { type: 'state', state: m.snapshot(ws.playerId) });
          } catch {
            ws.close(4003, 'Please join the room again');
          }
          return;
        }
        if (message.type === 'ping') {
          send(ws, { type: 'pong' });
          return;
        }
        if (!['answer', 'upgrade'].includes(message.type)) return;
        if (!ws.commandWindow || receivedAt - ws.commandWindow > 1000) {
          ws.commandWindow = receivedAt;
          ws.commandCount = 0;
        }
        if (++ws.commandCount > 8) {
          ws.close(1008, 'Too many choices');
          return;
        }
        try {
          const g = games.getGame(ws.gameId),
            m = getMatch(ws.key, ws.gameId);
          if (!g || !m || (!ws.identity.preview && !eligible(g, m, ws.identity)))
            throw Error('Your access to this room has changed.');
          await mutate(ws.key, (match) => {
            if (ws.replaced || message.matchId !== match.state.id)
              throw Error('This room has changed. Join again.');
            if (message.type === 'answer')
              match.answer(ws.playerId, message.round, message.choice, receivedAt);
            else match.upgrade(ws.playerId, message.round, message.key, message.target, receivedAt);
          });
          send(ws, { type: 'state', state: getMatch(ws.key, ws.gameId).snapshot(ws.playerId) });
          send(ws, { type: 'ack', commandId: message.commandId, accepted: true });
        } catch (e) {
          send(ws, { type: 'ack', commandId: message.commandId, accepted: false, error: e.message });
        }
      });
      ws.on('close', () => {
        clearTimeout(timer);
        if (!ws.key) return;
        groups.get(ws.key)?.delete(ws);
        if (![...(groups.get(ws.key) || [])].some((s) => s.playerId === ws.playerId && !s.replaced)) {
          mutate(ws.key, (m) => {
            const p = m.player(ws.playerId);
            if (p) p.connected = false;
          }).catch(() => {});
        }
        if (!groups.get(ws.key)?.size) groups.delete(ws.key);
      });
    });
    const heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (!ws.alive) ws.terminate();
        else {
          ws.alive = false;
          ws.ping();
        }
      }
    }, 15000);
    heartbeat.unref();
    const tick = setInterval(() => {
      for (const [key, m] of matches) {
        if (queues.has(key)) continue; // never build an unbounded backlog during slow storage
        if (!ACTIVE.includes(m.state.phase) && !(m.state.phase === 'ended' && !m.state.resultsSavedAt))
          continue;
        mutate(key, (match) => {
          const connected = match.active().some((p) => p.connected && !p.npc);
          if (!connected && ACTIVE.includes(match.state.phase)) {
            match.pause();
            match.event('Connection paused. Your teacher can resume when everyone is back.');
          } else match.tick();
        })
          .then(() => enqueue(key, () => finalize(key, m)))
          .catch((e) => {
            if (ACTIVE.includes(m.state.phase)) m.pause();
            broadcast(key);
            console.error('ColonyQuest paused; storage or simulation needs attention:', e.message);
          });
      }
    }, 1000);
    tick.unref();
    wss.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(tick);
      for (const timer of broadcastTimers.values()) clearTimeout(timer);
    });
    return wss;
  }
  function removeStudent(gameId, studentId) {
    getMatch(gameId); // recover a persisted room even if its control page has not been opened since restart
    for (const [key, m] of matches)
      if (m.state.gameId === gameId && !m.state.preview) {
        mutate(key, (match) => {
          const p = match.state.players.find((p) => p.studentId === games.normalizeStudentId(studentId));
          if (p) {
            p.removed = true;
            p.connected = false;
          }
        }).catch((e) => console.error('ColonyQuest removal save failed:', e.message));
        for (const ws of groups.get(key) || [])
          if (ws.identity.studentId === games.normalizeStudentId(studentId)) {
            ws.replaced = true;
            ws.close(4003, 'Removed by your teacher');
          }
      }
  }
  function isPlaying(gameId, studentId) {
    const m = getMatch(gameId);
    return (
      !!m &&
      ACTIVE.concat('paused').includes(m.state.phase) &&
      m.state.players.some((p) => !p.removed && p.studentId === games.normalizeStudentId(studentId))
    );
  }
  return { attach, openMatch, getMatch, removeStudent, isPlaying, mutate, finalize };
}
module.exports = { createColonyQuestMultiplayer };
