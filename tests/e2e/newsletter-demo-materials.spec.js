const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('sample materials appear for teachers and parents with working public activities',async({page,browser},info)=>{
 await signInDisposableTeacher(page,'-materialdemo');
 const w=await(await page.request.post('/api/school-newsletters/demo',{data:{}})).json();
 expect(w.reports[0].entries.every(e=>e.links.length && e.images.length)).toBe(true);
 await page.goto('/newsletters.html');await page.locator('#spaces').selectOption(w.id);
 await page.locator('#demoRole').selectOption('teacher');
 const media=page.locator('.subject-media').first();await media.locator('summary').click();
 await expect(media.locator('img')).toBeVisible();
 await expect(media.locator('textarea')).toContainText('newsletter-demo-materials.html#ict');
 await media.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('teacher-materials.png')});
 await page.locator('#demoRole').selectOption('coordinator');
 await page.getByRole('button',{name:'Prepare parent demo',exact:true}).click();
 const link=await page.locator('#parentLink').inputValue();
 const guest=await browser.newContext({viewport:info.project.use.viewport});
 try{const p=await guest.newPage();await p.goto(link);
 await expect(p.locator('#entries img').first()).toBeVisible();
 await expect(p.locator('#entries a').first()).toHaveAttribute('href',/newsletter-demo-materials/);
 await p.goto('/newsletter-demo-materials.html#ict');
 await expect(p.getByRole('heading',{name:'ICT · File sizes'})).toBeVisible();
 expect(await p.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
 expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await guest.close();}
});
