const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('published topic prompt produces a separate editable assessment draft',async({page,browser})=>{
 await page.context().route(/https:\/\//,route=>route.abort());
 await signInDisposableTeacher(page,'topic');
 const created=await (await page.request.post('/api/pack/quiz/publish',{data:{subject:'ICT',topic:'File sizes',grade:'Grade 3',data:{title:'File sizes',mcq:[{question:'Original',options:['B','TB'],correctIndex:0}]}}})).json();
 const topics=await (await page.request.get('/api/assessment-topics')).json();expect(topics.topics.some(t=>t.id===created.assignmentId)).toBeTruthy();
 const other=await browser.newContext();await other.route(/https:\/\//,route=>route.abort());await signInDisposableTeacher(await other.newPage(),'other-topic');
 expect((await other.request.post('/api/assessment-mcq',{data:{source:'assignment',sourceId:created.assignmentId,instructions:'Generate questions',grade:'3'}})).status()).toBe(404);await other.close();
 await page.locator('#assignmentsBtn').click();await page.locator('#topicMcqOpen').click();
 await expect(page.locator('#topicMcqGrade')).toHaveValue('Grade 3');
 await page.locator('#topicMcqPrompt').fill('Cover bytes to TB and text, images, audio, video and games');
 await page.route('**/api/assessment-mcq',route=>route.fulfill({json:{assessment:{title:'File size check',subject:'ICT',grade:'Grade 3',totalMarks:1,assessmentType:'test',deliveryMode:'self-paced',objectives:[{id:'o1',text:'Compare sizes'}],sections:[{id:'s1',title:'MCQ',type:'mcq',objectiveIds:['o1'],items:[{id:'q1',prompt:'Which is largest?',options:['B','KB','MB','TB'],correctIndex:3,marks:1}]}]}}}));
 await page.locator('#topicMcqGenerate').click();
 await expect(page.locator('#assessmentTitle')).toHaveValue('File size check');
 await expect(page.locator('[data-item-prompt]')).toHaveValue('Which is largest?');
 await expect(page.locator('#assessmentTotal')).toHaveValue('1');
 const original=await (await page.request.get(`/api/assignment/${created.assignmentId}/edit`)).json();expect(original.content.questions[0].question).toBe('Original');
});
