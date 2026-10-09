const PDFDocument = require("pdfkit");
const path = require("path");
function newsletterPdf(workspace, report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: `${workspace.demo ? "DEMO · " : ""}${report.className} · ${report.week}`,
        Author: workspace.name,
      },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(
      "Regular",
      path.join(__dirname, "assets/fonts/noto-sans/NotoSans-Regular.ttf"),
    );
    doc.registerFont(
      "Bold",
      path.join(__dirname, "assets/fonts/noto-sans/NotoSans-Bold.ttf"),
    );
    const ink = "#203b49",
      teal = "#137d6b";
    const room = (n) => {
      if (doc.y + n > doc.page.height - 65) doc.addPage();
    };
    doc.font("Regular").fontSize(10).fillColor(teal).text(workspace.name);
    doc
      .moveDown()
      .font("Bold")
      .fontSize(25)
      .fillColor(ink)
      .text("Weekly newsletter");
    doc
      .moveDown(0.4)
      .font("Regular")
      .fontSize(11)
      .text(
        `${report.className} · ${report.week}${report.sendDate ? " · " + report.sendDate : ""}`,
      );
    doc.moveDown();
    if (workspace.demo || !report.approved)
      doc
        .font("Bold")
        .fontSize(10)
        .fillColor("#95521b")
        .text(
          workspace.demo
            ? "DEMO — fictional sample for staff training"
            : "DRAFT — not approved for sharing",
        )
        .moveDown();
    for (const entry of report.approved?.entries || report.entries) {
      room(120);
      doc.font("Bold").fontSize(17).fillColor(teal).text(entry.subject);
      doc.moveDown(0.4);
      for (const [label, key] of [
        ["English", "english"],
        ["Tiếng Việt", "vietnamese"],
      ]) {
        room(70);
        doc.font("Bold").fontSize(11).fillColor(ink).text(label).moveDown(0.3);
        doc
          .font("Regular")
          .fontSize(10.5)
          .text(
            entry[key] ||
              (key === "english"
                ? "Contribution pending"
                : "Translation pending"),
            { lineGap: 3 },
          );
        doc.moveDown();
      }
    }
    const { count } = doc.bufferedPageRange();
    for (let i = 0; i < count; i++) {
      doc.switchToPage(i);
      doc
        .font("Regular")
        .fontSize(8)
        .fillColor("#54756b")
        .text(
          `${workspace.demo ? "DEMO · " : ""}LessonScope · ${report.className} · ${i + 1} / ${count}`,
          48,
          doc.page.height - 38,
          { lineBreak: false },
        );
    }
    doc.end();
  });
}
module.exports = { newsletterPdf };
