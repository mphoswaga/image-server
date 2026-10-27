const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('teacher moves a learner with class picker and persisted memberships',async({page,browser})=>{
 await signInDisposableTeacher(page,'-move-owner');
 const create=async(name,id)=>{
  const r=await page.request.post('/api/roster',{data:{name,idCol:'id',nameCol:'name',rows:[{id,name:'Learner '+id}]}});
  expect(r.ok()).toBeTruthy();return r.json();
 };
 const source=await create('Move source','MOVE-1');
 const target=await create('Move destination','MOVE-2');
 await page.locator('#rostersBtn').click();
 const row=page.locator('.roster-row').filter({has:page.locator('.roster-name',{hasText:'Move source'})});
 await row.getByRole('button',{name:'Student access'}).click();
 await row.getByRole('button',{name:'Move class'}).click();
 await page.locator('dialog .move-target').selectOption(target.id);
 await page.locator('dialog').getByRole('button',{name:'Move student',exact:true}).click();
 await expect(page.locator('dialog .move-target')).toHaveCount(0);
 const from=await (await page.request.get('/api/roster/'+source.id)).json();
 const to=await (await page.request.get('/api/roster/'+target.id)).json();
 expect(from.students).toHaveLength(0);expect(to.students.map(s=>s.id)).toContain('MOVE-1');
 await row.getByRole('button',{name:'Student access'}).click();
 await expect(row).toContainText('No students in this roster');
 const context=await browser.newContext();const other=await context.newPage();
 try{
  await signInDisposableTeacher(other,'-move-stranger');
  const rejected=await other.request.post(`/api/roster/${target.id}/student/MOVE-1/move`,{data:{targetRosterId:source.id}});
  expect(rejected.status()).toBe(400);
  const unchanged=await(await page.request.get('/api/roster/'+target.id)).json();
  expect(unchanged.students.map(s=>s.id)).toContain('MOVE-1');
 }finally{await context.close();}
});
