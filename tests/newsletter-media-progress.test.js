const { test } = require("node:test"),
  assert = require("node:assert/strict");
const sharp = require("sharp");
const { normalise } = require("../newsletter-media");
const { rows, csv } = require("../newsletter-progress");
test("media accepts bounded decoded images and safe links and strips metadata", async () => {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#47a" },
  })
    .png()
    .toBuffer();
  const result = await normalise({
    links: [{ label: "Learn", url: "https://example.com" }],
    images: [
      {
        data: "data:image/png;base64," + png.toString("base64"),
        caption: "Class diagram",
      },
    ],
  });
  assert.match(result.images[0].data, /^data:image\/jpeg/);
  assert.equal(result.images[0].caption, "Class diagram");
  await assert.rejects(normalise({ links: [{ url: "javascript:alert(1)" }] }));
  await assert.rejects(
    normalise({ images: [{ data: "data:image/png;base64,YWJj" }] }),
  );
  await assert.rejects(normalise({ images: new Array(4).fill({}) }));
});
test("progress respects class assignments and distinguishes submitter from owner", () => {
  const w = {
    members: [
      {
        name: "Teacher A",
        role: "teacher",
        subjects: ["ICT"],
        classes: ["3B2"],
      },
      {
        name: "Teacher B",
        role: "teacher",
        subjects: ["ICT"],
        classes: ["3B4"],
      },
    ],
    reports: [
      {
        id: "a",
        className: "3B2",
        week: "Week 10",
        deadline: "2020-01-01",
        entries: [
          {
            subject: "ICT",
            submitted: true,
            submittedBy: "Coordinator",
            reviewed: false,
          },
          { subject: "Maths", submitted: false },
        ],
      },
    ],
  };
  assert.equal(rows(w, { type: "submitted" })[0].teachers, "Teacher A");
  assert.equal(rows(w, { type: "submitted" })[0].submittedBy, "Coordinator");
  assert.equal(rows(w, { type: "missing" }).length, 1);
  assert.equal(rows(w, { type: "unassigned" }).length, 1);
  assert.equal(rows(w, { type: "overdue" }).length, 2);
  assert.equal(rows(w, { className: "3B4" }).length, 0);
  assert.match(csv([{ week: "=1+1" }]), /'=1\+1/);
});

test("coordinator reports enforce role checks and media snapshots store immutable image references", async (t) => {
  const fs = require("fs"),
    os = require("os"),
    path = require("path"),
    express = require("express");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "news-media-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = require("../school-newsletters").createStore(dir),
    owner = {
      id: "owner",
      name: "Coordinator",
      email: "owner@example.test",
      role: "teacher",
    },
    teacher = {
      id: "teacher",
      name: "Teacher",
      email: "teacher@example.test",
      role: "teacher",
    };
  let w = store.create(owner, { name: "School" });
  w = store.change(owner, w.id, w.revision, "create-report", {
    className: "3B2",
    week: "Week 1",
    subjects: ["ICT"],
  });
  const reportId = w.reports[0].id;
  const invite = store.invite(owner, w.id, w.revision, {
    email: teacher.email,
    subjects: ["ICT"],
    role: "teacher",
  });
  store.accept(teacher, invite.token);
  w = store.view(store.read(w.id), owner);
  let acting = teacher;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  require("../school-newsletter-routes").register(app, {
    requireAuth: (req, res, next) => {
      req.user = acting;
      next();
    },
    upload: { single: () => (req, res, next) => next() },
    requireUploads: () => (req, res, next) => next(),
    generationLimiter: (req, res, next) => next(),
    uploadLimiter: (req, res, next) => next(),
    newsStore: store,
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const url =
    "http://127.0.0.1:" +
    server.address().port +
    "/api/school-newsletters/" +
    w.id;
  assert.equal((await fetch(url + "/progress-report")).status, 403);
  acting = owner;
  assert.equal((await fetch(url + "/progress-report?format=csv")).status, 200);
  const png = await sharp({
    create: { width: 30, height: 20, channels: 3, background: "#0b8" },
  })
    .png()
    .toBuffer();
  let response = await fetch(url + "/change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: w.revision,
      reportId,
      action: "media",
      subject: "ICT",
      links: [{ url: "https://example.com", label: "Example" }],
      images: [
        {
          data: "data:image/png;base64," + png.toString("base64"),
          caption: "Diagram",
        },
      ],
    }),
  });
  assert.equal(response.status, 200);
  w = await response.json();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, w.id + ".json")));
  assert.ok(saved.reports[0].entries[0].images[0].assetId);
  assert.equal(saved.reports[0].entries[0].images[0].data, undefined);
  assert.match(
    store.read(w.id).reports[0].entries[0].images[0].data,
    /^data:image\/jpeg/,
  );
  response = await fetch(url + "/change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: w.revision,
      reportId,
      action: "media",
      subject: "ICT",
      links: [{ url: "javascript:alert(1)" }],
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(store.read(w.id).revision, w.revision);
});
