const {test,expect}=require('@playwright/test');
test('opening passages follow audio time, pause and seek; cues respect mute and never overlap',async({page})=>{
 await page.goto('/healthz');await page.setContent('<button id="voice">Voice</button><p id="story" style="height:300px"></p>');
 await page.addStyleTag({url:'/colony-voices.css'});
 for(const src of ['/opening-narration.js','/colony-voice-data.js','/colony-voices.js'])await page.addScriptTag({url:src});
 await page.evaluate(()=>{window.readerVoice=new OpeningNarration(document.querySelector('#voice'));window.reader=new ColonyStoryText(readerVoice);readerVoice.sync('/assets/game-narration/colony-board.mp3','test',0,true);reader.attach(document.querySelector('#story'),'colony-board');});
 await expect(page.locator('.spoken-passage.is-speaking')).toHaveCount(1);
 await page.waitForFunction(()=>readerVoice.media.readyState>=1);
 await page.evaluate(()=>{readerVoice.media.currentTime=ColonyVoiceTimings['colony-board'][4].start+.2;reader.update();});
 await expect(page.locator('.spoken-passage').nth(4)).toHaveClass(/is-speaking/);
 const transform=await page.locator('.spoken-track').getAttribute('style');await page.waitForTimeout(400);expect(await page.locator('.spoken-track').getAttribute('style')).toBe(transform);
 await page.evaluate(()=>{window.allowCue=false;window.cue=new ColonyActionVoice(()=>allowCue);cue.play('raid');});await expect(page.locator('.colony-voice-caption')).toHaveCount(0);
 await page.evaluate(()=>{allowCue=true;cue.play('raid');cue.play('spider');});await expect(page.locator('.colony-voice-caption')).toHaveText('RAIDING!');
 await page.evaluate(()=>cue.stop());await expect(page.locator('.colony-voice-caption')).toHaveCount(0);
 await page.screenshot({path:'/tmp/colony-reading-highlight.png'});
});
