"use strict";
const expandedSubjects = new Set();
const mediaDrafts = new Map();
const mediaKey = (subject) =>
  `newsletter.media.${user?.id}.${workspace?.id}.${reportId}.${subject}`;
try {
  for (const key of JSON.parse(
    sessionStorage.getItem("newsletter.expanded") || "[]",
  ))
    expandedSubjects.add(key);
} catch {}

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const lines = (value) =>
  String(value || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const chars = (value) => [...String(value || "").trim()].length;
let workspace,
  reportId,
  user,
  dirty = false;
let demoRole = "coordinator",
  pdfUrl = null,
  pdfAbort = null;
const root = "/api/school-newsletters";
function draftKey() {
  return `newsletter.drafts.${user?.id}.${workspace?.id}.${reportId}`;
}
function drafts() {
  try {
    return JSON.parse(localStorage.getItem(draftKey()) || "{}");
  } catch {
    return {};
  }
}
function remember(card) {
  const d = drafts(),
    i = card.dataset.index,
    entry = current().entries[Number(i)];
  d[i] = { source: card.querySelector("[data-source]")?.value || "" };
  for (const lang of ["english", "vietnamese"]) {
    const el = card.querySelector(`[data-field="${lang}"]`);
    if (!el.readOnly && el.value !== entry[lang]) d[i][lang] = el.value;
  }
  localStorage.setItem(draftKey(), JSON.stringify(d));
  dirty = true;
}

function clearSaved(subject, lang, savedText) {
  const d = drafts(),
    i = current().entries.findIndex((e) => e.subject === subject);
  if (d[i] && d[i][lang] === savedText) {
    delete d[i][lang];
    localStorage.setItem(draftKey(), JSON.stringify(d));
  }
}

async function api(url, body) {
  const res = await fetch(root + url, {
    method: body ? "POST" : "GET",
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) $("login").hidden = false;
    throw Error(data.error || "Could not complete the request.");
  }
  return data;
}
function status(message) {
  $("message").textContent = message;
  const local = $("parentShareStatus");
  if (local) local.textContent = message;
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    status(e.message);
  }
}
async function busy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } finally {
    button.disabled = false;
  }
}
const current = () => workspace?.reports.find((r) => r.id === reportId);
function safeLeave() {
  return (
    !dirty || confirm("There are unsaved edits. Leave them without saving?")
  );
}
function setWorkspace(w) {
  workspace = w;
  if (w.demo) {
    workspace.myRole = demoRole;
    workspace.mySubjects = ["ICT"];
  }
  dirty = false;
  localStorage.setItem("newsletter.workspace", w.id);
  if (!w.reports.some((r) => r.id === reportId)) reportId = w.reports[0]?.id;
  render();
}
async function change(action, extra = {}) {
  const w = await api("/" + workspace.id + "/change", {
    revision: workspace.revision,
    reportId,
    action,
    ...extra,
  });
  if (["apply-preview", "restore"].includes(action))
    localStorage.removeItem(draftKey());
  if (action === "english" || action === "vietnamese")
    clearSaved(extra.subject, action, extra.text);
  if (action === "next-week") reportId = w.reports[w.reports.length - 1]?.id;
  setWorkspace(w);
  status(
    dirty
      ? "Saved this contribution. Other unsaved edits are kept on this device."
      : "Saved.",
  );
}
function render() {
  document.body.classList.add("has-workspace");
  $("workspace").hidden = false;
  $("spaceName").textContent = workspace.name;
  $("role").textContent = workspace.myRole;
  $("demoBar").hidden = !workspace.demo;
  $("demoRole").value = demoRole;
  const coord = workspace.myRole === "coordinator";
  document.body.dataset.newsletterRole = workspace.myRole;
  $("coordinator").hidden = !coord;
  $("newReport").hidden = !coord || workspace.demo;
  $("invite").closest("details").hidden = !!workspace.demo;
  $("settings").elements.design.value =
    workspace.settings.design || (workspace.demo ? "vinschool" : "standard");
  $("settings").elements.example.value = workspace.settings.example;
  $("settings").elements.minimum.value = workspace.settings.minimum;
  $("settings").elements.vietnameseMinimum.value =
    workspace.settings.vietnameseMinimum;
  $("reports").innerHTML =
    workspace.reports
      .map(
        (r) =>
          `<button class="report-choice ${r.id === reportId ? "active" : ""}" data-report="${r.id}">${esc(r.className)}<br><small>${esc(r.week)} · ${r.approved ? "Approved" : "In progress"}</small></button>`,
      )
      .join("") ||
    '<p class="hint">Your coordinator will add the first class newsletter here.</p>';
  $("members").innerHTML =
    workspace.members
      .map(
        (m) =>
          `<p>${esc(m.name)} · ${esc(m.role)} ${esc((m.subjects || []).join(", "))}${m.userId && m.userId !== user.id ? ` <button class="secondary" data-remove="${esc(m.userId)}">Remove access</button>` : ""}</p>`,
      )
      .join("") +
    (workspace.invites || [])
      .map(
        (i) =>
          `<p>${esc(i.email)} · ${esc(i.role)} · Pending <button class="secondary" data-revoke="${esc(i.token)}">Withdraw invitation</button></p>`,
      )
      .join("");
  const r = current();
  if (!r) {
    $("editor").innerHTML =
      "<h2>Ready for the first week</h2><p>Add a class newsletter, then invite your subject teachers and assistants.</p>";
    return;
  }
  const canPublish = coord || (workspace.myRole === "translator" && (!workspace.myClasses || workspace.myClasses.includes(r.className)));
  $("editor").innerHTML =
    `<div class="report-heading"><div><p class="eyebrow">${esc(r.week)}</p><h2>${esc(r.className)}</h2><p class="hint">${r.sendDate ? "Sending " + esc(r.sendDate) : "Your weekly update for families"}</p></div><span class="pill">${r.approved ? "Approved for sharing" : r.entries.every((e) => e.submitted && e.reviewed) ? "Ready for approval" : r.entries.every((e) => e.submitted) ? "Awaiting translation & review" : "Draft"}</span></div><div class="workflow-progress"><span><b>${r.entries.filter((e) => e.submitted).length}/${r.entries.length}</b> contributions submitted</span><span><b>${r.entries.filter((e) => e.reviewed).length}/${r.entries.length}</b> translations reviewed</span></div><div class="report-preview-card"><div class="paper-symbol" aria-hidden="true">▤</div><div><h3>Your family newsletter</h3><p class="hint">${(workspace.settings.design || (workspace.demo ? "vinschool" : "standard")) === "vinschool" ? "Vinschool · Cambridge weekly report" : "LessonScope report"} · Preview the saved pages before sharing.</p><div class="actions"><button data-action="pdf-preview">Preview PDF</button>${coord && workspace.settings.design !== "vinschool" ? '<button data-action="school-design" class="secondary">Use Vinschool design</button>' : ""}<button data-action="teacher-preview" class="secondary">Teacher preview</button>${canPublish && !r.approved ? '<button data-action="approve" class="secondary">Approve newsletter</button>' : ""}${r.approved ? '<button data-action="print" class="secondary">Download approved PDF</button>' : ""}</div></div></div><div class="section-heading"><h3>Subject contributions</h3><p class="hint">${coord ? "Review each subject, then approve the finished report." : workspace.myRole === "translator" ? "Review each translation, approve the completed newsletter and publish the parent link." : "Open your subject, add your learning update and submit it for translation."}</p></div>` +
    r.entries
      .map((e, i) => {
        const edit =
          coord ||
          (workspace.myRole === "teacher" &&
            workspace.mySubjects.includes(e.subject) &&
            (!workspace.myClasses ||
              workspace.myClasses.includes(r.className)));
        const translate =
          coord ||
          (workspace.myRole === "translator" &&
            (!workspace.myClasses ||
              workspace.myClasses.includes(r.className)));
        const owners = workspace.members
          .filter(
            (m) =>
              m.role === "teacher" &&
              (m.subjects || []).includes(e.subject) &&
              (!m.classes || m.classes.includes(r.className)),
          )
          .map((m) => m.name)
          .join(", ");
        const key = workspace.id + ":" + r.id + ":" + i;
        return `<details class="subject" data-index="${i}" data-expansion="${esc(key)}" ${expandedSubjects.has(key) || (workspace.myRole === "teacher" && edit) ? "open" : ""}><summary><span class="subject-name">${esc(e.subject)}</span><span class="subject-owner">${esc(owners || "Subject team")}</span><span class="status">${e.submitted ? "English submitted" : "Draft"} · ${e.reviewed ? "Vietnamese reviewed" : "Translation needs review"}</span></summary><div class="subject-content"><div class="two"><div><label>English<textarea data-field="english" rows="10" maxlength="30000" ${edit ? "" : "readonly"}>${esc(e.english)}</textarea></label><p class="hint" data-count="english"></p>${edit ? `<div class="actions"><button data-action="save-en" class="secondary">Save draft</button><button data-action="submit">Submit English</button></div><details><summary>Reuse another class or week</summary><select data-reuse><option value="">Choose saved contribution</option>${workspace.reports.flatMap((other) => (other.id === r.id ? [] : other.entries.filter((x) => x.subject === e.subject && x.english).map((x) => `<option value="${other.id}">${esc(other.className)} · ${esc(other.week)}</option>`))).join("")}</select><p class="hint">Copies English into your draft for review. Other classes stay unchanged.</p></details><details><summary>Create from a lesson plan</summary><label>Upload lesson plan<input type="file" data-upload accept=".pdf,.docx,.pptx,.xlsx,.txt,.md"></label><button data-action="plans" class="secondary">Choose my saved LessonScope plan</button><select data-plans hidden><option value="">Choose a plan</option></select><label>Lesson content<textarea data-source rows="6" placeholder="Upload a plan, select a saved plan or paste the learning content here.">${workspace.demo ? esc(e.english) : ""}</textarea></label><button data-action="draft">Generate English draft</button><p class="hint">Review the generated draft before saving. Generation does not submit your contribution.</p></details>` : ""}</div><div><label>Vietnamese<textarea data-field="vietnamese" rows="10" maxlength="30000" ${translate ? "" : "readonly"}>${esc(e.vietnamese)}</textarea></label><p class="hint" data-count="vietnamese"></p>${translate ? '<div class="actions"><button data-action="save-vi" class="secondary">Save translation</button><button data-action="review">Mark reviewed</button><button data-action="translate" class="secondary">Draft translation</button></div><p class="hint">Translation uses saved English. Check the wording before marking reviewed.</p>' : ""}</div></div></div></details>`;
      })
      .join("") +
    (coord
      ? `<details class="report-maintenance"><summary>Report tools and previous versions</summary><details><summary>Regenerate subjects using your example</summary><p>Save your example under Format and minimum length first. A preview will appear before anything is replaced.</p>${r.entries.map((e) => `<label class="choice"><input type="checkbox" data-subject value="${esc(e.subject)}" checked>${esc(e.subject)}</label>`).join("")}<button data-action="reformat">Generate preview</button></details><details><summary>Previous versions (${r.history.length})</summary>${
          r.history
            .map(
              (h, i) =>
                `<p>${esc(new Date(h.at).toLocaleString())} · ${esc(h.by)} <button class="secondary" data-restore="${i}">Restore this version</button></p>`,
            )
            .reverse()
            .join("") || "<p>No previous versions yet.</p>"
        }</details></details>`
      : "");
  if (canPublish) {
    const share = document.createElement("div");
    share.className = "parent-sharing";
    share.innerHTML = `<h3>Share with families</h3><p id="parentShareStatus" role="status" aria-live="polite"></p><p class="hint">A phone-friendly page, with no parent sign-in. Only published, approved content is shared.</p>${workspace.demo && !r.publication ? '<button data-action="test-parent">Prepare parent demo</button><p class="hint">Create a ready-to-read fictional sample, then open its parent view or copy the link to your phone. Your saved work is unchanged.</p>' : ""}${r.approved ? '<button data-action="publish-parent">' + (r.publication ? "Publish latest approved version" : "Publish parent newsletter") + "</button>" : '<p class="hint">Approve the newsletter to publish it.</p>'}${r.publication ? '<label>Parent reading link<input id="parentLink" readonly></label><div class="actions"><button data-action="copy-parent" class="secondary">Copy parent link</button><a id="openParent" class="button secondary" target="_blank" rel="noopener noreferrer">Open parent view</a><button data-action="revoke-parent" class="secondary">Revoke link</button></div><p class="hint">The link stays available until revoked. New edits stay private until you approve and publish again.</p>' : ""}`;
    $("editor").append(share);
    if (r.publication) {
      const link =
        location.origin +
        "/family-newsletter.html#" +
        workspace.id +
        "/" +
        r.id +
        "/" +
        r.publication.token;
      $("parentLink").value = link;
      $("openParent").href = link;
    }
  }
  workflowTools(r, coord);
  newsletterExtras(r, coord);
  if (coord) renderEmailSettings();
  const pending = drafts();
  dirty = false;
  document.querySelectorAll(".subject").forEach((card) => {
    card.addEventListener("toggle", () => {
      if (card.open) expandedSubjects.add(card.dataset.expansion);
      else expandedSubjects.delete(card.dataset.expansion);
      try {
        sessionStorage.setItem(
          "newsletter.expanded",
          JSON.stringify([...expandedSubjects]),
        );
      } catch {}
    });
    const d = pending[card.dataset.index];
    if (d) {
      for (const lang of ["english", "vietnamese"]) {
        const el = card.querySelector(`[data-field="${lang}"]`);
        if (!el.readOnly && d[lang] !== undefined && d[lang] !== el.value) {
          el.value = d[lang];
          dirty = true;
        }
      }
      const source = card.querySelector("[data-source]");
      if (source && d.source) source.value = d.source;
    }
    updateCounts(card);
  });
  if (current().entries.some((e) => mediaDrafts.has(mediaKey(e.subject))))
    dirty = true;
}
function updateCounts(card) {
  for (const lang of ["english", "vietnamese"]) {
    const n = chars(card.querySelector(`[data-field="${lang}"]`).value),
      min =
        workspace.settings[
          lang === "english" ? "minimum" : "vietnameseMinimum"
        ];
    const el = card.querySelector(`[data-count="${lang}"]`);
    el.textContent = `${n} characters · minimum ${min}${n < min ? " · More detail needed" : ""}`;
    el.classList.toggle("warning", n < min);
  }
}
async function loadSpaces(id) {
  const data = await api("");
  $("home").hidden = false;
  $("spaces").innerHTML = data.workspaces
    .map((w) => `<option value="${w.id}">${esc(w.name)}</option>`)
    .join("");
  const selected =
    data.workspaces.find(
      (w) => w.id === (id || localStorage.getItem("newsletter.workspace")),
    ) || data.workspaces[0];
  if (selected) {
    $("spaces").value = selected.id;
    setWorkspace(await api("/" + selected.id));
  }
}
$("spaces").onchange = () =>
  run(async () => {
    if (!safeLeave()) {
      $("spaces").value = workspace.id;
      return;
    }
    setWorkspace(await api("/" + $("spaces").value));
  });
$("reload").onclick = () =>
  run(async () => {
    if (safeLeave()) await loadSpaces(workspace?.id);
  });
$("createSpace").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const w = await api("", { name: e.target.elements.name.value });
    await loadSpaces(w.id);
    status("Workspace created. Add a class and week.");
  });
};
$("reportForm").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target.elements;
  run(() =>
    change("create-report", {
      className: f.className.value,
      week: f.week.value,
      sendDate: f.sendDate.value,
      subjects: lines(f.subjects.value),
    }),
  );
};
$("settings").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target.elements;
  run(() =>
    change("settings", {
      design: f.design.value,
      example: f.example.value,
      minimum: Number(f.minimum.value),
      vietnameseMinimum: Number(f.vietnameseMinimum.value),
    }),
  );
};
$("invite").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target.elements;
  run(async () => {
    const result = await api("/" + workspace.id + "/invite", {
      revision: workspace.revision,
      email: f.email.value,
      role: f.role.value,
      subjects: lines(f.subjects.value),
    });
    setWorkspace(result.workspace);
    const link = location.origin + "/newsletters.html#invite=" + result.token;
    $("inviteResult").replaceChildren();
    const input = document.createElement("input");
    input.value = link;
    input.readOnly = true;
    input.setAttribute("aria-label", "Invitation link");
    const button = document.createElement("button");
    button.textContent = "Copy invitation";
    button.onclick = () =>
      run(async () => {
        await navigator.clipboard.writeText(link);
        status("Invitation copied. Send it to your colleague.");
      });
    $("inviteResult").append(input, button);
  });
};
$("reports").onclick = (e) => {
  const b = e.target.closest("[data-report]");
  if (b && safeLeave()) {
    reportId = b.dataset.report;
    dirty = false;
    render();
  }
};
$("members").onclick = (e) => {
  const revoke = e.target.closest("[data-revoke]");
  if (revoke) {
    run(() => change("revoke-invite", { token: revoke.dataset.revoke }));
    return;
  }
  const b = e.target.closest("[data-remove]");
  if (b && confirm("Remove this colleague’s access?"))
    run(() => change("remove-member", { userId: b.dataset.remove }));
};
$("editor").oninput = (e) => {
  const c = e.target.closest(".subject");
  if (c) {
    remember(c);
    updateCounts(c);
  }
};
$("editor").onchange = (e) =>
  run(async () => {
    const card = e.target.closest(".subject");
    if (!card) return;
    if (e.target.matches("[data-reuse]") && e.target.value) {
      const source = workspace.reports
        .find((r) => r.id === e.target.value)
        ?.entries.find(
          (x) =>
            x.subject === current().entries[Number(card.dataset.index)].subject,
        );
      if (source) {
        card.querySelector("[data-field=english]").value = source.english;
        remember(card);
        updateCounts(card);
      }
      return;
    }
    if (e.target.matches("[data-upload]")) {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      status("Reading your lesson plan…");
      const result = await api("/" + workspace.id + "/upload", form);
      card.querySelector("[data-source]").value = result.text;
      remember(card);
      status("Lesson content loaded. Review it, then generate.");
    }
    if (e.target.matches("[data-plans]") && e.target.value) {
      const result = await api(
        "/saved-plans/" + encodeURIComponent(e.target.value),
      );
      card.querySelector("[data-source]").value = result.text;
      remember(card);
    }
  });
$("editor").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  run(() =>
    busy(b, async () => {
      if (b.dataset.restore !== undefined) {
        if (dirty) {
          status("Save your edits before restoring a previous version.");
          return;
        }
        if (
          confirm(
            "Restore this version? The current version will also be kept.",
          )
        )
          await change("restore", { index: Number(b.dataset.restore) });
        return;
      }
      const action = b.dataset.action;
      if (action === "test-parent") {
        if (!workspace.demo) return;
        if (dirty) {
          status("Save your sample edits before preparing the parent demo.");
          return;
        }
        status("Preparing your parent demo…");
        await change("prepare-parent-demo");
        status(
          "Parent demo ready. Open parent view below, or copy the link to test on your phone without signing in.",
        );
        $("openParent").focus();
        return;
      }
      if (action === "publish-parent") {
        if (dirty) {
          status("Save and approve your edits before publishing.");
          return;
        }
        await change("publish");
        status("Published. Copy the parent link below.");
        return;
      }
      if (action === "copy-parent") {
        try {
          await navigator.clipboard.writeText($("parentLink").value);
          status("Parent link copied.");
        } catch {
          $("parentLink").select();
          status("Select and copy the parent link.");
        }
        return;
      }
      if (action === "revoke-parent") {
        if (
          confirm(
            "Close this parent link? Anyone with the link will lose access.",
          )
        )
          await change("revoke-publication");
        return;
      }
      if (action === "teacher-preview") {
        openTeacherPreview();
        return;
      }
      if (action === "school-design") {
        await change("design", { design: "vinschool" });
        await openPdfPreview();
        return;
      }
      if (action === "pdf-preview") {
        await openPdfPreview();
        return;
      }
      if (action === "print") {
        await openPdfPreview();
        return;
      }
      if (action === "approve") {
        if (dirty) {
          status("Save your edits before approval.");
          return;
        }
        await change("approve");
        return;
      }
      const card = b.closest(".subject"),
        entry = card && current().entries[Number(card.dataset.index)];
      if (["save-en", "submit", "save-vi", "review"].includes(action)) {
        const english = ["save-en", "submit"].includes(action);
        await change(english ? "english" : "vietnamese", {
          subject: entry.subject,
          text: card.querySelector(
            `[data-field="${english ? "english" : "vietnamese"}"]`,
          ).value,
          submit: action === "submit",
          review: action === "review",
        });
        return;
      }
      if (action === "plans") {
        const result = await api("/saved-plans");
        const select = card.querySelector("[data-plans]");
        select.hidden = false;
        select.innerHTML =
          '<option value="">Choose a plan</option>' +
          result.plans
            .map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`)
            .join("");
        if (!result.plans.length)
          status(
            "No saved lesson plans available. Upload or paste a plan instead.",
          );
        return;
      }
      if (["draft", "translate", "reformat"].includes(action)) {
        if (["reformat", "approve"].includes(action) && dirty) {
          status("Save your edits before regenerating the newsletter.");
          return;
        }
        status("Generating a draft for your review…");
        const result = await api("/" + workspace.id + "/generate", {
          revision: workspace.revision,
          reportId,
          mode: action,
          subject: entry?.subject,
          source: card?.querySelector("[data-source]")?.value,
          subjects: [
            ...document.querySelectorAll("[data-subject]:checked"),
          ].map((el) => el.value),
        });
        if (action === "reformat") {
          setWorkspace(result);
          $("previewBody").innerHTML = result.preview.entries
            .map(
              (e) =>
                `<h3>${esc(e.subject)}</h3><p class="hint">${chars(e.english)} characters · minimum ${workspace.settings.minimum}</p><p class="prose">${esc(e.english)}</p>`,
            )
            .join("");
          $("preview").showModal();
        } else {
          card.querySelector(
            `[data-field="${action === "translate" ? "vietnamese" : "english"}"]`,
          ).value = result.text;
          updateCounts(card);
          remember(card);
        }
        status("Draft ready. Review before saving.");
      }
    }),
  );
};
$("apply").onclick = () =>
  run(async () => {
    await change("apply-preview");
    $("preview").close();
  });
$("closePreview").onclick = () => $("preview").close();
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
run(async () => {
  const res = await fetch("/api/me");
  if (!res.ok) {
    $("login").hidden = false;
    return;
  }
  const me = await res.json();
  user = me.user || me;
  $("signout").hidden = false;
  $("createWorkspaceDetails").hidden = user.accessMode === "newsletter";
  const token =
    new URLSearchParams(location.hash.slice(1)).get("invite") ||
    sessionStorage.getItem("newsletter.invite");
  if (token) {
    sessionStorage.setItem("newsletter.invite", token);
    const w = await api("/accept", { token });
    sessionStorage.removeItem("newsletter.invite");
    history.replaceState(null, "", location.pathname);
    await loadSpaces(w.id);
    status("You have joined the newsletter team.");
  } else await loadSpaces();
});
if (location.hash.startsWith("#invite="))
  sessionStorage.setItem(
    "newsletter.invite",
    new URLSearchParams(location.hash.slice(1)).get("invite"),
  );

$("signout").onclick = () =>
  run(async () => {
    if (!safeLeave()) return;
    await fetch("/api/logout", { method: "POST" });
    location.href = "/";
  });

function openTeacherPreview() {
  const r = current();
  if (!r) return;
  $("previewSubject").innerHTML = r.entries
    .map((e) => `<option>${esc(e.subject)}</option>`)
    .join("");
  renderTeacherPreview();
  $("teacherPreview").showModal();
}
function renderTeacherPreview() {
  const r = current(),
    e = r.entries.find((e) => e.subject === $("previewSubject").value);
  if (!e) return;
  $("teacherPreviewBody").innerHTML =
    `<p class="eyebrow">${esc(r.className)} · ${esc(r.week)}</p><h3>${esc(e.subject)} · Subject teacher view</h3><p class="hint">${e.submitted ? "Submitted for translation" : "Draft — ready for the teacher to complete"} · ${chars(e.english)} characters · minimum ${workspace.settings.minimum}</p><label>${$("previewLanguage").value === "vietnamese" ? "Vietnamese translation" : "English contribution"}<textarea readonly rows="12">${esc(e[$("previewLanguage").value])}</textarea></label><p class="hint">Teachers can write, generate a draft and submit their assigned subject. Translators review Vietnamese separately.</p>`;
}
$("previewSubject").onchange = renderTeacherPreview;
$("previewLanguage").onchange = renderTeacherPreview;
$("closeTeacherPreview").onclick = () => $("teacherPreview").close();
$("teacherPdf").onclick = () => run(openPdfPreview);
async function openPdfPreview() {
  const r = current(),
    w = workspace;
  if (!r) return;
  if (pdfAbort) pdfAbort.abort();
  const controller = new AbortController();
  pdfAbort = controller;
  $("pdfPreview").showModal();
  $("pdfStatus").textContent = "Building PDF from saved content…";
  $("pdfFrame").hidden = true;
  $("pdfDownload").hidden = true;
  $("pdfOpen").hidden = true;
  if (pdfUrl) {
    URL.revokeObjectURL(pdfUrl);
    pdfUrl = null;
  }
  try {
    const res = await fetch(root + "/" + w.id + "/reports/" + r.id + "/pdf", {
      signal: controller.signal,
    });
    if (!res.ok) {
      const error = await res.json();
      throw Error(error.error || "Could not build the PDF.");
    }
    const blob = await res.blob();
    if (!$("pdfPreview").open || pdfAbort !== controller) return;
    pdfUrl = URL.createObjectURL(blob);
    $("pdfFrame").src = pdfUrl;
    $("pdfFrame").hidden = false;
    for (const id of ["pdfDownload", "pdfOpen"]) {
      $(id).href = pdfUrl;
      $(id).hidden = false;
    }
    $("pdfStatus").textContent = w.demo
      ? "Demo PDF · Fictional sample content."
      : r.approved
        ? "Approved newsletter · Ready to download."
        : "Draft PDF · Saved content only; not approved for sharing.";
  } catch (error) {
    if (!controller.signal.aborted)
      $("pdfStatus").textContent =
        error.message ||
        "Could not load the PDF. Close this preview and try again.";
  }
}
$("closePdfPreview").onclick = () => $("pdfPreview").close();
$("pdfPreview").addEventListener("close", () => {
  if (pdfAbort) pdfAbort.abort();
  pdfAbort = null;
  $("pdfFrame").src = "about:blank";
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = null;
});
$("openDemo").onclick = () =>
  run(() =>
    busy($("openDemo"), async () => {
      if (!safeLeave()) return;
      const button = $("openDemo");
      button.textContent = "Opening demo…";
      status("Opening your sample demo…");
      try {
        if (workspace && !workspace.demo)
          sessionStorage.setItem("newsletter.returnWorkspace", workspace.id);
        demoRole = "coordinator";
        const w = await api("/demo", {});
        // The create/open response already includes the full workspace. Avoid two
        // extra requests before showing the demo, particularly on school networks.
        if (![...$("spaces").options].some((o) => o.value === w.id))
          $("spaces").add(new Option(w.name, w.id));
        $("spaces").value = w.id;
        setWorkspace(w);
        status("Demo ready. Try each role, then preview the PDF.");
        $("demoBar").scrollIntoView({ behavior: "smooth", block: "start" });
      } finally {
        button.textContent = "Try a sample demo";
      }
    }),
  );
$("demoRole").onchange = () => {
  if (!safeLeave()) {
    $("demoRole").value = demoRole;
    return;
  }
  demoRole = $("demoRole").value;
  workspace.myRole = demoRole;
  workspace.mySubjects = ["ICT"];
  render();
};
$("resetDemo").onclick = () =>
  run(async () => {
    if (
      !confirm(
        "Reset your demo to the sample content? Real newsletters are unaffected.",
      )
    )
      return;
    localStorage.removeItem(draftKey());
    await change("reset-demo");
    status("Demo reset.");
  });
$("exitDemo").onclick = () =>
  run(async () => {
    if (!safeLeave()) return;
    const list = await api("");
    const id = sessionStorage.getItem("newsletter.returnWorkspace");
    const target =
      list.workspaces.find((w) => w.id === id) ||
      list.workspaces.find((w) => !w.demo);
    if (target) {
      await loadSpaces(target.id);
    } else {
      $("workspace").hidden = true;
      $("demoBar").hidden = true;
      workspace = null;
      reportId = null;
      dirty = false;
      localStorage.removeItem("newsletter.workspace");
    }
    status("You have left the demo.");
  });

function workflowTools(r, coord) {
  const panel = document.createElement("section");
  panel.className = "newsletter-workflow";
  const allowed = (x) =>
    coord || !workspace.myClasses || workspace.myClasses.includes(x.className);
  const tasks = workspace.reports.flatMap((x) =>
    allowed(x)
      ? x.entries
          .filter(
            (e) =>
              coord ||
              workspace.myRole === "translator" ||
              workspace.mySubjects.includes(e.subject),
          )
          .map((e) => ({ r: x, e }))
      : [],
  );
  const unique = [
    ...new Map(workspace.reports.map((x) => [x.className, x])).values(),
  ];
  panel.classList.add("contribution-overview");
  panel.innerHTML = `<div class="overview-heading"><div><p class="eyebrow">${coord ? "Coordinator overview" : "Your weekly newsletter"}</p><h2>${coord ? "Weekly progress" : "My contributions"}</h2></div><label>Week<select id="taskWeek"><option value="">All weeks</option>${[...new Set(workspace.reports.map((x) => x.week))].map((w) => `<option>${esc(w)}</option>`).join("")}</select></label></div><p id="taskSummary" class="hint"></p><div class="task-grid">${
    tasks
      .map(({ r: x, e }) => {
        const done = coord
          ? e.submitted && e.reviewed
          : workspace.myRole === "translator"
            ? e.reviewed
            : e.submitted;
        return `<button class="secondary task-card" data-task="${x.id}" data-subject-name="${esc(e.subject)}" data-week="${esc(x.week)}" data-done="${done}"><span class="task-description"><strong>${esc(x.className)} · ${esc(e.subject)}</strong><span>${e.reminder ? "Reminder · " : ""}${e.feedback && !e.feedbackResolved ? "Changes requested · " : ""}${!e.submitted ? "Contribution needed" : !e.reviewed ? "Submitted · awaiting translation" : x.approved ? "Approved" : "Ready for TA approval"}</span>${x.deadline ? `<small>Due ${esc(x.deadline)}</small>` : ""}</span><span class="task-action">${done ? "View contribution" : "Open contribution"} →</span></button>`;
      })
      .join("") || "<p>No assigned contributions.</p>"
  }</div>`;
  if (coord) panel.querySelector(".task-grid").hidden = true;
  if (coord)
    panel.innerHTML += `<details><summary>Set up next week</summary><p>Copy the class and subject setup. Contributions start blank; staff assignments stay in place.</p><form id="nextWeekForm"><label>New week<input name="week" required maxlength="80"></label><label>Submission deadline<input name="deadline" type="date"></label><label>Sending date<input name="sendDate" type="date"></label>${unique.map((x) => `<label><input type="checkbox" name="source" value="${x.id}" checked> ${esc(x.className)}</label>`).join("")}<button>Create next week</button></form></details><details><summary>Class assignments</summary><p>Existing staff keep access to all classes until you choose specific classes.</p>${
      workspace.members
        .filter((m) => m.role !== "coordinator")
        .map(
          (m, i) =>
            `<form data-assignment="${esc(m.userId)}"><strong>${esc(m.name)} · ${esc(m.role)} · ${esc((m.subjects || []).join(", "))}</strong><label><input type="checkbox" name="all" ${!m.classes ? "checked" : ""}>All classes, including future classes</label>${unique.map((x) => `<label><input type="checkbox" name="class" value="${esc(x.className)}" ${m.classes?.includes(x.className) ? "checked" : ""}>${esc(x.className)}</label>`).join("")}<button>Save assignment</button></form>`,
        )
        .join("") || "<p>Invite teachers or translators first.</p>"
    }</details>`;
  $("editor").prepend(panel);
  panel.onclick = (event) => {
    event.stopPropagation();
    const b = event.target.closest("[data-task]");
    if (b && safeLeave()) {
      reportId = b.dataset.task;
      render();
      const i = current().entries.findIndex(
        (e) => e.subject === b.dataset.subjectName,
      );
      const d = document.querySelector(`.subject[data-index="${i}"]`);
      if (d) {
        d.open = true;
        d.scrollIntoView({ block: "start" });
      }
    }
  };
  $("taskWeek").onchange = (event) => {
    const cards = [...panel.querySelectorAll("[data-week]")];
    cards.forEach(
      (b) =>
        (b.hidden =
          !!event.target.value && b.dataset.week !== event.target.value),
    );
    const shown = cards.filter((b) => !b.hidden),
      done = shown.filter((b) => b.dataset.done === "true").length;
    if (coord) renderProgressMatrix(panel, event.target.value);
    $("taskSummary").textContent =
      `${done} ${coord ? "ready" : workspace.myRole === "translator" ? "reviewed" : "submitted"} · ${shown.length - done} needing action`;
  };
  $("taskWeek").value = r.week;
  $("taskWeek").dispatchEvent(new Event("change"));
  panel.onsubmit = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (dirty) {
      status("Save your edits first.");
      return;
    }
    const f = event.target,
      fd = new FormData(f);
    run(() =>
      busy(f.querySelector("button"), () =>
        f.id === "nextWeekForm"
          ? change("next-week", {
              week: fd.get("week"),
              deadline: fd.get("deadline"),
              sendDate: fd.get("sendDate"),
              reportIds: fd.getAll("source"),
            })
          : change("assignment", {
              userId: f.dataset.assignment,
              classes: fd.get("all") ? null : fd.getAll("class"),
            }),
      ),
    );
  };
  const tools = document.createElement("section");
  tools.className = "newsletter-workflow";
  const readiness = r.readiness || { issues: [], warnings: [] };
  tools.innerHTML = `<h3>Ready to publish?</h3>${readiness.issues.map((x) => `<button class="secondary readiness-item" data-issue="${esc(x.subject)}">${esc(x.subject)} — ${esc(x.message)} →</button>`).join("") || "<p>✓ All subject contributions and translations are ready.</p>"}${readiness.warnings.map((x) => `<p>${esc(x)}</p>`).join("")}`;
  if (coord)
    tools.innerHTML += `<details><summary>Dates and deadline</summary><form id="scheduleForm"><label>Deadline<input type="date" name="deadline" value="${esc(r.deadline || "")}"></label><label>Sending date<input type="date" name="sendDate" value="${esc(r.sendDate || "")}"></label><button>Save dates</button></form></details>`;
  tools.innerHTML += `<details><summary>Copy a saved subject to other classes</summary><p>Review the saved text below. Applying replaces English in the selected reports and requires fresh submission and translation review.</p><form id="copySubjectForm"><label>Subject<select name="subject">${r.entries
    .filter(
      (e) =>
        coord ||
        (allowed(r) &&
          workspace.myRole === "teacher" &&
          workspace.mySubjects.includes(e.subject)),
    )
    .map((e) => `<option>${esc(e.subject)}</option>`)
    .join("")}</select></label><pre id="copyText"></pre>${workspace.reports
    .filter((x) => x.id !== r.id && allowed(x))
    .map(
      (x) =>
        `<label><input type="checkbox" name="target" value="${x.id}">${esc(x.className)} · ${esc(x.week)}</label>`,
    )
    .join("")}<button>Apply to selected reports</button></form></details>`;
  if (coord) {
    const c = workspace.classLinks?.find((c) => c.className === r.className);
    tools.innerHTML += `<details><summary>Permanent class link</summary><p>Parents can bookmark this link for the latest published newsletter and previous weeks.</p>${c ? `<input aria-label="Permanent class link" readonly value="${esc(location.origin + "/family-newsletter.html#" + workspace.id + "/" + c.id + "/" + c.token)}"><button data-channel="revoke-class-link">Revoke class link</button>` : '<button data-channel="class-link">Create class link</button>'}</details><button data-phone>Preview on a phone</button>`;
  }
  $("editor").append(tools);
  const updateCopy = () => {
    const f = $("copySubjectForm");
    $("copyText").textContent =
      r.entries.find((e) => e.subject === f.elements.subject.value)?.english ||
      "No saved English content.";
  };
  updateCopy();
  $("copySubjectForm").elements.subject.onchange = updateCopy;
  tools.onsubmit = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (dirty) {
      status("Save your edits first.");
      return;
    }
    const f = event.target,
      fd = new FormData(f);
    run(() =>
      busy(f.querySelector("button"), async () => {
        if (f.id === "scheduleForm")
          await change("schedule", {
            deadline: fd.get("deadline"),
            sendDate: fd.get("sendDate"),
          });
        else if (
          confirm(
            "Replace English in the selected reports with this saved text?",
          )
        )
          await change("copy-subject", {
            subject: fd.get("subject"),
            reportIds: fd.getAll("target"),
          });
      }),
    );
  };
  tools.onclick = (event) => {
    event.stopPropagation();
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.channel)
      run(async () => {
        if (dirty) {
          status("Save your edits first.");
          return;
        }
        if (
          b.dataset.channel === "revoke-class-link" &&
          !confirm(
            "Revoke this permanent class link? Existing weekly links remain available.",
          )
        )
          return;
        await change(b.dataset.channel);
      });
    if (b.dataset.issue) {
      const i = r.entries.findIndex((e) => e.subject === b.dataset.issue);
      const card = document.querySelector(`.subject[data-index="${i}"]`);
      if (card) {
        card.open = true;
        card.scrollIntoView({ block: "start" });
      }
    }
    if (b.hasAttribute("data-phone")) openPhonePreview(r);
  };
  document.querySelectorAll(".subject").forEach((card) => {
    const e = r.entries[Number(card.dataset.index)];
    if (e.reviewedEnglish !== undefined && e.reviewedEnglish !== e.english) {
      const d = document.createElement("details");
      d.innerHTML =
        "<summary>English changes since translation review</summary>";
      const old = e.reviewedEnglish.split("\n"),
        now = e.english.split("\n");
      for (const [label, rows, other] of [
        ["Removed or changed", old, now],
        ["Added or changed", now, old],
      ]) {
        const h = document.createElement("h4");
        h.textContent = label;
        d.append(h);
        for (const line of rows.filter((l) => l.trim() && !other.includes(l))) {
          const p = document.createElement("p");
          const mark = document.createElement("mark");
          mark.textContent = line;
          p.append(mark);
          d.append(p);
        }
      }
      card.querySelector(".subject-content").prepend(d);
    }
  });
}
function openPhonePreview(r) {
  const d = document.createElement("dialog");
  d.className = "phone-dialog";
  d.innerHTML =
    '<button>Close preview</button><p>Saved draft preview · Not published</p><iframe title="Phone newsletter preview" style="width:390px;max-width:100%;height:65vh;border:0"></iframe>';
  document.body.append(d);
  d.querySelector("button").onclick = () => d.close();
  d.onclose = () => {
    window.removeEventListener("message", ready);
    d.remove();
  };
  d.showModal();
  const frame = d.querySelector("iframe");
  frame.src = "/family-newsletter.html?preview=1";
  const ready = (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== frame.contentWindow ||
      event.data?.type !== "newsletter-preview-ready"
    )
      return;
    frame.contentWindow.postMessage(
      {
        type: "newsletter-preview",
        data: {
          school: workspace.name,
          className: r.className,
          week: r.week,
          sendDate: r.sendDate,
          design: workspace.settings.design,
          demo: workspace.demo,
          publishedAt: new Date().toISOString(),
          entries: r.entries.map(
            ({ subject, english, vietnamese, links, images }) => ({
              subject,
              english,
              vietnamese,
              links,
              images,
            }),
          ),
        },
      },
      location.origin,
    );
  };
  window.addEventListener("message", ready);
}

function newsletterExtras(r, coord) {
  if (coord) {
    const section = document.createElement("details");
    section.className = "newsletter-workflow";
    section.innerHTML = `<summary>Coordinator reports</summary><p>See responsibilities and follow up with staff. Downloads use the selected filters.</p><form id="progressFilters"><label>Report type<select name="type"><option value="all">All contributions</option><option value="missing">Not submitted</option><option value="submitted">Submitted</option><option value="translation">Translation review outstanding</option><option value="overdue">Overdue contributions or reviews</option><option value="publication">Awaiting approval or publication</option><option value="unassigned">No teacher assigned</option></select></label><label>Week<select name="week"><option value="">All weeks</option>${[...new Set(workspace.reports.map((x) => x.week))].map((x) => `<option>${esc(x)}</option>`).join("")}</select></label><label>Class<select name="className"><option value="">All classes</option>${[...new Set(workspace.reports.map((x) => x.className))].map((x) => `<option>${esc(x)}</option>`).join("")}</select></label><button>Run report</button> <a id="progressDownload" hidden>Download CSV</a></form><div id="progressResult" role="status"></div>`;
    $("editor").querySelector(".contribution-overview").after(section);
    section.onclick = (e) => e.stopPropagation();
    section.onchange = () => {
      $("progressDownload").hidden = true;
    };
    section.onsubmit = (e) => {
      e.preventDefault();
      e.stopPropagation();
      run(async () => {
        const query = new URLSearchParams(
            new FormData($("progressFilters")),
          ).toString(),
          result = await api("/" + workspace.id + "/progress-report?" + query);
        $("progressDownload").hidden = false;
        $("progressDownload").href =
          root +
          "/" +
          workspace.id +
          "/progress-report?" +
          query +
          "&format=csv";
        $("progressResult").innerHTML =
          `<p>${result.rows.length} contributions</p><div style="overflow:auto"><table><thead><tr><th>Class / week</th><th>Subject</th><th>Teacher</th><th>Translator</th><th>Submitted</th><th>Submitted by</th><th>Reviewed</th><th>Approved</th><th>Published</th><th>Due</th></tr></thead><tbody>${result.rows.map((x) => `<tr><td>${esc(x.className)} · ${esc(x.week)}</td><td>${esc(x.subject)}</td><td>${esc(x.teachers || "Unassigned")}</td><td>${esc(x.translators || "Unassigned")}</td><td>${x.submitted}</td><td>${esc(x.submittedBy)}</td><td>${x.reviewed}</td><td>${x.approved ? "Yes" : "No"}</td><td>${x.publicationCurrent ? "Current" : x.published ? "Older version" : "No"}</td><td>${esc(x.deadline)}${x.overdue ? " · Overdue" : ""}</td></tr>`).join("")}</tbody></table></div>`;
      });
    };
  }
  document.querySelectorAll(".subject").forEach((card) => {
    const entry = r.entries[Number(card.dataset.index)];
    if (entry.reminder && (!entry.submitted || !entry.reviewed)) {
      const reminder = document.createElement("p");
      reminder.className = "review-feedback";
      reminder.textContent = `${entry.reminder.by} requested an update on ${new Date(entry.reminder.at).toLocaleDateString()}. ${entry.submitted ? "Please review the translation." : "Please submit this contribution."}`;
      card.querySelector(".subject-content").prepend(reminder);
    }
    if (entry.feedback) {
      const note = document.createElement("aside");
      note.className = "review-feedback";
      note.innerHTML = `<strong>${entry.feedbackResolved ? "Previous coordinator feedback · resubmitted" : "Changes requested"}</strong><p>${esc(entry.feedback)}</p><small>${esc(entry.feedbackBy || "Coordinator")}</small>`;
      card.querySelector(".subject-content").prepend(note);
    }
    if (coord) {
      const feedback = document.createElement("details");
      feedback.innerHTML = `<summary>Request a change</summary><label>Feedback for this subject<textarea maxlength="2000" placeholder="Identify the paragraph and explain the change needed."></textarea></label><button type="button">Send back for revision</button>`;
      feedback.onclick = (e) => e.stopPropagation();
      feedback.oninput = (e) => e.stopPropagation();
      feedback.onchange = (e) => e.stopPropagation();
      feedback.querySelector("button").onclick = () => {
        if (dirty) return status("Save your edits first.");
        const text = feedback.querySelector("textarea").value.trim();
        if (!text) return status("Write feedback first.");
        run(() =>
          busy(feedback.querySelector("button"), () =>
            change("feedback", {
              reportId: r.id,
              subject: entry.subject,
              text,
            }),
          ),
        );
      };
      card.querySelector(".subject-content").append(feedback);
    }
    const editable =
      coord ||
      (workspace.myRole === "teacher" &&
        workspace.mySubjects.includes(entry.subject) &&
        (!workspace.myClasses || workspace.myClasses.includes(r.className)));
    if (!editable) return;
    const guidance = document.createElement("p");
    guidance.className = "hint";
    guidance.textContent =
      "For the parent checklist, add a heading on its own line: Homework, Things to bring, Important dates or Conversation starters. Put the details directly below it. Only include what families actually need; the published reader collects these sections automatically.";
    card.querySelector(".subject-content").append(guidance);
    const d = document.createElement("details");
    d.className = "subject-media";
    const key = mediaKey(entry.subject);
    if (!mediaDrafts.has(key)) {
      try {
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        if (saved) mediaDrafts.set(key, saved);
      } catch {}
    }
    const draft = mediaDrafts.get(key);
    let images = structuredClone(draft?.images || entry.images || []);
    d.innerHTML = `<summary>Links and images</summary><p>Add up to 8 useful links and 3 images. Changes require submission and review before publication.</p><label>Links — one per line: title | https://address<textarea data-links rows="3">${esc(draft?.linksText ?? (entry.links || []).map((l) => l.label + " | " + l.url).join("\n"))}</textarea></label><label>Add an image<input data-image type="file" accept="image/png,image/jpeg,image/webp"></label><div data-images></div><button data-save-media>Save links and images</button><p data-media-status role="status"></p>`;
    card.querySelector(".subject-content").append(d);
    const keep = () => {
      const value = {
        images: structuredClone(images),
        linksText: d.querySelector("[data-links]").value,
      };
      mediaDrafts.set(key, value);
      dirty = true;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        d.querySelector("[data-media-status]").textContent =
          "This image draft is too large to keep after reload. Save it now.";
      }
    };
    const renderImages = () => {
      d.querySelector("[data-images]").innerHTML = images
        .map(
          (i, n) =>
            `<figure><img src="${esc(i.data)}" alt="Newsletter image" style="max-width:220px;max-height:140px"><label>Image description / caption<input data-caption="${n}" value="${esc(i.caption)}" maxlength="300"></label><button data-remove-image="${n}">Remove image</button></figure>`,
        )
        .join("");
    };
    renderImages();
    d.addEventListener("input", (e) => {
      if (e.target.dataset.caption !== undefined)
        images[Number(e.target.dataset.caption)].caption = e.target.value;
      keep();
    });
    d.onchange = async (e) => {
      if (!e.target.matches("[data-image]")) return;
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (images.length >= 3)
          throw Error("Remove an image before adding another.");
        if (file.size > 8000000)
          throw Error("Choose an image smaller than 8 MB.");
        const bitmap = await createImageBitmap(file),
          canvas = document.createElement("canvas");
        const scale = Math.min(1, 1200 / bitmap.width, 900 / bitmap.height);
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas
          .getContext("2d")
          .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        images.push({
          data: canvas.toDataURL("image/jpeg", 0.75),
          caption: "",
        });
        renderImages();
        keep();
        d.querySelector("[data-media-status]").textContent =
          "Image ready. Save links and images to keep it.";
      } catch (err) {
        d.querySelector("[data-media-status]").textContent = err.message;
      } finally {
        e.target.value = "";
      }
    };
    d.onclick = (e) => {
      e.stopPropagation();
      const b = e.target.closest("button");
      if (!b) return;
      e.preventDefault();
      if (b.dataset.removeImage !== undefined) {
        images.splice(Number(b.dataset.removeImage), 1);
        renderImages();
        keep();
      }
      if (b.hasAttribute("data-save-media"))
        run(() =>
          busy(b, async () => {
            try {
              const links = lines(d.querySelector("[data-links]").value).map(
                (line) => {
                  const i = line.indexOf("|");
                  return i < 0
                    ? { label: line, url: line }
                    : {
                        label: line.slice(0, i).trim(),
                        url: line.slice(i + 1).trim(),
                      };
                },
              );
              const snapshot = JSON.stringify(mediaDrafts.get(key));
              const result = await api("/" + workspace.id + "/change", {
                revision: workspace.revision,
                reportId,
                action: "media",
                subject: entry.subject,
                links,
                images,
              });
              if (JSON.stringify(mediaDrafts.get(key)) === snapshot) {
                mediaDrafts.delete(key);
                localStorage.removeItem(key);
              }
              setWorkspace(result);
              status(
                "Links and images saved. Submit the contribution when ready.",
              );
            } catch (err) {
              d.querySelector("[data-media-status]").textContent = err.message;
              throw err;
            }
          }),
        );
    };
  });
}

function renderProgressMatrix(panel, week) {
  panel.querySelector(".progress-matrix")?.remove();
  const reports = workspace.reports.filter((r) => !week || r.week === week);
  const subjects = [
    ...new Set(reports.flatMap((r) => r.entries.map((e) => e.subject))),
  ];
  const box = document.createElement("div");
  box.className = "progress-matrix";
  box.innerHTML = `<p class="hint">Select a subject to review it. Missing → Draft → Submitted → Translated → Approved.</p><div class="matrix-scroll" tabindex="0" role="region" aria-label="Class and subject progress"><table><thead><tr><th>Class / week</th>${subjects.map((s) => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>${reports
    .map(
      (r) =>
        `<tr><th>${esc(r.className)}<small>${esc(r.week)}</small>${r.deadline ? `<small>Due ${esc(r.deadline)}</small>` : ""}</th>${subjects
          .map((subject) => {
            const e = r.entries.find((e) => e.subject === subject);
            if (!e) return '<td aria-label="Not assigned">—</td>';
            const state = r.approved
              ? "Approved"
              : e.reviewed && e.submitted
                ? "Translated"
                : e.submitted
                  ? "Submitted"
                  : e.english?.trim()
                    ? "Draft"
                    : "Missing";
            const owners =
              workspace.members
                .filter(
                  (m) =>
                    m.role === "teacher" &&
                    m.subjects?.includes(subject) &&
                    (!m.classes || m.classes.includes(r.className)),
                )
                .map((m) => m.name)
                .join(", ") || "No teacher assigned";
            return `<td>${state !== "Approved" && state !== "Translated" ? `<label><input type="checkbox" data-remind-report="${r.id}" data-remind-subject="${esc(subject)}"> Remind</label>` : ""}<button class="matrix-cell state-${state.toLowerCase()}" data-task="${r.id}" data-subject-name="${esc(subject)}"><strong>${state}</strong><small>${esc(owners)}</small>${e.feedback && !e.feedbackResolved ? "<small>Changes requested</small>" : ""}</button></td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
  const remind = document.createElement("button");
  remind.className = "secondary";
  remind.textContent = "Send selected in-app reminders";
  const result = document.createElement("p");
  result.setAttribute("role", "status");
  remind.onclick = () => {
    if (dirty) return status("Save your edits first.");
    const targets = [
      ...box.querySelectorAll("[data-remind-report]:checked"),
    ].map((el) => ({
      reportId: el.dataset.remindReport,
      subject: el.dataset.remindSubject,
    }));
    if (!targets.length) {
      result.textContent = "Select at least one contribution above.";
      return;
    }
    run(() =>
      busy(remind, async () => {
        await change("remind", { targets });
        status(
          "Reminders saved. Staff will see them when they open the workspace; no email was sent.",
        );
      }),
    );
  };
  box.append(remind, result);
  panel.querySelector("#taskSummary").after(box);
}

async function renderEmailSettings() {
  const workspaceId = workspace.id;
  const panel = document.createElement('details');
  panel.className = 'report-maintenance';
  panel.innerHTML = '<summary>Email notifications</summary><p role="status">Loading notification settings…</p>';
  $('editor').append(panel);
  const endpoint = '/' + workspaceId + '/notifications';
  try {
    const data = await api(endpoint);
    if (!panel.isConnected || workspace.id !== workspaceId) return;
    const s = data.settings;
    const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const scheduleFields=(role,title,weekly)=>{
      const schedule=s[role];
      return `<fieldset><legend>${title}</legend><label><input type="checkbox" data-mail-${role}-enabled ${schedule.enabled?'checked':''}> Enable this report</label><div class="two">${weekly?`<label>Day<select data-mail-${role}-day>${days.map((day,i)=>`<option value="${i}" ${i===schedule.day?'selected':''}>${day}</option>`).join('')}</select></label>`:'<p>Daily · only when work is outstanding</p>'}<label>Time in Vietnam<input type="time" data-mail-${role}-time value="${esc(schedule.time)}"></label></div></fieldset>`;
    };
    panel.innerHTML = `<summary>Email notifications</summary><p>Schedule weekly teacher reminders, daily TA digests and your own weekly progress report. Reports due together for the same person share one email. Empty teacher and TA reports are skipped.</p><label>Delivery mode<select data-mail-mode><option value="off">Off — previews only</option><option value="test">Test — send only to my email</option>${workspace.demo ? '' : '<option value="live">Live — send to assigned staff</option>'}</select></label><p class="hint">Test recipient: ${esc(data.testEmail)}. No parent emails are sent. ${data.configured ? '' : 'Hosting email configuration is needed before sending.'}</p>${scheduleFields('teacher','Teacher reminders',true)}${scheduleFields('ta','TA translation digest',false)}<fieldset><legend>Coordinator progress report</legend><label><input type="checkbox" data-mail-coordinator-enabled ${s.coordinator.enabled?'checked':''}> Enable this report</label><div class="two"><label>Coordinator summary day<select data-mail-day>${days.map((day,i)=>`<option value="${i}">${day}</option>`).join('')}</select></label><label>Time in Vietnam<input data-mail-time type="time" value="${esc(s.time)}"></label></div></fieldset><p>${data.usage?.sent || 0} newsletter emails sent in the last 24 hours · sending allowance ${data.usage?.limit || 90}. This reserves room within a 100-email limit for other app emails; provider limits still apply.</p><div class="actions"><button data-mail-save>Save notification settings</button><button class="secondary" data-mail-preview>Preview emails</button><button class="secondary" data-mail-test ${data.configured ? '' : 'disabled'}>Send test to my email</button></div><p data-mail-status role="status"></p><div data-mail-previews></div><h4>Recent deliveries</h4><div>${data.deliveries.length ? data.deliveries.map(d=>`<p>${esc(d.subject)} · ${esc(d.to)} · <strong>${esc(d.status)}</strong>${d.error ? ' · '+esc(d.error) : ''}</p>`).join('') : '<p>No deliveries yet.</p>'}</div>`;
    panel.querySelector('[data-mail-mode]').value=s.mode;
    panel.querySelector('[data-mail-day]').value=String(s.day);
    panel.addEventListener('click', async event => {
      event.stopPropagation();
      const b = event.target.closest('button');
      if (!b) return;
      const status = panel.querySelector('[data-mail-status]');
      b.disabled=true;
      try {
        if (b.hasAttribute('data-mail-save')) {
          const readSchedule=(role,weekly)=>({enabled:panel.querySelector(`[data-mail-${role}-enabled]`).checked,time:panel.querySelector(`[data-mail-${role}-time]`).value,...(weekly?{day:Number(panel.querySelector(`[data-mail-${role}-day]`).value)}:{})});
          await api(endpoint,{mode:panel.querySelector('[data-mail-mode]').value,teacher:readSchedule('teacher',true),ta:readSchedule('ta',false),coordinator:{enabled:panel.querySelector('[data-mail-coordinator-enabled]').checked,day:Number(panel.querySelector('[data-mail-day]').value),time:panel.querySelector('[data-mail-time]').value}});
          status.textContent='Settings saved. Teacher, TA and coordinator reports follow their Vietnam-time schedules.';
        } else if (b.hasAttribute('data-mail-preview')) {
          const messages=await api(endpoint+'/preview');
          panel.querySelector('[data-mail-previews]').innerHTML=messages.map(m=>`<article><h4>${esc(m.subject)}</h4><p>Intended recipient: ${esc(m.recipient)}</p><p style="white-space:pre-line">${esc(m.body)}</p></article>`).join('') || '<p>No pending notifications.</p>';
          status.textContent='Preview only — nothing sent.';
        } else if (b.hasAttribute('data-mail-test')) {
          await api(endpoint+'/test',{});status.textContent='Test email sent to your account email. No staff or parents were emailed.';
        }
      } catch(error) {status.textContent=error.message;} finally {b.disabled=false;}
    });
  } catch(error) {panel.querySelector('[role="status"]').textContent=error.message;}
}
