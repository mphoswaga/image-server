const {test,expect}=require('@playwright/test'),E=require('../../codequest-engine');
test('actual celebration audio plays at results, continues at finish and obeys Music off',async({page})=>{const s=E.create({students:[{id:'a',name:'Mia'},{id:'b',name:'Leo'}],preview:true,staged:false,seconds:60,rounds:2},Date.now());E.start(s,Date.now());E.tick(s,s.deadline);E.tick(s,s.replayEnd);await page.route('**/api/game/celebrate/codequest**',r=>r.fulfill({json:{teacher:false,preview:true,joinUrl:'/play/celebrate',state:E.view(s,'a',false)}}));await page.goto('/codequest.html?game=celebrate');await page.locator('header strong').click();const audio=()=>page.locator('audio[data-codequest-celebration]');await expect.poll(()=>audio().evaluate(a=>!a.paused&&a.currentTime>.1)).toBe(true);expect(await audio().evaluate(a=>a.error)).toBeNull();await expect(page.locator('audio[data-codequest-music]')).toHaveJSProperty('paused',true);s.phase='ended';await expect(page.locator('#final')).toBeVisible();await expect.poll(()=>audio().evaluate(a=>!a.paused)).toBe(true);await page.locator('#music').click();await expect(audio()).toHaveJSProperty('paused',true);await page.locator('#music').click();await expect.poll(()=>audio().evaluate(a=>!a.paused)).toBe(true);E.start(s,Date.now());await expect(audio()).toHaveJSProperty('paused',true);});

test('both duel players see only the winner throughout the break',async({page,context})=>{
 const C=require('../../public/codequest-core');
 const s=E.create({students:[{id:'a',name:'Mia',gender:'female'},{id:'b',name:'Leo',gender:'male'}],preview:true,staged:false,rounds:2},Date.now());E.start(s,Date.now());
 s.players.a.program=C.solve(E.view(s,'a',false).mission);E.tick(s,s.deadline);E.tick(s,s.replayEnd);
 const rival=await context.newPage();
 for(const [p,id] of [[page,'a'],[rival,'b']]){
  await p.route('**/api/game/winners/codequest**',r=>r.fulfill({json:{teacher:false,preview:true,state:E.view(s,id,false)}}));
  await p.goto('/codequest.html?game=winners');await expect(p.locator('#victoryTitle')).toHaveText('WINNER');
  await expect(p.locator('#victoryPirates .victoryCaptain')).toHaveCount(1);await expect(p.locator('#victoryPirates strong')).toHaveText('Mia');
  await expect(p.locator('#victoryPirates .pirate')).toHaveAttribute('data-avatar','female');await expect(p.locator('#replayBoards')).toBeHidden();
 }
 E.start(s,Date.now());for(const p of [page,rival])await expect(p.locator('#duelVictory')).toBeHidden();
});

test('final podium shows the top three named pirates and moving gold scene',async({page})=>{
 const s=E.create({students:['Mia','Leo','Ava','Noah'].map((name,i)=>({id:String(i),name,gender:i%2?'male':'female'})),preview:true,staged:false,rounds:2},Date.now());
 s.phase='ended';s.round=2;Object.values(s.players).forEach((p,i)=>{p.wins=4-i;p.solved=5-i;});
 await page.route('**/api/game/podium/codequest**',r=>r.fulfill({json:{teacher:false,preview:true,state:E.view(s,'0',false)}}));
 await page.goto('/codequest.html?game=podium');await page.locator('header strong').click();
 await expect(page.locator('#podium .victoryCaptain')).toHaveCount(3);await expect(page.locator('#podium strong')).toHaveText(['Mia','Leo','Ava']);
 await expect(page.locator('#podium .celebrationGold')).toHaveCount(3);expect(await page.locator('#podium .pirate').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('podiumJump');
 await expect.poll(()=>page.locator('audio[data-codequest-celebration]').evaluate(a=>!a.paused&&a.currentTime>0)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/codequest-podium-'+test.info().project.name+'.png',fullPage:true});
 await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('#podium .pirate').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});
