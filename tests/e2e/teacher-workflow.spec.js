const { test, expect } = require('@playwright/test');
const pptxgen = require('pptxgenjs');
const { expectNoOverlap, expectNoPageOverflow, signInDisposableTeacher } = require('./helpers');

async function simpleLessonDeck() {
  const pptx = new pptxgen();
  const title = pptx.addSlide();
  title.addText('Plants and habitats', { x: 0.8, y: 0.8, w: 8, h: 0.6 });
  const content = pptx.addSlide();
  content.addText('What plants need', { x: 0.8, y: 0.6, w: 8, h: 0.5 });
  content.addText('Water\nLight\nAir', { x: 1, y: 1.4, w: 5, h: 2 });
  return pptx.write({ outputType: 'nodebuffer' });
}

function savedProjectAssessment() {
  return {
    title: 'Document creation project', subject: 'ICT', grade: 'Grade 2', assessmentType: 'project', deliveryMode: 'self-paced', totalMarks: 50,
    objectives: [{ id: 'create-document', text: 'Create and edit a document independently' }],
    instructions: 'Complete each project stage independently.',
    sections: [{
      id: 'practical', title: 'Document task', type: 'practical', objectiveIds: ['create-document'], instructions: 'Create your own document.',
      items: [{ id: 'document-evidence', prompt: 'Creates, proofreads, saves and submits the required document independently', marks: 50 }],
    }],
  };
}

function savedProjectSequence(draft) {
  return [1, 2].map(number => ({
    teachingModelId: 'standard', lessonPurpose: 'project', sequenceLessonNumber: number, assessmentDraft: draft,
    sections: [
      { heading: 'Project session', stageId: 'practice', content: `Students complete document stage ${number} independently.` },
      { heading: 'Assessment', fieldKey: 'assessment', stageId: 'check', content: 'Students complete the practical assessment in LessonScope.' },
      { heading: 'Plenary', fieldKey: 'plenary', stageId: 'reflect', content: 'Teacher confirms every submission.' },
    ],
  }));
}

async function saveGrade2Roster(page, suffix) {
  const response = await page.request.post('/api/roster', {
    data: {
      name: `Grade 2 ICT ${suffix}`,
      rows: [{ ID: `G2-${suffix}`, Name: 'Amina Learner' }],
      idCol: 'ID',
      nameCol: 'Name',
    },
  });
  const saved = await response.json();
  expect(response.ok(), JSON.stringify(saved)).toBeTruthy();
  return saved;
}

async function saveProjectWorkspace(page, context, draft) {
  const response = await page.request.post('/api/lesson-workspaces', {
    data: {
      context,
      sequencePlans: savedProjectSequence(draft),
      stage: 'assigned',
      assignmentIds: [],
      deckRefs: [],
    },
  });
  const saved = await response.json();
  expect(response.ok(), JSON.stringify(saved)).toBeTruthy();
  return saved.workspace;
}

test.beforeEach(async ({ page }, testInfo) => {
  await signInDisposableTeacher(page, `-${testInfo.project.name}`);
});

test('lesson setup advances as a focused three-page wizard', async ({ page }) => {
  await page.getByRole('button', { name: /Start with objectives/ }).click();
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 1 of 3');
  await page.locator('#subject').fill('Science');
  await page.locator('#topic').fill('Plants');
  await page.locator('#flowSourceNextBtn').click();
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 2 of 3');
  await expect(page.locator('[data-flow-page="1"]')).not.toHaveClass(/active/);
  await page.locator('#objectives').fill('Identify the parts of a plant and explain what each part does.');
  await page.locator('#flowObjectivesNextBtn').click();
  await expect(page.locator('#lessonFlowEyebrow')).toHaveText('Step 3 of 3');
  await expect(page.locator('#planBtn')).toBeVisible();
  await expect(page.locator('#planBtn')).toBeEnabled();
  await expectNoPageOverflow(page);
});

test('desktop navigation remains clickable and does not sit under account controls', async ({ page }) => {
  const menu = page.locator('#mainNavMenu');
  await expect(menu).toBeVisible();
  await expectNoOverlap(page.locator('#nav .logo'), page.locator('#nav .nav-user'));
  const rosters = page.locator('#rostersBtn');
  await rosters.click();
  await expect(page.locator('#rostersPanel')).toBeVisible();
  await page.locator('#homeBtn').click();
  await expect(page.locator('#modeSelect')).toBeVisible();
  await expectNoPageOverflow(page);
});

test('teacher can reopen and keep editing a saved lesson workspace', async ({ page }) => {
  const created = await page.request.post('/api/lesson-workspaces', {
    data: {
      context: {
        subject: 'ICT', topic: 'Create folders', grade: 'Grade 3', objectives: 'Create and name a folder.',
        slideCount: 5, tone: 'clear and engaging', teachingModelId: 'standard',
      },
      stage: 'plan',
      plan: { sections: [{ heading: 'Learning objective', content: 'Create and name a folder.' }] },
      deckRefs: [],
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.locator('#lessonsBtn').click();
  await expect(page.locator('#lessonsPanel')).toBeVisible();
  await expect(page.locator('#lessonsList')).toContainText('Create folders');
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'Resume lesson' }).click();
  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#planSections textarea.content')).toHaveValue('Create and name a folder.');

  const saved = page.waitForResponse(response => response.url().includes('/api/lesson-workspaces/') && response.request().method() === 'PATCH');
  await page.locator('#planSections textarea.content').fill('Create, name, and reopen a folder.');
  await saved;
  await expect(page.locator('#workspaceSaveStatus')).toContainText('Saved');

  const listing = await page.request.get('/api/lesson-workspaces');
  const body = await listing.json();
  expect(body.lessons).toHaveLength(1);
  expect(body.lessons[0].stage).toBe('plan');
});

test('saved lesson restores its working view and editable deck without regenerating it', async ({ page }) => {
  const imported = await page.request.post('/api/import/slides', {
    multipart: {
      file: { name: 'plants.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await simpleLessonDeck() },
      subject: 'Science', topic: 'Plants and habitats', grade: 'Grade 3', teachingModelId: 'standard',
    },
  });
  expect(imported.ok()).toBeTruthy();
  const deck = await imported.json();
  const created = await page.request.post('/api/lesson-workspaces', {
    data: {
      context: { subject: 'Science', topic: 'Plants and habitats', grade: 'Grade 3', teachingModelId: 'standard', deckImported: true, workspaceView: 'plan' },
      plan: { sections: [{ heading: 'Learning objective', content: 'Identify what plants need.' }] },
      stage: 'slides', activeDeckId: deck.deckId, deckRefs: [{ deckId: deck.deckId, edits: [] }],
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.locator('#lessonsBtn').click();
  await page.getByRole('button', { name: 'Resume lesson' }).click();
  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#planSections')).toContainText('Identify what plants need.');
  await page.locator('#acceptBtn').click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#deck')).toContainText('Plants and habitats');
  await expectNoPageOverflow(page);
});

test('saved project sequence retains a valid published assessment when it is resumed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'The restored publication contract needs one browser viewport.');
  const draft = savedProjectAssessment();
  const classRoster = await saveGrade2Roster(page, 'saved-project');
  const context = {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2', objectives: 'Create and edit a document independently.',
    slideCount: 4, tone: 'clear and engaging', teachingModelId: 'standard', lessonPurpose: 'project',
    assessmentTotalMarks: 50, assessmentStructure: 'practical', assessmentDeliveryMode: 'self-paced', assessmentQuestionTypes: ['practical'], assessmentMcqCount: 0,
    assessmentDraft: draft,
    sequenceEnabled: true, sequenceLessonCount: 2, periodMinutes: 45, workspaceView: 'plan', useWeekPlanner: false,
  };
  const workspace = await saveProjectWorkspace(page, context, draft);
  const publishedDraft = { ...draft, lessonWorkspaceId: workspace.id };
  const publication = await page.request.post('/api/assessment', {
    data: { assessment: publishedDraft, rosterId: classRoster.id },
  });
  const published = await publication.json();
  expect(publication.ok(), JSON.stringify(published)).toBeTruthy();
  const update = await page.request.patch(`/api/lesson-workspaces/${workspace.id}`, {
    data: {
      context: { ...context, assessmentDraft: publishedDraft, assessmentPublishedId: published.assessmentId },
      sequencePlans: savedProjectSequence(publishedDraft),
      stage: 'assigned',
      assignmentIds: [published.assessmentId],
      deckRefs: [],
    },
  });
  expect(update.ok(), await update.text()).toBeTruthy();

  let generatePayload = null;
  await page.route('**/api/generate', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    generatePayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        deckId: 'restored-project-deck', filename: 'ICT-Document_creation.pptx', band: 'early', slideCount: 2, lessonPurpose: 'project',
        slides: [
          { type: 'title', title: 'Document creation project', subtitle: 'ICT', bullets: [], image: null, imageSource: null },
          { type: 'content', title: 'Project stage', bullets: ['Complete your own work.'], example: '', image: null, imageSource: null, modelStage: 'project-stage-1' },
        ],
      }),
    });
  });

  await page.locator('#lessonsBtn').click();
  await page.locator(`[data-workspace-resume="${workspace.id}"]`).click();
  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#autoAssessmentSummary')).toContainText('Automatic project published');
  await page.locator('#acceptBtn').click();
  await expect(page.locator('#results')).toBeVisible();
  expect(generatePayload).not.toBeNull();
  expect(generatePayload.assessmentPublishedId).toBe(published.assessmentId);
  expect(generatePayload.lessonWorkspaceId).toBe(workspace.id);
  expect(generatePayload.assessmentDraft.sections[0].title).toBe('Document task');
});

test('saved project sequence requires republishing when its assessment reference is stale', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'The restored publication contract needs one browser viewport.');
  const draft = savedProjectAssessment();
  const classRoster = await saveGrade2Roster(page, 'stale-project');
  const context = {
    subject: 'ICT', topic: 'Document creation', grade: 'Grade 2', objectives: 'Create and edit a document independently.',
    slideCount: 4, tone: 'clear and engaging', teachingModelId: 'standard', lessonPurpose: 'project',
    assessmentTotalMarks: 50, assessmentStructure: 'practical', assessmentDeliveryMode: 'self-paced', assessmentQuestionTypes: ['practical'], assessmentMcqCount: 0,
    assessmentDraft: draft,
    sequenceEnabled: true, sequenceLessonCount: 2, periodMinutes: 45, workspaceView: 'plan', useWeekPlanner: false,
  };
  const sourceWorkspace = await saveProjectWorkspace(page, { ...context, topic: 'Source project' }, draft);
  const publishedDraft = { ...draft, lessonWorkspaceId: sourceWorkspace.id };
  const publication = await page.request.post('/api/assessment', {
    data: { assessment: publishedDraft, rosterId: classRoster.id },
  });
  const published = await publication.json();
  expect(publication.ok(), JSON.stringify(published)).toBeTruthy();
  const resumedWorkspace = await saveProjectWorkspace(page, context, draft);
  const resumedDraft = { ...draft, lessonWorkspaceId: resumedWorkspace.id };
  const update = await page.request.patch(`/api/lesson-workspaces/${resumedWorkspace.id}`, {
    data: {
      context: { ...context, assessmentDraft: resumedDraft, assessmentPublishedId: published.assessmentId },
      sequencePlans: savedProjectSequence(resumedDraft),
      assignmentIds: [published.assessmentId],
    },
  });
  expect(update.ok(), await update.text()).toBeTruthy();
  let generateCalls = 0;
  await page.route('**/api/generate', async route => {
    generateCalls += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Deck generation should remain gated.' }) });
  });

  await page.locator('#lessonsBtn').click();
  await page.locator(`[data-workspace-resume="${resumedWorkspace.id}"]`).click();
  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#autoAssessmentSummary')).toContainText('Automatic project draft ready');
  await page.locator('#acceptBtn').click();
  await expect(page.locator('#assessmentBuilder')).toBeVisible();
  expect(generateCalls).toBe(0);
});

test('roster upload controls keep their actions visible and separated', async ({ page }) => {
  await page.locator('#rostersBtn').click();
  await page.locator('#rosterAdd > summary').click();
  await expect(page.locator('#rosterDropZone')).toBeVisible();
  await expectNoPageOverflow(page);
  const visibleButtons = page.locator('#rostersPanel button:visible');
  const count = await visibleButtons.count();
  for (let i = 0; i < count; i += 1) {
    const box = await visibleButtons.nth(i).boundingBox();
    if (!box) continue;
    expect(box.width).toBeGreaterThan(20);
    expect(box.height).toBeGreaterThan(20);
  }
});
