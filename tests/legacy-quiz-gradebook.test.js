const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "legacy-quiz-marks-"),
);
const a = require("../assignments"),
  roster = require("../roster"),
  gb = require("../gradebook");
function setup(released = true) {
  const r = roster.saveRoster("teacher", {
    name: "Grade 3B1",
    students: Array.from({ length: 26 }, (_, i) => ({
      id: "A" + i,
      name: "Learner " + i,
    })),
  });
  const quiz = a.createAssignment({
    teacherId: "teacher",
    type: "quiz",
    subject: "ICT",
    topic: "Data",
    grade: "Grade 3",
    rosterId: r.id,
    data: {
      title: "Data quiz",
      mcq: Array.from({ length: 10 }, (_, i) => ({
        question: "Which stores data " + i + "?",
        options: ["File", "Chair"],
        correctIndex: 0,
      })),
      shortAnswer: [
        { question: "Explain data.", answer: "Data is information.", marks: 2 },
      ],
    },
  });
  for (let i = 0; i < 23; i++)
    a.saveSubmission(quiz.id, {
      studentId: "A" + i,
      name: "Learner " + i,
      answers: Object.fromEntries(
        quiz.content.questions.map((q) => [
          q.id,
          q.kind === "mcq" ? 0 : "Information",
        ]),
      ),
      grades: Object.fromEntries(
        quiz.content.questions.map((q) => [
          q.id,
          {
            marksAwarded: 1,
            verdict: q.kind === "mcq" ? "correct" : "partial",
            source: q.kind === "mcq" ? "auto" : "ai",
          },
        ]),
      ),
      totalMarks: 11,
      maxMarks: 12,
      submittedAt: new Date(Date.now() - 1000).toISOString(),
    });
  if (released) a.releaseResults(quiz.id, true);
  return { r, quiz };
}
test("previously released 3B1 quiz keeps its official marks after shared-control upgrade", () => {
  const { r, quiz } = setup(),
    before = fs.readFileSync(
      path.join(
        process.env.DATA_DIR,
        "assignments",
        quiz.id + ".submissions.json",
      ),
      "utf8",
    );
  assert.equal(
    gb.buildGradebook("teacher", r.id).rows[0].cells[quiz.id].mark,
    11,
  );
  a.enableQuizAssessmentControls(quiz.id, "teacher", r.students);
  const book = gb.buildGradebook("teacher", r.id);
  assert.equal(book.rows.filter((row) => row.cells[quiz.id]).length, 23);
  assert.deepEqual(book.rows[0].cells[quiz.id], {
    mark: 11,
    max: 12,
    pct: 11 / 12,
  });
  assert.equal(
    fs.readFileSync(
      path.join(
        process.env.DATA_DIR,
        "assignments",
        quiz.id + ".submissions.json",
      ),
      "utf8",
    ),
    before,
  );
});
test("unreleased legacy AI suggestions and new quiz copies still require confirmation", () => {
  const { r, quiz } = setup(false);
  const upgraded = a.enableQuizAssessmentControls(
    quiz.id,
    "teacher",
    r.students,
  );
  assert.equal(
    gb.teacherSubmissionResult(upgraded, a.getSubmissions(quiz.id)[0]),
    null,
  );
  const copy = a.copyAssessmentToRoster({
    id: quiz.id,
    teacherId: "teacher",
    rosterId: "b",
    rosterSnapshot: [{ id: "B", name: "Other" }],
  });
  assert.equal(copy.legacyQuiz, undefined);
  const sub = { ...a.getSubmissions(quiz.id)[0], studentId: "B" };
  assert.equal(gb.teacherSubmissionResult(copy, sub), null);
});

test("historical compatibility does not approve later work or invalid stored totals", () => {
  const { r, quiz } = setup(true),
    record = a.enableQuizAssessmentControls(quiz.id, "teacher", r.students),
    sub = a.getSubmissions(quiz.id)[0];
  assert.equal(
    gb.teacherSubmissionResult(record, {
      ...sub,
      submittedAt: new Date(
        Date.parse(record.legacyQuiz.upgradedAt) + 1000,
      ).toISOString(),
    }),
    null,
  );
  for (const extra of [
    { totalMarks: 99 },
    { maxMarks: 11 },
    { totalMarks: null },
    { submittedAt: "invalid" },
  ])
    assert.equal(
      gb.teacherSubmissionResult(record, { ...sub, ...extra }),
      null,
    );
});
