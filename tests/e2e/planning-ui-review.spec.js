const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher,expectNoPageOverflow}=require('./helpers');
test('planning navigation and starting options',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signInDisposableTeacher(page,'ui');
 await expect(page.locator('.mode-card')).toHaveCount(3);
 await expect(page.locator('#guideHeroBtn')).toHaveCount(0);
 await expect(page.locator('a[href="/newsletters.html"]')).toHaveCSS('text-decoration-line','none');
 await expectNoPageOverflow(page);
 await expect(page.locator('#homeBtn .app-menu-label')).toBeVisible();
 if(info.project.name==='windows-100') {
   const menu=await page.locator('#mainNavMenu').boundingBox();
   const header=await page.locator('.nav').first().boundingBox();
   expect(menu.y).toBeGreaterThanOrEqual(header.y+header.height);
 }
 await page.screenshot({path:`/tmp/planning-${info.project.name}.png`,fullPage:true});
 await page.locator('#lessonsBtn').click();
 await page.locator('#homeBtn').click();
 await expect(page.locator('#modeSelect')).toBeVisible();
 expect(errors).toEqual([]);
});
