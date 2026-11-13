// Editable classroom compositions. Content stays in the lesson model; shape
// names carry the exact reveal order into the exported PowerPoint.
const {
  parseFraction,
  detectLabelledDiagram,
  drawFractionPizza,
  drawNumberLine,
} = require("./concept-diagram");
const { tableLayout } = require("./lesson-slide-table");
const { displayVisual, revealText } = require("./classroom-visuals");
const isPrimary = (p) => p?.design === "primary";
function hasNativeVisual(s) {
  return !!(
    s.table?.rows?.length ||
    s.worked?.steps?.length ||
    s.shortcuts?.length ||
    displayVisual(s) ||
    parseFraction(s.example) ||
    parseFraction(s.title) ||
    parseFraction(s.imageQuery) ||
    (s.visual?.type && !["none", "illustration"].includes(s.visual.type))
  );
}
function wantsPicture(s, preset) {
  if (s.pictureMode === "hide") return false;
  if (s.pictureMode === "show") return !s.table?.rows?.length;
  if (!isPrimary(preset)) return true;
  if (hasNativeVisual(s)) return false;
  if (s.visual?.type === "illustration") return !s.assessmentProtected;
  if (
    ["objectives", "check", "activity", "recap", "video"].includes(s.type) ||
    s.learnerTask?.required ||
    /outcome|criteria|game|reflect|plenary|check/i.test(s.modelStage || "")
  )
    return false;
  return (
    s.type === "title" || (s.layoutHint !== "TEXT_HEAVY" && !!s.imageQuery)
  );
}
function primaryLayout(s) {
  return s.table?.rows?.length
    ? "primary-table"
    : displayVisual(s)
      ? "primary-diagram"
      : s.worked?.steps?.length
        ? "primary-worked"
        : wantsPicture(s, { design: "primary" })
          ? "primary-photo"
          : "primary-text";
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
function renderPrimarySlide({
  pptx,
  slide,
  s,
  imgPath,
  preset: p,
  index,
  fitTitleSize,
  fitBulletSize,
  bulletsHeightIn,
  theme,
}) {
  if (s.type === "video" || s.shortcuts?.length) return false;
  // Keep existing exact anatomical/object diagrams, but render illustrations,
  // sequences, comparisons, number lines and fractions in the classroom theme.
  if (
    s.visual?.type === "diagram" ||
    (!s.learnerTask?.required &&
      !s.alignment &&
      detectLabelledDiagram(`${s.title || ""} ${s.imageQuery || ""}`))
  )
    return false;
  const question = s.type === "check",
    task = !!s.learnerTask?.required,
    criteria = s.modelStage === "success_criteria";
  const visual = displayVisual(s),
    answers = revealText(s),
    has = !!imgPath && wantsPicture(s, p);
  const fraction =
    !task &&
    (parseFraction(s.example) ||
      parseFraction(s.title) ||
      parseFraction(s.imageQuery));
  const bg = question || criteria || s.type === "recap" ? p.soft : p.bg;
  slide.background = { color: bg };
  let serial = 0,
    beat = 0;
  const name = (step, role = "text") =>
    step ? `ls-reveal-${step}-${role}-${++serial}` : undefined;
  function text(value, x, y, w, h, size = 24, options = {}, step = 0) {
    if (!value) return;
    slide.addText(value, {
      x,
      y,
      w,
      h,
      fontFace: p.font,
      fontSize: fitTitleSize(value, w, h, size),
      color: p.text,
      margin: 0,
      breakLine: false,
      valign: "mid",
      fit: "shrink",
      objectName: name(step),
      ...options,
    });
  }
  function shape(type, x, y, w, h, fill, step = 0, options = {}) {
    slide.addShape(pptx.ShapeType[type], {
      x,
      y,
      w,
      h,
      fill: { color: fill },
      line: { color: fill, transparency: 100 },
      radius: 0.12,
      objectName: name(step, "shape"),
      ...options,
    });
  }
  function heading(
    value,
    x = 0.5,
    y = 0.63,
    w = 9,
    h = 0.9,
    size = 32,
    color = p.primary,
  ) {
    text(value, x, y, w, h, size, {
      fontFace: p.headingFont,
      bold: true,
      color,
      objectName: "ls-title",
    });
  }
  function image(x, y, w, h, step = 0) {
    slide.addImage({
      path: imgPath,
      x,
      y,
      w,
      h,
      sizing: { type: "contain", w, h },
      objectName: name(step, "image"),
    });
  }
  const marker =
    s.modelStageLabel ||
    {
      title: "Discover",
      objectives: criteria ? "Success criteria" : "Our learning",
      activity: "Your turn",
      check: "Think first",
      recap: "Take it with you",
    }[s.type] ||
    "Explore";
  text(marker.toUpperCase(), 0.5, 0.23, 8, 0.22, 10, {
    bold: true,
    color: p.accent,
    objectName: "ls-primary-design",
  });
  text("LessonScope", 0.5, 5.36, 7, 0.16, 8, { color: p.primary });
  text(String(index + 1).padStart(2, "0"), 9.05, 5.32, 0.45, 0.22, 9, {
    align: "right",
    color: p.primary,
  });
  slide.addNotes(
    (s.speakerNotes || "") +
      "\n\nPresentation: the heading appears first. Click once for each teaching point or problem. Wait for pupils before revealing an answer.",
  );
  const answerHeight = answers.length > 1 ? 1.05 : 0.68,
    answerY = 5.1 - answerHeight;
  const reserve = answers.length ? answerHeight + 0.15 : 0,
    bottom = 5.08 - reserve;
  function answerPanel() {
    if (!answers.length) return;
    const step = ++beat;
    shape("roundRect", 0.5, answerY, 9, answerHeight, p.primary, step);
    const rowH = (answerHeight - 0.14) / answers.length;
    answers.forEach((answer, i) =>
      text(
        answer,
        0.7,
        answerY + 0.07 + i * rowH,
        8.6,
        rowH,
        20,
        { color: "FFFFFF", bold: true },
        i ? ++beat : step,
      ),
    );
  }
  if (s.type === "title") {
    if (has) {
      image(4.8, 0.65, 4.85, 4.4);
      heading(s.title, 0.5, 1.02, 4.05, 2.1, 42);
      text(s.subtitle, 0.5, 3.43, 3.95, 1, 23, { color: p.accent }, ++beat);
    } else {
      heading(s.title, 0.65, 1.3, 8.7, 1.8, 45);
      text(s.subtitle, 0.68, 3.4, 8.4, 0.9, 25, { color: p.accent }, ++beat);
    }
    return true;
  }
  heading(
    s.type === "objectives" && !criteria
      ? String(s.title || "Learning objectives").toUpperCase()
      : s.title,
  );
  if (s.table?.rows?.length) {
    const t = s.table,
      focus = normalizeFocus(t.focus, t),
      prompt = (s.bullets || []).join(" ");
    if (!answers.length) {
      const fit = tableLayout(t, { height: 2.9 });
      if (prompt)
        text(
          [prompt, t.caption].filter(Boolean).join(" "),
          0.5,
          4.72,
          9,
          0.52,
          19,
          {},
          ++beat,
        );
      const step = ++beat;
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
        fontFace: p.font,
        fontSize: fit.fontSize,
        margin: 0.07,
        border: { type: "solid", color: "CBD8D1", pt: 1 },
        valign: "mid",
        autoPage: false,
        objectName: name(step, "table"),
      });
      if (!prompt)
        text(t.caption, 0.5, 4.72, 9, 0.52, 19, { color: p.accent }, ++beat);
      return true;
    }
    if (prompt) text(prompt, 0.5, 1.6, 9, 0.55, 22, {}, ++beat);
    const y = prompt ? 2.15 : 1.75,
      height = Math.min(1.65, answerY - y - 0.36),
      fit = tableLayout(t, { height }),
      step = ++beat;
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
      y,
      w: 9,
      h: height,
      colW: Array(t.headers.length).fill(9 / t.headers.length),
      rowH: fit.rowH,
      fontFace: p.font,
      fontSize: fit.fontSize,
      margin: 0.07,
      border: { type: "solid", color: "CBD8D1", pt: 1 },
      valign: "mid",
      autoPage: false,
      objectName: name(step, "table"),
    });
    text(
      t.caption,
      0.5,
      answerY - 0.32,
      9,
      0.25,
      14,
      { color: p.accent },
      ++beat,
    );
    answerPanel();
    return true;
  }
  if (visual) {
    let y = 1.8;
    if (visual.prompt) {
      const h =
        visual.prompt.length > 180
          ? 1.2
          : visual.prompt.length > 110
            ? 0.82
            : 0.62;
      text(visual.prompt, 0.5, 1.65, 9, h, 24, { color: p.primary }, ++beat);
      y = 1.65 + h + 0.16;
    }
    const items = visual.items,
      n = items.length;
    if (visual.type === "steps" || visual.type === "cycle") {
      const cols = n <= 4 ? n : 3,
        rows = Math.ceil(n / cols),
        gap = 0.26,
        w = (9 - (cols - 1) * gap) / cols,
        h = Math.min(1.25, (bottom - y - (rows - 1) * 0.28) / rows);
      const problemBeat = visual.task ? ++beat : null;
      items.forEach((value, i) => {
        const step = problemBeat || ++beat,
          row = Math.floor(i / cols),
          slot = i % cols,
          col = row % 2 ? cols - 1 - slot : slot,
          x = 0.5 + col * (w + gap),
          yy = y + row * (h + 0.28);
        shape("roundRect", x, yy, w, h, i % 2 ? p.soft : "FFFFFF", step, {
          line: { color: p.accent, width: 1.4 },
        });
        text(
          String(i + 1).padStart(2, "0"),
          x + 0.12,
          rows > 1 ? yy + (h - 0.3) / 2 : yy + 0.09,
          0.38,
          0.3,
          17,
          { bold: true, color: p.accent },
          step,
        );
        text(
          value,
          x + (rows > 1 ? 0.62 : 0.14),
          yy + (rows > 1 ? 0.08 : 0.44),
          w - (rows > 1 ? 0.74 : 0.28),
          h - (rows > 1 ? 0.16 : 0.5),
          n > 4 ? 20 : 23,
          { bold: true },
          step,
        );
        if (slot)
          text(
            row % 2 ? "←" : "→",
            row % 2 ? x + w : x - 0.26,
            yy + h / 2 - 0.2,
            0.26,
            0.4,
            21,
            { align: "center", color: p.accent },
            step,
          );
        if (row && slot === 0)
          text(
            "↓",
            x + w / 2 - 0.17,
            yy - 0.28,
            0.34,
            0.26,
            18,
            { color: p.accent, align: "center" },
            step,
          );
      });
      if (visual.type === "cycle")
        text(
          "↺ Repeat the cycle",
          0.5,
          4.78,
          9,
          0.35,
          18,
          { color: p.accent },
          ++beat,
        );
    } else if (visual.type === "compare") {
      items.forEach((item, i) => {
        const step = ++beat,
          x = 0.5 + i * 4.65;
        shape("rect", x, y, 4.35, bottom - y, i ? p.soft : "FFFFFF", step);
        text(item, x + 0.2, y + 0.15, 3.95, bottom - y - 0.3, 25, {}, step);
      });
    } else {
      // A native concept map: one topic, meaningful related ideas, clear links.
      const cy = y + (bottom - y) / 2;
      shape("ellipse", 3.75, cy - 0.58, 2.5, 1.16, p.primary, ++beat);
      text(
        s.title.match(/[“"']([^”"']+)[”"']/)?.[1] || s.title,
        3.9,
        cy - 0.4,
        2.2,
        0.8,
        22,
        { color: "FFFFFF", bold: true, align: "center" },
        beat,
      );
      items.forEach((item, i) => {
        const right = i % 2 === 1,
          row = Math.floor(i / 2),
          count = Math.ceil(n / 2),
          yy = y + (row * (bottom - y)) / count,
          x = right ? 6.65 : 0.5,
          step = ++beat;
        const endY = yy + 0.36;
        slide.addShape(pptx.ShapeType.line, {
          x: right ? 6.25 : 3.3,
          y: Math.min(cy, endY),
          w: 0.4,
          h: Math.abs(endY - cy),
          flipV: endY < cy,
          line: { color: p.accent, width: 2 },
          objectName: name(step, "connector"),
        });
        text(
          item,
          x,
          yy,
          2.85,
          0.85,
          22,
          { bold: true, color: p.primary },
          step,
        );
      });
    }
    answerPanel();
    return true;
  }
  if (fraction) {
    const initial = ++beat,
      start = slide._slideObjects.length;
    drawFractionPizza(pptx, slide, {
      ...fraction,
      x: 0.75,
      y: 1.7,
      w: 2.65,
      accent: p.accent,
      dividerColor: bg,
      labelSlash: "/",
    });
    // Diagram outline first, shaded parts next, then the numerical explanation.
    slide._slideObjects.slice(start).forEach((o) => {
      const old = o.options?.objectName || "",
        fill = old.match(/^lc-anim-fill-(\d+)$/);
      if (o.options)
        o.options.objectName = name(
          fill
            ? initial + 1 + Number(fill[1])
            : old === "lc-pizza"
              ? initial
              : initial + fraction.num + 1,
          "fraction",
        );
    });
    beat = initial + fraction.num + 1;
    const words = (s.bullets || []).filter(Boolean);
    words.forEach((v, i) =>
      text(v, 4.05, 1.9 + i * 0.83, 5.25, 0.7, 25, {}, ++beat),
    );
    if (s.example && !/^\s*\d+\s*[/⁄]\s*\d+\s*$/.test(s.example))
      text(
        s.example,
        4.05,
        answers.length ? answerY - 0.6 : 4.65,
        5.2,
        0.45,
        20,
        { color: p.accent },
        ++beat,
      );
    answerPanel();
    return true;
  }
  if (s.visual?.type === "numberline") {
    const [start, end, step, mark] = (s.visual.items || []).map(Number);
    const before = slide._slideObjects.length;
    if (
      drawNumberLine(pptx, slide, {
        start,
        end,
        step,
        mark,
        x: 0.7,
        y: 2,
        w: 8.6,
        accent: p.accent,
      })
    ) {
      const initial = ++beat;
      slide._slideObjects.slice(before).forEach((o) => {
        if (o.options)
          o.options.objectName = name(
            (o.options.objectName || "").startsWith("lc-anim-fill")
              ? initial + 1
              : initial,
            "numberline",
          );
      });
      beat++;
      const words = [...(s.bullets || []), s.example].filter(Boolean);
      words.forEach((word, i) =>
        text(
          word,
          0.5,
          3.05 + i * 0.5,
          9,
          0.46,
          22,
          { color: p.accent },
          ++beat,
        ),
      );
      answerPanel();
      return true;
    }
  }
  const bullets = s.worked?.steps?.length ? s.worked.steps : s.bullets || [];
  if (s.worked?.steps?.length)
    text(s.worked.task, 0.5, 1.6, 9, 0.65, 23, { color: p.accent }, ++beat);
  const numbered =
    s.type === "objectives" || criteria || !!s.worked?.steps?.length;
  const y = s.worked?.steps?.length ? 2.4 : 1.8,
    w = has ? 4.4 : 9;
  if (has) image(5.25, 1.7, 4.3, Math.min(3.4, bottom - 1.7), ++beat);
  const example = s.worked?.steps?.length ? "" : s.example;
  const h = (example ? Math.min(4.5, bottom - 0.6) : bottom) - y,
    tw = w - (numbered ? 0.65 : 0);
  const sizing = {
    ...theme,
    playful: false,
    colorful: false,
    paraSpaceAfter: 8,
  };
  const size = fitBulletSize(
    bullets,
    sizing,
    tw,
    h,
    bullets.length === 1 && !has ? 30 : bullets.length <= 3 ? 25 : 23,
  );
  const heights = bullets.map(
    (b) => bulletsHeightIn([b], sizing, tw, size, 0) + 0.1,
  );
  const gap = Math.min(
    0.22,
    Math.max(
      0.03,
      (h - heights.reduce((a, b) => a + b, 0)) /
        Math.max(1, bullets.length - 1),
    ),
  );
  let yy = y;
  bullets.forEach((value, i) => {
    const step = ++beat,
      rowH = heights[i];
    if (numbered)
      text(
        String(i + 1).padStart(2, "0"),
        0.5,
        yy,
        0.45,
        0.4,
        20,
        { bold: true, color: p.accent },
        step,
      );
    text(
      value,
      0.5 + (numbered ? 0.65 : 0),
      yy,
      tw,
      rowH,
      size,
      { bold: (task && i === 0) || question },
      step,
    );
    yy += rowH + gap;
  });
  if (example)
    text(
      example,
      0.5,
      answers.length ? answerY - 0.66 : 4.65,
      has ? 4.4 : 9,
      0.55,
      20,
      { color: p.accent },
      ++beat,
    );
  answerPanel();
  return true;
}
module.exports = {
  isPrimary,
  wantsPicture,
  primaryLayout,
  normalizeFocus,
  renderPrimarySlide,
  hasNativeVisual,
};
