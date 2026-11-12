const {revealAssessmentActions}=require('./helpers');
const { test, expect } = require("@playwright/test");
const { signInDisposableTeacher } = require("./helpers");
test("legacy quiz gains test controls and copies to another class without moving its original", async ({
  page,
}) => {
  await signInDisposableTeacher(page, "-quiz-controls");
  async function roster(name, id) {
    const response = await page.request.post("/api/roster", {
      data: {
        name,
        rows: [{ ID: id, Name: "Learner " + id }],
        idCol: "ID",
        nameCol: "Name",
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const a = await roster("Quiz class A", "QA1"),
    b = await roster("Quiz class B", "QB1");
  const published = await page.request.post("/api/pack/quiz/publish", {
    data: {
      subject: "ICT",
      topic: "Data and information",
      grade: "Grade 3",
      rosterId: a.id,
      data: {
        title: "Quiz with classroom controls",
        mcq: [
          {
            question: "Which item stores information?",
            options: ["File", "Chair"],
            correctIndex: 0,
          },
          {
            question: "Which device displays an image?",
            options: ["Monitor", "Mouse"],
            correctIndex: 0,
          },
        ],
      },
    },
  });
  expect(published.ok(), await published.text()).toBeTruthy();
  const q = await published.json();
  await page.locator("#assignmentsBtn").click();
  const card = page.locator('[data-assignment-id="' + q.assignmentId + '"]');
  await expect(card).toContainText("Quiz class A");
  await revealAssessmentActions(card);
  await expect(card.locator('.a-toggle-btn')).toBeVisible();
  for (const name of [
    "Attendance",
    "Add learners to test",
    "Change class",
    "Give to another class",
  ])
    await expect(card.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Present", exact: true }),
  ).toHaveAttribute("href", "/assessment/" + q.assignmentId + "/present");
  await card.locator('.a-toggle-btn').click();
  await expect(card).toContainText('No AI marks need accepting.');
  await expect(card.locator('.accept-all-ai')).toHaveCount(0);
  const presentation = await page.request.get(
    "/api/assignment/" + q.assignmentId + "/presentation",
  );
  expect(presentation.ok(), await presentation.text()).toBeTruthy();
  const slides = (await presentation.json()).slides;
  expect(slides.length).toBeGreaterThan(2);
  expect(
    slides.some((s) =>
      JSON.stringify(s).includes("Which item stores information?"),
    ),
  ).toBe(false);
  await card.getByRole("button", { name: "Attendance", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Learner QA1");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await card
    .getByRole("button", { name: "Give to another class", exact: true })
    .click();
  await card.locator(".a-class-copy-picker").selectOption(b.id);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assignment/" + q.assignmentId + "/class-copy") &&
      r.request().method() === "POST",
  );
  await card
    .getByRole("button", { name: "Duplicate and edit", exact: true })
    .click();
  const copied = await response;
  expect(copied.ok(), await copied.text()).toBeTruthy();
  const copy = await copied.json();
  await expect(page.locator("#assessmentKind")).toHaveValue("quiz");
  await expect(page.locator("#assessmentRoster")).toHaveValue(b.id);
  await page.locator("#assessmentDelivery").selectOption("live");
  await expect(page.locator("#publishAssessmentBtn")).toBeEnabled();
  const publish = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assignment/" + copy.assessmentId + "/content") &&
      r.request().method() === "PATCH",
  );
  await page.locator("#publishAssessmentBtn").click();
  expect((await publish).ok()).toBeTruthy();
  const list = (await (await page.request.get("/api/assignments")).json())
    .assignments;
  expect(list.find((item) => item.id === q.assignmentId).rosterId).toBe(a.id);
  const other = list.find((item) => item.id === copy.assessmentId);
  expect(other.rosterId).toBe(b.id);
  expect(other.assessmentType).toBe("quiz");
  expect(other.submissions).toBe(0);
  expect(other.resultsReleased).toBe(false);
  expect(other.roomCode).not.toBe(q.roomCode);
  expect(other.delivery.mode).toBe("live");
  const start = await page.request.patch(
    "/api/assignment/" + copy.assessmentId + "/live-state",
    { data: { action: "start" } },
  );
  expect(start.ok(), await start.text()).toBeTruthy();
});
