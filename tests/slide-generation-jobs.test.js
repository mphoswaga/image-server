const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createSlideGenerationJobs } = require("../slide-generation-jobs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-slide-jobs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "jobs.json");
  return { file, jobs: createSlideGenerationJobs({ file, log: () => {} }) };
}
const body = {
  generationRequestId: "request_1234567890",
  subject: "ICT",
  topic: "Data",
  lessonPlan: { sections: [{ heading: "Teach", content: "Explain fields." }] },
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("a slow job returns immediately, reconnects once, and exposes results only to its owner", async (t) => {
  const { file, jobs } = fixture(t);
  let finish,
    runs = 0;
  const run = () => {
    runs++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const first = jobs.start("teacher", body, run);
  assert.equal(first.status, "running");
  assert.equal(jobs.get("other", first.jobId), null);
  await tick();
  assert.equal(runs, 1);
  assert.equal(jobs.start("teacher", body, run).jobId, first.jobId);
  const alias = { ...body, generationRequestId: "another_1234567890" };
  assert.equal(jobs.start("teacher", alias, run).jobId, first.jobId);
  assert.throws(
    () => jobs.start("teacher", { ...body, topic: "Fractions" }, run),
    (e) => e.status === 409,
  );
  finish({
    httpStatus: 200,
    result: { deckId: "finished-deck", weekPlanner: { ok: true } },
  });
  await tick();
  assert.equal(jobs.get("teacher", first.jobId).result.deckId, "finished-deck");
  const restored = createSlideGenerationJobs({ file });
  assert.equal(
    restored.start("teacher", alias, run).result.deckId,
    "finished-deck",
  );
  assert.equal(runs, 1);
  assert.ok(!fs.readFileSync(file, "utf8").includes("Explain fields."));
});
test("restart reports interrupted work without silently rerunning a paid operation", async (t) => {
  const { file, jobs } = fixture(t);
  const started = jobs.start("teacher", body, () => new Promise(() => {}));
  await tick();
  const restored = createSlideGenerationJobs({ file });
  let runs = 0;
  const reply = restored.start("teacher", body, () => {
    runs++;
  });
  assert.equal(reply.status, "failed");
  assert.equal(reply.httpStatus, 503);
  assert.equal(reply.result.code, "generation_interrupted");
  assert.equal(runs, 0);
  assert.equal(restored.get("teacher", started.jobId).status, "failed");
});
test("validation and credit failures retain their original status and do not rerun", async (t) => {
  const { jobs } = fixture(t);
  let calls = 0;
  const first = jobs.start("teacher", body, async () => {
    calls++;
    return {
      httpStatus: 402,
      result: { needCredits: true, error: "Insufficient credits" },
    };
  });
  await tick();
  const retry = jobs.start("teacher", body, async () => {
    calls++;
  });
  assert.equal(retry.httpStatus, 402);
  assert.equal(retry.result.needCredits, true);
  assert.equal(calls, 1);
  assert.equal(first.jobId, retry.jobId);
});
test("a server error finishes the receipt and permits an explicit new attempt", async (t) => {
  const { jobs } = fixture(t);
  const first = jobs.start("teacher", body, async () => {
    throw Error("internal failure");
  });
  await tick();
  assert.equal(jobs.get("teacher", first.jobId).status, "failed");
  assert.doesNotMatch(
    jobs.get("teacher", first.jobId).result.error,
    /internal failure/,
  );
  const next = jobs.start(
    "teacher",
    { ...body, generationRequestId: "new_request_1234567890" },
    async () => ({ httpStatus: 200, result: { deckId: "new" } }),
  );
  await tick();
  assert.notEqual(next.jobId, first.jobId);
  assert.equal(jobs.get("teacher", next.jobId).status, "completed");
});
