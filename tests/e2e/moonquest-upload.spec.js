const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
const sharp=require('sharp');
test('new diagram upload opens chooser and displays image without losing lesson details',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signInDisposableTeacher(page,'-diagram-upload');await page.goto('/moonquest');await page.getByRole('button',{name:'Create a diagram game',exact:false}).click();await page.locator('#mq-title').fill('How devices communicate with us');await page.locator('#mq-subject').fill('ICT');
 const chooser=page.waitForEvent('filechooser');await page.getByText('Add diagram',{exact:false}).click();const file=await chooser;
 const buffer=await sharp({create:{width:1024,height:1024,channels:3,background:'#a5c9bb'}}).png().toBuffer();await file.setFiles(process.env.MOONQUEST_TEST_IMAGE||{name:'class-diagram.png',mimeType:'image/png',buffer});
 await expect(page.locator('#diagram img')).toBeVisible();await expect(page.locator('#mq-title')).toHaveValue('How devices communicate with us');await expect(page.locator('#mq-subject')).toHaveValue('ICT');expect(errors).toEqual([]);
});

test('failed upload keeps a visible error and allows the same image to be retried',async({page})=>{
 await signInDisposableTeacher(page,'-diagram-retry');await page.goto('/moonquest');await page.getByRole('button',{name:'Create a diagram game',exact:false}).click();await page.locator('#mq-title').fill('Keep my lesson');
 let attempts=0;await page.route('**/api/games/moonquest/assets',r=>{if(++attempts===1)return r.fulfill({status:503,json:{error:'Upload temporarily unavailable. Please try again.'}});return r.continue()});
 const buffer=await sharp({create:{width:100,height:100,channels:3,background:'#abcdef'}}).png().toBuffer(),file={name:'retry.png',mimeType:'image/png',buffer};
 await page.locator('#upload').setInputFiles(file);await expect(page.locator('#upload-status')).toContainText('temporarily unavailable');await expect(page.locator('#mq-title')).toHaveValue('Keep my lesson');await expect(page.locator('#upload')).toBeEnabled();
 await page.locator('#upload').setInputFiles(file);await expect(page.locator('#diagram img')).toBeVisible();await expect(page.locator('#upload-status')).toContainText('Diagram added');
});

test('a slow upload stays visible and succeeds beyond the former twelve-second limit',async({page})=>{
 await signInDisposableTeacher(page,'-slow-diagram');await page.goto('/moonquest');await page.getByRole('button',{name:'Create a diagram game',exact:false}).click();
 await page.route('**/api/games/moonquest/assets',async r=>{await new Promise(resolve=>setTimeout(resolve,13000));await r.continue()});
 const buffer=await sharp({create:{width:100,height:100,channels:3,background:'#aabbcc'}}).png().toBuffer();await page.locator('#upload').setInputFiles({name:'slow.png',mimeType:'image/png',buffer});
 await expect(page.locator('#upload-status')).toContainText('Uploading slow.png');await expect(page.locator('#upload-preview')).toBeVisible();await expect(page.locator('#diagram img')).toBeVisible({timeout:20000});await expect(page.locator('#upload-status')).toContainText('Diagram added');
});

test('large diagram is reduced before transfer and retains its proportions',async({page})=>{
 await signInDisposableTeacher(page,'-compressed-diagram');await page.goto('/moonquest');await page.getByRole('button',{name:'Create a diagram game',exact:false}).click();
 const buffer=await sharp({create:{width:3000,height:2000,channels:3,background:'#123456'}}).png().toBuffer();
 await page.evaluate(()=>{const original=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){if(body instanceof FormData)window.sentDiagramBytes=body.get('file').size;return original.call(this,body)}});
 await page.locator('#upload').setInputFiles({name:'large.png',mimeType:'image/png',buffer});
 await expect.poll(()=>page.evaluate(()=>window.sentDiagramBytes||Infinity)).toBeLessThan(buffer.length);
 await expect(page.locator('#diagram img')).toBeVisible();
 const dimensions=await page.locator('#diagram img').evaluate(async image=>{await image.decode();return [image.naturalWidth,image.naturalHeight]});expect(dimensions).toEqual([1800,1200]);
});
