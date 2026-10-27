const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('admit a late learner to a running test then remove class membership without changing the test cohort',async({page,browser})=>{
 await signInDisposableTeacher(page,'-admissions');
 const create=async(name,id)=>{const r=await page.request.post('/api/roster',{data:{name,idCol:'id',nameCol:'name',rows:[{id,name:'Learner '+id}]}});expect(r.ok()).toBeTruthy();return r.json();};
 const target=await create('Admissions class','ORIGINAL'),source=await create('New learners','LATE');
 const response=await page.request.post('/api/assessment',{data:{rosterId:target.id,assessment:{title:'Late arrival test',subject:'ICT',grade:'Grade 2',assessmentType:'test',deliveryMode:'live',totalMarks:1,objectives:[{id:'know',text:'Identify computer devices'}],sections:[{id:'theory',title:'Theory',type:'mcq',objectiveIds:['know'],items:[{id:'q1',prompt:'Which device shows pictures?',options:['Monitor','Keyboard'],correctIndex:0,marks:1}]}]}}});
 expect(response.ok(),await response.text()).toBeTruthy();const a=await response.json();
 const started=await page.request.patch(`/api/assignment/${a.assessmentId}/live-state`,{data:{action:'start'}});expect(started.ok(),await started.text()).toBeTruthy();
 expect((await page.request.post(`/api/roster/${source.id}/student/LATE/move`,{data:{targetRosterId:target.id}})).ok()).toBeTruthy();
 await page.locator('#assignmentsBtn').click();
 await page.getByRole('button',{name:'Add learners to test',exact:true}).click();
 await expect(page.locator('dialog .admit-learner')).toHaveCount(1);await page.locator('.admit-learner').check();
 await page.getByRole('button',{name:'Add selected learners',exact:true}).click();await expect(page.locator('.admit-learner')).toHaveCount(0);
 const context=await browser.newContext();
 try{
  const meta=await(await context.request.get(new URL(`/api/assignment/${a.assessmentId}/join`,page.url()).href)).json();expect(meta.students).toHaveLength(2);
  const forbidden=await context.request.post(new URL(`/api/assignment/${a.assessmentId}/learners`,page.url()).href,{data:{studentIds:['FAKE']}});expect(forbidden.ok()).toBeFalsy();
 }finally{await context.close();}
 await page.locator('#rostersBtn').click();const row=page.locator('.roster-row').filter({has:page.locator('.roster-name',{hasText:'Admissions class'})});
 await row.getByRole('button',{name:'Student access',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept());
 await row.locator('.student-remove-btn[data-student-id="LATE"]').click();
 await expect(row).toContainText('1 students');
 const saved=await(await page.request.get('/api/roster/'+target.id)).json();expect(saved.students.map(s=>s.id)).toEqual(['ORIGINAL']);
 const snapshot=await(await page.request.get(`/api/assignment/${a.assessmentId}/join`)).json();expect(snapshot.students).toHaveLength(2);
});
