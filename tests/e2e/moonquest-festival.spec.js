const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('festival theme keeps authoring accessible and music independent from effects',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signInDisposableTeacher(page,'-festival');await page.goto('/moonquest');
 await expect(page.getByRole('img',{name:'Jade rabbit carrying a glowing festival lantern'})).toBeVisible();
 await page.locator('#music').click();await expect(page.locator('#music')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#sound')).toHaveAttribute('aria-pressed','false');
 await page.waitForTimeout(2000);await page.locator('#music').click();await expect(page.locator('#music')).toHaveAttribute('aria-pressed','false');
 await page.screenshot({path:'/tmp/moonquest-festival-'+test.info().project.name+'.png',fullPage:true});
 await page.getByRole('button',{name:'Create a diagram game',exact:false}).click();await expect(page.locator('#mq-title')).toBeVisible();expect(errors).toEqual([]);
});
