const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('unfinished work survives immediate reload and account draft reopens without browser storage',async({page})=>{
 await signInDisposableTeacher(page,'-draft-recovery');await page.goto('/moonquest');await page.getByRole('button',{name:'Create a diagram game',exact:false}).click();
 await page.locator('#mq-title').fill('Unfinished moon lesson');await page.locator('#objective').fill('Identify output devices');
 page.on('dialog',d=>d.accept());await page.reload();
 await expect(page.locator('#mq-title')).toHaveValue('Unfinished moon lesson');await expect(page.locator('#objective')).toHaveValue('Identify output devices');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('#notice')).toContainText('Draft saved');
 await page.evaluate(()=>localStorage.clear());await page.goto('/moonquest');await page.getByRole('button',{name:'Continue draft'}).click();await expect(page.locator('#mq-title')).toHaveValue('Unfinished moon lesson');await expect(page.locator('#objective')).toHaveValue('Identify output devices');
 await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();await expect(page.locator('#notice')).toContainText('Add questions');
});
test('completed adventure removes its draft while preserving saved regions and questions',async({page})=>{
 await signInDisposableTeacher(page,'-draft-publish');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('#notice')).toContainText('Draft saved');
 await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
 await expect(page.getByRole('button',{name:'Set up class'})).toBeVisible();await expect(page.getByRole('button',{name:'Continue draft'})).toHaveCount(0);
});
test('unfinished outline, label and AI objective survive reload even when account saving fails',async({page})=>{
 await signInDisposableTeacher(page,'-draft-outline');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();
 await page.route('**/api/games/moonquest/drafts',r=>r.fulfill({status:503,json:{error:'Temporarily unavailable'}}));
 await page.locator('#objective').fill('Human senses');await page.locator('#region-label').fill('Unfinished outline');await page.locator('#shape').selectOption('polygon');
 const svg=page.locator('#diagram svg');await svg.scrollIntoViewIfNeeded();const b=await svg.boundingBox();await page.mouse.click(b.x+b.width*.1,b.y+b.height*.1);
 const points=await page.locator('#drawing').getAttribute('points');expect(points).not.toBe('');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('#draft-status')).toContainText('Not saved to account');
 page.on('dialog',d=>d.accept());await page.reload();await expect(page.locator('#region-label')).toHaveValue('Unfinished outline');await expect(page.locator('#drawing')).toHaveAttribute('points',points);await expect(page.locator('#objective')).toHaveValue('Human senses');
});
