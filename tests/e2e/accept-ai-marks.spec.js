const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { signInDisposableTeacher } = require("./helpers");
test("teacher accepts all AI suggestions and separately releases the quiz marks", async ({
  page,
}) => {
  await signInDisposableTeacher(page, "-accept-ai");
  const rosterResponse = await page.request.post("/api/roster", {
    data: {
      name: "AI marking class",
      rows: [{ ID: "AI1", Name: "Amina" }],
      idCol: "ID",
      nameCol: "Name",
    },
  });
  const roster = await rosterResponse.json();
  const created = await page.request.post("/api/pack/quiz/publish", {
    data: {
      subject: "ICT",
      grade: "Grade 3",
      topic: "Files",
      rosterId: roster.id,
      data: {
        title: "AI marking quiz",
        mcq: [
          {
            question: "Which stores information?",
            options: ["File", "Chair"],
            correctIndex: 0,
          },
        ],
        shortAnswer: [
          {
            question: "What is a file?",
            answer: "A file stores information.",
            marks: 2,
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const quiz = await created.json();
  await page.locator("#assignmentsBtn").click();
  let card = page.locator('[data-assignment-id="' + quiz.assignmentId + '"]');
  await expect(card).toContainText("AI marking class");
  // Seed deterministic AI output only in this disposable local test server, avoiding a live AI call.
  const root = fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith("lessonscope-e2e-"))
    .map((name) => path.join(os.tmpdir(), name, "assignments"))
    .find((dir) => fs.existsSync(path.join(dir, quiz.assignmentId + ".json")));
  expect(root).toBeTruthy();
  const record = JSON.parse(
      fs.readFileSync(path.join(root, quiz.assignmentId + ".json"), "utf8"),
    ),
    mcq = record.content.questions.find((q) => q.kind === "mcq"),
    written = record.content.questions.find((q) => q.kind === "text");
  fs.writeFileSync(
    path.join(root, quiz.assignmentId + ".submissions.json"),
    JSON.stringify([
      {
        studentId: "AI1",
        name: "Amina",
        answers: { [mcq.id]: 0, [written.id]: "A file stores information." },
        grades: {
          [mcq.id]: { marksAwarded: 1, verdict: "correct", source: "auto" },
          [written.id]: {
            marksAwarded: 1.5,
            verdict: "partial",
            rationale: "Needs an example.",
            source: "ai",
          },
        },
        totalMarks: 2.5,
        maxMarks: 3,
        submittedAt: new Date().toISOString(),
      },
    ]),
  );
  await card
    .locator('.a-toggle-btn')
    .click();
  const accept = card.getByRole("button", {
    name: "Accept all AI marks (1)",
    exact: true,
  });
  await expect(accept).toBeVisible();
  await accept.click();
  await expect(accept).toBeHidden();
  const results = await (
    await page.request.get("/api/assignment/" + quiz.assignmentId + "/results")
  ).json();
  expect(results.resultsReleased).toBe(false);
  expect(results.pendingAIGrades).toBe(0);
  expect(results.submissions[0].grades[written.id]).toMatchObject({
    marksAwarded: 1.5,
    source: "teacher",
    acceptedFromAI: true,
  });
  expect(results.submissions[0].grades[mcq.id].source).toBe("auto");
  expect(results.submissions[0].totalMarks).toBe(2.5);
  const release = card.getByRole("button", {
    name: "Release results",
    exact: true,
  });
  await expect(release).toBeEnabled();
  await release.click();
  await expect(
    card.getByRole("button", { name: "Recall from learners", exact: true }),
  ).toBeVisible();
  const again = await page.request.post(
    "/api/assignment/" + quiz.assignmentId + "/grades/accept-ai",
  );
  expect(again.status()).toBe(409);
});
