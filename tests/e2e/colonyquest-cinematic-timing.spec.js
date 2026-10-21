const {test,expect}=require('@playwright/test');
const core=require('../../public/colonyquest-core');
for(const motion of ['reduce','no-preference']) test(`smartboard raid finishes before next question (${motion})`,async({page},info)=>{
 test.setTimeout(35000);await page.emulateMedia({reducedMotion:motion});
 const teams=[core.createTeam({name:'Oak'},0),core.createTeam({name:'Leaf'},1)];
 Object.assign(teams[0],{soldiers:5,population:7,barracksBuilt:true});
 Object.assign(teams[1],{soldiers:1,population:3,food:20});
 let session=core.normalizeSession({phase:'reward',introSeen:true,teams,turnIndex:0});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/\/api\/game\/cinema\/colonyquest(?:\/session)?$/,async route=>{
  if(route.request().method()==='PUT'){session=route.request().postDataJSON().session;return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{game:{id:'cinema',questions:[{question:'Where?',options:['Nest','Cup'],correctIndex:0}],colonyquest:{teamCount:2,rounds:10,sound:false,teams}},session}});
 });
 await page.route('**/assets/colonyquest/moonroot-meadow.webp',async route=>{await new Promise(r=>setTimeout(r,1500));await route.continue();});
 await page.goto('/colonyquest/cinema');await page.locator('#resumeBtn').click();
 await page.locator('[data-reward="raid"]').click();await page.locator('[data-target]').first().click();
 await expect(page.locator('#worldViewport')).toHaveAttribute('data-raid-phase','outbound');
 const size=page.viewportSize();await page.setViewportSize({width:size.width+20,height:size.height});
 await expect(page.locator('#questionOverlay')).toBeHidden();
 await expect(page.locator('#worldViewport')).toHaveAttribute('data-raid-phase','at-nest');
 await page.locator('#deductTeam').selectOption('team-1');await page.locator('#deductAmount').fill('5');await page.locator('#deductPointsBtn').click();
 await expect(page.locator('#questionOverlay')).toBeHidden();
 await expect(page.locator('#worldViewport')).toHaveAttribute('data-raid-phase','returning');
 await expect(page.locator('#questionOverlay')).toBeHidden();
 await expect(page.locator('#worldViewport')).not.toHaveAttribute('data-raid-phase',/.+/, {timeout:12000});
 await expect(page.locator('.colony-raid-moment')).toHaveAttribute('data-moment','result');
 await page.screenshot({path:info.outputPath('raid-result.png')});
 await expect(page.locator('#questionOverlay')).toBeVisible({timeout:18000});
 expect(session.events.filter(e=>e.key==='raid-result')).toHaveLength(1);expect(errors).toEqual([]);
});
test('reduced motion still gives building a visible scene before the next learner',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const teams=[core.createTeam({name:'Oak'},0),core.createTeam({name:'Leaf'},1)];teams[0].sticks=20;teams[0].leaves=20;
 let session=core.normalizeSession({phase:'reward',introSeen:true,teams,turnIndex:0});
 await page.route(/\/api\/game\/build\/colonyquest(?:\/session)?$/,async route=>{
  if(route.request().method()==='PUT'){session=route.request().postDataJSON().session;return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{game:{id:'build',questions:[{question:'Where?',options:['Nest','Cup'],correctIndex:0}],colonyquest:{teamCount:2,rounds:10,sound:false,teams}},session}});
 });
 await page.goto('/colonyquest/build');await page.locator('#resumeBtn').click();
 await page.locator('[data-reward="defense"]').click();
 await expect(page.locator('#worldViewport')).toHaveAttribute('data-action-focus',/.+/);
 const size=page.viewportSize();await page.setViewportSize({width:size.width+20,height:size.height});
 await page.locator('#pauseBtn').click();await page.waitForTimeout(300);await page.locator('#pauseBtn').click();
 await page.waitForTimeout(4000);
 await expect(page.locator('#questionOverlay')).toBeHidden();
 await expect(page.locator('#questionOverlay')).toBeVisible({timeout:12000});
 expect(session.events.filter(e=>e.key==='upgrade-defense')).toHaveLength(1);
});
