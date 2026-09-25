const {test,expect}=require('@playwright/test');
test('class board celebrates, locks answers, pauses, resumes after reload and finishes fairly',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await page.route('**/api/game/board/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:board',classes:[{id:'r1',name:'Class One'}],attendance:[{rosterId:'r1',studentId:'a',name:'Alex'},{rosterId:'r1',studentId:'b',name:'Bao'}],game:{questions:[{question:'Where do fish live?',options:['Water','Trees'],correctIndex:0,explanation:'Fish live in water.'}]}}}));
 await page.goto('/fishquest-board.html?game=board');await page.locator('#start').click();
 await expect(page.locator('#turn')).toContainText('Alex');await page.locator('[data-answer="0"]').click();
 await expect(page.locator('#hero')).toBeVisible();await expect(page.locator('#scores')).toContainText('5');
 await expect(page.locator('[data-answer="1"]')).toBeDisabled();
 await page.locator('#pause').click();await page.clock.fastForward(10000);await expect(page.locator('#turn')).toContainText('Alex');
 await page.reload();await page.locator('#restore').click();await expect(page.locator('#pause')).toHaveText('Resume');
 await page.locator('#pause').click();await page.clock.fastForward(6600);await expect(page.locator('#turn')).toContainText('Bao');
 await page.locator('[data-answer="1"]').click();await expect(page.locator('#feedback')).toContainText('Let’s learn together');
 await expect(page.locator('#hero')).toBeHidden();await page.clock.fastForward(6600);
 await expect(page.locator('#turn')).toContainText('Everyone had a turn');expect(errors).toEqual([]);
});
test('full class stays visible and class selection excludes other rosters',async({page},info)=>{
 const roster=Array.from({length:30},(_,i)=>({rosterId:'r1',studentId:String(i),name:'Learner '+(i+1)}));
 await page.route('**/api/game/board/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:board',classes:[{id:'r1',name:'Class One'},{id:'r2',name:'Class Two'}],attendance:[...roster,{rosterId:'r2',studentId:'other',name:'Other class learner'}],game:{questions:[{question:'Which part of our body receives sound?',options:['Eyes','Ears','Hands','Nose'],correctIndex:1}]}}}));
 await page.goto('/fishquest-board.html?game=board');await page.locator('#teams').selectOption('3');await page.locator('#start').click();
 await expect(page.locator('.swimmer')).toHaveCount(30);await expect(page.locator('#fish')).not.toContainText('Other class learner');
 await page.screenshot({path:info.outputPath('class-ocean.png'),fullPage:true});
 if(info.project.name==='windows-100'){
 const bottom=await page.locator('#restart').evaluate(el=>el.getBoundingClientRect().bottom);
 expect(bottom).toBeLessThanOrEqual(768);
 }
});
