const test = require("node:test");
const assert = require("node:assert/strict");
const PizZip = require("pizzip");
const { DOMParser } = require("@xmldom/xmldom");
const classroom = require("../classroom-visuals");
const { rebuildDeck, paginateSlides } = require("../generate");
const { animateBuffer } = require("../animate-pptx");
const { gradeProfile } = require("../grade");
const { getPreset } = require("../slide-presets");
const { validateAlignedExport } = require("../lesson-deck-export");
const task = {
  type: "content",
  title: "Spot the repeated action",
  learnerTask: {
    required: true,
    answer: "PRIVATE: Remove the second Make the bed.",
  },
  bullets: [
    "Which action repeats?",
    "Pick up toys → Make the bed → Make the bed → Put away shoes",
  ],
  reveal: ["Make the bed appears twice. Keep it once."],
};
function groups(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return Array.from(doc.getElementsByTagName("p:sp")).map((sp) => ({
    name: sp.getElementsByTagName("p:cNvPr")[0]?.getAttribute("name"),
    id: sp.getElementsByTagName("p:cNvPr")[0]?.getAttribute("id"),
    text: Array.from(sp.getElementsByTagName("a:t"))
      .map((x) => x.textContent)
      .join(""),
  }));
}
async function exportSlides(slides) {
  const deck = {
    slides,
    images: slides.map(() => null),
    grade: "Grade 3",
    presetId: "primary-discovery",
  };
  const bytes = animateBuffer(
    await rebuildDeck(deck).write({ outputType: "nodebuffer" }),
    "early",
  );
  validateAlignedExport(bytes, deck);
  return new PizZip(bytes);
}
test("question, complete problem and explicit answer have distinct ordered clicks", async () => {
  const zip = await exportSlides([task]);
  const xml = zip.file("ppt/slides/slide1.xml").asText();
  const shapes = groups(xml);
  const nameFor = (text) => shapes.find((s) => s.text === text)?.name;
  assert.match(nameFor("Which action repeats?"), /^ls-reveal-1-/);
  for (const action of classroom.displayVisual(task).items)
    assert.match(nameFor(action), /^ls-reveal-2-/);
  assert.match(nameFor(task.reveal[0]), /^ls-reveal-3-/);
  assert.equal((xml.match(/nodeType="clickEffect"/g) || []).length, 3);
  assert.doesNotMatch(xml, /PRIVATE/);
  const targets = new Set(
    Array.from(
      new DOMParser()
        .parseFromString(xml, "text/xml")
        .getElementsByTagName("p:spTgt"),
    ).map((x) => x.getAttribute("spid")),
  );
  for (const s of shapes.filter((s) => /^ls-reveal-/.test(s.name)))
    assert.ok(targets.has(s.id));
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  for (const effect of Array.from(doc.getElementsByTagName("p:cTn")).filter(
    (n) => ["clickEffect", "withEffect"].includes(n.getAttribute("nodeType")),
  )) {
    const children = effect.getElementsByTagName("p:childTnLst")[0];
    assert.equal(
      children.firstChild.tagName,
      "p:set",
      "Native entrance must establish visibility before the fade",
    );
  }
  assert.ok(
    !targets.has(shapes.find((s) => s.name === "ls-title").id),
    "Heading is visible before the first click",
  );
});
test("long algorithms show their data once and retain every step in order", async () => {
  const chain =
    "Make the bed → Pick up toys → Clean the floor → Make the bed → Put clothes away → Put shoes on the rack";
  const s = { ...task, bullets: ["Edit and reorder: " + chain + ".", chain] };
  const v = classroom.displayVisual(s);
  assert.equal(v.prompt, "Edit and reorder.");
  assert.equal(v.items.length, 6);
  const zip = await exportSlides([s]),
    xml = zip.file("ppt/slides/slide1.xml").asText();
  assert.doesNotMatch(xml, /Edit and reorder: Make/);
  assert.match(xml, /Put shoes on the rack/);
  assert.match(xml, /←/);
});
test("each explicit answer point has its own later click", async () => {
  const s = {
    type: "content",
    title: "Explain your choice",
    bullets: ["Which order works better?"],
    reveal: ["Put on socks first.", "Shoes go on after socks."],
    learnerTask: { required: true },
  };
  const xml = (await exportSlides([s])).file("ppt/slides/slide1.xml").asText(),
    shapes = groups(xml);
  assert.match(
    shapes.find((x) => x.text === s.reveal[0]).name,
    /^ls-reveal-2-/,
  );
  assert.match(
    shapes.find((x) => x.text === s.reveal[1]).name,
    /^ls-reveal-3-/,
  );
});
test("observational task art remains visible and no solution becomes a diagram", () => {
  const { materializeTask } = require("../lesson-activity-slides");
  const art = {
    type: "illustration",
    items: ["A child observing toys scattered in a bedroom."],
  };
  const s = materializeTask({
    ...task,
    visual: art,
    learnerTask: {
      required: true,
      question: "What would you tidy first?",
      stimulus: ["Look carefully at the room."],
      answer: "Accept any safe first action.",
    },
  });
  assert.deepEqual(s.visual, art);
  assert.equal(classroom.displayVisual(s), null);
  assert.doesNotMatch(s.bullets.join(" "), /Accept any/);
});
test("diagrams follow teacher edits and never extract the private answer", () => {
  const edited = {
    ...task,
    bullets: [
      "Which step comes last?",
      "Open the box → Put toys inside → Close the box",
    ],
    reveal: [],
  };
  assert.deepEqual(classroom.displayVisual(edited).items, [
    "Open the box",
    "Put toys inside",
    "Close the box",
  ]);
  assert.deepEqual(classroom.revealText(edited), []);
  for (const flag of ["assessmentProtected", "assessmentPhaseType"]) {
    const s = { ...task, [flag]: true };
    assert.equal(classroom.displayVisual(s), null);
    assert.deepEqual(classroom.revealText(s), []);
  }
});
test("fractions reveal the equal parts, each shaded part, then the label", async () => {
  const zip = await exportSlides([
    {
      type: "content",
      title: "Build three quarters",
      example: "3/4",
      bullets: ["Each part has the same size."],
    },
  ]);
  const shapes = groups(zip.file("ppt/slides/slide1.xml").asText());
  assert.match(shapes.find((x) => x.text === "3/4").name, /^ls-reveal-5-/);
  for (const n of [1, 2, 3, 4])
    assert.ok(
      shapes.some((x) => x.name?.startsWith("ls-reveal-" + n + "-fraction")),
    );
});
test("tables and their answers survive export, with the answer as the last click", async () => {
  const s = {
    type: "content",
    title: "Read the pet table",
    bullets: ["Who has no pets?"],
    table: {
      headers: ["Name", "Pets"],
      rows: [
        ["Maya", "2"],
        ["Ben", "0"],
      ],
      caption: "Read one record at a time.",
    },
    reveal: ["Ben has no pets. Zero is a recorded value."],
    alignment: { id: "table" },
  };
  const zip = await exportSlides([s]);
  const xml = zip.file("ppt/slides/slide1.xml").asText();
  assert.match(xml, /<a:tbl>/);
  assert.match(
    groups(xml).find((x) => x.text === s.reveal[0]).name,
    /^ls-reveal-4-/,
  );
});
test("native diagrams preserve linked videos and closure keeps practice before reflection", () => {
  const s = {
    ...task,
    youtube: {
      title: "Algorithms video",
      url: "https://www.youtube.com/watch?v=example",
    },
  };
  const pages = paginateSlides(
    [s],
    gradeProfile("Grade 3").theme,
    getPreset("primary-discovery"),
  );
  assert.equal(pages.length, 2);
  assert.equal(pages[1].type, "video");
  assert.equal(pages[1].youtube.url, s.youtube.url);
  const lesson = [
    { title: "Teach", type: "content" },
    { title: "Exit task", type: "content" },
    { title: "Next lesson", type: "content" },
    { title: "Check", type: "check" },
    { title: "Practice", type: "activity" },
    { title: "Recap", type: "recap" },
  ];
  assert.deepEqual(
    classroom.orderLesson(lesson).map((s) => s.title),
    ["Teach", "Practice", "Check", "Exit task", "Next lesson", "Recap"],
  );
  assert.deepEqual(
    classroom
      .orderLesson(lesson.map((s) => ({ ...s, alignment: {} })))
      .map((s) => s.title),
    lesson.map((s) => s.title),
  );
});
test("long diagram explanations keep their content on readable pages", async () => {
  const s = {
    type: "content",
    title: "Clear instructions",
    bullets: ["An algorithm is a list of ordered actions. ".repeat(9)],
    visual: {
      type: "steps",
      items: ["Collect the books", "Pack the books", "Close the bag"],
    },
    example: "",
    reveal: [],
  };
  const pages = paginateSlides(
    [s],
    gradeProfile("Grade 3").theme,
    getPreset("primary-discovery"),
  );
  assert.ok(pages.length >= 2);
  assert.ok(pages.at(-1).visual.items.includes("Close the bag"));
  assert.equal(pages.at(-1).bullets.length, 0);
  assert.equal(
    pages
      .slice(0, -1)
      .flatMap((p) => p.bullets)
      .join(" "),
    s.bullets.join(" "),
  );
  await exportSlides([s]);
});
test("missing closed-task answers are prepared separately while original creation stays open", async () => {
  const slides = [
    { ...task, reveal: [] },
    {
      ...task,
      title: "Create your own",
      reveal: [],
      learnerTask: {
        required: true,
        question: "Create your own safe algorithm.",
        stimulus: [],
        answer: "Accept logical safe steps.",
      },
    },
    { ...task, assessmentProtected: true, reveal: [] },
  ];
  const original = structuredClone(slides);
  const ready = await classroom.completeReveals({
    slides,
    grade: "Grade 3",
    callModel: async (schema, name, messages) => {
      assert.equal(name, "classroom_lesson_reveals");
      assert.deepEqual(
        schema.properties.answers.items.properties.id.enum,
        [0, 1],
      );
      assert.match(messages[0].content, /open original creation/);
      return {
        answers: [
          { id: 0, reveal: ["Make the bed is repeated. Keep it once."] },
          { id: 1, reveal: [] },
        ],
      };
    },
  });
  assert.equal(ready[0].reveal.length, 1);
  assert.deepEqual(ready[0].bullets, original[0].bullets);
  assert.deepEqual(ready[1].reveal, []);
  assert.equal(ready[2], slides[2]);
  assert.deepEqual(slides, original);
  await assert.rejects(
    classroom.completeReveals({
      slides,
      callModel: async () => ({ answers: [] }),
    }),
    /wrong slides/,
  );
});
