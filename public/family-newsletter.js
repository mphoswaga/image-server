"use strict";
const $ = (id) => document.getElementById(id);
const copy = {
  en: {
    title: "A little window into our week.",
    intro:
      "Explore what your child is learning, the words to discover and simple ways to help at home.",
    reading: "This week, by subject",
    expand: "Open all subjects",
    collapse: "Close all subjects",
    footer: "Keep a copy for later",
    footerText:
      "Prefer a printable version? Download the school newsletter below.",
    download: "Download PDF",
    demo: "Sample newsletter · Fictional content for demonstration.",
    updated: "Published",
    error:
      "This newsletter is unavailable. Please ask your school for the current link.",
    loading: "Preparing your PDF…",
    failed: "The download could not be completed. Please try again.",
  },
  vi: {
    title: "Cùng con khám phá tuần học.",
    intro:
      "Tìm hiểu những điều con đang học, từ vựng mới và các cách đơn giản để đồng hành cùng con tại nhà.",
    reading: "Nội dung theo môn học",
    expand: "Mở tất cả các môn",
    collapse: "Đóng tất cả các môn",
    footer: "Lưu lại để đọc sau",
    footerText:
      "Ba mẹ có thể tải bản tin của trường dưới dạng PDF để lưu hoặc in.",
    download: "Tải bản PDF",
    demo: "Bản tin mẫu · Nội dung minh họa.",
    updated: "Ngày đăng",
    error:
      "Không thể mở bản tin này. Ba mẹ vui lòng liên hệ nhà trường để nhận đường dẫn hiện tại.",
    loading: "Đang chuẩn bị bản PDF…",
    failed: "Không thể tải bản PDF. Ba mẹ vui lòng thử lại.",
  },
};
let data,
  lang = "en";
const [workspace, report, token] = location.hash.slice(1).split("/");
const endpoint =
  "/api/parent-newsletters/" +
  encodeURIComponent(workspace || "") +
  "/" +
  encodeURIComponent(report || "");
const options = {
  headers: { Authorization: "Bearer " + (token || "") },
  credentials: "omit",
  cache: "no-store",
};
const subjects = {
  ict: ["⌨", "#e9f2fa"],
  maths: ["＋", "#f9eddc"],
  science: ["✧", "#e8f2e9"],
  fle: ["Aa", "#eeeafa"],
  homework: ["⌂", "#f9ebe9"],
};
function paragraph(parent, text) {
  const p = document.createElement("p");
  p.textContent = text;
  parent.append(p);
}
function render() {
  const c = copy[lang],
    opened = new Set(
      [...document.querySelectorAll("#entries details[open]")].map((e) => e.id),
    );
  document.documentElement.lang = lang;
  document
    .querySelectorAll("[data-lang]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.lang === lang)),
    );
  if (!data) return;
  $("school").textContent = data.school;
  $("week").textContent = data.week;
  $("title").textContent = c.title;
  $("intro").textContent = c.intro;
  $("className").textContent = data.className;
  $("date").textContent = data.sendDate || "";
  $("logo").hidden = data.design !== "vinschool";
  $("demo").hidden = !data.demo;
  $("demo").textContent = c.demo;
  $("readingTitle").textContent = c.reading;
  $("footerTitle").textContent = c.footer;
  $("footerText").textContent = c.footerText;
  $("download").textContent = c.download;
  $("updated").textContent =
    c.updated +
    " · " +
    new Date(data.publishedAt).toLocaleDateString(
      lang === "vi" ? "vi-VN" : "en-GB",
      { day: "numeric", month: "long", year: "numeric" },
    );
  $("subjects").replaceChildren();
  $("entries").replaceChildren();
  data.entries.forEach((e, i) => {
    const id = "subject-" + i,
      a = document.createElement("a");
    a.href = "#" + id;
    a.textContent = e.subject;
    a.onclick = (event) => {
      event.preventDefault();
      const target = $(id);
      target.open = true;
      target.scrollIntoView({ behavior: "auto", block: "start" });
    };
    $("subjects").append(a);
    const d = document.createElement("details");
    d.id = id;
    d.open = opened.has(id) || (!opened.size && i === 0);
    const summary = document.createElement("summary"),
      icon = document.createElement("span"),
      name = document.createElement("span");
    const style = subjects[e.subject.toLowerCase()] || ["✦", "#edf1f6"];
    icon.className = "subject-icon";
    icon.textContent = style[0];
    icon.style.setProperty("--tint", style[1]);
    icon.setAttribute("aria-hidden", "true");
    name.textContent = e.subject;
    summary.append(icon, name);
    d.append(summary);
    const prose = document.createElement("div");
    prose.className = "prose";
    const text = e[lang === "vi" ? "vietnamese" : "english"] || "";
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split("\n");
      if (
        /^(key vocabulary|homework|how can you help at home\??|từ vựng chính|bài tập về nhà|ba mẹ.*\?)[:：]?$/i.test(
          lines[0].trim(),
        )
      ) {
        const h = document.createElement("h3");
        h.textContent = lines.shift();
        prose.append(h);
      }
      if (lines.join("\n").trim()) paragraph(prose, lines.join("\n"));
    }
    d.append(prose);
    d.addEventListener("toggle", updateExpand);
    $("entries").append(d);
  });
  updateExpand();
}
function updateExpand() {
  const all = [...document.querySelectorAll("#entries details")];
  $("expand").textContent =
    all.length && all.every((d) => d.open)
      ? copy[lang].collapse
      : copy[lang].expand;
}
$("expand").onclick = () => {
  const all = [...document.querySelectorAll("#entries details")],
    open = !all.every((d) => d.open);
  all.forEach((d) => (d.open = open));
  updateExpand();
};
document.querySelectorAll("[data-lang]").forEach(
  (b) =>
    (b.onclick = () => {
      lang = b.dataset.lang;
      render();
      if (!data) $("status").textContent = copy[lang].error;
    }),
);
$("download").onclick = async () => {
  const b = $("download");
  b.disabled = true;
  $("downloadStatus").textContent = copy[lang].loading;
  try {
    const r = await fetch(endpoint + "/pdf", options);
    if (!r.ok) throw Error();
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = "weekly-newsletter.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $("downloadStatus").textContent = "";
  } catch {
    $("downloadStatus").textContent = copy[lang].failed;
  } finally {
    b.disabled = false;
  }
};
(async () => {
  try {
    if (!token) throw Error();
    const r = await fetch(endpoint, options);
    if (!r.ok) throw Error();
    data = await r.json();
    render();
    $("status").textContent = "";
    $("content").hidden = false;
    document.title = data.className + " · " + data.week;
  } catch {
    $("status").textContent = copy[lang].error;
  }
})();
