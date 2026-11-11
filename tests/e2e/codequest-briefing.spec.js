const {test,expect}=require('@playwright/test');
test('level rules match mission constraints and speech plays only for the teacher',async({page})=>{
 await page.goto('/healthz');
 await page.setContent('<main></main>');
 await page.evaluate(()=>{window.spoken=[];window.speechSynthesis.cancel=()=>{};window.speechSynthesis.speak=u=>spoken.push(u.text);});
 await page.addScriptTag({url:'/codequest-briefing.js'});
 await page.evaluate(()=>{
  CodeQuestBriefing.prototype.speak=function(){spoken.push(this.text);};
  window.briefing=new CodeQuestBriefing();
  window.level={id:'lesson',round:1,phase:'countdown',mission:{blocks:['move','collect']}};
  briefing.sync(level,true,true,false);
 });
 await expect(page.locator('#levelBriefing strong')).toHaveText(['NO REPEAT']);
 await page.evaluate(()=>{level.round=2;level.mission={blocks:['move','repeat'],repeatRequired:true,blockLimit:8};briefing.sync(level,true,true,false);briefing.sync(level,true,true,false);});
 await expect(page.locator('#levelBriefing strong')).toHaveText(['USE REPEAT','MAXIMUM 8 BLOCKS']);
 expect(await page.evaluate(()=>spoken.length)).toBe(2);
 await page.evaluate(()=>{level.round=3;level.mission.repeatRequired=false;delete level.mission.blockLimit;level.challenge={kind:'simplify',supported:true};briefing.sync(level,false,true,false);});
 await expect(page.locator('#levelBriefing strong')).toHaveText(['REPEAT OPTIONAL','REPEAT EARNS A BONUS']);
 expect(await page.evaluate(()=>spoken.length)).toBe(2);
});
test('teacher level briefing plays an audio recording',async({page})=>{
 await page.route('**/codequest/level-audio?*',route=>route.fulfill({path:require('node:path').join(__dirname,'../../public/assets/game-narration/action-build.mp3'),contentType:'audio/mpeg'}));
 await page.goto('/healthz?game=voice-test');await page.setContent('<main></main>');
 await page.addScriptTag({url:'/codequest-briefing.js'});
 await page.evaluate(()=>{
  window.briefing=new CodeQuestBriefing();
  briefing.sync({id:'voice-test',round:1,phase:'countdown',mission:{blocks:['move']}},true,false,false);
 });
 await page.getByRole('button',{name:'Read level rules aloud'}).click();
 await expect.poll(()=>page.evaluate(()=>briefing.audio?.currentTime||0)).toBeGreaterThan(.1);
 await expect(page.getByRole('button',{name:'Read level rules again'})).toBeVisible();
});
