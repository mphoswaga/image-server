const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('removing a diagram confirms linked questions and preserves the other diagram across reload',async({page})=>{
 await signInDisposableTeacher(page,'-remove-image');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();
 const buffer=await require('sharp')({create:{width:100,height:100,channels:3,background:'#abcdef'}}).png().toBuffer();
 await page.locator('#upload').setInputFiles({name:'Keep this.png',mimeType:'image/png',buffer});await expect(page.locator('#upload-status')).toContainText('Diagram added');
 await page.locator('#diagram-select').selectOption('0');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Remove diagram',exact:true}).click();await expect(page.locator('[data-question]')).toHaveCount(5);await expect(page.locator('#diagram-select option')).toHaveCount(2);
 let message='';page.once('dialog',d=>{message=d.message();return d.accept()});await page.getByRole('button',{name:'Remove diagram',exact:true}).click();expect(message).toContain('5 linked questions');
 await expect(page.locator('[data-question]')).toHaveCount(0);await expect(page.locator('#diagram-select option')).toHaveCount(1);await expect(page.locator('#diagram-select')).toContainText('Keep this');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('#notice')).toContainText('Draft saved');page.on('dialog',d=>d.accept());await page.reload();
 await expect(page.locator('#diagram-select')).toContainText('Keep this');await expect(page.locator('[data-question]')).toHaveCount(0);
 await page.getByRole('button',{name:'Remove diagram',exact:true}).click();await expect(page.locator('#diagram')).toHaveCount(0);await expect(page.getByRole('button',{name:'Remove diagram',exact:true})).toHaveCount(0);await expect(page.locator('#upload')).toBeAttached();
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('#notice')).toContainText('Draft saved');await page.reload();await expect(page.locator('#diagram')).toHaveCount(0);
});
