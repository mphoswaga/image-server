const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('teacher previews learner dashboard without creating a learner session',async({page})=>{
 await signInDisposableTeacher(page,'preview');
 const r=await page.request.post('/api/roster',{data:{name:'Preview class',rows:[{ID:'PREVIEW01',Name:'Preview Learner'}],idCol:'ID',nameCol:'Name'}});expect(r.ok()).toBeTruthy();
 expect((await page.request.get('/api/student-profiles/UNKNOWN/preview/me')).status()).toBe(404);
 await page.goto('/start?previewStudent=PREVIEW01');
 await expect(page.locator('#previewBanner')).toContainText('Viewing as Preview Learner');
 await expect(page.locator('#dashboard')).toBeVisible();
 await expect(page.locator('#todoList')).not.toContainText('Finding your activities');
 await page.locator('#roomCode').fill('ABCDEF');
 let joins=0;page.on('request',r=>{if(r.url().includes('/join-room'))joins++;});
 await page.locator('#joinBtn').click();expect(joins).toBe(0);
 expect((await page.request.get('/api/student/me')).status()).not.toBe(200);
 await signInDisposableTeacher(page,'other');
 expect((await page.request.get('/api/student-profiles/PREVIEW01/preview/me')).status()).toBe(404);
});
