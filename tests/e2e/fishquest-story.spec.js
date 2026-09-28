const {test,expect}=require('@playwright/test');
test('reef story, recoverable shark encounter and net reach sanctuary without duplicate costs',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
 await page.route('**/api/game/story/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:story',classes:[{id:'r',name:'Grade 3'}],attendance:['Nguyễn Phương Anh','Lưu Hà Anh','Nguyễn Lương Hoàng Bách','Đỗ Minh Bảo'].map((name,i)=>({name,studentId:String(i),rosterId:'r'})),game:{questions:[{question:'What do output devices do?',options:['Store data','Send information to the user'],correctIndex:1}]}}}));
 await page.goto('/fishquest-board.html?game=story');await page.locator('#start').click();
 await expect(page.locator('#storyTitle')).toHaveText('A shadow is coming…');await page.locator('#storyContinue').click();
 for(let i=0;i<4;i++){await page.locator('[data-answer="1"]').click();await page.locator('#next').click()}
 await expect(page.locator('#danger')).toHaveClass(/event_warning/);
 await page.locator('#pause').click();await page.clock.fastForward(9000);await expect(page.locator('#storyChoices button')).toHaveCount(0);
 await page.locator('#pause').click();await page.clock.fastForward(7100);
 await expect(page.locator('#storyTitle')).toContainText('Nguyễn Lương Hoàng Bách');await expect(page.locator('#hero')).toBeVisible();await expect(page.locator('#hero')).toHaveCSS('opacity','1');
 await page.clock.fastForward(1200);await page.screenshot({path:info.outputPath('shark-choice.png'),fullPage:true});
 await page.locator('[data-choice="stand"]').click();
 await expect(page.locator('#storyTitle')).toContainText('regroups');await expect(page.locator('#scores>div').first()).toContainText('6 food');
 await page.reload();await page.locator('#restore').click();await expect(page.locator('#pause')).toHaveText('Resume');await expect(page.locator('#scores>div').first()).toContainText('6 food');
 await page.locator('#pause').click();await page.clock.fastForward(5600);
 await page.locator('[data-choice="hide"]').click();await page.clock.fastForward(5600);
 await expect(page.locator('#storyPanel')).toBeHidden();
 for(let i=0;i<4;i++){await page.locator('[data-answer="1"]').click();await page.locator('#next').click()}
 await expect(page.locator('#storyTitle')).toHaveText('A boat… and a falling net!');await page.clock.fastForward(7100);
 await page.clock.fastForward(1200);await expect(page.locator('.fishing-net')).toBeVisible();await page.screenshot({path:info.outputPath('net-choice.png'),fullPage:true});
 await page.locator('[data-choice="shelter"]').click();await page.clock.fastForward(5600);
 await page.locator('[data-choice="sprint"]').click();await page.clock.fastForward(5600);
 await expect(page.locator('#turn')).toContainText('Sanctuary reached');await expect(page.locator('.swimmer')).toHaveCount(4);
 expect(errors).toEqual([]);
});
