const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('answer regions move and resize while linked answers survive saving',async({page})=>{
 await signInDisposableTeacher(page,'-region-drag');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();
 const region=page.locator('polygon[data-region="eyes"]'),original=await region.getAttribute('points');await region.scrollIntoViewIfNeeded();await expect(page.locator('#diagram img')).toHaveJSProperty('complete',true);await region.hover();const b=await region.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+25,b.y+b.height/2+20,{steps:10});await page.mouse.up();
 await expect(region).not.toHaveAttribute('points',original);await expect(page.locator('[data-resize]')).toHaveCount(4);const moved=await region.getAttribute('points');
 const h=await page.locator('[data-resize="se"]').boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+20,h.y+h.height/2+15,{steps:8});await page.mouse.up();await expect(region).not.toHaveAttribute('points',moved);
 const final=await region.getAttribute('points');await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();const lib=await(await page.request.get('/api/games/moonquest/library')).json();const saved=await(await page.request.get('/api/games/moonquest/games/'+lib.games[0].id)).json();expect(saved.game.diagrams[0].regions.find(r=>r.id==='eyes').points.map(p=>p.join(',')).join(' ')).toBe(final);expect(saved.game.questions[1].accepted).toEqual(['eyes']);
});
test('teacher draws a new labelled rectangle with a drag',async({page})=>{
 await signInDisposableTeacher(page,'-rectangle-create');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#region-label').fill('Shoulder');const svg=page.locator('#diagram svg');await svg.scrollIntoViewIfNeeded();const b=await svg.boundingBox();await page.mouse.move(b.x+b.width*.3,b.y+b.height*.42);await page.mouse.down();await page.mouse.move(b.x+b.width*.45,b.y+b.height*.53,{steps:8});await page.mouse.up();await expect(page.locator('polygon[data-region]')).toHaveCount(6);await expect(page.locator('[data-resize]')).toHaveCount(4);await expect(page.locator('#region-label')).toHaveValue('Shoulder');
});

test('save identifies an empty second diagram and returns teacher to its areas',async({page})=>{
 await signInDisposableTeacher(page,'-empty-diagram');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();
 const buffer=await require('sharp')({create:{width:100,height:100,channels:3,background:'#abcdef'}}).png().toBuffer();
 await page.locator('#upload').setInputFiles({name:'Second picture.png',mimeType:'image/png',buffer});await expect(page.locator('#upload-status')).toContainText('Diagram added');
 await page.locator('#diagram-select').selectOption('0');await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
 await expect(page.locator('#notice')).toContainText('Second picture');await expect(page.locator('#notice')).toContainText('no saved answer areas');await expect(page.locator('#diagram-select')).toHaveValue('1');await expect(page.locator('#region-label')).toBeFocused();
});
