const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');

test('teacher can generate, review, create slides, download, and export to Google Slides', async ({ page }, testInfo) => {
  test.skip(!['windows-100', 'desktop-safari'].includes(testInfo.project.name), 'The full generation contract runs in Chromium and WebKit.');

  let generatePayload = null;
  let downloadSeen = false;
  await page.route('**/api/lesson-plan', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        teachingModelId: 'gradual_release',
        usedTemplate: false,
        successCriteria: ['I can identify a habitat and explain why an animal lives there.'],
        sections: [
          { heading: 'Learning objectives', content: 'Identify common habitats and connect animals to their needs.' },
          { heading: 'Success criteria', content: 'I can identify a habitat and explain why an animal lives there.' },
          { heading: 'Teacher activities', content: 'I Do: Model how to inspect habitat clues. We Do: Match one animal together.' },
          { heading: 'Learner activities', content: 'You Do: Match animals to habitats and explain one choice.' },
        ],
      }),
    });
  });
  await page.route('**/api/generate', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    generatePayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        deckId: 'e2e-deck',
        filename: 'Science-Habitats.pptx',
        band: 'middle',
        slideCount: 2,
        teachingModelId: 'gradual_release',
        slides: [
          { type: 'title', title: 'Habitats', subtitle: 'Science', bullets: [], image: null, imageSource: null },
          { type: 'content', title: 'Animals need the right habitat', bullets: ['Habitats provide food, water, shelter and space.'], example: 'A frog needs water and damp shelter.', image: null, imageSource: null, modelStage: 'you_do' },
        ],
      }),
    });
  });
  await page.route('**/api/download/e2e-deck', async route => {
    downloadSeen = true;
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="Science-Habitats.pptx"',
      },
      body: Buffer.from('deterministic-e2e-pptx'),
    });
  });
  await page.route('**/api/google-slides/export/e2e-deck', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        kind: 'slides',
        file: { id: 'slides-e2e', name: 'Science-Habitats', webViewLink: 'https://docs.google.com/presentation/d/slides-e2e/edit' },
      }),
    });
  });

  await signInDisposableTeacher(page, `-generation-${testInfo.project.name}`);
  await page.getByRole('button', { name: /Start with objectives/ }).click();
  await page.locator('#subject').fill('Science');
  await page.locator('#topic').fill('Habitats');
  await page.locator('#flowSourceNextBtn').click();
  await page.locator('#objectives').fill('Identify common habitats and connect animals to their needs.');
  await page.locator('#flowObjectivesNextBtn').click();
  await page.locator('#teachingModel').selectOption('gradual_release');
  await page.locator('#planBtn').click();

  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#planSections .heading').nth(1)).toHaveValue('Success criteria');
  await expect(page.locator('#planSections .content').nth(1)).toHaveValue(/I can identify a habitat/);
  await expect(page.locator('#planSections')).toContainText('I Do');
  await page.locator('#acceptBtn').click();

  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#deckTitle')).toHaveText('Science-Habitats');
  await expect(page.locator('#deck .slide')).toHaveCount(2);
  expect(generatePayload).toMatchObject({ subject: 'Science', topic: 'Habitats', teachingModelId: 'gradual_release' });
  expect(generatePayload.lessonPlan.sections).toHaveLength(4);

  await page.locator('#downloadBtn').click();
  await expect.poll(() => downloadSeen).toBeTruthy();
  await expect(page.locator('#downloadBtn')).toBeEnabled();

  await page.locator('#slidesExportBtn').click();
  await expect(page.locator('#driveExportStatus')).toContainText('Saved to Google Slides');
  await expect(page.locator('#driveExportStatus a')).toHaveAttribute('href', /docs\.google\.com\/presentation/);
});

test('Plan automatically creates an editable project assessment draft', async ({ page }, testInfo) => {
  test.skip(!['windows-100', 'mobile'].includes(testInfo.project.name), 'Desktop and mobile cover the automatic project flow.');
  let planPayload;
  await page.route('**/api/lesson-plan', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    planPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        teachingModelId: 'standard', lessonPurpose: 'project', usedTemplate: false,
        successCriteria: ['I can create and edit a document independently.'],
        sections: [{ heading: 'Project session', stageId: 'practice', content: 'Teacher launches the task. Students complete it independently.' }],
        assessmentDraft: {
          title: 'Document creation project', subject: 'ICT', grade: 'Grade 2', assessmentType: 'project', deliveryMode: 'live', totalMarks: 60,
          objectives: [{ id: 'objective-create-and-edit-a-document', text: 'Create and edit a document' }],
          instructions: 'Complete each section in class.',
          sections: [
            { id: 'auto-section-1', title: 'Knowledge check', type: 'mcq', instructions: 'Choose the best answer.', objectiveIds: ['objective-create-and-edit-a-document'], items: [{ id: 'auto-1-1', prompt: 'Which action checks written work?', marks: 20, options: ['Proofread it', 'Close it'], correctIndex: 0 }] },
            { id: 'auto-section-2', title: 'Practical task', type: 'practical', instructions: 'Create the document.', objectiveIds: ['objective-create-and-edit-a-document'], items: [{ id: 'auto-2-1', prompt: 'Creates and corrects a short document', marks: 40 }] },
          ],
        },
      }),
    });
  });
  await page.route('**/api/generate', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        deckId: 'project-deck', filename: 'Document-creation-project.pptx', band: 'early', slideCount: 2,
        teachingModelId: 'standard', lessonPurpose: 'project',
        slides: [
          { type: 'title', title: 'Document creation project', subtitle: 'ICT', bullets: [], image: null, imageSource: null },
          { type: 'content', title: 'Create your document', bullets: ['Follow the project stages.'], example: '', image: null, imageSource: null, modelStage: 'practice' },
        ],
      }),
    });
  });

  await signInDisposableTeacher(page, `-auto-project-${testInfo.project.name}`);
  await page.getByRole('button', { name: /Start with objectives/ }).click();
  await page.locator('input[name="lessonPurpose"][value="project"]').check();
  await page.locator('#subject').fill('ICT');
  await page.locator('#topic').fill('Document creation');
  await page.locator('#flowSourceNextBtn').click();
  await page.locator('#objectives').fill('Create and edit a document');
  await page.locator('#flowObjectivesNextBtn').click();
  await expect(page.locator('#autoAssessmentSettings')).toBeVisible();
  await page.locator('#assessmentPlanTotal').fill('60');
  await page.locator('#planBtn').click();

  await expect(page.locator('#autoAssessmentSummary')).toContainText('60 marks');
  expect(planPayload).toMatchObject({ lessonPurpose: 'project', assessmentTotalMarks: 60, assessmentQuestionTypes: ['mcq', 'practical'], assessmentMcqCount: 15 });
  await page.locator('#reviewAutoAssessmentBtn').click();
  await expect(page.locator('#assessmentBuilder')).toBeVisible();
  await expect(page.locator('#assessmentTitle')).toHaveValue('Document creation project');
  await expect(page.locator('#assessmentTotal')).toHaveValue('60');
  await expect(page.locator('#assessmentSections .assessment-section')).toHaveCount(2);
  await expect(page.locator('#assessmentTotalStatus')).toHaveClass(/valid/);
  await page.locator('#assignmentsBackTop').click();
  await page.locator('#acceptBtn').click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#automaticAssessmentResult')).toBeVisible();
  await expect(page.locator('#automaticAssessmentResultTitle')).toHaveText('Project assessment ready');
  await expect(page.locator('#automaticAssessmentResultBreakdown')).toContainText('60 marks');
  await expect(page.locator('#automaticAssessmentResultBreakdown')).toContainText('multiple choice');
  await page.locator('#reviewResultAssessmentBtn').click();
  await expect(page.locator('#assessmentBuilder')).toBeVisible();
  await expect(page.locator('#assessmentTitle')).toHaveValue('Document creation project');
});
