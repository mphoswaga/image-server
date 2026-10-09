const path = require("path");

// Branding from the school's supplied Weekly report PDF. Selected per workspace.
function drawSchoolReport(doc, workspace, report) {
  const navy = "#204581",
    blue = "#397cce",
    gold = "#ffd12d";
  const x = 40,
    width = doc.page.width - 80,
    bottom = doc.page.height - 52;
  let y;
  function band(text, colour, height, size, textColour = "#ffffff") {
    doc.rect(x, y, width, height).fill(colour);
    doc
      .font("Bold")
      .fontSize(size)
      .fillColor(textColour)
      .text(text, x + 10, y + 4, {
        width: width - 20,
        align: "center",
        lineBreak: false,
      });
    y += height;
  }
  function header() {
    y = 40;
    band("Cambridge Program - Weekly report", navy, 27, 15, gold);
    doc.rect(x, y, width, 58).fill(navy);
    doc.rect(x + 12, y, width - 24, 58).fill("#ffffff");
    doc.image(
      path.join(__dirname, "assets/newsletters/vinschool.png"),
      x + (width - 112) / 2,
      y + 2,
      { fit: [112, 54], align: "center" },
    );
    y += 58;
    band(
      `${report.className} · ${report.week}${report.sendDate ? " · " + report.sendDate : ""}`,
      navy,
      24,
      10,
      gold,
    );
    if (workspace.demo || !report.approved) {
      band(
        workspace.demo
          ? "DEMO — fictional sample for staff training"
          : "DRAFT — not approved for sharing",
        "#fff3ce",
        22,
        9,
        "#714514",
      );
    }
  }
  header();
  for (const entry of report.approved?.entries || report.entries) {
    if (y + 100 > bottom) {
      doc.addPage();
      header();
    }
    band(entry.subject, navy, 25, 12);
    band("Next week", blue, 19, 9);
    for (const [label, key] of [
      ["English", "english"],
      ["Tiếng Việt", "vietnamese"],
    ]) {
      const content =
        entry[key] ||
        (key === "english" ? "Contribution pending" : "Translation pending");
      // Split into measured lines, rather than shrink or clip longer contributions.
      const paragraphs = content.split(/\r?\n/);
      const lines = [];
      doc.font("Regular").fontSize(10);
      for (const paragraph of paragraphs) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const proposed = line ? line + " " + word : word;
          if (doc.widthOfString(proposed) > width - 44 && line) {
            lines.push(line);
            line = "";
          }
          // Long unbroken strings also wrap without leaking outside the frame.
          for (const char of (line ? " " : "") + word) {
            if (doc.widthOfString(line + char) > width - 44) {
              lines.push(line);
              line = "";
            }
            line += char;
          }
        }
        lines.push(line);
      }
      function continuation() {
        doc.addPage();
        header();
        band(`${entry.subject} · continued`, navy, 25, 12);
      }
      if (y + 48 > bottom) continuation();
      doc.rect(x, y, width, 23).fill(navy);
      doc.rect(x + 12, y, width - 24, 23).fill("#ffffff");
      doc
        .font("Bold")
        .fontSize(10)
        .fillColor("#233042")
        .text(label, x + 22, y + 5, { lineBreak: false });
      y += 23;
      for (const line of lines) {
        if (y + 16 > bottom) continuation();
        doc.rect(x, y, width, 16).fill(navy);
        doc.rect(x + 12, y, width - 24, 16).fill("#ffffff");
        doc
          .font("Regular")
          .fontSize(10)
          .fillColor("#17212d")
          .text(line, x + 22, y, { lineBreak: false });
        y += 16;
      }
      y += 8;
    }
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .strokeColor(gold)
      .lineWidth(1)
      .stroke();
    y += 10;
  }
}
module.exports = { drawSchoolReport };
