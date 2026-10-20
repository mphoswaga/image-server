const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('recorded opening decodes, pauses, resumes, and stops before gameplay',async({page})=>{
 await signInDisposableTeacher(page,'-voice');
 await page.setContent('<button id="voice">Opening voice</button><button id="start">Start</button>');
 await page.addScriptTag({url:'/opening-narration-data.js'});await page.addScriptTag({url:'/opening-narration.js'});
 await page.evaluate(()=>{window.testVoice=new OpeningNarration(document.getElementById('voice'));document.getElementById('start').onclick=()=>testVoice.sync(OpeningNarrationData.clips['moon-0'].src,'intro',0);});
 await page.locator('#start').click();
 await expect.poll(()=>page.evaluate(()=>testVoice.media.currentTime)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>testVoice.media.duration)).toBeGreaterThan(3);
 await page.locator('#voice').click();await expect.poll(()=>page.evaluate(()=>testVoice.media.paused)).toBe(true);
 await page.locator('#voice').click();await expect.poll(()=>page.evaluate(()=>testVoice.media.paused)).toBe(false);
 await page.evaluate(()=>testVoice.stop());expect(await page.evaluate(()=>testVoice.media.paused)).toBe(true);
 await page.locator('#start').click();await expect.poll(()=>page.evaluate(()=>testVoice.media.paused)).toBe(false);
 await page.evaluate(()=>{testVoice.paused=true;testVoice.update();});expect(await page.evaluate(()=>testVoice.media.paused)).toBe(true);
});
