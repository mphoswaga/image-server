const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
const base={sections:[{heading:'Starter',content:'Recall search words.',stageId:'launch'},{heading:'Main Activity',content:'Model a search for tree frogs.',stageId:'practice'},{heading:'Plenary',content:'Explain your keywords.',stageId:'check'}],successCriteria:['I can select specific keywords.'],lessonPurpose:'lesson',teachingModelId:'standard',learningOutcome:'By the end of this lesson, you will be able to choose specific keywords to find information.'};
async function setup(page){await signInDisposableTeacher(page,'-learning');await page.getByRole('button',{name:/Start with objectives/}).click();await page.locator('#subject').fill('ICT');await page.locator('#topic').fill('Search');await page.locator('#flowSourceNextBtn').click();await page.locator('#objectives').fill('Use keywords to search for information.');await page.locator('#flowObjectivesNextBtn').click();}
test('follow-up keeps original and saves separate editable outcomes in a new sequence',async({page})=>{
 let followRequest;
 await page.route('**/api/lesson-plan',async r=>{const b=r.request().postDataJSON();if(b.sequenceLessonNumber===2){followRequest=b;return r.fulfill({json:{...base,sequenceLessonNumber:2,learningOutcome:'By the end of this lesson, you will be able to explain and improve your keyword choices.'}});}return r.fulfill({json:base});});
 await setup(page);await page.locator('#planBtn').click();await expect(page.locator('#planLearningOutcome')).toHaveValue(base.learningOutcome);
 await page.locator('#planLearningOutcome').fill('By the end of this lesson, you will be able to search using precise keywords.');
 await page.evaluate(()=>saveWorkspaceNow());const original=await page.evaluate(()=>currentWorkspaceId);
 await page.locator('#followUpReflectionBtn').click();await expect(page.locator('#planLearningOutcome')).toHaveValue('By the end of this lesson, you will be able to explain and improve your keyword choices.');
 await expect.poll(()=>page.evaluate(()=>currentWorkspaceId)).not.toBe(original);
 await page.evaluate(()=>saveWorkspaceNow());const sequence=await page.evaluate(()=>currentWorkspaceId);expect(sequence).toBeTruthy();expect(followRequest.sequenceLessonPurposes).toEqual(['teach','reflect']);expect(followRequest.previousLessonPlanText).toContain('tree frogs');
 await page.reload();await page.evaluate(id=>resumeLessonWorkspace(id),sequence);
 await expect(page.locator('#planLearningOutcome')).toHaveValue('By the end of this lesson, you will be able to explain and improve your keyword choices.');
 await page.locator('[data-plan-index="0"]').click();await expect(page.locator('#planLearningOutcome')).toHaveValue('By the end of this lesson, you will be able to search using precise keywords.');
 await page.evaluate(id=>resumeLessonWorkspace(id),original);await expect(page.locator('#planLearningOutcome')).toHaveValue('By the end of this lesson, you will be able to search using precise keywords.');await expect(page.locator('#followUpReflectionBtn')).toBeVisible();
});
test('per-period purpose controls are optional and sent with the sequence',async({page})=>{
 let sent;await page.route('**/api/lesson-plan',r=>{sent=r.request().postDataJSON();return r.fulfill({json:{...base,sequenceLessonNumber:1}});});
 await setup(page);await page.getByText('Weekly lesson sequence',{exact:false}).first().click();await page.locator('#sequenceEnabled').check();await page.locator('#sequenceLessonCount').fill('2');await page.locator('#sequenceLessonCount').dispatchEvent('change');await page.locator('[data-period-purpose]').nth(1).selectOption('reflect');await page.locator('#reflectionMcqCount').fill('6');await page.locator('#planBtn').click();await expect(page.locator('#planLearningOutcome')).toBeVisible();expect(sent.sequenceLessonPurposes).toEqual(['teach','reflect']);expect(sent.reflectionMcqCount).toBe(6);
});

test('optional lesson objectives are sent separately and survive control rerenders',async({page})=>{
 let sent;await page.route('**/api/lesson-plan',r=>{sent=r.request().postDataJSON();return r.fulfill({json:{...base,sequenceLessonNumber:1}});});
 await setup(page);await page.getByText('Weekly lesson sequence',{exact:false}).first().click();
 await page.locator('#sequenceEnabled').check();await page.locator('#sequenceLessonCount').fill('2');await page.locator('#sequenceLessonCount').dispatchEvent('change');
 await page.getByText('Different objectives for lesson 2 (optional)',{exact:true}).click();
 await page.locator('[data-period-objectives="1"]').fill('Describe the properties of liquids.');
 await page.locator('#sequenceLessonCount').fill('3');await page.locator('#sequenceLessonCount').dispatchEvent('change');
 await expect(page.locator('[data-period-objectives="1"]')).toHaveValue('Describe the properties of liquids.');
 await page.locator('#planBtn').click();await expect(page.locator('#planLearningOutcome')).toBeVisible();
 expect(sent.sequenceLessonObjectives).toEqual(['','Describe the properties of liquids.','']);
 await page.evaluate(()=>saveWorkspaceNow());
 const id=await page.evaluate(()=>currentWorkspaceId);
 await page.reload();await page.evaluate(id=>resumeLessonWorkspace(id),id);
 await expect(page.locator('[data-period-objectives="1"]')).toHaveValue('Describe the properties of liquids.');
});
