const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { createStore, count } = require("../school-newsletters");
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "newsletters-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir),
    owner = {
      id: "coordinator",
      email: "coordinator@school.test",
      name: "Coordinator",
      role: "teacher",
    };
  let w = store.create(owner, { name: "School" });
  w = store.change(owner, w.id, w.revision, "create-report", {
    className: "3B2",
    week: "Week 9",
    subjects: ["ICT", "Maths"],
  });
  return { store, owner, w };
}
test("isolated workspace, email-specific invitation and subject permissions", (t) => {
  const { store, owner, w } = setup(t);
  const teacher = { id: "teacher", email: "ict@school.test", role: "teacher" },
    other = { id: "other", email: "other@school.test", role: "teacher" };
  const invited = store.invite(owner, w.id, w.revision, {
    email: teacher.email,
    role: "teacher",
    subjects: ["ICT"],
  });
  assert.throws(() => store.accept(other, invited.token), /email/);
  const joined = store.accept(teacher, invited.token);
  assert.equal(joined.myRole, "teacher");
  assert.equal(joined.invites, undefined);
  assert.throws(() => store.view(store.read(w.id), other), /access/);
  assert.throws(
    () =>
      store.change(teacher, w.id, joined.revision, "english", {
        reportId: w.reports[0].id,
        subject: "Maths",
        text: "Hi",
      }),
    /assigned/,
  );
  assert.throws(
    () =>
      store.change(teacher, w.id, joined.revision, "settings", {
        minimum: 0,
        vietnameseMinimum: 0,
      }),
    /coordinator/,
  );
  assert.throws(
    () => store.list({ id: "student", role: "student" }),
    /Teacher/,
  );
});
test("minimum enforced at submission, stale saves rejected, changes invalidate translation and approval", (t) => {
  const { store, owner } = setup(t);
  let w = store.list(owner)[0];
  w = store.view(store.read(w.id), owner);
  const id = w.id,
    reportId = w.reports[0].id;
  const change = (action, b) =>
    (w = store.change(owner, id, w.revision, action, { reportId, ...b }));
  change("settings", { minimum: 10, vietnameseMinimum: 5, example: "Example" });
  assert.throws(
    () => change("english", { subject: "ICT", text: "tiny", submit: true }),
    /minimum/,
  );
  change("english", { subject: "ICT", text: "tiny" });
  assert.equal(w.reports[0].entries[0].submitted, false);
  assert.throws(
    () =>
      store.change(owner, id, 1, "english", {
        reportId,
        subject: "ICT",
        text: "overwrite",
      }),
    /Reload/,
  );
  for (const subject of ["ICT", "Maths"]) {
    change("english", {
      subject,
      text: "Enough content for parents.",
      submit: true,
    });
    change("vietnamese", { subject, text: "Nội dung học tập.", review: true });
  }
  change("approve", {});
  assert.ok(w.reports[0].approved);
  change("english", {
    subject: "ICT",
    text: "Updated content for parents.",
    submit: true,
  });
  assert.equal(w.reports[0].approved, null);
  assert.equal(w.reports[0].entries[0].reviewed, false);
  assert.ok(w.reports[0].history.some((h) => h.approved));
  assert.equal(count("  a b 😀  "), 5);
});
test("regeneration is preview-only, stale previews cannot apply, restore retains history", (t) => {
  const { store, owner } = setup(t);
  let w = store.view(store.read(store.list(owner)[0].id), owner);
  const id = w.id,
    reportId = w.reports[0].id;
  w = store.change(owner, id, w.revision, "english", {
    reportId,
    subject: "ICT",
    text: "Original",
  });
  w = store.preview(owner, id, w.revision, reportId, [
    { subject: "ICT", english: "Reformatted" },
  ]);
  assert.equal(w.reports[0].entries[0].english, "Original");
  w = store.change(owner, id, w.revision, "apply-preview", { reportId });
  assert.equal(w.reports[0].entries[0].english, "Reformatted");
  w = store.change(owner, id, w.revision, "restore", {
    reportId,
    index: w.reports[0].history.length - 1,
  });
  assert.equal(w.reports[0].entries[0].english, "Original");
  w = store.preview(owner, id, w.revision, reportId, [
    { subject: "ICT", english: "New" },
  ]);
  w = store.change(owner, id, w.revision, "english", {
    reportId,
    subject: "Maths",
    text: "Another teacher saved",
  });
  assert.throws(
    () => store.change(owner, id, w.revision, "apply-preview", { reportId }),
    /out of date/,
  );
});
test("translator can review but cannot change English, revoked membership is enforced", (t) => {
  const { store, owner, w } = setup(t);
  const teacher = {
    id: "translator",
    email: "ta@school.test",
    role: "teacher",
  };
  const invite = store.invite(owner, w.id, w.revision, {
    email: teacher.email,
    role: "translator",
  });
  let joined = store.accept(teacher, invite.token);
  assert.throws(
    () =>
      store.change(teacher, w.id, joined.revision, "english", {
        reportId: w.reports[0].id,
        subject: "ICT",
        text: "No",
      }),
    /assigned/,
  );
  joined = store.change(owner, w.id, joined.revision, "remove-member", {
    userId: teacher.id,
  });
  assert.throws(() => store.member(store.read(w.id), teacher), /access/);
  assert.equal(store.list(teacher).length, 0);
});
test("AI reformat API validates every subject, preserves source, and requires explicit apply", async (t) => {
  const express = require("express");
  const { register } = require("../school-newsletter-routes");
  const { store, owner, w: initial } = setup(t);
  let w = initial;
  const reportId = w.reports[0].id;
  for (const subject of ["ICT", "Maths"])
    w = store.change(owner, w.id, w.revision, "english", {
      reportId,
      subject,
      text: "Original " + subject,
    });
  let response = {
      entries: [
        { subject: "ICT", english: "Reformatted ICT" },
        { subject: "Maths", english: "Reformatted Maths" },
      ],
    },
    prompt;
  const app = express();
  app.use(express.json());
  const pass = (_q, _r, n) => n();
  register(app, {
    newsStore: store,
    ai: () => ({
      chat: {
        completions: {
          create: async (p) => {
            prompt = p;
            return {
              choices: [{ message: { content: JSON.stringify(response) } }],
            };
          },
        },
      },
    }),
    requireAuth: (q, r, n) => {
      q.user = q.headers["x-test-outsider"]
        ? { ...owner, id: "outsider" }
        : owner;
      n();
    },
    upload: { single: () => pass },
    requireUploads: () => pass,
    generationLimiter: pass,
    uploadLimiter: pass,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = async (body) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api/school-newsletters/${w.id}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId,
          revision: w.revision,
          mode: "reformat",
          subjects: ["ICT", "Maths"],
          ...body,
        }),
      },
    );
    return { status: r.status, body: await r.json() };
  };
  const pdfEndpoint = `http://127.0.0.1:${server.address().port}/api/school-newsletters/${w.id}/reports/${reportId}/pdf`;
  const privatePdf = await fetch(pdfEndpoint, {
    headers: { "x-test-outsider": "1" },
  });
  assert.equal(privatePdf.status, 403);
  const allowedPdf = await fetch(pdfEndpoint);
  assert.equal(allowedPdf.status, 200);
  assert.match(allowedPdf.headers.get("content-type"), /application\/pdf/);
  assert.equal(
    Buffer.from(await allowedPdf.arrayBuffer())
      .subarray(0, 4)
      .toString(),
    "%PDF",
  );
  const generated = await post();
  assert.equal(generated.status, 200);
  assert.equal(store.read(w.id).reports[0].entries[0].english, "Original ICT");
  assert.match(prompt.messages[0].content, /Never transfer facts/);
  w = generated.body;
  w = store.change(owner, w.id, w.revision, "apply-preview", { reportId });
  assert.equal(w.reports[0].entries[0].english, "Reformatted ICT");
  response = { entries: [{ subject: "ICT", english: "Missing Maths" }] };
  assert.equal((await post()).status, 400);
  assert.equal(
    store.read(w.id).reports[0].entries[0].english,
    "Reformatted ICT",
  );
});

test("demos are private per teacher, resettable and cannot invite real staff", (t) => {
  const { store, owner, w } = setup(t);
  let demo = store.demo(owner);
  const other = {
    id: "another",
    email: "another@school.test",
    role: "teacher",
  };
  assert.equal(demo.demo, true);
  assert.equal(demo.reports[0].entries.length, 3);
  assert.equal(store.demo(owner).id, demo.id);
  assert.notEqual(store.demo(other).id, demo.id);
  assert.throws(() => store.view(store.read(demo.id), other), /access/);
  assert.throws(
    () =>
      store.invite(owner, demo.id, demo.revision, {
        email: other.email,
        role: "translator",
      }),
    /cannot invite/,
  );
  const reportId = demo.reports[0].id;
  demo = store.change(owner, demo.id, demo.revision, "english", {
    reportId,
    subject: "ICT",
    text: "Demo edit",
  });
  assert.equal(store.read(w.id).reports[0].entries[0].english, "");
  demo = store.change(owner, demo.id, demo.revision, "reset-demo", {});
  assert.match(demo.reports[0].entries[0].english, /file types/);
  assert.throws(
    () => store.change(owner, w.id, w.revision, "reset-demo", {}),
    /Only the demo/,
  );
});

test("downloadable PDF preserves Vietnamese, all subjects and demo label", async () => {
  const { newsletterPdf } = require("../school-newsletter-pdf");
  const { demoReport } = require("../school-newsletter-demo");
  const { PDFParse } = require("pdf-parse");
  const bytes = await newsletterPdf(
    { name: "Sample school", demo: true },
    demoReport(),
  );
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  assert.match(bytes.toString("latin1"), /\/Subtype \/Image/);
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    assert.match(result.text, /DEMO/);
    assert.match(result.text, /Tiếng Việt/);
    assert.match(result.text, /Maths/);
    assert.match(result.text, /Science/);
    assert.match(result.text, /các con sẽ/);
    assert.ok(result.pages.length >= 2);
  } finally {
    await parser.destroy();
  }
});

test("school design embeds logo and keeps long bilingual contributions through page breaks", async () => {
  const { newsletterPdf } = require("../school-newsletter-pdf");
  const { PDFParse } = require("pdf-parse");
  const bytes = await newsletterPdf(
    { name: "School", settings: { design: "vinschool" } },
    {
      className: "3B2",
      week: "Week 8",
      approved: null,
      entries: [
        {
          subject: "ICT",
          english: "Learn safely. ".repeat(350) + "FINAL ENGLISH",
          vietnamese: "Tiếng Việt — cuối bài.",
        },
      ],
    },
  );
  assert.match(bytes.toString("latin1"), /\/Subtype \/Image/);
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    assert.match(result.text, /Cambridge Program/);
    assert.match(result.text, /FINAL ENGLISH/);
    assert.match(result.text, /cuối bài/);
    assert.match(result.text, /DRAFT/);
    assert.ok(result.pages.length > 1);
  } finally {
    await parser.destroy();
  }
});

test("parent publication is an approved snapshot, stays private until republished and can be revoked", (t) => {
  const { store, owner } = setup(t);
  let w = store.list(owner)[0];
  w = store.view(store.read(w.id), owner);
  const id = w.id,
    rid = w.reports[0].id;
  const change = (action, extra = {}) =>
    (w = store.change(owner, id, w.revision, action, {
      reportId: rid,
      ...extra,
    }));
  assert.throws(() => change("publish"), /Approve/);
  for (const subject of ["ICT", "Maths"]) {
    change("english", { subject, text: "Approved English", submit: true });
    change("vietnamese", {
      subject,
      text: "Tiếng Việt đã duyệt",
      review: true,
    });
  }
  change("approve");
  change("publish");
  const token = w.reports[0].publication.token;
  let p = store.published(id, rid, token);
  assert.equal(p.entries[0].english, "Approved English");
  assert.equal(p.history, undefined);
  assert.equal(p.members, undefined);
  assert.equal(p.token, undefined);
  assert.throws(() => store.published(id, rid, "0".repeat(64)), /unavailable/);
  change("english", { subject: "ICT", text: "Private edit", submit: true });
  assert.equal(
    store.published(id, rid, token).entries[0].english,
    "Approved English",
  );
  assert.throws(() => change("publish"), /Approve/);
  change("vietnamese", { subject: "ICT", text: "Bản cập nhật", review: true });
  change("approve");
  change("publish");
  assert.equal(w.reports[0].publication.token, token);
  assert.equal(
    store.published(id, rid, token).entries[0].english,
    "Private edit",
  );
  change("revoke-publication");
  assert.throws(() => store.published(id, rid, token), /unavailable/);
  change("publish");
  assert.notEqual(w.reports[0].publication.token, token);
});
