const {revealAssessmentActions}=require('./helpers');
const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('saved quiz questions can be edited and persist without changing the room',async({page,browser})=>{
 await signInDisposableTeacher(page,'quiz-edit');
 const published=await page.request.post('/api/pack/quiz/publish',{data:{subject:'ICT',topic:'Research',grade:'2',data:{title:'Editable quiz',mcq:[{question:'Old question',options:['One','Two'],correctIndex:0}],shortAnswer:[{question:'Explain',answer:'An explanation',marks:2}]}}});
 expect(published.ok()).toBeTruthy();const rec=await published.json();
 // Exercise the compatibility editor before a legacy quiz is migrated.
 await page.route('**/api/assignments',async route=>{const response=await route.fetch();const data=await response.json();data.assignments=data.assignments.map(a=>({...a,needsAssessmentControls:false}));await route.fulfill({response,json:data});});
 await page.locator('#assignmentsBtn').click();
 await revealAssessmentActions(page.locator(`[data-assignment-id="${rec.assignmentId}"]`));
 await page.locator(`.a-edit-btn[data-id="${rec.assignmentId}"]`).click();
 await page.locator('.legacy-prompt').first().fill('Which source is trustworthy?');
 await page.locator('.legacy-option').nth(1).fill('A checked source');
 await page.locator('.legacy-correct').selectOption('1');
 await page.locator('.legacy-save').click();
 await expect(page.locator('.legacy-status')).toContainText('Changes saved');
 const stored=await (await page.request.get(`/api/assignment/${rec.assignmentId}/edit`)).json();
 expect(stored.content.questions[0]).toMatchObject({question:'Which source is trustworthy?',correctIndex:1,options:['One','A checked source']});
 const conflict=await page.request.patch(`/api/assignment/${rec.assignmentId}/content`,{data:{...stored.content,version:1}});expect(conflict.status()).toBe(409);
 const other=await browser.newContext();await signInDisposableTeacher(await other.newPage(),'other');
 expect((await other.request.get(`/api/assignment/${rec.assignmentId}/edit`)).status()).toBe(403);await other.close();
 await page.reload();await page.locator('#assignmentsBtn').click();
 await expect(page.locator('#assignmentsList')).toContainText(rec.roomCode);
 await revealAssessmentActions(page.locator(`[data-assignment-id="${rec.assignmentId}"]`));
 await page.locator(`.a-edit-btn[data-id="${rec.assignmentId}"]`).click();
 await expect(page.locator('.legacy-prompt').first()).toHaveValue('Which source is trustworthy?');
});
