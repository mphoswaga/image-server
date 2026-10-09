"use strict";
const expandedSubjects = new Set();
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
  $("coordinator").hidden = !coord;
  $("newReport").hidden = !coord || workspace.demo;
  $("invite").closest("details").hidden = !!workspace.demo;
  $("settings").elements.design.value = workspace.settings.design || "standard";
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
  $("editor").innerHTML =
    `<div class="report-heading"><div><p class="eyebrow">${esc(r.week)}</p><h2>${esc(r.className)}</h2><p class="hint">${r.sendDate ? "Sending " + esc(r.sendDate) : "Your weekly update for families"}</p></div><span class="pill">${r.approved ? "Approved for sharing" : r.entries.every((e) => e.submitted && e.reviewed) ? "Ready for approval" : r.entries.every((e) => e.submitted) ? "Awaiting translation & review" : "Draft"}</span></div><div class="workflow-progress"><span><b>${r.entries.filter((e) => e.submitted).length}/${r.entries.length}</b> contributions submitted</span><span><b>${r.entries.filter((e) => e.reviewed).length}/${r.entries.length}</b> translations reviewed</span></div><div class="report-preview-card"><div class="paper-symbol" aria-hidden="true">▤</div><div><h3>Your family newsletter</h3><p class="hint">${workspace.settings.design === "vinschool" ? "Vinschool · Cambridge weekly report" : "LessonScope report"} · Preview the saved pages before sharing.</p><div class="actions"><button data-action="pdf-preview">Preview PDF</button><button data-action="teacher-preview" class="secondary">Teacher preview</button>${coord && !r.approved ? '<button data-action="approve" class="secondary">Approve newsletter</button>' : ""}${r.approved ? '<button data-action="print" class="secondary">Download approved PDF</button>' : ""}</div></div></div><div class="section-heading"><h3>Subject contributions</h3><p class="hint">${coord ? "Review each subject, then approve the finished report." : workspace.myRole === "translator" ? "Review the Vietnamese wording, then mark each translation reviewed." : "Open your subject, add your learning update and submit it for translation."}</p></div>` +
    r.entries
      .map((e, i) => {
        const edit =
          coord ||
          (workspace.myRole === "teacher" &&
            workspace.mySubjects.includes(e.subject));
        const translate = coord || workspace.myRole === "translator";
        const owners = workspace.members
          .filter(
            (m) =>
              m.role === "teacher" && (m.subjects || []).includes(e.subject),
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
      if (action === "teacher-preview") {
        openTeacherPreview();
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
