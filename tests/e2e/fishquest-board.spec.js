const {test,expect}=require('@playwright/test');
test('class board celebrates, locks answers, pauses, resumes after reload and finishes fairly',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await page.route('**/api/game/board/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:board',classes:[{id:'r1',name:'Class One'}],attendance:[{rosterId:'r1',studentId:'a',name:'Alex'},{rosterId:'r1',studentId:'b',name:'Bao'}],game:{questions:[{question:'Where do fish live?',options:['Water','Trees'],correctIndex:0,explanation:'Fish live in water.'}]}}}));
 await page.goto('/fishquest-board.html?game=board');await page.locator('[data-team="0"]').fill('Ocean Explorers');await page.locator('#start').click();
 await expect(page.locator('#turn')).toContainText('Alex');await expect(page.locator('#hero')).toContainText('Alex');await page.locator('[data-answer="0"]').click();
 await expect(page.locator('#hero')).toBeVisible();await expect(page.locator('#scores')).toContainText('5');
 await expect(page.locator('[data-answer="1"]')).toBeDisabled();
 await page.locator('#pause').click();await page.clock.fastForward(10000);await expect(page.locator('#turn')).toContainText('Alex');
 await page.reload();await page.locator('#restore').click();await expect(page.locator('#pause')).toHaveText('Resume');await expect(page.locator('#scores')).toContainText('Ocean Explorers');
 await page.locator('#pause').click();await page.clock.fastForward(6600);await expect(page.locator('#turn')).toContainText('Bao');
 await page.locator('[data-answer="1"]').click();await expect(page.locator('#feedback')).toContainText('Let’s learn together');
 await expect(page.locator('#hero')).toBeVisible();await expect(page.locator('#hero')).not.toHaveClass(/celebrating/);await page.clock.fastForward(6600);
 await expect(page.locator('#turn')).toContainText('Everyone had a turn');expect(errors).toEqual([]);
});
test('full class stays visible and class selection excludes other rosters',async({page},info)=>{
 const roster=Array.from({length:30},(_,i)=>({rosterId:'r1',studentId:String(i),name:'Learner '+(i+1)}));
 await page.route('**/api/game/board/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:board',classes:[{id:'r1',name:'Class One'},{id:'r2',name:'Class Two'}],attendance:[...roster,{rosterId:'r2',studentId:'other',name:'Other class learner'}],game:{questions:[{question:'Which part of our body receives sound?',options:['Eyes','Ears','Hands','Nose'],correctIndex:1}]}}}));
 await page.goto('/fishquest-board.html?game=board');await page.locator('#teams').selectOption('3');await page.locator('#start').click();
 await expect(page.locator('.swimmer')).toHaveCount(30);expect(await page.locator('.swimmer .fish-growth').evaluateAll(els=>new Set(els.map(e=>e.dataset.variant)).size)).toBe(30);await expect(page.locator('#hero .fish-growth')).toHaveAttribute('data-stage','minnow');await expect(page.locator('#fish')).not.toContainText('Other class learner');
 await expect.poll(()=>page.locator('#hero .fish-body').evaluate(img=>img.complete&&img.naturalWidth===160)).toBe(true);
 await page.waitForTimeout(1100);
 await page.screenshot({path:info.outputPath('class-ocean.png'),fullPage:true});
 await page.locator('[data-answer="1"]').click();await expect(page.locator('#hero')).toHaveClass(/celebrating/);await expect(page.locator('#hero .fish-growth')).toHaveAttribute('data-stage','reef');await expect(page.locator('#hero .fish-growth')).toHaveAttribute('data-mass','190');await page.waitForTimeout(1100);await page.screenshot({path:info.outputPath('feeding.png'),fullPage:true});
 if(info.project.name==='windows-100'){
 const bottom=await page.locator('#restart').evaluate(el=>el.getBoundingClientRect().bottom);
 expect(bottom).toBeLessThanOrEqual(768);
 }
});

test('four rounds evolve fish to whales and expressions fit each evolution',async({page},info)=>{
 await page.clock.install();
 const roster=Array.from({length:4},(_,i)=>({rosterId:'r1',studentId:String(i),name:'Learner '+(i+1)}));
 await page.route('**/api/game/board/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:board',classes:[{id:'r1',name:'Class One'}],attendance:roster,game:{questions:[{question:'Where do fish live?',options:['Water','Trees'],correctIndex:0}]}}}));
 await page.goto('/fishquest-board.html?game=board');await page.locator('#rounds').selectOption('4');await page.locator('#start').click();
 for(let i=0;i<16;i++){await page.locator('[data-answer="0"]').click();await page.locator('#next').click();}
 await expect(page.locator('.swimmer [data-stage="whale"]')).toHaveCount(4);
 await expect(page.locator('#turn')).toContainText('Everyone had a turn');
 const distinct=await page.evaluate(()=>['minnow','reef','hunter','shark','orca','whale'].every(stage=>[0,1,2].every(v=>FishQuestArt.data(v,'body',stage,'happy')!==FishQuestArt.data(v,'body',stage,'neutral'))));
 expect(distinct).toBe(true);
 // Inspect the actual canvas expressions at all stages, not a separate mock graphic.
 await page.evaluate(()=>{
  document.body.className='';document.body.innerHTML='<div id="artcheck" style="display:grid;grid-template-columns:repeat(6,1fr);background:#d8f6ef;padding:20px;gap:10px;color:#123"></div>';
  for(const variant of [0,1,2])for(const stage of ['minnow','reef','hunter','shark','orca','whale']){
   const cell=document.createElement('div');cell.textContent=stage+' / '+variant;const img=document.createElement('img');img.src=FishQuestArt.data(variant,'body',stage,'happy');img.style.width='100%';cell.append(img);document.getElementById('artcheck').append(cell);
  }
 });
 await page.screenshot({path:info.outputPath('smile-stages.png'),fullPage:true});
});
