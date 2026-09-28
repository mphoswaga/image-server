const {test,expect}=require('@playwright/test');
async function open(page){
 await page.clock.install();
 await page.route('**/api/game/adventure/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:adventure',classes:[{id:'r',name:'Reef class'}],attendance:Array.from({length:12},(_,i)=>({name:'Explorer '+(i+1),studentId:String(i),rosterId:'r'})),game:{questions:[{question:'Which device shows information?',options:['Monitor','Keyboard'],correctIndex:0}]}}}));
 await page.goto('/fishquest-board.html?game=adventure');await page.locator('#start').click();
}
test('turtle guide, four marine encounters, supplies and awards complete without lost learners',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
 await expect(page.locator('#storyTitle')).toHaveText('The reef is fading…');await expect(page.locator('#ambient .turtle-art')).toBeVisible();
 await page.clock.fastForward(13000);await page.screenshot({path:info.outputPath('turtle-introduction.png'),fullPage:true});await page.locator('#storyContinue').click();
 const seen=new Set();let steps=0,reloaded=false;
 while(await page.locator('#ocean').getAttribute('data-phase')!=='ended'&&steps++<90){
  const phase=await page.locator('#ocean').getAttribute('data-phase');
  if(phase==='question')await page.locator('[data-answer="0"]').click();
  else if(phase==='reveal')await page.locator('#next').click();
  else if(phase==='supply_choice'){await expect(page.locator('[data-supply="energy"]')).toBeVisible();await page.locator('[data-supply="energy"]').click()}
  else if(phase==='event_warning'){
   const kind=(await page.locator('#danger').getAttribute('class')).split(' ')[0];seen.add(kind);
   await page.evaluate(()=>{for(const a of document.getAnimations())if(a.effect?.target?.closest('#danger'))a.currentTime=3000});
   await page.screenshot({path:info.outputPath(kind+'-warning.png'),fullPage:true});await page.clock.fastForward(8600);
  }else if(phase==='event_choice'){
   const kind=(await page.locator('#danger').getAttribute('class')).split(' ')[0];
   await page.locator('[data-choice="'+({current:'rocks',shark:'escape',rescue:'helpers',net:'sprint'}[kind])+'"]').click();
  }else if(phase==='event_result'){
   if(!reloaded){const before=await page.locator('#scores').textContent();await page.reload();await page.locator('#restore').click();await expect(page.locator('#scores')).toHaveText(before);await page.locator('#pause').click();reloaded=true}
   await page.clock.fastForward(5600);
  }else if(phase==='swim_break')await page.clock.fastForward(7100);
 }
 expect([...seen]).toEqual(['current','shark','rescue','net']);await expect(page.locator('#storyTitle')).toHaveText('Welcome to the living reef!');
 await expect(page.locator('.reef-award')).toHaveCount(2);await expect(page.locator('#storyChoices')).toContainText('Reef Guardians');await expect(page.locator('.swimmer')).toHaveCount(12);
 await page.clock.runFor(4500);await page.screenshot({path:info.outputPath('living-reef-finale.png'),fullPage:true});expect(errors).toEqual([]);
});
test('intro starts automatically and warning clock survives pause and reload',async({page})=>{
 await open(page);await page.clock.fastForward(20100);await expect(page.locator('#ocean')).toHaveAttribute('data-phase','question');
 for(let i=0;i<3;i++){await page.locator('[data-answer="0"]').click();await page.locator('#next').click()}
 await page.clock.fastForward(3000);await page.locator('#pause').click();await page.clock.fastForward(30000);
 await page.reload();await page.locator('#restore').click();await expect(page.locator('#ocean')).toHaveAttribute('data-phase','event_warning');
 await page.locator('#pause').click();await page.clock.fastForward(5600);await expect(page.locator('#ocean')).toHaveAttribute('data-phase','event_choice');
});
