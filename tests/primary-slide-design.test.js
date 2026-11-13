const test = require("node:test");
const assert = require("node:assert/strict");
const PizZip = require("pizzip");
const { DOMParser } = require("@xmldom/xmldom");
const { rebuildDeck, selectImages } = require("../generate");
const { getPreset } = require("../slide-presets");
const { animateBuffer } = require("../animate-pptx");
const { validateAlignedExport } = require("../lesson-deck-export");
const { wantsPicture } = require("../primary-slide-design");

const slides = [
  {
    type: "title",
    title: "Become a data detective",
    subtitle: "Find the story in a table.",
    bullets: [],
  },
  {
    type: "objectives",
    title: "Learning outcomes",
    bullets: [
      "Identify fields and records in a table.",
      "Choose a suitable data type.",
    ],
  },
  {
    type: "objectives",
    modelStage: "success_criteria",
    title: "I will be successful when…",
    bullets: [
      "I can point to one field and one record.",
      "I can explain whether a value is text, a number or a date.",
    ],
  },
  {
    type: "content",
    title: "One row tells one story",
    bullets: [],
    table: {
      headers: ["Name", "Pets", "Birthday"],
      rows: [
        ["Maya", "2", "12 June"],
        ["Ben", "0", "4 March"],
        ["Linh", "1", "23 July"],
      ],
      caption: "Which field stores a number?",
      focus: { kind: "row", index: 1 },
    },
    alignment: { id: "table" },
    speakerNotes: "Answer: Pets. A genuine zero means Ben has no pets.",
  },
  {
    type: "content",
    title: "Let’s read a record",
    bullets: [],
    worked: {
      task: "Find Ben’s record. What does it tell us?",
      steps: [
        "Find Ben in the Name field.",
        "Read across the same row.",
        "Ben has no pets. His birthday is 4 March.",
      ],
    },
    speakerNotes: "Model reading across one row.",
  },
  {
    type: "activity",
    title: "Your turn",
    bullets: [
      "Write a table for three imaginary pets.",
      "Include a name field and an age field.",
      "Explain your data types to a partner.",
    ],
    learnerTask: { required: true },
    speakerNotes: "Keep sample solutions in teacher notes only.",
  },
  {
    type: "check",
    title: "Is “12 June” a number or a date?",
    bullets: [
      "It is a date: a day and a month.",
      "A number alone does not tell us which day.",
    ],
    speakerNotes: "Wait for pupils to explain before revealing.",
  },
  {
    type: "recap",
    title: "One thing you can explain",
    bullets: ["What is the difference between a field and a record?"],
    speakerNotes: "Use answers to plan the next lesson.",
  },
];

async function exportDeck(presetId, data = slides) {
  const deck = {
    grade: "Grade 3",
    presetId,
    slides: structuredClone(data),
    images: data.map(() => null),
  };
  const buffer = animateBuffer(
    await rebuildDeck(deck).write({ outputType: "nodebuffer" }),
    "early",
  );
  validateAlignedExport(buffer, deck);
  return new PizZip(buffer);
}

test("all primary designs export the full lesson, editable data and teacher guidance", async () => {
  for (const preset of [
    "primary-discovery",
    "primary-sunshine",
    "primary-ocean",
  ]) {
    const zip = await exportDeck(preset);
    assert.equal(zip.file(/ppt\/slides\/slide\d+\.xml$/).length, slides.length);
    const xml = zip.file("ppt/slides/slide4.xml").asText();
    assert.match(xml, /<a:tbl>/);
    assert.match(xml, /Ben/);
    assert.match(xml, /<a:t>0<\/a:t>/);
    assert.match(xml, new RegExp(getPreset(preset).highlight));
    assert.match(
      zip.file("ppt/slides/slide2.xml").asText(),
      /LEARNING OUTCOMES/,
    );
    assert.match(
      zip.file("ppt/slides/slide3.xml").asText(),
      /I can point to one field/,
    );
    assert.match(
      zip.file("ppt/notesSlides/notesSlide4.xml").asText(),
      /A genuine zero/,
    );
    assert.match(
      zip.file("ppt/slides/slide1.xml").asText(),
      /Arial Rounded MT Bold/,
    );
  }
});

test("headings open first and teaching points, questions and answers reveal in order", async () => {
  const zip = await exportDeck("primary-discovery");
  for (const [index, expected] of [
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 4],
    [6, 3],
    [7, 2],
    [8, 1],
  ]) {
    const xml = zip.file(`ppt/slides/slide${index}.xml`).asText();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    assert.equal(
      (xml.match(/nodeType="clickEffect"/g) || []).length,
      expected,
      `slide ${index}`,
    );
    const shapeIds = new Set(
      Array.from(doc.getElementsByTagName("p:cNvPr")).map((n) =>
        n.getAttribute("id"),
      ),
    );
    for (const target of Array.from(doc.getElementsByTagName("p:spTgt")))
      assert.ok(shapeIds.has(target.getAttribute("spid")));
    const timingIds = Array.from(doc.getElementsByTagName("p:cTn")).map((n) =>
      n.getAttribute("id"),
    );
    assert.equal(new Set(timingIds).size, timingIds.length);
    assert.match(xml, /<p:transition spd="fast" advClick="1">/);
  }
});

test("text-led primary slides need no stock library or network, with reversible teacher override", async () => {
  const preset = getPreset("primary-discovery");
  const data = slides.filter((s) => s.type !== "title");
  assert.ok(data.every((s) => !wantsPicture(s, preset)));
  const images = await selectImages(
    data,
    "no-images-required",
    "primary-test",
    [],
    preset,
  );
  assert.equal(images.length, data.length);
  assert.ok(images.every((i) => !i.relpath));
  assert.equal(
    wantsPicture({ ...slides[5], pictureMode: "show" }, preset),
    true,
  );
  assert.equal(
    wantsPicture({ ...slides[0], pictureMode: "hide" }, preset),
    false,
  );
  assert.equal(wantsPicture(slides[5], getPreset("ocean-classic")), true);
});

test("legacy deck keeps its fonts and animation policy", async () => {
  const zip = await exportDeck("ocean-classic");
  const xml = zip.file("ppt/slides/slide2.xml").asText();
  assert.doesNotMatch(xml, /ls-primary-design|Arial Rounded/);
  assert.match(xml, /<p:transition spd="slow">/);
  assert.match(xml, /nodeType="clickEffect"/);
});

module.exports = { slides };

test("primary photos reach the exported file and explicit hiding removes them", async () => {
  const fs = require("node:fs"),
    path = require("node:path");
  const { mediaWriteDir } = require("../media");
  const dir = mediaWriteDir("primary-photo-test");
  fs.writeFileSync(
    path.join(dir, "photo.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  try {
    for (const type of ["title", "content", "activity"])
      for (const mode of ["show", "hide"]) {
        const pptx = rebuildDeck({
          grade: "Grade 3",
          presetId: "primary-discovery",
          slides: [
            {
              type,
              title: "A data detective",
              bullets: ["Look carefully."],
              pictureMode: mode,
            },
          ],
          images: [{ relpath: "primary-photo-test/photo.png" }],
        });
        const zip = new PizZip(await pptx.write({ outputType: "nodebuffer" }));
        assert.equal(
          zip.file("ppt/slides/slide1.xml").asText().includes("<p:pic>"),
          mode === "show",
          `${type}: ${mode}`,
        );
      }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("longer generated activity instructions stay together and remain readable", async () => {
  const task = {
    type: "activity",
    title: "Your Turn: Class Pet Table",
    learnerTask: { required: true },
    bullets: [
      "Goal: Create a pet table with records.",
      "You'll need: Paper, Pencil, Ruler",
      "Create a table for three imaginary pets. What column headers will you use and why? Share an example for each pet!",
      "Draw a table with 4 rows and 2 columns.",
      "Label the first column 'Name' and the second 'Age'.",
      "Write down 3 imaginary pet names in the first column.",
      "Choose ages for each pet and write them in the second column.",
    ],
  };
  const zip = await exportDeck("primary-discovery", [task]);
  assert.equal(zip.file(/ppt\/slides\/slide\d+\.xml$/).length, 1);
  const doc = new DOMParser().parseFromString(
    zip.file("ppt/slides/slide1.xml").asText(),
    "text/xml",
  );
  for (const sp of Array.from(doc.getElementsByTagName("p:sp"))) {
    const text = Array.from(sp.getElementsByTagName("a:t"))
      .map((n) => n.textContent)
      .join("");
    if (!task.bullets.includes(text)) continue;
    const run = sp.getElementsByTagName("a:rPr")[0];
    assert.ok(Number(run.getAttribute("sz")) >= 1800);
    const offset = sp.getElementsByTagName("a:off")[0],
      extent = sp.getElementsByTagName("a:ext")[0];
    assert.ok(
      Number(offset.getAttribute("y")) + Number(extent.getAttribute("cy")) <
        5.3 * 914400,
    );
  }
});
