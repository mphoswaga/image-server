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
      teamMode: "gender",
      rosterIds: ["c1"],
    });
});
