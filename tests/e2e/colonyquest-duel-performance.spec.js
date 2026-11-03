const { test, expect } = require("@playwright/test");
test("two large duel habitats bound pixels and idle drawing while keeping raid animation and game clocks", async ({
  page,
}, info) => {
  await page.goto("/healthz");
  await page.setContent(
    '<style>body{margin:0;display:flex}canvas{width:50vw;height:70vh;display:block}</style><canvas id="own"></canvas><canvas id="rival"></canvas>',
  );
  for (const script of [
    "colonyquest-core",
    "colony-presentation",
    "colony-habitat-layout",
    "colonyquest-live-art",
  ])
    await page.addScriptTag({ url: "/" + script + ".js" });
  await page.evaluate(() => {
    window.scenes = ["own", "rival"].map((id, i) => {
      const c = ColonyQuestCore.createTeam({ id, name: id }, i);
      Object.assign(c, {
        expansionRooms: 16,
        pantryBuilt: true,
        barracksBuilt: true,
        workers: 24,
        soldiers: 8,
        food: 40,
        defense: 3,
      });
      const scene = new ColonyScene(document.getElementById(id));
      scene.isRival = i === 1;
      scene.update({
        id: "perf",
        phase: "answer",
        pacing: "individual",
        duel: { round: 1 },
        world: {},
        players: [],
        events: [],
        me: { id, name: id, colony: c },
      });
      return scene;
    });
  });
  await page.waitForTimeout(700);
  const result = await page.evaluate(() =>
    scenes.map((scene) => {
      cancelAnimationFrame(scene.raf);
      const start = scene.last + 100;
      scene.last = start;
      scene.lastPaint = start;
      scene.clock = 0;
      scene.effects = [];
      const before = scene.frameCount,
        builds = scene.backgroundBuilds;
      for (let i = 1; i <= 60; i++) {
        scene.draw(start + (i * 1000) / 60);
        cancelAnimationFrame(scene.raf);
      }
      return {
        frames: scene.frameCount - before,
        clock: scene.clock,
        pixels: scene.canvas.width * scene.canvas.height,
        cssPixels: scene.canvas.clientWidth * scene.canvas.clientHeight,
        cacheStable: builds === scene.backgroundBuilds,
        quality: scene.canvas.dataset.renderQuality,
        spritePixels: scene.spritePixels,
      };
    }),
  );
  expect(result[0].frames).toBeGreaterThanOrEqual(28);
  expect(result[0].frames).toBeLessThanOrEqual(31);
  expect(result[1].frames).toBeGreaterThanOrEqual(18);
  expect(result[1].frames).toBeLessThanOrEqual(21);
  for (const r of result) {
    expect(r.clock).toBeGreaterThan(930);
    expect(r.pixels).toBeLessThanOrEqual(r.cssPixels * 1.02);
    expect(r.cacheStable).toBe(true);
    expect(r.spritePixels).toBeLessThanOrEqual(4 * 1024 * 1024);
  }
  const raid = await page.evaluate(() => {
    const scene = scenes[1],
      start = scene.last + 100;
    scene.clock = 0;
    scene.effects = [
      {
        kind: "raid",
        start: 0,
        duration: 6800,
        event: {
          attacker: "own",
          target: "rival",
          attackerName: "Own",
          targetName: "Rival",
          success: true,
          stolen: 5,
        },
      },
    ];
    scene.last = start;
    scene.lastPaint = start;
    const before = scene.frameCount;
    for (let i = 1; i <= 60; i++) {
      scene.draw(start + (i * 1000) / 60);
      cancelAnimationFrame(scene.raf);
    }
    return {
      frames: scene.frameCount - before,
      fps: scene.canvas.dataset.targetFps,
      clock: scene.clock,
    };
  });
  expect(raid.fps).toBe("30");
  expect(raid.frames).toBeGreaterThanOrEqual(28);
  expect(raid.clock).toBeGreaterThan(930);
  console.log("Duel rendering budget", JSON.stringify({ idle: result, raid }));
});
