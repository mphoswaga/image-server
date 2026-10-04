const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http');
const { once } = require('node:events'),
  express = require('express'),
  jwt = require('jsonwebtoken'),
  WebSocket = require('ws');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'colony-live-test-'));
process.env.DATA_DIR = temp;
const { createColonyQuestMultiplayer } = require('../colonyquest-multiplayer-live');
const { createFishQuestLive } = require('../fishquest-live');
const secret = 'colony-test-secret';
async function fixture(t, id, { withFish = false } = {}) {
  const game = {
    id,
    teacherId: 'teacher',
    lessonTitle: 'Meadow',
    rosterIds: ['classA'],
    questions: [
      { question: 'A habitat?', options: ['Forest', 'Pen'], correctIndex: 0 },
      { question: 'Plants need?', options: ['Water', 'Plastic'], correctIndex: 0 },
    ],
  };
  const records = {
    classA: {
      id: 'classA',
      name: 'Class A',
      students: Array.from({ length: 30 }, (_, i) => ({ id: 'S' + i, name: 'Learner ' + i })),
    },
    classB: { id: 'classB', name: 'Class B', students: [{ id: 'Other', name: 'Other' }] },
  };
  const removed = new Set(),
    writes = [];
  const games = {
    getGame: (key) => (key === id ? game : null),
    getRosterIds: (g) => g.rosterIds,
    normalizeStudentId: (s) => String(s).toUpperCase(),
    isStudentRemoved: (_g, id) => removed.has(id),
    recordResult: (_id, r) => {
      if (!writes.some((w) => w.resultId === r.resultId)) writes.push(r);
    },
  };
  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    req.userId = req.headers['x-teacher'] || 'teacher';
    next();
  };
  const requireGameAccess = (req, res, next) => {
    if (req.headers['x-teacher']) req.userId = req.headers['x-teacher'];
    else
      req.gameSession = {
        gameId: id,
        studentId: req.headers['x-student'] || 'S0',
        name: 'Learner',
        rosterId: req.headers['x-roster'] || 'classA',
      };
    next();
  };
  const args = {
    app,
    games,
    roster: { getRoster: (_t, id) => records[id] },
    requireAuth,
    requireGameAccess,
    jwtSecret: secret,
  };
  const fish = withFish ? createFishQuestLive(args) : null,
    live = createColonyQuestMultiplayer(args),
    server = http.createServer(app);
  const fishWss = fish?.attach(server),
    wss = live.attach(server),
    sockets = [];
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`,
    api = base + `/api/game/${id}/colonyquest-live`;
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    for (const ws of wss.clients) ws.terminate();
    for (const ws of fishWss?.clients || []) ws.terminate();
    await new Promise((r) => wss.close(r));
    if (fishWss) await new Promise((r) => fishWss.close(r));
    await new Promise((r) => server.close(r));
  });
  async function join(student = 'S0', token = null) {
    const m = live.getMatch(id),
      ws = new WebSocket(base.replace('http', 'ws') + '/ws/colonyquest-live');
    sockets.push(ws);
    ws.states = [];
    ws.messages = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      ws.messages.push(msg);
      if (msg.type === 'state') ws.states.push(msg.state);
    });
    await once(ws, 'open');
    ws.send(
      JSON.stringify({
        type: 'auth',
        token:
          token ||
          jwt.sign(
            {
              type: 'colonyquest-live',
              gameId: id,
              key: id,
              matchId: m.state.id,
              studentId: student,
              name: student,
              rosterId: 'classA',
              preview: false,
            },
            secret,
          ),
      }),
    );
    return ws;
  }
  return { game, games, live, api, base, join, writes, removed, server, sockets };
}
async function until(fn, timeout = 10000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw Error('Timed out waiting for state');
    await new Promise((r) => setTimeout(r, 20));
  }
}
test(
  '30 real learners submit at once, with durable acknowledgements, reconnect and report history',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, 'classroom', { withFish: true }),
      m = await f.live.openMatch(f.game, { rosterIds: ['classA'] });
    const clients = await Promise.all(Array.from({ length: 30 }, (_, i) => f.join('S' + i)));
    await until(() => clients.every((ws) => ws.states.length));
    assert.equal(m.active().length, 30);
    await f.live.mutate(f.game.id, (m) => m.start());
    const began = Date.now();
    for (const ws of clients) {
      ws.send('null');
      ws.send('{broken');
      ws.send(
        JSON.stringify({ type: 'answer', commandId: 'answer', matchId: m.state.id, round: 0, choice: 0 }),
      );
    }
    await until(() => clients.every((ws) => ws.messages.some((x) => x.type === 'ack' && x.accepted)));
    const latency = Date.now() - began;
    t.diagnostic(`30 simultaneous answer acknowledgements: ${latency} ms`);
    assert.ok(latency < 8000);
    assert.equal(m.active().filter((p) => p.answers.length === 1).length, 30);
    const stored = JSON.parse(
      fs.readFileSync(path.join(temp, 'colonyquest-multiplayer', `classroom.${m.state.id}.json`)),
    );
    assert.equal(stored.players.filter((p) => p.answers.length === 1).length, 30);
    const oldClosed = once(clients[0], 'close'),
      replacement = await f.join('S0');
    assert.equal((await oldClosed)[0], 4002);
    await until(() => replacement.states.length);
    assert.equal(replacement.states.at(-1).me.choice, 0);
    await f.live.mutate(f.game.id, (m) => m.pause());
    await until(() => replacement.states.at(-1).phase === 'paused');
    await f.live.mutate(f.game.id, (m) => m.resume());
    const closed = once(clients[1], 'close');
    f.removed.add('S1');
    f.live.removeStudent(f.game.id, 'S1');
    assert.equal((await closed)[0], 4003);
    await until(() => m.player(clients[1].states.at(-1).me.id).removed);
    const premature = await fetch(f.api + '/report', { headers: { 'x-teacher': 'someone-else' } });
    assert.equal(premature.status, 403);
    await f.live.mutate(f.game.id, (m) => m.end());
    await f.live.finalize(f.game.id, m);
    assert.equal(f.writes.length, 30);
    assert.ok(f.writes.every((w) => w.score === 1 && w.total === 2 && w.answers[1] === -1));
    const report = await (await fetch(f.api + '/report?match=' + m.state.id)).json();
    assert.equal(report.learners.length, 30);
    assert.equal(report.questions[0].correct, 30);
    const next = await f.live.openMatch(f.game, { rosterIds: ['classA'] });
    assert.notEqual(next.state.id, m.state.id);
    const oldReport = await (await fetch(f.api + '/report?match=' + m.state.id)).json();
    assert.equal(oldReport.learners.length, 30);
    const stale = await f.join(
      'S2',
      jwt.sign(
        {
          type: 'colonyquest-live',
          gameId: f.game.id,
          key: f.game.id,
          matchId: m.state.id,
          studentId: 'S2',
          name: 'S2',
          rosterId: 'classA',
          preview: false,
        },
        secret,
      ),
    );
    assert.equal((await once(stale, 'close'))[0], 4003);
  },
);
test('class restrictions, isolated computer preview, non-owner and stale credentials', async (t) => {
  const f = await fixture(t, 'permissions');
  f.game.rosterIds = ['classA', 'classB'];
  const m = await f.live.openMatch(f.game, { rosterIds: ['classA'] });
  const other = await fetch(f.api + '/ticket', {
    method: 'POST',
    headers: { 'x-student': 'Other', 'x-roster': 'classB' },
  });
  assert.equal(other.status, 403);
  const forged = await fetch(f.api + '/ticket', {
    method: 'POST',
    headers: { 'x-student': 'Other', 'x-roster': 'classA' },
  });
  assert.equal(forged.status, 403);
  const denied = await fetch(f.api + '/start', { method: 'POST', headers: { 'x-teacher': 'intruder' } });
  assert.equal(denied.status, 403);
  const preview = await (
    await fetch(f.api + '/ticket', { method: 'POST', headers: { 'x-teacher': 'teacher' } })
  ).json();
  const claims = jwt.verify(preview.token, secret);
  assert.notEqual(claims.key, f.game.id);
  const ws = await f.join('teacher', preview.token);
  await until(() => ws.states.length);
  assert.equal(ws.states.at(-1).players.length, 4);
  assert.equal(ws.states.at(-1).preview, true);
  assert.equal(m.state.phase, 'lobby');
  assert.equal(m.state.players.length, 0);
  const previewMatch = f.live.getMatch(claims.key, f.game.id);
  await f.live.mutate(claims.key, (m) => m.end());
  await f.live.finalize(claims.key, previewMatch);
  assert.equal(f.writes.length, 0);
});
test('server recovery pauses persisted running rounds with answer state intact', async (t) => {
  const f = await fixture(t, 'recovery');
  const m = await f.live.openMatch(f.game, { rosterIds: ['classA'] });
  const ws = await f.join();
  await until(() => ws.states.length);
  await f.live.mutate(f.game.id, (m) => {
    m.start();
    m.answer(m.active()[0].id, 0, 0);
  });
  const app = express(),
    restored = createColonyQuestMultiplayer({
      app,
      games: f.games,
      roster: {},
      requireAuth: () => {},
      requireGameAccess: () => {},
      jwtSecret: secret,
    });
  const recovered = restored.getMatch(f.game.id);
  assert.equal(recovered.state.phase, 'paused');
  assert.equal(recovered.active()[0].answers[0].choice, 0);
  assert.equal(recovered.active()[0].connected, false);
  f.removed.add('S0');
  restored.removeStudent(f.game.id, 'S0');
  await until(() => recovered.state.players[0].removed);
  assert.equal(recovered.state.players[0].answers[0].choice, 0);
});
test('raid command runs once over the socket, add-back restores access and result failures retry', async (t) => {
  const f = await fixture(t, 'raid-room'),
    m = await f.live.openMatch(f.game, { rosterIds: ['classA'] });
  const a = await f.join('S0'),
    b = await f.join('S1');
  await until(() => a.states.length && b.states.length);
  await f.live.mutate(f.game.id, (m) => {
    m.start();
    m.active()[0].colony.soldiers = 3;
    m.active()[1].colony.food = 12;
    for (const p of m.active()) m.answer(p.id, 0, 0);
    m.settleAnswers();
    m.setPhase('upgrade', 12, Date.now());
  });
  const raid = {
    type: 'upgrade',
    commandId: 'raid',
    matchId: m.state.id,
    round: 0,
    key: 'raid',
    target: m.active()[1].id,
  };
  a.send(JSON.stringify(raid));
  a.send(JSON.stringify(raid));
  await until(() => a.messages.some((x) => x.type === 'ack' && x.commandId === 'raid' && x.accepted));
  assert.equal(m.state.events.filter((e) => e.kind === 'raid').length, 1);
  assert.equal(m.active()[1].colony.food, 7);
  f.removed.add('S1');
  const closed = once(b, 'close');
  f.live.removeStudent(f.game.id, 'S1');
  await closed;
  await until(() => m.state.players[1].removed);
  f.removed.delete('S1');
  const back = await f.join('S1');
  await until(() => back.states.length);
  assert.equal(m.state.players[1].removed, false);
  assert.equal(m.state.players[1].answers.length, 1);
  const original = f.games.recordResult;
  let attempts = 0;
  f.games.recordResult = (...args) => {
    if (++attempts === 1) throw Error('temporary storage failure');
    return original(...args);
  };
  await f.live.mutate(f.game.id, (m) => m.end());
  await assert.rejects(f.live.finalize(f.game.id, m), /temporary/);
  assert.equal(m.state.resultsSavedAt, undefined);
  await f.live.finalize(f.game.id, m);
  assert.equal(f.writes.length, 2);
  assert.ok(m.state.resultsSavedAt);
});
