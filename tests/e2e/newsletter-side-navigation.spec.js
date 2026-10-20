const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('newsletter side navigation separates work, reporting and settings while retaining drafts',async({page},info)=>{
 await signInDisposableTeacher(page,'-side-nav');
 const w=await(await page.request.post('/api/school-newsletters/demo',{data:{}})).json();
 await page.goto('/newsletters.html');await page.locator('#spaces').selectOption(w.id);await page.locator('#demoRole').selectOption('coordinator');
 const nav=page.locator('#newsletterNav');
 await expect(nav).toBeVisible();await expect(page.locator('#taskSummary')).toBeVisible();await expect(page.locator('#settings')).toBeHidden();
 await nav.getByRole('button',{name:'Reports',exact:true}).click();await expect(page.locator('#progressFilters')).toBeVisible();await expect(page.locator('#taskSummary')).toBeHidden();
 await nav.getByRole('button',{name:'Settings & staff'}).click();await expect(page.getByText('Email notifications',{exact:true})).toBeVisible();await expect(page.locator('#progressFilters')).toBeHidden();
 await nav.getByRole('button',{name:'Preview & sharing'}).click();await expect(page.getByRole('button',{name:'Preview PDF',exact:true})).toBeVisible();
 await page.locator('#demoRole').selectOption('teacher');await expect(nav.getByRole('button',{name:'Settings & staff'})).toHaveCount(0);
 await nav.getByRole('button',{name:'Newsletter content'}).click();const field=page.locator('[data-field="english"]').first();await field.fill('A draft kept while moving between sections.');
 await nav.getByRole('button',{name:'My tasks'}).click();await expect(field).toBeHidden();await nav.getByRole('button',{name:'Newsletter content'}).click();await expect(field).toHaveValue('A draft kept while moving between sections.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('newsletter-side-menu.png'),fullPage:true});
});
