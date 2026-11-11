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
test("raid starts while the rival answers and restores the remaining question time", () => {
  const { m, a, b } = room();
  a.colony.soldiers = 3;
  b.colony.food = 30;
  m.answer(a.id, 0, 0, 5100);
  m.upgrade(a.id, 0, "raid", b.id, 5200);
  assert.equal(a.phase, "duelWait");
  assert.equal(m.state.events.filter((e) => e.kind === "raid").length, 0);
  m.tick(6000);
  assert.equal(b.phase, "duelRaid");
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
  assert.equal(b.deadline, until + 19000);
  assert.equal(m.state.events.filter((e) => e.kind === "raid").length, 1);
});
test("duel transitions continue immediately and preserve saved results",()=>{
 const {m,a,b}=room();const deadline=m.state.duels.deadline;
 m.pause(6000);m.resume(16000);assert.equal(m.state.duels.deadline,deadline+10000);
 m.tick(m.state.duels.deadline);
 assert.equal(m.state.duels.stage,'playing');assert.equal(m.state.duels.round,2);
 assert.equal(m.state.duels.history.length,1);assert.equal(a.phase,'answer');
 const restored=new ColonyMatch(game,{state:structuredClone(m.state)});
 assert.equal(restored.report().duels.history.length,1);
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
test("connected learners continue when their rival disconnects",()=>{
 const {m,a,b}=room();b.connected=false;const deadline=a.deadline;
 m.tick(6000);m.tick(16000);
 assert.equal(a.phase,'answer');assert.equal(a.deadline,deadline);
 assert.ok(m.snapshot(a.id,false,16000).question);
 m.answer(a.id,0,0,17000);assert.equal(a.phase,'upgrade');
});

test("duel expiry starts the next opponent round without waiting",()=>{
 const {m,a,b}=room();m.answer(a.id,0,0,5100);m.upgrade(a.id,0,'food',null,5200);m.tick(10000);
 m.tick(m.state.duels.deadline);
 assert.equal(m.state.duels.stage,'playing');assert.equal(m.state.duels.round,2);
 assert.equal(a.answers.length,1);assert.equal(a.phase,'answer');assert.equal(b.phase,'answer');
});

test("removing a rival re-pairs the active learner without a wait",()=>{
 const {m,a,b}=room();b.removed=true;m.tick(6000);
 assert.equal(a.phase,'answer');assert.equal(m.state.duels.stage,'playing');
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

test("teacher can skip the story directly into active duels",()=>{
 const m=new ColonyMatch(game,{duels:true,storyEnabled:true,now:0});
 const a=m.join({studentId:'a',name:'A'},0);m.join({studentId:'b',name:'B'},0);
 m.start(0);m.skipStory(100);assert.equal(m.state.duels.stage,'playing');assert.equal(a.phase,'answer');
});

test("game timer expiry keeps students active until every learner completes questions",()=>{
 const {m,a,b}=room({gameMinutes:1});m.tick(70000);
 assert.equal(m.state.phase,'answer');assert.equal(m.state.duels.gameExpired,true);
 assert.notEqual(a.phase,'duelWait');assert.notEqual(b.phase,'duelWait');
 for(const p of [a,b]){p.round=game.questions.length;p.phase='upgrade';p.deadline=100000;}
 m.tick(71000);assert.equal(m.state.phase,'ended');
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
 assert.equal(m.state.phase,'answer');assert.equal(a.round,1);assert.equal(b.phase,'upgrade');
 assert.equal(m.snapshot(a.id,false,8300).freeBuild,true);
 for(const p of [a,b]){m.upgrade(p.id,1,'food',null,8500);}
 m.tick(11600);
 assert.equal(m.report().learners[0].correct,1);
 m.tick(70000);m.tick(74000);m.tick(78000);m.tick(100000);
 assert.equal(m.state.phase,'ended');
 assert.equal(m.report().learners[0].correct,1);
});
