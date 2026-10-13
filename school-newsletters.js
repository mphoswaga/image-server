// Shared newsletters contain no roster, assessment or billing data.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DATA_DIR, writeJsonAtomic } = require("./storage");
const count = (value) => [...String(value || "").trim()].length;
const text = (value, max = 30000) =>
  String(value || "")
    .trim()
    .slice(0, max);
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function createStore(dir = path.join(DATA_DIR, "school-newsletters")) {
  const mediaRoot = path.join(dir, "media");
  const filename = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id || "")) fail("Workspace not found.", 404);
    return path.join(dir, id + ".json");
  };
  function read(id) {
    const f = filename(id);
    if (!fs.existsSync(f)) fail("Workspace not found.", 404);
    return require("./newsletter-media").hydrate(
      JSON.parse(fs.readFileSync(f)),
      mediaRoot,
    );
  }
  const all = () =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
          .map((n) => read(n.slice(0, -5)))
      : [];
  function member(w, user) {
    if (!user || user.role === "student")
      fail("Teacher sign-in required.", 403);
    const m = w.members.find((m) => m.userId === user.id);
    if (!m) fail("You do not have access to this newsletter workspace.", 403);
    return m;
  }
  function coordinator(w, user) {
    if (member(w, user).role !== "coordinator")
      fail("Only a coordinator can do this.", 403);
  }
  function publisher(w, user, className) {
    const m = member(w, user);
    if (m.role !== "coordinator" && !(m.role === "translator" && (!m.classes || m.classes.includes(className))))
      fail("Only the assigned TA or coordinator can publish this class newsletter.", 403);
  }
  function view(w, user) {
    const m = member(w, user);
    const copy = require("./newsletter-media").hydrate(w, mediaRoot);
    if (m.role !== "coordinator")
      for (const r of copy.reports)
        if (r.publication && !(m.role === "translator" && (!m.classes || m.classes.includes(r.className)))) delete r.publication.token;
    copy.myRole = m.role;
    copy.mySubjects = m.subjects;
    copy.myClasses = m.classes ?? null;
    if (m.role !== "coordinator") delete copy.classLinks;
    copy.reports.forEach((r) => (r.readiness = readiness(w, r)));
    if (m.role !== "coordinator") delete copy.invites;
    if (m.role !== "coordinator")
      copy.members = copy.members.map(({ name, role, subjects }) => ({
        name,
        role,
        subjects,
      }));
    return copy;
  }
  function save(w) {
    w.revision++;
    w.updatedAt = new Date().toISOString();
    writeJsonAtomic(
      filename(w.id),
      require("./newsletter-media").pack(w, mediaRoot),
    );
    return w;
  }
  function mutate(user, id, revision, fn) {
    const w = read(id);
    member(w, user);
    if (revision !== w.revision)
      fail(
        "Someone updated this workspace. Reload before saving; your text has not been overwritten.",
        409,
      );
    fn(w);
    return view(save(w), user);
  }
  function archive(r, user) {
    r.history.push({
      at: new Date().toISOString(),
      by: user.name || user.email,
      entries: structuredClone(r.entries),
      approved: r.approved || null,
    });
    if (r.history.filter((h) => !h.approved).length > 50)
      r.history.splice(
        r.history.findIndex((h) => !h.approved),
        1,
      );
    r.approved = null;
  }
  function report(w, id) {
    const r = w.reports.find((r) => r.id === id);
    if (!r) fail("Newsletter not found.", 404);
    return r;
  }
  function editable(w, user, subject, translation = false, className) {
    const m = member(w, user);
    if (
      m.role === "coordinator" ||
      ((!m.classes || m.classes.includes(className)) &&
        ((translation && m.role === "translator") ||
          (!translation &&
            m.role === "teacher" &&
            m.subjects.includes(subject))))
    )
      return;
    fail("This subject or review stage is not assigned to you.", 403);
  }
  function readiness(w, r) {
    const issues = [];
    for (const e of r.entries) {
      if (!e.submitted)
        issues.push({ subject: e.subject, message: "Submit English" });
      if (count(e.english) < Math.max(1, w.settings.minimum))
        issues.push({
          subject: e.subject,
          message: "English is below the minimum",
        });
      if (!e.reviewed)
        issues.push({
          subject: e.subject,
          message: "Review Vietnamese against the latest English",
        });
      if (count(e.vietnamese) < Math.max(1, w.settings.vietnameseMinimum))
        issues.push({
          subject: e.subject,
          message: "Vietnamese is below the minimum",
        });
    }
    return {
      issues,
      warnings: !r.sendDate ? ["Choose a sending date"] : [],
      ready: !issues.length,
    };
  }
  function date(value) {
    if (!value) return "";
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      fail("Choose a valid date.");
    return value;
  }
  return {
    read,
    all,
    published(id, reportId, token, edition) {
      if (!/^[a-f0-9]{64}$/.test(token || ""))
        fail("This newsletter link is unavailable.", 404);
      let w;
      try {
        w = read(id);
      } catch {
        fail("This newsletter link is unavailable.", 404);
      }
      const channel = (w.classLinks || []).find((c) => c.id === reportId);
      if (channel) {
        if (
          !channel.token ||
          !crypto.timingSafeEqual(
            Buffer.from(channel.token),
            Buffer.from(token),
          )
        )
          fail("This newsletter link is unavailable.", 404);
        const editions = w.reports
          .filter((r) => r.className === channel.className && r.publication)
          .sort((a, b) =>
            (
              b.publication.content.sendDate ||
              b.publication.content.publishedAt
            ).localeCompare(
              a.publication.content.sendDate ||
                a.publication.content.publishedAt,
            ),
          );
        const selected = edition
          ? editions.find((r) => r.id === edition)
          : editions[0];
        if (!selected) fail("No published newsletter is available.", 404);
        return {
          ...structuredClone(selected.publication.content),
          editionId: selected.id,
          editions: editions.map((r) => ({
            id: r.id,
            week: r.publication.content.week,
            sendDate: r.publication.content.sendDate,
          })),
        };
      }
      const p = w.reports.find((r) => r.id === reportId)?.publication;
      if (
        !p ||
        !p.token ||
        !crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(token))
      )
        fail("This newsletter link is unavailable.", 404);
      return structuredClone(p.content);
    },
    member,
    coordinator,
    editable,
    report,
    view,
    mutate,
    list(user) {
      if (!user || user.role === "student")
        fail("Teacher sign-in required.", 403);
      return all()
        .filter((w) => w.members.some((m) => m.userId === user.id))
        .map((w) => ({
          id: w.id,
          name: w.name,
          role: member(w, user).role,
          demo: !!w.demo,
        }));
    },
    create(user, input, demo = false) {
      if (
        !user ||
        user.role === "student" ||
        (!demo &&
          require("./teacher-access").accessFor(user.id) === "newsletter")
      )
        fail("Ask your coordinator for an invitation.", 403);
      const name = text(input.name, 100);
      if (!name) fail("Enter a school workspace name.");
      const w = {
        id: crypto.randomUUID(),
        name,
        demo,
        revision: 0,
        members: [
          {
            userId: user.id,
            name: user.name || user.email,
            role: "coordinator",
            subjects: [],
          },
        ],
        invites: [],
        settings: {
          example: "",
          minimum: 0,
          vietnameseMinimum: 0,
          design: demo ? "vinschool" : "standard",
        },
        reports: demo ? [require("./school-newsletter-demo").demoReport()] : [],
      };
      return view(save(w), user);
    },
    demo(user) {
      const existing = all().find(
        (w) => w.demo && w.members.some((m) => m.userId === user.id),
      );
      if (existing) {
        let changed = false;
        for (const report of existing.reports) {
          if (report.demoMaterialsVersion || report.approved || report.publication) continue;
          // Enrich older samples once; never overwrite edits, approved snapshots or publications.
          for (const entry of report.entries) {
            const materials = require("./school-newsletter-demo").sampleMaterials(entry.subject);
            if (!entry.links?.length && materials.links) { entry.links = materials.links; entry.submitted = false; entry.reviewed = false; changed = true; }
            if (!entry.images?.length && materials.images) { entry.images = materials.images; entry.submitted = false; entry.reviewed = false; changed = true; }
          }
          report.demoMaterialsVersion = 1;
          changed = true;
        }
        if (changed) { existing.revision++; save(existing); }
      }
      if (existing && !existing.settings.design) {
        existing.settings.design = "vinschool";
        existing.revision++;
        save(existing);
      }
      return existing
        ? view(existing, user)
        : this.create(user, { name: "Sample school · Demo" }, true);
    },
    invite(user, id, revision, input) {
      let invitation;
      const result = this.mutate(user, id, revision, (w) => {
        coordinator(w, user);
        if (w.demo)
          fail(
            "Demo workspaces cannot invite colleagues. Each colleague can open their own demo.",
          );
        const email = text(input.email, 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          fail("Enter a valid email.");
        if (!["teacher", "translator", "coordinator"].includes(input.role))
          fail("Choose a role.");
        const subjects = [
          ...new Set(
            (input.subjects || []).map((s) => text(s, 80)).filter(Boolean),
          ),
        ];
        if (
          subjects.length > 20 ||
          (input.role === "teacher" && !subjects.length)
        )
          fail("Assign at least one subject to this teacher.");
        invitation = {
          token: crypto.randomBytes(24).toString("hex"),
          email,
          role: input.role,
          subjects,
          classes: Array.isArray(input.classes)
            ? [
                ...new Set(
                  input.classes.map((c) => text(c, 80)).filter(Boolean),
                ),
              ]
            : null,
          createdAt: new Date().toISOString(),
        };
        w.invites.push(invitation);
      });
      return { workspace: result, token: invitation.token };
    },
    accept(user, token) {
      if (!user || user.role === "student")
        fail("Teacher sign-in required.", 403);
      const w = all().find((w) => w.invites.some((i) => i.token === token));
      if (!w) fail("Invitation not found.", 404);
      const i = w.invites.find((i) => i.token === token);
      if (i.email !== String(user.email).trim().toLowerCase())
        fail(
          "Sign in with the email address this invitation was sent to.",
          403,
        );
      if (!w.members.some((m) => m.userId === user.id))
        w.members.push({
          userId: user.id,
          name: user.name || user.email,
          role: i.role,
          subjects: i.subjects,
          classes: i.classes ?? null,
        });
      require("./teacher-access").grantNewsletterIfNew(user, i.createdAt);
      w.invites = w.invites.filter((x) => x !== i);
      save(w);
      return view(w, user);
    },
    change(user, id, revision, action, input) {
      return this.mutate(user, id, revision, (w) => {
        if (action === "remind") {
          coordinator(w, user);
          if (
            !Array.isArray(input.targets) ||
            !input.targets.length ||
            input.targets.length > 500
          )
            fail("Select contributions to remind.");
          const entries = input.targets.map((t) => {
            const r = report(w, t.reportId);
            const e = r.entries.find((e) => e.subject === t.subject);
            if (!e) fail("Subject not found.");
            return e;
          });
          for (const e of entries)
            e.reminder = {
              at: new Date().toISOString(),
              by: user.name || user.email,
            };
          return;
        }
        if (action === "reset-demo") {
          coordinator(w, user);
          if (!w.demo) fail("Only the demo can be reset.");
          w.reports = [require("./school-newsletter-demo").demoReport()];
          w.settings = {
            example: "",
            minimum: 0,
            vietnameseMinimum: 0,
            design: "vinschool",
          };
          delete w.preview;
          delete w.classLinks;
          return;
        }
        if (action === "design") {
          coordinator(w, user);
          if (!["standard", "vinschool"].includes(input.design))
            fail("Unknown report design.");
          w.settings.design = input.design;
          return;
        }
        if (action === "settings") {
          coordinator(w, user);
          for (const key of ["minimum", "vietnameseMinimum"])
            if (
              !Number.isInteger(input[key]) ||
              input[key] < 0 ||
              input[key] > 10000
            )
              fail("Character minimum must be between 0 and 10,000.");
          const design = input.design ?? w.settings.design ?? "standard";
          if (!["standard", "vinschool"].includes(design))
            fail("Unknown report design.");
          w.settings = {
            design,
            example: text(input.example, 10000),
            minimum: input.minimum,
            vietnameseMinimum: input.vietnameseMinimum,
          };
          w.reports.forEach((r) => {
            if (r.approved) archive(r, user);
          });
          return;
        }
        if (action === "revoke-invite") {
          coordinator(w, user);
          w.invites = w.invites.filter((i) => i.token !== input.token);
          return;
        }
        if (action === "remove-member") {
          coordinator(w, user);
          if (input.userId === user.id) fail("You cannot remove yourself.");
          w.members = w.members.filter((m) => m.userId !== input.userId);
          return;
        }
        if (action === "create-report") {
          coordinator(w, user);
          const className = text(input.className, 80),
            week = text(input.week, 80);
          const subjects = [
            ...new Set(
              (input.subjects || []).map((s) => text(s, 80)).filter(Boolean),
            ),
          ];
          if (!className || !week || !subjects.length || subjects.length > 20)
            fail("Enter a class, week and 1–20 subjects.");
          if (
            w.reports.some((r) => r.className === className && r.week === week)
          )
            fail("That class and week already exist.");
          w.reports.push({
            id: crypto.randomUUID(),
            className,
            week,
            sendDate: date(input.sendDate),
            entries: subjects.map((subject) => ({
              subject,
              english: "",
              vietnamese: "",
              submitted: false,
              reviewed: false,
            })),
            history: [],
            approved: null,
          });
          return;
        }
        if (action === "assignment") {
          coordinator(w, user);
          const m = w.members.find((m) => m.userId === input.userId);
          if (!m || m.role === "coordinator")
            fail("Choose a teacher or translator.");
          if (
            input.classes !== null &&
            (!Array.isArray(input.classes) || !input.classes.length)
          )
            fail("Choose classes or all classes.");
          m.classes =
            input.classes === null
              ? null
              : [...new Set(input.classes.map((c) => text(c, 80)))];
          return;
        }
        if (action === "next-week") {
          coordinator(w, user);
          const week = text(input.week, 80),
            ids = [...new Set(input.reportIds || [])];
          if (!week || !ids.length)
            fail("Choose source classes and enter the new week.");
          const sources = ids.map((id) => report(w, id));
          if (new Set(sources.map((r) => r.className)).size !== sources.length)
            fail("Choose one source per class.");
          if (
            sources.some((r) =>
              w.reports.some(
                (x) => x.className === r.className && x.week === week,
              ),
            )
          )
            fail("That week already exists for a selected class.");
          const sendDate = date(input.sendDate),
            deadline = date(input.deadline);
          if (deadline && sendDate && deadline > sendDate)
            fail("Deadline must not follow the sending date.");
          for (const r of sources)
            w.reports.push({
              id: crypto.randomUUID(),
              className: r.className,
              week,
              sendDate,
              deadline,
              entries: r.entries.map((e) => ({
                subject: e.subject,
                english: "",
                vietnamese: "",
                submitted: false,
                reviewed: false,
              })),
              history: [],
              approved: null,
            });
          return;
        }
        const r = report(w, input.reportId);
        if (action === "schedule") {
          coordinator(w, user);
          const deadline = date(input.deadline),
            sendDate = date(input.sendDate);
          if (deadline && sendDate && deadline > sendDate)
            fail("Deadline must not follow the sending date.");
          if (r.sendDate !== sendDate) archive(r, user);
          r.deadline = deadline;
          r.sendDate = sendDate;
          return;
        }
        if (action === "class-link" || action === "revoke-class-link") {
          coordinator(w, user);
          w.classLinks ||= [];
          let c = w.classLinks.find((c) => c.className === r.className);
          if (action === "revoke-class-link") {
            w.classLinks = w.classLinks.filter((x) => x !== c);
            return;
          }
          if (
            !w.reports.some((x) => x.className === r.className && x.publication)
          )
            fail("Publish a newsletter for this class first.");
          if (!c)
            w.classLinks.push({
              id: crypto.randomUUID(),
              className: r.className,
              token: crypto.randomBytes(32).toString("hex"),
            });
          return;
        }
        if (action === "copy-subject") {
          const source = r.entries.find((e) => e.subject === input.subject);
          if (!source?.english.trim())
            fail("Save the source contribution first.");
          editable(w, user, source.subject, false, r.className);
          const targets = [...new Set(input.reportIds || [])].map((id) =>
            report(w, id),
          );
          if (
            !targets.length ||
            targets.some(
              (x) =>
                x.id === r.id ||
                !x.entries.some((e) => e.subject === source.subject),
            )
          )
            fail("Choose other reports with this subject.");
          for (const target of targets)
            editable(w, user, source.subject, false, target.className);
          for (const target of targets) {
            archive(target, user);
            const e = target.entries.find((e) => e.subject === source.subject);
            e.english = source.english;
            e.links = structuredClone(source.links || []);
            e.images = structuredClone(source.images || []);
            e.submittedAt = null;
            e.submitted = false;
            e.reviewed = false;
          }
          return;
        }
        if (
          action === "publish" ||
          action === "revoke-publication" ||
          action === "prepare-parent-demo"
        ) {
          publisher(w, user, r.className);
          if (action === "revoke-publication") {
            delete r.publication;
            return;
          }
          if (action === "prepare-parent-demo" && !w.demo)
            fail("Sample preview is only available in a demo workspace.");
          if (action !== "prepare-parent-demo" && !r.approved)
            fail("Approve this newsletter before publishing it.");
          r.publication = {
            token:
              r.publication?.token || crypto.randomBytes(32).toString("hex"),
            content: {
              school: w.name,
              demo: !!w.demo,
              className: r.className,
              week: r.week,
              sendDate: r.sendDate,
              design: w.settings.design || (w.demo ? "vinschool" : "standard"),
              publishedAt: new Date().toISOString(),
              entries: (action === "prepare-parent-demo"
                ? require("./school-newsletter-demo").demoReport().entries
                : r.approved.entries
              ).map(({ subject, english, vietnamese, links, images }) => ({
                subject,
                english,
                vietnamese,
                links: links || [],
                images: images || [],
              })),
            },
          };
          return;
        }
        if (action === "restore") {
          coordinator(w, user);
          const previous = r.history[input.index];
          if (!previous) fail("Version not found.");
          const entries = structuredClone(previous.entries);
          archive(r, user);
          r.entries = entries;
          return;
        }
        if (action === "approve") {
          publisher(w, user, r.className);
          if (
            !r.entries.every(
              (e) =>
                e.submitted &&
                e.reviewed &&
                count(e.english) >= Math.max(1, w.settings.minimum) &&
                count(e.vietnamese) >=
                  Math.max(1, w.settings.vietnameseMinimum),
            )
          )
            fail(
              "All subjects need submitted English and reviewed Vietnamese meeting the minimum.",
            );
          r.approved = {
            at: new Date().toISOString(),
            by: user.name || user.email,
            entries: structuredClone(r.entries),
          };
          return;
        }
        if (action === "apply-preview") {
          coordinator(w, user);
          const p = w.preview;
          if (!p || p.reportId !== r.id || p.revision !== w.revision)
            fail("This preview is out of date. Generate a fresh preview.", 409);
          archive(r, user);
          for (const item of p.entries) {
            const e = r.entries.find((e) => e.subject === item.subject);
            e.english = item.english;
            e.submittedAt = null;
            e.submitted = false;
            e.reviewed = false;
          }
          delete w.preview;
          return;
        }
        const e = r.entries.find((e) => e.subject === input.subject);
        if (!e) fail("Subject not found.");
        if (action === "feedback") {
          coordinator(w, user);
          if (
            typeof input.text !== "string" ||
            !input.text.trim() ||
            input.text.length > 2000
          )
            fail("Write feedback of at most 2,000 characters.");
          archive(r, user);
          e.feedback = input.text.trim();
          e.feedbackBy = user.name || user.email;
          e.feedbackResolved = false;
          e.submitted = false;
          e.submittedAt = null;
          e.reviewed = false;
        } else if (action === "media") {
          editable(w, user, e.subject, false, r.className);
          archive(r, user);
          e.links = input.links;
          e.images = input.images;
          e.submitted = false;
          e.submittedAt = null;
          e.reviewed = false;
        } else if (action === "english") {
          editable(w, user, e.subject, false, r.className);
          if (typeof input.text !== "string" || input.text.length > 30000)
            fail("Contributions must be text of at most 30,000 characters.");
          const value = text(input.text);
          if (input.submit && count(value) < Math.max(1, w.settings.minimum))
            fail("The contribution is below the English character minimum.");
          archive(r, user);
          if (e.reviewed && e.reviewedEnglish === undefined)
            e.reviewedEnglish = e.english;
          if (e.english !== value) e.reviewed = false;
          e.english = value;
          e.submitted = !!input.submit;
          if (e.submitted) {
            e.feedbackResolved = true;
            delete e.reminder;
          }
          e.submittedAt = e.submitted ? new Date().toISOString() : null;
          e.submittedBy = e.submitted ? user.name || user.email : null;
        } else if (action === "vietnamese") {
          editable(w, user, e.subject, true, r.className);
          if (typeof input.text !== "string" || input.text.length > 30000)
            fail("Contributions must be text of at most 30,000 characters.");
          const value = text(input.text);
          if (
            input.review &&
            (!e.submitted ||
              count(value) < Math.max(1, w.settings.vietnameseMinimum))
          )
            fail(
              "Submit English first and meet the Vietnamese minimum before marking reviewed.",
            );
          archive(r, user);
          e.vietnamese = value;
          e.reviewed = !!input.review;
          if (e.reviewed) {
            delete e.reminder;
            e.reviewedEnglish = e.english;
            e.reviewedBy = user.name || user.email;
            e.reviewedAt = new Date().toISOString();
          }
        } else fail("Unknown action.");
      });
    },
    preview(user, id, revision, reportId, entries) {
      return this.mutate(user, id, revision, (w) => {
        coordinator(w, user);
        const r = report(w, reportId);
        if (
          !Array.isArray(entries) ||
          !entries.length ||
          new Set(entries.map((e) => e.subject)).size !== entries.length ||
          entries.some(
            (e) =>
              !r.entries.some((x) => x.subject === e.subject) ||
              typeof e.english !== "string" ||
              !e.english.trim() ||
              e.english.length > 30000,
          )
        )
          fail("Generated content was incomplete. Nothing was changed.");
        w.preview = { reportId, revision: w.revision + 1, entries };
      });
    },
  };
}
module.exports = { createStore, count };
