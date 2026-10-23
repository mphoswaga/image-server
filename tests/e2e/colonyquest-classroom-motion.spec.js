const {test,expect}=require('@playwright/test');
const core=require('../../public/colonyquest-core');
async function open(page,extra={}) {
 const teams=[core.createTeam({name:'Oak',members:[{id:'a',name:'Amina'}]},0),core.createTeam({name:'Leaf',members:[{id:'b',name:'Bao'}]},1)];
 teams.forEach(t=>{t.sticks=30;t.leaves=30;});
 let saved=core.normalizeSession({phase:'reward',introSeen:true,teams,...extra});
 await page.route(/\/api\/game\/classroom-motion\/colonyquest(?:\/session)?$/,async route=>{
  if(route.request().method()==='PUT'){saved=route.request().postDataJSON().session;return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{game:{id:'classroom-motion',lessonTitle:'Habitat',questions:[{question:'Where?',options:['Nest','Cup'],correctIndex:0}],colonyquest:{teamCount:2,rounds:10,sound:false,teams}},session:saved}});
 });
 await page.goto('/colonyquest/classroom-motion');
 await page.evaluate(()=>{const Game=Phaser.Game;Phaser.Game=function(config){window.motionGame=new Game(config);return window.motionGame;};});
 await page.locator('#resumeBtn').click();
 await expect(page.locator('#gameScreen')).not.toHaveAttribute('inert','');
}
test('visible answer countdown expires once and pauses with the teacher',async({page})=>{
  await open(page,{phase:'question'});
  await expect(page.locator('#answerCountdown')).toBeVisible();
  await expect(page.locator('#answerCountdown')).toHaveText(/(?:10|9)s/);
  await page.locator('#pauseBtn').click();
  const paused=await page.locator('#answerCountdown').textContent();
  await page.waitForTimeout(1200);
  await expect(page.locator('#answerCountdown')).toHaveText(paused);
  await page.locator('#pauseBtn').click();
  const saved=page.waitForRequest(request=>request.method()==='PUT'&&request.url().includes('/session')&&request.postDataJSON()?.session?.answers?.some(a=>a.choice===null&&a.correct===false));
  await saved;
});

test('spider swarm shows food being stolen at the pantry',async({page},info)=>{
  const beforeTeams=[core.createTeam({name:'Oak'},0),core.createTeam({name:'Leaf'},1)];
  await open(page,{phase:'event',events:[{key:'predator',automatic:true,beforeTeams,effects:[{teamId:'team-1',foodDelta:-4,roomsDelta:0}]}]});
  await expect.poll(()=>page.evaluate(()=>window.motionGame.scene.scenes[0].children.list.some(item=>item.text==='−4 food'))).toBe(true);
  await page.screenshot({path:info.outputPath('spider-food-theft.png')});
});

for(const motion of ['reduce','no-preference']) {
 test(`smartboard winners keep dancing over time (${motion})`,async({page},info)=>{
  await page.emulateMedia({reducedMotion:motion});await open(page);
  page.on('dialog',d=>d.accept());await page.locator('#endGameBtn').click();
  await expect(page.locator('#cqCelebration')).toBeVisible({timeout:20000});
  const ant=page.locator('.cq-winners img').first();
  const result=await ant.evaluate(async img=>{
   const style=getComputedStyle(img), poses=new Set();
   for(let i=0;i<8;i++){poses.add(getComputedStyle(img).transform);await new Promise(r=>setTimeout(r,130));}
   return {duration:parseFloat(style.animationDuration),iterations:style.animationIterationCount,poses:poses.size};
  });
  expect(result.duration).toBeGreaterThan(1);expect(result.iterations).toBe('infinite');expect(result.poses).toBeGreaterThan(3);
  await expect(page.locator('.cq-winners')).toContainText('Amina');
  if(motion==='reduce') {await page.getByRole('button',{name:'Full dance',exact:true}).click();expect(await ant.evaluate(el=>getComputedStyle(el).animationName)).toBe('cq-dance');}
  await page.screenshot({path:info.outputPath(`dance-${motion}.png`)});
 });
 test(`rain falls and water flows with ${motion}`,async({page},info)=>{
  await page.emulateMedia({reducedMotion:motion});
  await open(page,{phase:'question',seasonRules:true,rainOccurred:true,birdStage:'rain',birdStageMs:15000});
  const movement=await page.evaluate(async()=>{
   const scene=window.motionGame.scene.scenes[0];
   const drops=scene.children.list.filter(o=>o.getData('rainDrop'));
   const foam=scene.children.list.find(o=>o.type==='Ellipse'&&o.depth===19&&o.width===5);
   const ys=new Set(),flows=new Set();
   for(let i=0;i<12;i++){ys.add(drops[0]?.y);flows.add(foam?.y);await new Promise(r=>setTimeout(r,65));}
   return {drops:drops.length,fall:ys.size,flow:flows.size};
  });
  expect(movement.drops).toBeGreaterThan(10);expect(movement.fall).toBeGreaterThan(4);expect(movement.flow).toBeGreaterThan(4);
  await page.screenshot({path:info.outputPath(`rain-${motion}.png`)});
 });
 for(const kind of ['expansion','defense'])test(`${kind} builds in stages with one fixed team camera (${motion})`,async({page},info)=>{
  await page.emulateMedia({reducedMotion:motion});await open(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator(`[data-reward="${kind}"]`).click();
  await expect(page.locator('#worldViewport')).toHaveAttribute('data-build-stage','materials');
  await expect(page.locator('#worldViewport')).toHaveAttribute('data-build-team','team-1');
  await page.waitForTimeout(1800);
  await expect(page.locator('#worldViewport')).toHaveAttribute('data-build-stage','building');
  const inspect=()=>page.evaluate(()=>{
   const scene=window.motionGame.scene.scenes[0],camera=scene.cameras.main;
   return {x:camera.scrollX,y:camera.scrollY,zoom:camera.zoom,crew:scene.children.list.filter(o=>o.getData('builderTeam')==='team-1').map(o=>[o.x,o.y,o.angle])};
  });
  const before=await inspect();expect(before.crew).toHaveLength(3);expect(before.zoom).toBeGreaterThan(1.2);
  await page.waitForTimeout(1200);const after=await inspect();
  expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);expect(after.crew).not.toEqual(before.crew);
  await page.screenshot({path:info.outputPath(`${kind}-${motion}.png`)});
  await expect(page.locator('#worldViewport')).toHaveAttribute('data-build-stage','ready');
  await expect(page.locator('#questionOverlay')).toBeHidden();
  await expect(page.locator('#questionOverlay')).toBeVisible({timeout:15000});expect(errors).toEqual([]);
 });
}
