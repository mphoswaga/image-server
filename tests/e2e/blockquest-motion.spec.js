const {test,expect}=require('@playwright/test');
async function setup(page){
 await page.goto('/healthz');await page.addScriptTag({url:'/blockquest-core.js'});await page.addScriptTag({url:'/blockquest-motion.js'});await page.addStyleTag({url:'/blockquest.css'});await page.addStyleTag({url:'/blockquest-world.css'});
 await page.evaluate(()=>{document.body.innerHTML='<div id="boards"></div>';const html='<section class="tower active"><div class="grid" style="width:240px;height:400px"></div></section><section class="tower"><div class="grid"></div></section>';
  window.motionTest=new BlockQuestMotion(document.querySelector('#boards'),()=>Date.now());motionTest.boards(html,['own','foe']);window.ownGrid=document.querySelector('.tower.active .grid');window.boardHTML=html;
  const now=Date.now();window.run={id:'motion',turn:0,phase:'choose',answers:[{}],deadline:now+15000,falling:{shape:'O',rotation:0,column:2,y:0,lastStepAt:now},teams:[{board:BlockQuest.empty()}]};motionTest.sync(run);window.firstPiece=document.querySelector('.moving-block');
 });
}
test('earned pieces glide between rows, keep their nodes on polls and freeze on pause',async({page})=>{
 await setup(page);await page.waitForTimeout(400);const position=await page.evaluate(()=>({y:motionTest.y,dy:motionTest.dy}));expect(position.y).toBeGreaterThan(.08);expect(position.y).toBeLessThan(1);
 await page.evaluate(()=>{motionTest.boards(boardHTML,['own','foe-updated']);motionTest.sync(run);});expect(await page.evaluate(()=>ownGrid===document.querySelector('.tower.active .grid')&&firstPiece===document.querySelector('.moving-block'))).toBe(true);
 await page.evaluate(()=>{run.falling.column=4;motionTest.sync(run);});await page.waitForTimeout(40);const x=await page.evaluate(()=>motionTest.x);expect(x).toBeGreaterThan(2);expect(x).toBeLessThan(4);
 await page.evaluate(()=>{run.phase='paused';run.beforePause='choose';run.pausedAt=Date.now();motionTest.sync(run);});const paused=await page.evaluate(()=>motionTest.y);await page.waitForTimeout(150);expect(await page.evaluate(()=>motionTest.y)).toBe(paused);
 await page.evaluate(()=>{run.phase='answer';motionTest.sync(run);});await expect(page.locator('.moving-block')).toHaveCount(0);
});
test('piece interpolation stops at occupied rows and gentle mode keeps discrete positions',async({page})=>{
 await setup(page);await page.evaluate(()=>{run.teams[0].board[2][2]='T';run.falling.lastStepAt-=7000;motionTest.sync(run);});await page.waitForTimeout(150);expect(await page.evaluate(()=>motionTest.target())).toBe(0);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{run.teams[0].board=BlockQuest.empty();run.falling.lastStepAt=Date.now()-750;motionTest.sync(run);});expect(await page.evaluate(()=>motionTest.y)).toBe(0);
});
