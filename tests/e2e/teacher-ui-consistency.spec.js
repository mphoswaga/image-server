const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher,expectNoPageOverflow}=require('./helpers');
test('teacher sections keep navigation and fit the screen',async({page},info)=>{
 await signInDisposableTeacher(page,'consistency');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const id of ['lessonsBtn','gamesBtn','assignmentsBtn','marksBtn','rostersBtn','homeBtn']) {
   await page.locator('#'+id).click();
   await expect(page.locator('#mainNavMenu')).toBeVisible();
   await expectNoPageOverflow(page);
   await page.screenshot({path:`/tmp/teacher-${id}-${info.project.name}.png`,fullPage:true});
 }
 expect(errors).toEqual([]);
});
