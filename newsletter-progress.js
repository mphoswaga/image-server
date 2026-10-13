function sameContent(r) {
  const clean = (entries) =>
    JSON.stringify(
      (entries || []).map((e) => ({
        subject: e.subject,
        english: e.english,
        vietnamese: e.vietnamese,
        links: e.links || [],
        images: (e.images || []).map((i) => ({
          caption: i.caption || "",
          data: i.data || i.assetId,
        })),
      })),
    );
  return (
    !!r.approved &&
    !!r.publication &&
    clean(r.approved.entries) === clean(r.publication.content.entries) &&
    r.sendDate === r.publication.content.sendDate
  );
}
function rows(w, filter = {}) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  return w.reports
    .filter(
      (r) =>
        (!filter.week || r.week === filter.week) &&
        (!filter.className || r.className === filter.className),
    )
    .flatMap((r) =>
      r.entries.map((e) => {
        const assigned = (role) =>
          w.members
            .filter(
              (m) =>
                m.role === role &&
                (!m.classes || m.classes.includes(r.className)) &&
                (role !== "teacher" || m.subjects.includes(e.subject)),
            )
            .map((m) => m.name)
            .join("; ");
        return {
          week: r.week,
          className: r.className,
          subject: e.subject,
          teachers: assigned("teacher"),
          translators: assigned("translator"),
          submitted: e.submitted ? "Yes" : "No",
          submittedAt: e.submitted ? e.submittedAt || "" : "",
          submittedBy: e.submitted ? e.submittedBy || "Not recorded" : "",
          reviewed: e.reviewed ? "Yes" : "No",
          deadline: r.deadline || "",
          overdue: !!(
            r.deadline &&
            r.deadline < today &&
            (!e.submitted || !e.reviewed)
          ),
          approved: !!r.approved,
          published: !!r.publication,
          publicationCurrent: sameContent(r),
          reportId: r.id,
        };
      }),
    )
    .filter(
      (x) =>
        !filter.type ||
        filter.type === "all" ||
        (filter.type === "missing" && x.submitted === "No") ||
        (filter.type === "submitted" && x.submitted === "Yes") ||
        (filter.type === "translation" && x.reviewed === "No") ||
        (filter.type === "overdue" && x.overdue) ||
        (filter.type === "unassigned" && !x.teachers) ||
        (filter.type === "publication" &&
          (!x.approved || !x.publicationCurrent)),
    );
}
function csv(rows) {
  const keys = [
    "week",
    "className",
    "subject",
    "teachers",
    "translators",
    "submitted",
    "submittedAt",
    "submittedBy",
    "reviewed",
    "deadline",
    "overdue",
    "approved",
    "published",
    "publicationCurrent",
  ];
  const cell = (v) =>
    '"' +
    String(v ?? "")
      .replace(/^[\s]*[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return (
    "\ufeff" +
    [keys, ...rows.map((r) => keys.map((k) => r[k]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
module.exports = { rows, csv };
