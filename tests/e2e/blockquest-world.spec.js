const {test,expect}=require('@playwright/test');
const core=require('../../public/blockquest-core');
async function world(page){
 await page.goto('/healthz');await page.addScriptTag({url:'/blockquest-world.js'});
 await page.evaluate(()=>{document.body.innerHTML='<header><nav></nav></header><main><section id="arena"><div class="tower active"><div class="grid" style="position:absolute;left:50px;top:200px;width:200px;height:400px"></div></div><section class="panel dock" style="position:absolute;left:300px;top:350px;width:350px;height:200px">Readable question</section></section></main>';window.testWorld=new BlockQuestWorld({pulseLevel:.5});});
}
test('shared scenery reacts to progression, freezes when paused and honours gentle effects',async({page})=>{
 await world(page);await expect(page.locator('#blockquest-world')).toHaveAttribute('data-motion','animated');
 await page.evaluate(()=>testWorld.sync({id:'sample',phase:'answer',teams:[{lines:3}]}));await expect(page.locator('body')).toHaveAttribute('data-world','Ember city');
 await page.locator('.world-controls summary').click();await page.getByLabel('Scenery world').selectOption('2');await expect(page.locator('body')).toHaveAttribute('data-world','Stardust');
 await page.evaluate(()=>testWorld.sync({id:'sample',phase:'answer',teams:[{lines:0}]}));await expect(page.locator('body')).toHaveAttribute('data-world','Stardust');
 await expect.poll(()=>page.evaluate(()=>testWorld.time)).toBeGreaterThan(.05);
 await page.evaluate(()=>testWorld.sync({id:'sample',phase:'paused',teams:[]}));const paused=await page.evaluate(()=>testWorld.time);await page.waitForTimeout(160);expect(await page.evaluate(()=>testWorld.time)).toBe(paused);await expect(page.locator('#blockquest-world')).toHaveAttribute('data-motion','still');
 await page.evaluate(()=>testWorld.sync({id:'sample',phase:'answer',teams:[]}));await expect.poll(()=>page.evaluate(()=>testWorld.time)).toBeGreaterThan(paused);
 await page.getByRole('button',{name:'Gentle effects'}).click();await expect(page.locator('#blockquest-world')).toHaveAttribute('data-motion','still');expect(await page.evaluate(()=>testWorld.events.length)).toBe(0);
 await page.getByRole('button',{name:'Gentle effects'}).click();await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#blockquest-world')).toHaveAttribute('data-motion','still');
});
test('row impacts originate at the active tower, never repeat on polling and avoid the reading area',async({page})=>{
 await world(page);const now=Date.now(),state={id:'impact',phase:'placing',turn:0,placementStartedAt:now,serverNow:now,teams:[{lines:2}],lastDrop:{y:8},lastPlacement:[8,9]};
 await page.evaluate(s=>{testWorld.sync(s);testWorld.sync(s);},state);
 const events=await page.evaluate(()=>testWorld.events);expect(events).toHaveLength(2);expect(events[0].x).toBe(150);expect(events[0].y).toBe(540);
 await page.waitForTimeout(850);
 const pixels=await page.evaluate(()=>{const w=testWorld,c=w.ink,d=w.dpr;return {dock:[...c.getImageData(310*d,360*d,250*d,100*d).data].some((v,i)=>i%4===3&&v>0),all:[...c.getImageData(0,0,w.fx.width,w.fx.height).data].some((v,i)=>i%4===3&&v>0)};});expect(pixels.dock).toBe(false);expect(pixels.all).toBe(true);
 await page.evaluate(()=>testWorld.sync({id:'impact',phase:'ended',teams:[]}));expect(await page.evaluate(()=>testWorld.events.filter(e=>e.kind==='win').length)).toBe(1);
});
test('immersive smartboard worlds preserve readable questions and clear animations',async({page},info)=>{
 const board=core.empty();for(const y of [8,9])board[y]=['T','S','Z','L','J','I',null,null];board[7][0]='S';board[6][0]='O';board[7][1]='O';
 const result=core.place(board,'O',0,6),start=Date.now();const state={id:'visual',mode:'board',phase:'placing',revision:3,turn:0,total:4,active:0,learner:'Mia',answers:[{correct:true}],lastBefore:board,lastDrop:{...core.landing(board,'O',0,6),shape:'O'},lastPlacement:[8,9],lastLinesBefore:0,lastAward:{points:result.points,bonus:result.bonus},placementStartedAt:start,readyAt:start+20000,serverNow:start,teams:[{name:'Sun Builders',board:result.board,points:260,lines:2,names:['Mia']},{name:'Moon Builders',board:board,points:100,lines:1,names:['Noah']}]};
 await page.route('**/api/game/visual/blockquest',r=>r.fulfill({json:{teacher:true,board:true,title:'World preview',state:{...state,serverNow:Date.now()}}}));await page.route('**/blockquest/voice?*',r=>r.abort());
 await page.goto('/blockquest.html?game=visual');await page.locator('#resume').click();await expect(page.locator('#blockquest-world')).toBeVisible();await page.waitForTimeout(850);await page.screenshot({path:info.outputPath('immersive-clear.png'),fullPage:true});
 await page.locator('.world-controls summary').click();await page.getByLabel('Scenery world').selectOption('1');await page.locator('.world-controls summary').click();await page.waitForTimeout(2600);await page.screenshot({path:info.outputPath('ember-city.png'),fullPage:true});
 await page.locator('.world-controls summary').click();await page.getByLabel('Scenery world').selectOption('2');await page.locator('.world-controls summary').click();await page.waitForTimeout(2600);await page.screenshot({path:info.outputPath('stardust.png'),fullPage:true});
});

test('routine game snapshots preserve the scenery clock and adaptive quality',async({page})=>{
 await world(page);await expect.poll(()=>page.evaluate(()=>testWorld.time)).toBeGreaterThan(.05);
 const result=await page.evaluate(()=>{testWorld.fps=30;testWorld.budget=50;const before=testWorld.last;testWorld.sync({id:'same',phase:'answer',teams:[{lines:0}]});return {before,after:testWorld.last,fps:testWorld.fps,budget:testWorld.budget};});
 expect(result.after).toBe(result.before);expect(result.fps).toBe(30);expect(result.budget).toBe(50);
});

test('resuming a placement does not duplicate its impact burst',async({page})=>{
 await world(page);const result=await page.evaluate(()=>{const start=Date.now(),run={id:'resume',turn:0,answers:[{}],phase:'placing',teams:[{lines:0}],lastDrop:{y:8},lastPlacement:[],placementStartedAt:start,serverNow:start};testWorld.sync(run);const born=testWorld.events[0].born;testWorld.sync({...run,phase:'paused'});testWorld.sync({...run,placementStartedAt:start+3000,serverNow:start+3200});return {count:testWorld.events.length,born,after:testWorld.events[0].born,delay:born-testWorld.time};});expect(result.count).toBe(1);expect(result.after).toBe(result.born);expect(result.delay).toBeCloseTo(.6,1);
});

test('restoring a paused attack never plays a battle sound',async({page})=>{
 await world(page);const count=await page.evaluate(()=>{const calls=[];testWorld.audio.cue=kind=>calls.push(kind);testWorld.sync({id:'silent-pause',phase:'paused',beforePause:'choose',teams:[],defenseEvent:{id:'shield-restore',kind:'shield',at:Date.now(),rows:1}});return calls.length;});expect(count).toBe(0);
});
