const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('teacher invites a future account to copy roster without sharing original records',async({page,browser})=>{
 await signInDisposableTeacher(page,'-share-owner');
 const result=await page.request.post('/api/roster',{data:{name:'Shared 3B4',idCol:'id',nameCol:'name',rows:[{id:'SHARE-TEST',name:'Class Learner'}]}});
 const original=await result.json();
 const email=`roster-recipient-${Date.now()}@example.test`;
 await page.locator('#rostersBtn').click();
 await page.locator('#rosterShareEmail').fill(email);
 await page.locator('#rosterShareClasses input').check();
 await page.getByRole('button',{name:'Invite to copy rosters'}).click();
 await expect(page.locator('#rosterShareStatus')).toContainText('Invitation ready');
 const context=await browser.newContext(),other=await context.newPage();
 try{
  const signup=await context.request.post('http://127.0.0.1:4341/api/signup',{data:{email,password:'Test-password-123!',name:'Other Teacher'}});expect(signup.ok()).toBeTruthy();
  await other.goto('http://127.0.0.1:4341/');await other.locator('#rostersBtn').click();
  await expect(other.locator('#rosterShareInvites')).toContainText('Shared 3B4');
  await other.getByRole('button',{name:'Accept roster copies'}).click();
  await expect(other.locator('#rosterList')).toContainText('Shared 3B4');
  const rosters=await (await context.request.get('http://127.0.0.1:4341/api/rosters')).json();expect(rosters.rosters).toHaveLength(1);expect(rosters.rosters[0].id).not.toBe(original.id);
  const forbidden=await context.request.get('http://127.0.0.1:4341/api/roster/'+original.id);expect(forbidden.status()).toBe(404);
 }finally{await context.close();}
});
