const {test,expect}=require('@playwright/test');
async function open(page,learners=25){
 await page.route('**/api/game/ocean/fishquest/smartboard',r=>r.fulfill({json:{storageKey:'owner:ocean',classes:[{id:'r',name:'Class ocean'}],attendance:Array.from({length:learners},(_,i)=>({rosterId:'r',studentId:String(i),name:'Nguyễn Learner '+(i+1)})),game:{questions:[{question:'What do output devices do?',options:['Store information','Send information to the user','Make food','Receive input'],correctIndex:1,explanation:'Output devices send information to the user.'}]}}}));
 await page.goto('/fishquest-board.html?game=ocean');await page.locator('#storyEnabled').uncheck();
}
test('fish travel while names stay upright, pause holds position, and food reaches the crew',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await open(page);await page.locator('#start').click();await page.waitForTimeout(1200);
 const fish=page.locator('.swimmer').nth(3);
 const positions=()=>page.locator('.swimmer:not(.active)').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y}}));
 const before=await positions();
 await page.waitForTimeout(3000);const after=await positions();
 const distances=after.map((p,i)=>Math.hypot(p.x-before[i].x,p.y-before[i].y));
 expect(distances.filter(d=>d>4).length).toBeGreaterThan(12);expect(Math.max(...distances)).toBeGreaterThan(15);
 await expect(fish.locator(':scope > span:last-child')).toHaveCSS('transform','none');
 await page.locator('#pause').click();await page.waitForTimeout(150);const frozen=await fish.boundingBox();
 await page.waitForTimeout(600);const still=await fish.boundingBox();expect(still.x).toBeCloseTo(frozen.x,1);expect(still.y).toBeCloseTo(frozen.y,1);
 await page.locator('#pause').click();await page.locator('[data-answer="1"]').click();
 await expect(page.locator('.pellet.meal').first()).toBeVisible();await expect(page.locator('.swimmer.feeding').first()).toBeAttached();
 await page.waitForTimeout(1700);await page.screenshot({path:info.outputPath('living-ocean.png'),fullPage:true});
 const bounds=await page.locator('.swimmer:not(.active)').evaluateAll(nodes=>nodes.map(node=>{const a=node.getBoundingClientRect(),b=node.closest('.reef').getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1}));
 expect(bounds.every(Boolean)).toBe(true);expect(errors).toEqual([]);
});
test('countdown survives pause and refresh, then timeout reveals and advances automatically',async({page})=>{
 await page.clock.install();await open(page,2);await page.locator('#questionSeconds').selectOption('20');await page.locator('#start').click();
 await expect(page.locator('#boardBuild')).toHaveAttribute('data-build',/^[a-f0-9]{12}$/);
 await expect(page.locator('#countdown')).toHaveCSS('border-top-width','2px');
 await expect(page.locator('#seconds')).toHaveText('20');await page.clock.fastForward(7000);
 await page.locator('#pause').click();await expect(page.locator('#seconds')).toHaveText('13');
 await page.clock.fastForward(40000);await expect(page.locator('#seconds')).toHaveText('13');
 await page.reload();await page.locator('#restore').click();await expect(page.locator('#seconds')).toHaveText('13');
 await page.locator('#pause').click();await page.clock.fastForward(13000);await expect(page.locator('#feedback')).toContainText('Time’s up');
 await expect(page.locator('#options .correct')).toContainText('Send information');
 await expect(page.locator('[data-answer="1"]')).toBeDisabled();
 await page.clock.fastForward(6600);await expect(page.locator('#turn')).toContainText('Turn 2 of 2');await expect(page.locator('#seconds')).toHaveText('20');
 const answers=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('fishboard:owner:ocean')).answers);expect(answers).toHaveLength(1);expect(answers[0].timedOut).toBe(true);
});
test('swimmers glide frame by frame and retain positions when an answer redraws the board',async({page})=>{
 await open(page);await page.locator('#start').click();await page.waitForTimeout(800);
 const movement=await page.evaluate(()=>new Promise(resolve=>{
  const nodes=[...document.querySelectorAll('.swimmer:not(.active)')];let previous,largest=0,frames=0;
  function sample(){
   const points=nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y}});
   if(previous)points.forEach((p,i)=>{largest=Math.max(largest,Math.hypot(p.x-previous[i].x,p.y-previous[i].y))});
   previous=points;if(++frames===90)resolve({largest,frames});else requestAnimationFrame(sample);
  }requestAnimationFrame(sample);
 }));
 expect(movement.largest).toBeLessThan(2);expect(movement.largest).toBeGreaterThan(.01);
 const location=()=>page.locator('.swimmer').nth(3).evaluate(n=>{const m=new DOMMatrixReadOnly(n.style.transform);return {x:m.m41,y:m.m42}});
 const before=await location();await page.locator('[data-answer="1"]').click();const after=await location();
 expect(Math.hypot(after.x-before.x,after.y-before.y)).toBeLessThan(8);
});
