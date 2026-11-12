const {test,expect}=require('@playwright/test');
test('rapid steering paints before network responses and drop waits for latest movement',async({page})=>{
 await page.goto('/healthz');await page.setContent('<div id="boards"><section class="tower active"><div class="grid" style="width:320px;height:400px"></div></section></div>');
 await page.addScriptTag({path:'public/blockquest-core.js'});await page.addScriptTag({path:'public/blockquest-input.js'});
 await page.evaluate(()=>{window.run={id:'one',turn:0,answers:[],phase:'choose',choices:['O'],teams:[{board:BlockQuest.empty()}],falling:{shape:'O',rotation:0,column:2,y:0}};window.sent=[];window.paints=[];window.release=null;window.input=new BlockQuestInput(()=>run,async(action,extra)=>{sent.push({action,...extra});if(action==='move')await new Promise(r=>release=r);},()=>paints.push(run.falling.column));input.bind(document.querySelector('#boards'));input.move({column:3});});
 await expect.poll(()=>page.evaluate(()=>sent.length)).toBe(1);
 await page.evaluate(()=>{input.move({column:4});input.move({column:5});window.dropped=input.place();});
 expect(await page.evaluate(()=>paints)).toEqual([3,4,5]);
 expect(await page.evaluate(()=>sent.length)).toBe(1);
 await page.evaluate(()=>release());
 await expect.poll(()=>page.evaluate(()=>sent.length)).toBe(2);
 expect(await page.evaluate(()=>sent[1].column)).toBe(5);
 await page.evaluate(()=>release());await page.evaluate(()=>dropped);
 expect(await page.evaluate(()=>sent.map(s=>s.action))).toEqual(['move','move','place']);
});
test('dragging the tower drops on release',async({page})=>{
 await page.goto('/healthz');await page.setContent('<div id="boards"><section class="tower active"><div class="grid" style="width:320px;height:400px"></div></section></div>');await page.addScriptTag({path:'public/blockquest-core.js'});await page.addScriptTag({path:'public/blockquest-input.js'});
 await page.evaluate(()=>{window.sent=[];const run={id:'drag',turn:0,phase:'choose',choices:['O'],teams:[{board:BlockQuest.empty()}],falling:{shape:'O',rotation:0,column:2,y:0}};new BlockQuestInput(()=>run,async(action,extra)=>sent.push({action,...extra}),()=>{}).bind(document.querySelector('#boards'));});
 const box=await page.locator('.grid').boundingBox();await page.mouse.move(box.x+100,box.y+50);await page.mouse.down();await page.mouse.move(box.x+200,box.y+90,{steps:5});await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>sent.some(s=>s.action==='place'))).toBe(true);
});
