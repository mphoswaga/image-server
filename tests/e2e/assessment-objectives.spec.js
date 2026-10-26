const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');
test('objectives generate a reviewable assessment without a lesson workspace', async ({ page }) => {
  await signInDisposableTeacher(page, '-objective-assessment');
  await page.locator('#assignmentsBtn').click();
  await page.locator('#newAssessmentBtn').click();
  await page.locator('#assessmentGenerate').click();
  await expect(page.locator('#assessmentGenerateStatus')).toContainText('Enter your subject');
  await page.locator('#assessmentSubject').fill('Science');
  await page.locator('#assessmentGrade').fill('Grade 2');
  await page.locator('#assessmentObjectives').fill('Identify solids and liquids.');
  await page.locator('#assessmentTotal').fill('10');
  await page.route('**/api/assessment-generate', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ grade: 'Grade 2', objectives: 'Identify solids and liquids.', totalMarks: 10 });
    await route.fulfill({ json: { assessment: { title: 'Materials test', subject: 'Science', grade: 'Grade 2', assessmentType: 'test', totalMarks: 10, deliveryMode: 'live', objectives: [{ id: 'o1', text: 'Identify solids and liquids.' }], sections: [{ id: 's1', title: 'Materials', type: 'short-answer', objectiveIds: ['o1'], items: [{ id: 'i1', prompt: 'Name a liquid.', answerKey: 'Water.', marks: 10 }] }] } } });
  });
  await page.locator('#assessmentGenerate').click();
  await expect(page.locator('#assessmentGenerateStatus')).toContainText('Draft ready');
  await expect(page.locator('[data-item-prompt]')).toHaveValue('Name a liquid.');
  await expect(page.locator('#assessmentTitle')).toHaveValue('Materials test');
  await expect(page.locator('#publishAssessmentBtn')).toBeEnabled();
});
test('teacher chooses an exact MCQ and practical split before generation', async ({ page }) => {
  await signInDisposableTeacher(page, '-assessment-split');
  await page.locator('#assignmentsBtn').click();
  await page.locator('#newAssessmentBtn').click();
  await page.locator('[data-generation-split="30"]').click();
  await expect(page.locator('#assessmentTotal')).toHaveValue('50');
  await expect(page.locator('#assessmentGenerateMcqCount')).toHaveValue('30');
  await expect(page.locator('#assessmentGeneratePracticalMarks')).toHaveValue('20');
  await page.locator('#assessmentGeneratePracticalCount').fill('4');
  await page.locator('#assessmentGeneratePracticalMarks').fill('25');
  await page.locator('#assessmentGenerate').click();
  await expect(page.locator('#assessmentGenerateStatus')).toContainText('must add up');
  await page.locator('#assessmentGeneratePracticalMarks').fill('20');
  await page.locator('#assessmentSubject').fill('ICT');
  await page.locator('#assessmentGrade').fill('Grade 3');
  await page.locator('#assessmentObjectives').fill('Compare file sizes.');
  let received;
  await page.route('**/api/assessment-generate', async route => {
    received=route.request().postDataJSON();
    await route.fulfill({status:400,json:{error:'Sample generation error'}});
  });
  await page.locator('#assessmentGenerate').click();
  await expect(page.locator('#assessmentGenerateStatus')).toContainText('Sample generation error');
  expect(received).toMatchObject({format:'mixed',mcqCount:30,practicalCount:4,practicalMarks:20,totalMarks:50});
  await expect(page.locator('#assessmentGeneratePracticalCount')).toHaveValue('4');
  await expect(page.locator('#assessmentGenerate')).toBeEnabled();
});
