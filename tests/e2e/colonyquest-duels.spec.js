const { test, expect } = require("@playwright/test"),
  path = require("node:path"),
  { ColonyMatch } = require("../../colonyquest-multiplayer");
const game = {
  id: "duel-browser",
  lessonTitle: "Colony duel test",
  questions: Array.from({ length: 10 }, (_, i) => ({
    question: "Which is a habitat? " + i,
    options: ["Forest", "Pencil"],
    correctIndex: 0,
    explanation: "Animals live in a habitat.",
  })),
};
test("two learner devices see live rival colonies, independent answers and one shared raid without interrupting a question", async ({
  browser,
}, info) => {
  test.setTimeout(45000);
  const m = new ColonyMatch(game, {
      pacing: "individual",
      storyEnabled: false,
      duels: true,
      now: Date.now(),
    }),
    a = m.join({ studentId: "a", name: "Mia" }, Date.now()),
    b = m.join({ studentId: "b", name: "Leo" }, Date.now());
  m.start(Date.now() - 5001);
  m.tick(Date.now());
  a.colony.soldiers = 3;
  b.colony.food = 30;
  const contexts = [],
    peers = [];
  let timer;
  try {
    for (const p of [a, b]) {
      const ctx = await browser.newContext({
        viewport: info.project.use.viewport || { width: 1366, height: 768 },
      });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => {
        throw e;
      });
      await page.route("**/colonyquest-live-play/duel-browser", (r) =>
        r.fulfill({
          path: path.join(__dirname, "../../public/colonyquest-live.html"),
          contentType: "text/html",
        }),
      );
      await page.route(
        "**/api/game/duel-browser/colonyquest-live/ticket",
        (r) => r.fulfill({ json: { token: "sample" } }),
      );
      await page.routeWebSocket("**/ws/colonyquest-live", (ws) => {
        peers.push({ ws, id: p.id });
        ws.onMessage((raw) => {
          const message = JSON.parse(raw);
          if (message.type === "auth") {
            ws.send(
              JSON.stringify({
                type: "state",
                state: m.snapshot(p.id, false, Date.now()),
              }),
            );
            return;
          }
          if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }
          let error;
          try {
            if (message.type === "answer")
              m.answer(p.id, message.round, message.choice, Date.now());
            else if (message.type === "upgrade")
              m.upgrade(
                p.id,
                message.round,
                message.key,
                message.target,
                Date.now(),
              );
          } catch (e) {
            error = e.message;
          }
          ws.send(
            JSON.stringify({
              type: "ack",
              commandId: message.commandId,
              accepted: !error,
              error,
            }),
          );
          for (const peer of peers)
            peer.ws.send(
              JSON.stringify({
                type: "state",
                state: m.snapshot(peer.id, false, Date.now()),
              }),
            );
        });
      });
      await page.goto("/colonyquest-live-play/duel-browser");
      await expect(page.locator("#colonyDuelPanel")).toContainText(
        p.id === a.id ? "Leo" : "Mia",
      );
      await expect(page.locator("#rivalColonyCanvas")).toBeVisible();
    }
    const [pa, pb] = await Promise.all(contexts.map((c) => c.pages()[0]));
    await expect(pa.locator("#colonyCanvas")).toHaveAttribute(
      "data-habitat-view",
      "smartboard",
    );
    if(info.project.name==='windows-100'){
      const textSizes=()=>pa.locator('#question').evaluate(el=>({question:getComputedStyle(el).fontSize,answer:getComputedStyle(document.querySelector('#choices button')).fontSize}));
      const sizes=await textSizes();
      for(const viewport of [{width:1920,height:1080},{width:1366,height:768}]){
        await pa.setViewportSize(viewport);
        const stage=await pa.locator('.colony-stage').boundingBox();expect(stage.width).toBeLessThanOrEqual(1040);expect(stage.height).toBeLessThanOrEqual(281);expect(stage.height).toBeGreaterThanOrEqual(220);
        expect(await textSizes()).toEqual(sizes);
        await pageShot(pa,info.outputPath('compact-'+viewport.width+'.png'));
      }
    }
    await pageShot(pa, info.outputPath("smartboard-question.png"));
    if (info.project.name === "windows-100")
      expect(
        await pa
          .locator("#choices")
          .evaluate((el) => el.getBoundingClientRect().bottom),
      ).toBeLessThanOrEqual(768);

    await pa.bringToFront();
    await pa.locator('#choices [data-choice="0"]').click();
    await expect(pa.locator("#question")).toHaveText(
      "Correct! Grow your colony.",
    );
    expect(b.phase).toBe("answer");
    await pa.getByRole("button", { name: /Raid Leo/ }).click();
    await expect(pa.locator("#colonyDuelPanel")).toContainText("Raid queued");
    expect(m.state.events.filter((e) => e.kind === "raid").length).toBe(0);
    await pb.bringToFront();
    await pb.locator('#choices [data-choice="1"]').click();
    timer = setInterval(() => {
      m.tick(Date.now());
      for (const peer of peers)
        try {
          peer.ws.send(
            JSON.stringify({
              type: "state",
              state: m.snapshot(peer.id, false, Date.now()),
            }),
          );
        } catch {}
    }, 100);
    await expect
      .poll(() => !!m.state.duels.pairs[0].raid, { timeout: 8000 })
      .toBe(true);
    await expect(pb.locator("#colonyDuelPanel")).toContainText("Mia raids Leo");
    expect(m.snapshot(a.id, false).duel.raid.startedAt).toBe(
      m.snapshot(b.id, false).duel.raid.startedAt,
    );
    await expect(pb.locator("body")).toHaveClass(/colony-duel-raid/);
    await pageShot(pb, info.outputPath("shared-raid.png"));
    await expect(pb.locator("[data-raid-result]")).toBeVisible({
      timeout: 6000,
    });
    await expect(pb.locator("[data-raid-result]")).toContainText("wins");
    await expect
      .poll(() => !m.state.duels.pairs[0].raid, { timeout: 10000 })
      .toBe(true);
    expect(a.round).toBe(1);
    expect(b.round).toBe(1);
    expect(a.answers.length).toBe(1);
    expect(b.answers.length).toBe(1);
  } finally {
    clearInterval(timer);
    for (const ctx of contexts) await ctx.close();
  }
});
async function pageShot(page, file) {
  await page.screenshot({ path: file, fullPage: true });
}

test("teacher can choose five-minute duels and roster teams before opening the room", async ({
  page,
}) => {
  const data = {
    title: "Habitats",
    classes: [{ id: "c1", name: "Grade 3", count: 25 }],
    rosterIds: ["c1"],
    history: [],
    match: null,
  };
  let opened;
  await page.route("**/colonyquest-live/duel-browser", (r) =>
    r.fulfill({
      path: path.join(__dirname, "../../public/colonyquest-live.html"),
      contentType: "text/html",
    }),
  );
  await page.route("**/api/game/duel-browser/colonyquest-live", (r) =>
    r.fulfill({ json: data }),
  );
  await page.route("**/api/game/duel-browser/colonyquest-live/open", (r) => {
    opened = r.request().postDataJSON();
    return r.fulfill({ json: data });
  });
  await page.goto("/colonyquest-live/duel-browser");
  await page.locator("#colonyMode").selectOption("duels");
  await page.locator("#duelMinutes").selectOption("5");
  await page.locator("#duelGameMinutes").selectOption("20");
  await page.locator("#duelTeamMode").selectOption("gender");
  await expect(
    page.getByRole("link", { name: "Test a duel against the computer" }),
  ).toHaveAttribute("href", /duels=1&minutes=5/);
  await page.locator("#open").click();
  await expect
    .poll(() => opened)
    .toMatchObject({
      duels: true,
      duelMinutes: 5,
      gameMinutes: 20,
      teamMode: "gender",
      rosterIds: ["c1"],
    });
});

test("teacher can skip the opening story straight into the duel announcement", async ({
  page,
}) => {
  const m = new ColonyMatch(game, { duels: true, now: Date.now() });
  m.join({ studentId: "a", name: "Mia" }, Date.now());
  m.join({ studentId: "b", name: "Leo" }, Date.now());
  m.start(Date.now());
  const data = () => ({
    title: "Habitats",
    classes: [],
    rosterIds: [],
    history: [],
    attendance: [],
    match: m.snapshot(null, true, Date.now()),
  });
  await page.route("**/colonyquest-live/duel-browser", (r) =>
    r.fulfill({
      path: path.join(__dirname, "../../public/colonyquest-live.html"),
      contentType: "text/html",
    }),
  );
  await page.route("**/api/game/duel-browser/colonyquest-live", (r) =>
    r.fulfill({ json: data() }),
  );
  await page.route(
    "**/api/game/duel-browser/colonyquest-live/skipStory",
    (r) => {
      m.skipStory(Date.now());
      return r.fulfill({ json: data() });
    },
  );
  await page.goto("/colonyquest-live/duel-browser");
  await expect(page.locator("#skipStory")).toBeVisible();
  await page.locator("#skipStory").click();
  await expect(page.locator("#skipStory")).toBeHidden();
  await expect(page.locator(".colony-duel-announcement")).toContainText(
    "Meet your colony rival!",
  );
  expect(m.state.story).toBeNull();
});

test("every learner and teacher receives all duel winners before the next match", async ({
  page,
}) => {
  const m = new ColonyMatch(game, {
    duels: true,
    storyEnabled: false,
    now: Date.now(),
  });
  for (const name of ["Mia", "Leo", "Ava", "Noah"])
    m.join({ studentId: name, name }, Date.now());
  m.start(Date.now() - 5001);
  m.tick(Date.now());
  for (const p of m.active()) {
    p.phase = "duelWait";
    p.duelHold = { phase: "answer", remaining: 25000 };
  }
  m.state.duels.stage = "closing";
  m.state.duels.pairs.forEach((pair, i) => {
    m.player(pair.ids[0]).colony.food = 90 + i;
  });
  m.tick(Date.now());
  const results = m.state.duels.history.at(-1).results;
  expect(results.length).toBe(2);
  const learner = m.active()[0];
  await page.route("**/colonyquest-live-play/duel-browser", (r) =>
    r.fulfill({
      path: path.join(__dirname, "../../public/colonyquest-live.html"),
      contentType: "text/html",
    }),
  );
  await page.route("**/api/game/duel-browser/colonyquest-live/ticket", (r) =>
    r.fulfill({ json: { token: "sample" } }),
  );
  await page.routeWebSocket("**/ws/colonyquest-live", (ws) =>
    ws.onMessage((raw) => {
      if (JSON.parse(raw).type === "auth")
        ws.send(
          JSON.stringify({
            type: "state",
            state: m.snapshot(learner.id, false, Date.now()),
          }),
        );
    }),
  );
  await page.goto("/colonyquest-live-play/duel-browser");
  await expect(page.locator(".duel-results-grid article")).toHaveCount(2);
  for (const result of results) {
    await expect(page.locator(".duel-results-grid")).toContainText(
      result.names[result.ids.indexOf(result.winner)] + " won!",
    );
  }
  await expect(page.locator("[data-game-clock]")).toContainText("Game 15:");
  await page.route("**/colonyquest-live/duel-browser", (r) =>
    r.fulfill({
      path: path.join(__dirname, "../../public/colonyquest-live.html"),
      contentType: "text/html",
    }),
  );
  await page.route("**/api/game/duel-browser/colonyquest-live", (r) =>
    r.fulfill({
      json: {
        title: "Habitats",
        classes: [],
        rosterIds: [],
        history: [],
        attendance: [],
        match: m.snapshot(null, true, Date.now()),
      },
    }),
  );
  await page.goto("/colonyquest-live/duel-browser");
  await expect(page.locator(".duel-results-grid article")).toHaveCount(2);
});

test("class music stays on the teacher computer and learner upgrades use smartboard voice clips", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.audioPlays = [];
    HTMLMediaElement.prototype.play = function () {
      window.audioPlays.push(this.src);
      return Promise.resolve();
    };
  });
  const m = new ColonyMatch(game, {
      duels: true,
      storyEnabled: false,
      now: Date.now(),
    }),
    learner = m.join({ studentId: "a", name: "Mia" }, Date.now());
  m.join({ studentId: "b", name: "Leo" }, Date.now());
  m.start(Date.now() - 5001);
  m.tick(Date.now());
  let peer;
  await page.route("**/colonyquest-live-play/duel-browser", (r) =>
    r.fulfill({
      path: path.join(__dirname, "../../public/colonyquest-live.html"),
      contentType: "text/html",
    }),
  );
  await page.route("**/api/game/duel-browser/colonyquest-live/ticket", (r) =>
    r.fulfill({ json: { token: "sample" } }),
  );
  await page.routeWebSocket("**/ws/colonyquest-live", (ws) => {
    peer = ws;
    ws.onMessage((raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === "auth") {
        ws.send(
          JSON.stringify({
            type: "state",
            state: m.snapshot(learner.id, false, Date.now()),
          }),
        );
        return;
      }
      if (msg.type === "answer")
        m.answer(learner.id, msg.round, msg.choice, Date.now());
      if (msg.type === "upgrade")
        m.upgrade(learner.id, msg.round, msg.key, msg.target, Date.now());
      if (["answer", "upgrade"].includes(msg.type)) {
        ws.send(
          JSON.stringify({
            type: "ack",
            commandId: msg.commandId,
            accepted: true,
          }),
        );
        ws.send(
          JSON.stringify({
            type: "state",
            state: m.snapshot(learner.id, false, Date.now()),
          }),
        );
      }
    });
  });
  await page.goto("/colonyquest-live-play/duel-browser");
  await expect(page.locator("#sound")).toHaveText("Effects on");
  await page.locator('#choices [data-choice="0"]').click();
  const food = m.options(learner).findIndex((o) => o.key === "food");
  await page.locator('#choices [data-upgrade="' + food + '"]').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.audioPlays.some((src) => src.endsWith("/action-food.mp3")),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      window.audioPlays.some(
        (src) => src.includes("/music/") || src.includes("celebration.wav"),
      ),
    ),
  ).toBe(false);
  const running = JSON.parse(JSON.stringify(m.state));
  m.end(Date.now());
  peer.send(
    JSON.stringify({
      type: "state",
      state: m.snapshot(learner.id, false, Date.now()),
    }),
  );
  await expect(page.locator(".cq-celebration")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.audioPlays.some(
        (src) => src.includes("/music/") || src.includes("celebration.wav"),
      ),
    ),
  ).toBe(false);
  await page.route("**/colonyquest-live/duel-browser", (r) =>
    r.fulfill({
      path: path.join(__dirname, "../../public/colonyquest-live.html"),
      contentType: "text/html",
    }),
  );
  const hostMatch = new ColonyMatch(game, { state: running });
  const hostData = () => ({
    title: "Habitats",
    classes: [],
    rosterIds: [],
    history: [],
    attendance: [],
    match: hostMatch.snapshot(null, true, Date.now()),
  });
  await page.route("**/api/game/duel-browser/colonyquest-live", (r) =>
    r.fulfill({ json: hostData() }),
  );
  await page.goto("/colonyquest-live/duel-browser");
  await page.locator("#sound").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.audioPlays.some((src) => src.includes("/music/")),
      ),
    )
    .toBe(true);
  hostMatch.end(Date.now());
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.audioPlays.some((src) => src.endsWith("/celebration.wav")),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      window.audioPlays.some((src) => src.includes("/action-")),
    ),
  ).toBe(false);
});
