const {test,expect}=require('@playwright/test'),E=require('../../codequest-engine'),C=require('../../public/codequest-core');
function session(){const s=E.create({students:[{id:'a',name:'Mia',gender:'female'},{id:'b',name:'Leo',gender:'male'}],preview:true,generated:false,staged:false,seconds:180,rounds:3,requireReturn:false},Date.now());E.start(s,Date.now());return s;}
test('winner portrait persists after the protected replay celebration until the next duel',async({page},info)=>{
 const s=session();s.players.a.program=C.solve(E.view(s,'a',false).mission);s.players.b.program=[];E.tick(s,s.deadline);
 const length=Math.max(...Object.values(s.players).map(p=>p.result.frames.length));
 expect(s.replayEnd-s.replayAt-length*650).toBe(6000);
 E.tick(s,s.replayEnd-1);expect(s.phase).toBe('replay');
 s.replayAt=Date.now()-length*650-200;s.replayEnd=Date.now()+5800;
 await page.route('**/api/game/visual/codequest*',r=>r.fulfill({json:{teacher:false,preview:true,state:E.view(s,'a',false)}}));
 await page.goto('/codequest.html?game=visual');await expect(page.locator('#duelVictory')).toBeVisible();
 await expect(page.locator('#victoryTitle')).toHaveText('WINNER');await expect(page.locator('#victoryPirates strong')).toHaveText('Mia');
 await expect(page.locator('#victoryPirates .pirate')).toHaveAttribute('data-avatar','female');
 const box=await page.locator('#duelVictory').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width+1);
 await page.screenshot({path:info.outputPath('winner-celebration.png'),fullPage:true});
 await page.locator('header strong').click();await expect.poll(()=>page.locator('audio[data-codequest-celebration]').evaluate(a=>!a.paused&&a.currentTime>0)).toBe(true);
 E.tick(s,s.replayEnd);expect(s.phase).toBe('results');await expect(page.locator('#duelVictory')).toBeVisible();await expect(page.locator('#replayBoards')).toBeHidden();E.start(s,Date.now());await expect(page.locator('#duelVictory')).toBeHidden();await expect(page.locator('#editor')).toBeVisible();
});
test('repeat execution shows the current repetition and keeps blocks editable afterwards',async({page})=>{
 const s=session();s.round=3;s.players.a.program=[{op:'repeat',count:3,body:[{op:'right'}]}];
 await page.route('**/api/game/visual/codequest*',r=>r.fulfill({json:{teacher:false,preview:true,state:E.view(s,'a',false)}}));
 await page.goto('/codequest.html?game=visual');await page.locator('#test').click();
 await expect(page.locator('#program li.active')).toHaveAttribute('data-iteration','↻ 1 of 3');
 await expect(page.locator('#program li.active')).toHaveAttribute('data-iteration','↻ 3 of 3');
 await expect(page.locator('#island .pirate')).toHaveAttribute('data-facing','north');
 await page.locator('#program .codeStep').click();await expect(page.locator('#stepRepeat')).toBeVisible();
});
test('draw celebrates both pirates instead of inventing a winner',async({page})=>{
 const s=session(),code=C.solve(E.view(s,'a',false).mission);s.players.a.program=code;s.players.b.program=code;E.tick(s,s.deadline);
 const length=s.players.a.result.frames.length;s.replayAt=Date.now()-length*650-200;s.replayEnd=Date.now()+5800;
 await page.route('**/api/game/visual/codequest*',r=>r.fulfill({json:{teacher:false,preview:true,state:E.view(s,'a',false)}}));
 await page.goto('/codequest.html?game=visual');await expect(page.locator('#victoryTitle')).toHaveText('A brilliant draw!');await expect(page.locator('#victoryPirates .pirate')).toHaveCount(2);
});
