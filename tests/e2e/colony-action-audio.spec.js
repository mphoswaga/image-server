const {test,expect}=require('@playwright/test');
test('student tap unlocks real build and raid recordings for delayed server updates',async({browserName,playwright,baseURL})=>{
 test.skip(browserName!=='chromium','Chromium autoplay regression');
 const browser=await playwright.chromium.launch({args:['--autoplay-policy=user-gesture-required']});
 try {
  const page=await browser.newPage();
  await page.goto(baseURL+'/healthz');
  // Use the configured test server origin, without a game or learner records.
  await page.setContent('<button id="enable">Start</button>');
  await page.addScriptTag({url:'/colony-voices.js'});
  await page.evaluate(()=>{
   window.voice=new ColonyActionVoice(()=>true,()=>{},()=>.6);
   document.querySelector('#enable').onclick=()=>voice.unlock();
  });
  await page.locator('#enable').click();
  await expect.poll(()=>page.evaluate(()=>voice.unlocked)).toBe(true);
  for(const key of ['build','raid']){
   await page.evaluate(key=>{voice.last=0;voice.play(key);},key);
   await expect.poll(()=>page.evaluate(()=>voice.audio.currentTime)).toBeGreaterThan(.1);
   expect(await page.evaluate(()=>voice.audio.paused)).toBe(false);
   await page.evaluate(()=>voice.stop());
  }
 } finally {await browser.close();}
});
