const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { ColonyMatch } = require("../colonyquest-multiplayer");
const game = {
  id: "duels",
  lessonTitle: "Science",
  questions: Array.from({ length: 60 }, (_, i) => ({
    question: "Q" + i,
    options: ["Yes", "No"],
    correctIndex: 0,
    explanation: "Yes",
  })),
};
function room(options = {}) {
  const m = new ColonyMatch(game, {
      pacing: "individual",
      storyEnabled: false,
      duels: true,
      now: 0,
      ...options,
    }),
    a = m.join({ studentId: "a", name: "A", gender: "Male" }, 0),
    b = m.join({ studentId: "b", name: "B", gender: "Female" }, 0);
  m.start(0);
  m.tick(5000);
  return { m, a, b };
}
test("duels pair opposite roster genders, use independent questions and reveal only colony data", () => {
  const { m, a, b } = room({ teamMode: "gender" });
  assert.equal(a.duelTeam, "Boys");
  assert.equal(b.duelTeam, "Girls");
  assert.equal(m.state.duels.pairs.length, 1);
  m.answer(a.id, 0, 0, 5100);
  assert.equal(a.phase, "upgrade");
  assert.equal(b.phase, "answer");
  m.upgrade(a.id, 0, "food", null, 5200);
  m.tick(9000);
  assert.equal(a.round, 1);
  assert.equal(b.round, 0);
  const view = m.snapshot(a.id, false, 9000);
  assert.equal(view.duel.rival.name, "B");
  assert.equal(view.duel.rival.answers, undefined);
  assert.equal(view.duel.rival.question, undefined);
  assert.equal(view.question.correctIndex, undefined);
});
test("raid waits for the rival question and upgrade, then both see the same timed raid and frozen next-question timer", () => {
  const { m, a, b } = room();
  a.colony.soldiers = 3;
  b.colony.food = 30;
  m.answer(a.id, 0, 0, 5100);
  m.upgrade(a.id, 0, "raid", b.id, 5200);
  assert.equal(a.phase, "duelWait");
  assert.equal(m.state.events.filter((e) => e.kind === "raid").length, 0);
  m.tick(6000);
  assert.equal(b.phase, "answer");
  m.answer(b.id, 0, 0, 6100);
  m.upgrade(b.id, 0, "food", null, 6200);
  m.tick(10000);
  const pair = m.state.duels.pairs[0];
  assert.ok(pair.raid);
  assert.equal(a.phase, "duelRaid");
  assert.equal(b.phase, "duelRaid");
  assert.equal(
    m.snapshot(a.id, false, 10000).duel.raid.startedAt,
    m.snapshot(b.id, false, 10000).duel.raid.startedAt,
  );
  assert.equal(m.snapshot(b.id, false, 10000).question, null);
  const until = pair.raid.until;
  m.tick(until);
  assert.equal(a.phase, "answer");
  assert.equal(b.phase, "answer");
  assert.equal(b.deadline, until + 25000);
  assert.equal(m.state.events.filter((e) => e.kind === "raid").length, 1);
});
test("pause and resume preserve duel deadline, results are persisted, fresh duels reset resources equally", () => {
  const { m, a, b } = room({ duelMinutes: 5 });
  const old = m.state.duels.deadline;
  m.pause(6000);
  m.tick(50000);
  m.resume(16000);
  assert.equal(m.state.duels.deadline, old + 10000);
  m.state.duels.stage = "closing";
  for (const p of [a, b]) {
    p.phase = "duelWait";
    p.duelHold = { phase: "answer", remaining: 25000 };
  }
  a.colony.food = 90;
  m.tick(17000);
  assert.equal(m.state.duels.stage, "results");
  assert.equal(m.state.duels.history.length, 1);
  const points = a.duelPoints;
  m.tick(m.state.duels.stageUntil);
  assert.equal(m.state.duels.round, 2);
  assert.equal(a.colony.food, b.colony.food);
  assert.equal(a.colony.soldiers, b.colony.soldiers);
  assert.equal(a.duelPoints, points);
  const restored = new ColonyMatch(game, {
    state: JSON.parse(JSON.stringify(m.state)),
  });
  assert.deepEqual(restored.report().duels.history, m.report().duels.history);
});
test("raids cannot target another pair and duplicate commands cannot duplicate a queued raid", () => {
  const { m, a, b } = room();
  const extra = {
    id: "other",
    name: "Other",
    colony: { food: 50 },
    connected: true,
  };
  a.colony.soldiers = 3;
  assert.equal(m.raidAllowed(a, extra).allowed, false);
  b.colony.food = 30;
  m.answer(a.id, 0, 0, 5100);
  m.upgrade(a.id, 0, "raid", b.id, 5200);
  assert.throws(() => m.upgrade(a.id, 0, "raid", b.id, 5201));
  assert.equal(
    m.state.events.filter((e) => e.kind === "duel-raid-queued").length,
    1,
  );
});
test("disconnect freezes both paired question clocks and economies until reconnect", () => {
  const { m, a, b } = room(),
    originalDeadline = m.state.duels.deadline;
  b.connected = false;
  m.tick(6000);
  const remaining = a.duelHold.remaining,
    food = a.colony.food;
  m.tick(16000);
  assert.equal(a.phase, "duelWait");
  assert.equal(a.colony.food, food);
  assert.equal(m.snapshot(a.id, false, 16000).question, null);
  assert.ok(m.state.duels.deadline > originalDeadline);
  m.join({ studentId: "b", name: "B" }, 17000);
  m.tick(17000);
  assert.equal(a.phase, "answer");
  assert.equal(a.deadline - 17000, remaining);
  assert.equal(b.phase, "answer");
  assert.equal(m.snapshot(a.id, false, 17000).question.correctIndex, undefined);
});
test("duel expiry finishes current questions before results and re-pairing does not erase question history", () => {
  const { m, a, b } = room();
  m.answer(a.id, 0, 0, 5100);
  m.upgrade(a.id, 0, "food", null, 5200);
  m.tick(10000);
  assert.equal(a.round, 1);
  const deadline = m.state.duels.deadline;
  m.tick(deadline);
  assert.equal(m.state.duels.stage, "closing");
  m.tick(deadline + 4000);
  assert.equal(m.state.duels.stage, "results");
  assert.equal(a.answers.length, 1);
  assert.equal(m.report().learners.find((p) => p.studentId === "a").correct, 1);
  m.tick(m.state.duels.stageUntil);
  assert.equal(m.state.duels.round, 2);
  assert.equal(a.answers.length, 1);
  assert.ok(a.round >= 2);
  assert.equal(a.colony.correct, 0);
});
test("removing a rival does not trap a duel indefinitely", () => {
  const { m, a, b } = room();
  b.removed = true;
  m.tick(6000);
  m.tick(31000);
  m.tick(35000);
  assert.equal(m.state.duels.stage, "results");
  assert.equal(a.connected, true);
});

test("odd class gets one labelled computer rival and manual finish scores only once", () => {
  const m = new ColonyMatch(game, { duels: true, storyEnabled: false, now: 0 });
  for (let i = 0; i < 3; i++)
    m.join({ studentId: "odd" + i, name: "Learner " + i }, 0);
  m.start(0);
  m.tick(5000);
  assert.equal(m.state.duels.pairs.length, 2);
  const computers = m.active().filter((p) => p.npc);
  assert.equal(computers.length, 1);
  assert.match(computers[0].name, /computer/);
  m.tick(12000);
  assert.ok(computers[0].answers.length > 0);
  m.end(13000);
  const report = m.report();
  m.end(14000);
  assert.equal(m.state.duels.history.length, 1);
  assert.equal(report.duels.players.length, 3);
  assert.ok(
    report.duels.players.every((p) => !p.studentId.startsWith("duel-computer")),
  );
});

test("teacher can skip opening story into duels once without skipping later events", () => {
  const m = new ColonyMatch(game, { duels: true, now: 0 });
  m.join({ studentId: "a", name: "A" }, 0);
  m.join({ studentId: "b", name: "B" }, 0);
  m.start(0);
  assert.equal(m.state.phase, "story");
  assert.equal(m.state.story.key, "intro");
  m.skipStory(1000);
  assert.equal(m.state.story, null);
  assert.equal(m.state.duels.stage, "intro");
  assert.throws(() => m.skipStory(1001), /Only the opening story/);
  m.tick(6000);
  assert.equal(m.active()[0].phase, "answer");
  assert.equal(m.active()[0].answers.length, 0);
});

test("overall game timer pauses for announcements and teacher pauses, then finishes before another match", () => {
  const { m, a, b } = room({ gameMinutes: 1, duelMinutes: 3 });
  assert.equal(m.snapshot(a.id, false, 5000).duel.gameRemainingMs, 60000);
  m.tick(15000);
  assert.equal(m.state.duels.gameRemainingMs, 50000);
  m.pause(15000);
  m.resume(35000);
  m.tick(45000);
  assert.equal(m.state.duels.gameRemainingMs, 40000);
  m.tick(85000);
  assert.equal(m.state.duels.stage, "closing");
  assert.equal(m.state.duels.gameExpired, true);
  for (const p of [a, b]) {
    p.phase = "duelWait";
    p.deadline = null;
  }
  m.tick(86000);
  assert.equal(m.state.duels.stage, "results");
  const until = m.state.duels.stageUntil;
  m.tick(until - 1);
  assert.equal(m.state.phase, "answer");
  m.tick(until);
  assert.equal(m.state.phase, "ended");
  assert.equal(m.state.duels.round, 1);
  assert.equal(m.state.duels.history.length, 1);
  assert.equal(m.report().duels.gameMinutes, 1);
});
test("overall game duration rejects invalid values", () => {
  for (const gameMinutes of [0, -1, 121, "15", NaN])
    assert.throws(() => room({ gameMinutes }));
});

test("classroom broadcasts reuse rankings without rescanning every answer for every recipient", () => {
  const m = new ColonyMatch(game, { duels: true, storyEnabled: false, now: 0 });
  for (let i = 0; i < 30; i++)
    m.join({ studentId: "load" + i, name: "Learner " + i }, 0);
  m.start(0);
  m.tick(5000);
  let scans = 0;
  for (const p of m.active()) {
    p.answers = Array.from({ length: 40 }, (_, round) => ({
      round,
      choice: 0,
      correct: true,
    }));
    p.answers.filter = function (...args) {
      scans++;
      return Array.prototype.filter.apply(this, args);
    };
  }
  const players = m.playerSummaries(false);
  scans = 0;
  const views = m.active().map((p) => m.snapshot(p.id, false, 6000, players));
  assert.ok(
    scans <= 120,
    "Expected linear class-wide answer scans, got " + scans,
  );
  assert.ok(views.every((v) => v.duel.leaderboard.length === 30));
  m.active()[0].duelWins = 9;
  const next = m.snapshot(
    m.active()[0].id,
    false,
    7000,
    m.playerSummaries(false),
  );
  assert.equal(next.duel.leaderboard[0].wins, 9);
});

test('short question sets repeat in duels until the game timer ends',()=>{
 const m=new ColonyMatch({...game,questions:game.questions.slice(0,1)},{duels:true,storyEnabled:false,gameMinutes:1,now:0});
 const a=m.join({studentId:'a',name:'A'},0),b=m.join({studentId:'b',name:'B'},0);
 m.start(0);m.tick(5000);
 for(const p of [a,b]){m.answer(p.id,0,0,5100);m.upgrade(p.id,0,'food',null,5200);}
 m.tick(8300);
 assert.equal(m.state.phase,'answer');assert.equal(a.round,1);assert.equal(b.phase,'answer');
 assert.equal(m.snapshot(a.id,false,8300).practice,true);
 for(const p of [a,b]){m.answer(p.id,1,0,8400);m.upgrade(p.id,1,'food',null,8500);}
 m.tick(11600);
 assert.equal(m.report().learners[0].correct,1);
 m.tick(70000);m.tick(74000);m.tick(78000);m.tick(100000);
 assert.equal(m.state.phase,'ended');
 assert.equal(m.report().learners[0].correct,1);
});
