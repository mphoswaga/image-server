const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "accept-ai-"));
const a = require("../assignments");
function setup() {
  const rec = a.createAssignment({
    teacherId: "t",
    type: "quiz",
    subject: "ICT",
    grade: "3",
    topic: "Files",
    rosterId: "c",
    data: {
      title: "Files quiz",
      mcq: [
        {
          question: "Which stores data?",
          options: ["File", "Chair"],
          correctIndex: 0,
        },
      ],
      shortAnswer: [
        {
          question: "Describe a file.",
          answer: "A file stores information.",
          marks: 2,
        },
        { question: "Name one file.", answer: "Text file", marks: 1 },
      ],
    },
  });
  const r = a.enableQuizAssessmentControls(rec.id, "t", [
    { id: "S1", name: "One" },
    { id: "S2", name: "Two" },
  ]);
  r.content.questions.push({
    id: "p",
    question: "Create a file.",
    kind: "practical",
    marks: 2,
  });
  fs.writeFileSync(
    path.join(process.env.DATA_DIR, "assignments", r.id + ".json"),
    JSON.stringify(r),
  );
  for (const studentId of ["S1", "S2"])
    a.saveSubmission(r.id, {
      studentId,
      answers: { q0: 0, q1: "A file stores information.", q2: "Text file" },
      grades: {
        q0: { marksAwarded: 1, verdict: "correct", source: "auto" },
        q1: {
          marksAwarded: 1.5,
          verdict: "partial",
          rationale: "Needs an example.",
          source: "ai",
        },
        q2: { marksAwarded: 1, verdict: "correct", source: "teacher" },
        p: { marksAwarded: 0, verdict: "pending", source: "teacher-required" },
      },
      totalMarks: 3.5,
      maxMarks: 6,
    });
  a.setAttendance(r.id, "t", "S2", "absent");
  return r;
}
test("accept all confirms AI suggestions without changing scores, teacher marks, automatic marks, absence or release state", () => {
  const r = setup(),
    before = a.getSubmission(r.id, "S1");
  assert.equal(
    a.pendingAIMarks(a.getAssignment(r.id), a.getSubmissions(r.id)).length,
    1,
  );
  assert.deepEqual(a.acceptAllAIMarks(r.id, "t"), { updated: 1, learners: 1 });
  const s = a.getSubmission(r.id, "S1");
  assert.equal(s.totalMarks, 3.5);
  assert.equal(s.grades.q1.marksAwarded, 1.5);
  assert.equal(s.grades.q1.rationale, "Needs an example.");
  assert.equal(s.grades.q1.source, "teacher");
  assert.equal(s.grades.q1.acceptedFromAI, true);
  for (const key of ["q0", "q2", "p"])
    assert.deepEqual(s.grades[key], before.grades[key]);
  assert.equal(a.getSubmission(r.id, "S2").grades.q1.source, "ai");
  assert.equal(a.getAssignment(r.id).resultsReleased, false);
  assert.equal(
    a.assessmentReleaseReadiness(a.getAssignment(r.id)).pendingGrades,
    1,
  );
  assert.equal(
    a.findConfirmedVerdict(r.id, "q1", "A file stores information.")
      .marksAwarded,
    1.5,
  );
  assert.equal(a.acceptAllAIMarks(r.id, "t").updated, 0);
});
test("other teachers and finalised results cannot be bulk accepted", () => {
  const r = setup();
  assert.throws(() => a.acceptAllAIMarks(r.id, "other"), /not found/);
  const rec = a.getAssignment(r.id);
  rec.resultsReleased = true;
  rec.status = "finalised";
  fs.writeFileSync(
    path.join(process.env.DATA_DIR, "assignments", r.id + ".json"),
    JSON.stringify(rec),
  );
  assert.throws(() => a.acceptAllAIMarks(r.id, "t"), /finalis|Recall/i);
  assert.equal(a.getSubmission(r.id, "S1").grades.q1.source, "ai");
});
test("invalid or unresolved AI suggestions require individual review", () => {
  const r = setup(),
    s = a.getSubmission(r.id, "S1");
  s.grades.q1.marksAwarded = 99;
  a.saveSubmission(r.id, s);
  assert.equal(a.acceptAllAIMarks(r.id, "t").updated, 0);
  assert.equal(a.getSubmission(r.id, "S1").grades.q1.source, "ai");
});
