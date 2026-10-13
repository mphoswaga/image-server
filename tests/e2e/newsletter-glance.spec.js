const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('coordinator matrix, revision feedback and family checklist',async({page,browser},testInfo)=>{
 await signInDisposableTeacher(page,'-glance');
 let w=await(await page.request.post('/api/school-newsletters/demo',{data:{}})).json();
 const id=w.reports[0].id;
 await page.goto('/newsletters.html');
 await page.locator('#spaces').selectOption(w.id);
 await expect(page.locator('.progress-matrix')).toBeVisible();
 await expect(page.locator('.matrix-cell')).toHaveCount(3);
 await page.locator('[data-remind-subject="Science"]').check();
 await page.getByRole('button',{name:'Send selected in-app reminders'}).click();
 await expect(page.locator('.subject').filter({hasText:'Science'})).toContainText('requested an update');
 const ict=page.locator('.subject').first();
 await page.locator('.matrix-cell').first().click();
 await ict.getByText('Request a change',{exact:true}).click();
 await ict.getByPlaceholder('Identify the paragraph and explain the change needed.').fill('Please add the homework deadline.');
 await ict.getByRole('button',{name:'Send back for revision'}).click();
 await expect(ict).toContainText('Please add the homework deadline.');
 w=await(await page.request.get('/api/school-newsletters/'+w.id)).json();
 async function change(action,extra={}){
 const response=await page.request.post('/api/school-newsletters/'+w.id+'/change',{data:{revision:w.revision,reportId:id,action,...extra}});
 expect(response.ok(),await response.text()).toBeTruthy(); w=await response.json();
 }
 for(const e of w.reports[0].entries){
 await change('english',{subject:e.subject,text:'Learning about our world.\n\nHomework:\nComplete the LMS task by Friday.\n\nThings to bring:\nBring your notebook.',submit:true});
 await change('vietnamese',{subject:e.subject,text:'Tuần này chúng ta học.\n\nBài tập về nhà:\nHoàn thành bài trên LMS.',review:true});
 }
 await change('approve'); await change('publish');
 const pub=w.reports[0].publication;
 const guest=await browser.newContext({viewport:testInfo.project.use.viewport});
 try{
 const parent=await guest.newPage();
 await parent.goto(`/family-newsletter.html#${w.id}/${id}/${pub.token}`);
 await expect(parent.locator('#familyChecklist')).toContainText('Complete the LMS task by Friday.');
 await expect(parent.locator('body')).not.toContainText('Please add the homework deadline.');
 await parent.locator('#familyChecklist input').first().check();
 await parent.getByRole('button',{name:'Tiếng Việt',exact:true}).click();
 await expect(parent.locator('#familyChecklist')).toContainText('Hoàn thành bài trên LMS.');
 expect(await parent.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await parent.screenshot({path:testInfo.outputPath('family-checklist.png'),fullPage:true});
 }finally{await guest.close();}
 await page.reload(); await page.locator('#spaces').selectOption(w.id);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('coordinator-grid.png'),fullPage:false});
});
