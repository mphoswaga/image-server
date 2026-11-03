const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { signInDisposableTeacher } = require("./helpers");
test("23 released historical quiz marks remain visible for a 26-learner class after the controls update", async ({
  page,
}) => {
  await signInDisposableTeacher(page, "-historical-quiz");
  const response = await page.request.post("/api/roster", {
    data: {
      name: "Grade 3B1",
      rows: Array.from({ length: 26 }, (_, i) => ({
        ID: "H" + i,
        Name: "Learner " + i,
      })),
      idCol: "ID",
      nameCol: "Name",
    },
  });
  const roster = await response.json();
  const created = await page.request.post("/api/pack/quiz/publish", {
    data: {
      subject: "ICT",
      grade: "Grade 3",
      topic: "Data and information",
      rosterId: roster.id,
      data: {
        title: "Historical data quiz",
        mcq: Array.from({ length: 10 }, (_, i) => ({
          question: "Which stores data " + i + "?",
          options: ["File", "Chair"],
          correctIndex: 0,
        })),
        shortAnswer: [
          {
            question: "Explain data.",
            answer: "Data is information.",
            marks: 2,
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const q = await created.json();
  const root = fs
      .readdirSync(os.tmpdir())
      .filter((name) => name.startsWith("lessonscope-e2e-"))
      .map((name) => path.join(os.tmpdir(), name, "assignments"))
      .find((dir) => fs.existsSync(path.join(dir, q.assignmentId + ".json"))),
    record = JSON.parse(
      fs.readFileSync(path.join(root, q.assignmentId + ".json"), "utf8"),
    );
  const subs = Array.from({ length: 23 }, (_, i) => ({
    studentId: "H" + i,
    name: "Learner " + i,
    answers: Object.fromEntries(
      record.content.questions.map((q) => [
        q.id,
        q.kind === "mcq" ? 0 : "Information",
      ]),
    ),
    grades: Object.fromEntries(
      record.content.questions.map((q) => [
        q.id,
        {
          marksAwarded: 1,
          source: q.kind === "mcq" ? "auto" : "ai",
          verdict: q.kind === "mcq" ? "correct" : "partial",
        },
      ]),
    ),
    totalMarks: 11,
    maxMarks: 12,
    submittedAt: new Date(Date.now() - 1000).toISOString(),
  }));
  const subFile = path.join(root, q.assignmentId + ".submissions.json");
  fs.writeFileSync(subFile, JSON.stringify(subs));
  const before = fs.readFileSync(subFile, "utf8");
  const release = await page.request.patch(
    "/api/assignment/" + q.assignmentId + "/release",
    { data: { released: true } },
  );
  expect(release.ok(), await release.text()).toBeTruthy();
  await page.locator("#assignmentsBtn").click();
  await expect(
    page.locator('[data-assignment-id="' + q.assignmentId + '"]'),
  ).toContainText("Released");
  const book = await (
    await page.request.get("/api/gradebook/" + roster.id)
  ).json();
  expect(book.rows.filter((r) => r.cells[q.assignmentId])).toHaveLength(23);
  expect(book.rows[0].cells[q.assignmentId]).toMatchObject({
    mark: 11,
    max: 12,
  });
  expect(fs.readFileSync(subFile, "utf8")).toBe(before);
  await page.locator("#marksBtn").click();
  await expect(
    page.locator("#marksBody").getByText("11/12", { exact: true }),
  ).toHaveCount(23);
});
