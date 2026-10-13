const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extract } = require("../public/newsletter-checklist");
test("checklist copies explicit sections without inventing tasks or dates", () => {
  const entries = [
    {
      subject: "ICT",
      english:
        "We will study files.\n\nHomework:\nComplete LMS on Friday.\n\nKey Vocabulary:\nByte: a unit.\n\nThings to bring: Notebook\n\nConversation starters\nWhat makes a file larger?",
    },
  ];
  assert.deepEqual(extract(entries, "en"), [
    { subject: "ICT", category: "homework", text: "Complete LMS on Friday." },
    { subject: "ICT", category: "bring", text: "Notebook" },
    { subject: "ICT", category: "talk", text: "What makes a file larger?" },
  ]);
  assert.deepEqual(
    extract([{ subject: "Maths", english: "Bring a ruler sometime." }], "en"),
    [],
  );
});
test("Vietnamese checklist never falls back to unreviewed English", () => {
  assert.deepEqual(
    extract(
      [
        {
          subject: "ICT",
          english: "Homework: Private",
          vietnamese: "Bài tập về nhà:\nLàm bài trên LMS.",
        },
      ],
      "vi",
    ),
    [{ subject: "ICT", category: "homework", text: "Làm bài trên LMS." }],
  );
});
