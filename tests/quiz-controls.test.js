const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-controls-"));
process.env.DATA_DIR = dir;
const assignments = require("../assignments");
function quiz(extra = {}) {
  return assignments.createAssignment({
    teacherId: "teacher",
    type: "quiz",
    subject: "ICT",
    topic: "Data and information",
    grade: "Grade 3",
    rosterId: "class-a",
    data: {
      title: "Data quiz",
      mcq: Array.from({ length: 30 }, (_, i) => ({
        question: "Which item stores data " + i + "?",
        options: ["File", "Chair"],
        correctIndex: 0,
      })),
    },
    ...extra,
  });
}
const raw = (id, suffix = "") =>
  fs.readFileSync(path.join(dir, "assignments", id + suffix + ".json"), "utf8");
test("quiz controls preserve existing submitted marks, drafts, question IDs and room links", () => {
  const q = quiz();
  for (let i = 0; i < 23; i++)
    assignments.saveSubmission(q.id, {
      studentId: "S" + i,
      name: "Learner " + i,
      answers: { q0: 0 },
      grades: { q0: { marksAwarded: 1, source: "auto" } },
      totalMarks: 1,
      maxMarks: 30,
    });
  assignments.saveDraft(q.id, {
    studentId: "S23",
    name: "Learner 23",
    answers: { q0: 1 },
  });
  const subs = raw(q.id, ".submissions"),
    drafts = raw(q.id, ".drafts"),
    source = assignments.getAssignment(q.id);
  const converted = assignments.enableQuizAssessmentControls(
    q.id,
    "teacher",
    Array.from({ length: 25 }, (_, i) => ({
      id: "S" + i,
      name: "Learner " + i,
    })),
  );
  assert.equal(converted.id, q.id);
  assert.equal(converted.roomCode, q.roomCode);
  assert.equal(assignments.getRoomCode(q.roomCode), q.id);
  assert.equal(converted.assessmentType, "quiz");
  assert.equal(converted.type, "assessment");
  assert.equal(converted.delivery.mode, "self-paced");
  assert.equal(converted.totalMarks, 30);
  assert.equal(converted.rosterSnapshot.length, 25);
  for (let i = 0; i < 30; i++)
    for (const key of ["id", "question", "marks", "options", "correctIndex"])
      assert.deepEqual(
        converted.content.questions[i][key],
        source.content.questions[i][key],
      );
  assert.equal(raw(q.id, ".submissions"), subs);
  assert.equal(raw(q.id, ".drafts"), drafts);
  assert.deepEqual(converted.legacyQuiz.original, source);
  const persisted = raw(q.id);
  assignments.enableQuizAssessmentControls(q.id, "teacher", []);
  assert.equal(raw(q.id), persisted);
  assert.equal(
    assignments.listTeacherAssignments("teacher").find((a) => a.id === q.id)
      .needsAssessmentControls,
    false,
  );
});
test("copying a converted quiz isolates the other class and opens a private editable quiz", () => {
  const q = quiz();
  assignments.enableQuizAssessmentControls(q.id, "teacher", [
    { id: "S1", name: "One" },
  ]);
  const source = raw(q.id);
  const copy = assignments.copyAssessmentToRoster({
    id: q.id,
    teacherId: "teacher",
    rosterId: "class-b",
    rosterSnapshot: [{ id: "S2", name: "Two" }],
  });
  assert.notEqual(copy.id, q.id);
  assert.notEqual(copy.roomCode, q.roomCode);
  assert.equal(copy.status, "draft");
  assert.equal(copy.assessmentType, "quiz");
  assert.equal(copy.resultsReleased, false);
  assert.equal(copy.teacherMarked, false);
  assert.equal(assignments.getSubmissions(copy.id).length, 0);
  assert.equal(raw(q.id), source);
  assert.equal(copy.content.questions.length, 30);
  assert.equal(assignments.assessmentContentEditable(copy), true);
});
test("conversion is owner-only, preserves overdue result visibility and retains historical learners", () => {
  const q = quiz({ cutoffAt: "2020-01-01T00:00:00Z" }),
    before = raw(q.id);
  assert.throws(
    () => assignments.enableQuizAssessmentControls(q.id, "other"),
    /Quiz not found/,
  );
  assert.equal(raw(q.id), before);
  assignments.saveSubmission(q.id, {
    studentId: "LEFT",
    name: "Former pupil",
    answers: { q0: 0 },
    grades: { q0: { marksAwarded: 1, source: "auto" } },
  });
  const converted = assignments.enableQuizAssessmentControls(q.id, "teacher", [
    { id: "S1", name: "One" },
  ]);
  assert.equal(assignments.isReleased(converted), true);
  assert.equal(converted.status, "finalised");
  assert.ok(converted.rosterSnapshot.some((p) => p.id === "LEFT"));
});
