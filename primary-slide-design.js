// Opt-in presentation layer. It never rewrites lesson content or teacher notes.
const { parseFraction, detectLabelledDiagram } = require("./concept-diagram");
const { tableLayout } = require("./lesson-slide-table");
function isPrimary(preset) {
  return preset?.design === "primary";
}
function hasNativeVisual(s) {
  return !!(
    s.table?.rows?.length ||
    s.worked?.steps?.length ||
    s.shortcuts?.length ||
    (s.visual?.type && s.visual.type !== "none") ||
    parseFraction(s.example) ||
    parseFraction(s.title) ||
    parseFraction(s.imageQuery) ||
    (!s.alignment &&
      detectLabelledDiagram(`${s.title || ""} ${s.imageQuery || ""}`))
  );
}
function wantsPicture(s, preset) {
  if (s.pictureMode === "hide") return false;
  if (s.pictureMode === "show") return !s.table?.rows?.length;
  if (!isPrimary(preset)) return true;
  if (hasNativeVisual(s)) return false;
  if (
    ["objectives", "check", "activity", "recap", "video"].includes(s.type) ||
    s.learnerTask?.required ||
    s.modelStage === "success_criteria"
  )
    return false;
  if (/outcome|criteria|game|reflect|plenary|check/i.test(s.modelStage || ""))
    return false;
  if (s.type === "title") return true;
  return s.layoutHint !== "TEXT_HEAVY" && !!s.imageQuery;
}
function primaryLayout(s) {
  if (s.table?.rows?.length) return "primary-table";
  if (s.worked?.steps?.length) return "primary-worked";
  if (!wantsPicture(s, { design: "primary" })) return "primary-text";
  return "primary-photo";
}
function normalizeFocus(focus, table) {
  if (
    !focus ||
    !["row", "column"].includes(focus.kind) ||
    !Number.isInteger(focus.index)
  )
    return null;
  const max =
    focus.kind === "column" ? table.headers.length : table.rows.length;
  return focus.index >= 0 && focus.index < max
    ? { kind: focus.kind, index: focus.index }
    : null;
}
function supports(s) {
  if (s.type === "video" || s.shortcuts?.length) return false;
  if (
    s.table?.rows?.length ||
    s.worked?.steps?.length ||
    s.learnerTask?.required
  )
    return true;
  return (
    !(s.visual?.type && s.visual.type !== "none") &&
    !parseFraction(s.example) &&
    !parseFraction(s.title) &&
    !parseFraction(s.imageQuery) &&
    !(
      !s.alignment &&
      detectLabelledDiagram(`${s.title || ""} ${s.imageQuery || ""}`)
    )
  );
}
function renderPrimarySlide({
  pptx,
  slide,
  s,
  imgPath,
  preset,
  index,
  fitTitleSize,
  fitBulletSize,
  bulletsHeightIn,
  theme,
}) {
  if (!supports(s)) return false; // Keep the proven specialist diagram/video renderers.
  const p = preset,
    font = p.font,
    heading = p.headingFont;
  const criteria = s.modelStage === "success_criteria",
    question = s.type === "check";
  const bg = criteria || question || s.type === "recap" ? p.soft : p.bg;
  slide.background = { color: bg };
  let serial = 0;
  function text(value, x, y, w, h, size = 22, options = {}) {
    if (!value) return;
    slide.addText(value, {
      x,
      y,
      w,
      h,
      fontFace: font,
      fontSize: size,
      color: p.text,
      margin: 0,
      breakLine: false,
      valign: "top",
      fit: "shrink",
      ...options,
    });
  }
  const title = (value, x, y, w, h, size = 32) =>
    text(value, x, y, w, h, fitTitleSize(value, w, h, size), {
      fontFace: heading,
      bold: true,
      color: p.primary,
    });
  const label =
    s.modelStageLabel ||
    (criteria ? "Success criteria" : "") ||
    {
      title: "Explore",
      objectives: s.title || "Learning objectives",
      check: "Quick check",
      activity: "Your turn",
      recap: "Recap",
    }[s.type] ||
    "Discover";
  // Explicit marker prevents the legacy animator from guessing a title/bullet box.
  text(label.toUpperCase(), 0.5, 0.27, 9, 0.3, 10, {
    bold: true,
    color: p.primary,
    objectName: "ls-primary-design",
  });
  text("LessonScope", 0.5, 5.35, 7, 0.17, 8, { color: p.primary });
  text(String(index + 1).padStart(2, "0"), 9.1, 5.32, 0.4, 0.22, 9, {
    color: p.primary,
  });
  const note =
    (s.modelLabel && s.modelLabel !== "Standard lesson"
      ? `Teaching model: ${s.modelLabel}\nLesson stage: ${s.modelStageLabel || ""}\n\n`
      : "") + (s.speakerNotes || "");
  slide.addNotes(
    note +
      (question
        ? "\nClick to reveal each answer after learners have responded."
        : "") +
      (s.worked?.steps?.length
        ? "\nClick to reveal each worked step as you model it."
        : ""),
  );
  if (s.type === "title") {
    const has = !!imgPath && wantsPicture(s, p),
      w = has ? 4.1 : 9;
    if (has)
      slide.addImage({
        path: imgPath,
        ...pptxgenSize(pptx, imgPath, 5, 0, 5, 5.1),
      });
    title(s.title, 0.5, 1.25, w, 2.15, 42);
    text(s.subtitle, 0.5, 3.75, w, 1, 20, { color: p.accent });
    return true;
  }
  title(
    s.type === "objectives" && !criteria
      ? String(s.title || "Learning objectives").toUpperCase()
      : s.title,
    0.5,
    0.7,
    9,
    0.85,
    32,
  );
  if (s.table?.rows?.length) {
    const t = s.table,
      fit = tableLayout(t, { height: 2.9 }),
      focus = normalizeFocus(t.focus, t);
    const rows = [
      t.headers.map((text) => ({
        text,
        options: { bold: true, color: "FFFFFF", fill: p.primary },
      })),
      ...t.rows.map((row, r) =>
        row.map((text, c) => ({
          text,
          options: {
            color: p.text,
            fill:
              focus &&
              (focus.kind === "row" ? r === focus.index : c === focus.index)
                ? p.highlight
                : r % 2
                  ? p.soft
                  : "FFFFFF",
            bold:
              !!focus &&
              (focus.kind === "row" ? r === focus.index : c === focus.index),
          },
        })),
      ),
    ];
    slide.addTable(rows, {
      x: 0.5,
      y: 1.65,
      w: 9,
      h: 2.9,
      colW: Array(t.headers.length).fill(9 / t.headers.length),
      rowH: fit.rowH,
      fontFace: font,
      fontSize: fit.fontSize,
      margin: 0.07,
      border: { type: "solid", color: "CBD8D1", pt: 1 },
      valign: "mid",
      autoPage: false,
    });
    const caption = [t.caption, ...(s.bullets || [])].filter(Boolean).join(" ");
    text(caption, 0.5, 4.72, 9, 0.52, fitTitleSize(caption, 9, 0.52, 17));
    return true;
  }
  const bullets = s.worked?.steps?.length ? s.worked.steps : s.bullets || [];
  if (s.worked?.steps?.length)
    text(s.worked.task, 0.5, 1.65, 9, 0.6, 20, { color: p.accent });
  const has = !!imgPath && wantsPicture(s, p) && !s.worked?.steps?.length;
  const x = 0.5,
    y = s.worked?.steps?.length ? 2.4 : s.learnerTask?.required ? 1.7 : 1.85,
    w = has ? 4.7 : 9;
  const example = s.worked?.steps?.length ? "" : s.example;
  const h = (example ? 4.45 : 5.08) - y;
  if (has)
    slide.addImage({
      path: imgPath,
      ...pptxgenSize(pptx, imgPath, 5.55, 1.85, 3.95, 3.2),
    });
  if (bullets.length) {
    const baseSize =
      bullets.length === 1 && !has ? 30 : bullets.length === 2 ? 25 : 23;
    const numbered =
      s.type === "objectives" || criteria || !!s.worked?.steps?.length;
    const textWidth = w - (numbered ? 0.7 : 0);
    const sizingTheme = {
      ...theme,
      playful: false,
      colorful: false,
      paraSpaceAfter: 8,
    };
    const size = fitBulletSize(bullets, sizingTheme, textWidth, h, baseSize);
    const measured = bullets.map(
      (b) => bulletsHeightIn([b], sizingTheme, textWidth, size, 0) + 0.06,
    );
    const extra =
      Math.max(0, h - measured.reduce((sum, n) => sum + n, 0)) / bullets.length;
    let rowY = y;
    // A single large question remains the focus; answers are separate named shapes.
    bullets.forEach((b, i) => {
      const rowH = measured[i] + extra;
      if (numbered)
        text(
          String(i + 1).padStart(2, "0"),
          x,
          rowY,
          0.48,
          rowH - 0.05,
          Math.min(24, size),
          {
            fontFace: heading,
            color: p.accent,
            objectName: s.worked?.steps?.length
              ? `ls-reveal-${i + 1}-${++serial}`
              : undefined,
          },
        );
      text(
        b,
        x + (numbered ? 0.7 : 0),
        rowY,
        w - (numbered ? 0.7 : 0),
        rowH - 0.06,
        size,
        {
          objectName:
            question || s.worked?.steps?.length
              ? `ls-reveal-${i + 1}-${++serial}`
              : undefined,
        },
      );
      rowY += rowH;
    });
  }
  if (example)
    text(
      example,
      0.5,
      4.65,
      has ? 4.7 : 9,
      0.57,
      fitTitleSize(example, has ? 4.7 : 9, 0.57, 17),
      { color: p.accent },
    );
  return true;
}
// PptxGenJS 4 fits the original bitmap inside the supplied box at export time.
function pptxgenSize(pptx, path, x, y, w, h) {
  return { x, y, w, h, sizing: { type: "contain", w, h } };
}
module.exports = {
  isPrimary,
  wantsPicture,
  primaryLayout,
  normalizeFocus,
  renderPrimarySlide,
};
