const {test,expect}=require('@playwright/test');
const core=require('../../public/colonyquest-core');
for(const viewport of [{width:1366,height:768},{width:1093,height:614},{width:1920,height:1080},{width:820,height:720}])test(`smartboard question fits beside teacher rail at ${viewport.width}`,async({page})=>{
 await page.setViewportSize(viewport);
 const teams=[core.createTeam({name:'Boys'},0),core.createTeam({name:'Girls'},1)];
 const session=core.normalizeSession({phase:'question',introSeen:true,teams});
 await page.route(/\/api\/game\/cq-layout\/colonyquest(?:\/session)?$/,route=>route.fulfill({json:route.request().method()==='PUT'?{ok:true}:{game:{id:'cq-layout',lessonTitle:'Understanding Software Types',questions:[{question:'What is application software, and how does it help people use a computer?',options:['Software that helps the computer run','Software that helps people complete tasks such as writing documents','Software that protects the computer','Software that connects the computer to a printer'],correctIndex:1}],colonyquest:{teamCount:2,rounds:5,sound:false,teams}},session}}));
 await page.goto('/colonyquest/cq-layout');await page.locator('#resumeBtn').click();await expect(page.locator('#questionOverlay')).toBeVisible();
 const boxes=await page.evaluate(()=>{
 const els=[document.querySelector('.question-dialog'),document.querySelector('#questionText'),...document.querySelectorAll('.answer')];const stage=document.querySelector('.game-stage').getBoundingClientRect();
 return els.map(el=>{const r=el.getBoundingClientRect();return {overflowX:el.scrollWidth>el.clientWidth+1,overflowY:el.scrollHeight>el.clientHeight+1,inside:r.left>=stage.left&&r.right<=stage.right+1&&r.top>=0&&r.bottom<=innerHeight};});
 });for(const box of boxes)expect(box).toEqual({overflowX:false,overflowY:false,inside:true});
 await page.screenshot({path:`/tmp/colony-question-${viewport.width}.png`});
});
