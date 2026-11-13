const fs = require("node:fs");
const crypto = require("node:crypto");
const { writeJsonAtomic } = require("./storage");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
function fingerprint(body) {
  const { background, generationRequestId, ...input } = body;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(input)))
    .digest("hex");
}
function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

// Durable receipts for long-running slide requests. The lesson input is never
// written here. Reconnecting to a receipt must not spend credits or file a week twice.
function createSlideGenerationJobs({
  file,
  now = Date.now,
  log = console.error,
}) {
  const ttl = 24 * 60 * 60 * 1000;
  let jobs = [];
  try {
    jobs = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      log("Could not restore slide generation receipts:", error.message);
  }
  jobs = (Array.isArray(jobs) ? jobs : []).filter(
    (job) => job && now() - job.createdAt < ttl,
  );
  for (const job of jobs) {
    if (job.status === "running")
      Object.assign(job, {
        status: "failed",
        httpStatus: 503,
        result: {
          error:
            "Slide generation was interrupted by a server restart. Your lesson plan is unchanged. Please try again.",
          code: "generation_interrupted",
        },
      });
  }
  const save = () => writeJsonAtomic(file, jobs);
  if (jobs.length) save();
  const view = (job) => ({
    jobId: job.id,
    status: job.status,
    ...(job.status === "running"
      ? { pollAfterMs: 2000 }
      : { httpStatus: job.httpStatus, result: job.result }),
  });
  function start(ownerId, body, run) {
    const key = body.generationRequestId;
    if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
      throw failure(400, "Please refresh the page before creating slides.");
    jobs = jobs.filter(
      (job) => now() - job.createdAt < ttl || job.status === "running",
    );
    const hash = fingerprint(body);
    let existing = jobs.find(
      (job) =>
        job.ownerId === ownerId &&
        (job.key === key || job.aliases?.includes(key)),
    );
    if (existing && existing.fingerprint !== hash)
      throw failure(
        409,
        "This generation request belongs to a different lesson. Please try again.",
      );
    existing ||= jobs.find(
      (job) =>
        job.ownerId === ownerId &&
        job.fingerprint === hash &&
        job.status === "running",
    );
    if (existing) {
      if (existing.key !== key && !existing.aliases?.includes(key)) {
        existing.aliases = [...(existing.aliases || []), key];
        save();
      }
      return view(existing);
    }
    if (
      jobs.filter((job) => job.ownerId === ownerId && job.status === "running")
        .length >= 2
    )
      throw failure(
        429,
        "Two slide decks are already being prepared. Wait for one to finish before starting another.",
      );
    const job = {
      id: crypto.randomUUID(),
      ownerId,
      key,
      fingerprint: hash,
      createdAt: now(),
      status: "running",
    };
    jobs.push(job);
    try {
      save();
    } catch (error) {
      jobs = jobs.filter((item) => item !== job);
      throw error;
    }
    Promise.resolve()
      .then(run)
      .then((reply) => {
        if (!reply || !Number.isInteger(reply.httpStatus) || !reply.result)
          throw new Error("The slide generator returned no result.");
        Object.assign(job, reply, {
          status:
            reply.httpStatus >= 200 && reply.httpStatus < 300
              ? "completed"
              : "failed",
        });
      })
      .catch((error) => {
        log("Background slide generation failed:", error.message);
        Object.assign(job, {
          status: "failed",
          httpStatus: 500,
          result: {
            error:
              "Slides could not be prepared. Your lesson plan is unchanged. Please try again.",
          },
        });
      })
      .finally(() => {
        try {
          save();
        } catch (error) {
          log("Slide generation receipt could not be saved:", error.message);
        }
      });
    return view(job);
  }
  return {
    start,
    get(ownerId, id) {
      const job = jobs.find(
        (item) =>
          item.id === id &&
          item.ownerId === ownerId &&
          now() - item.createdAt < ttl,
      );
      return job ? view(job) : null;
    },
  };
}
module.exports = { createSlideGenerationJobs };
