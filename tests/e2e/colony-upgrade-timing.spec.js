const {test,expect}=require('@playwright/test');
const core=require('../../public/colonyquest-core');
for(const reducedMotion of ['no-preference','reduce'])test(`upgrades remain visible and teacher deductions do not interrupt them (${reducedMotion})`,async({page})=>{
 await page.emulateMedia({reducedMotion});
 const teams=[core.createTeam({name:'Boys'},0),core.createTeam({name:'Girls'},1)];
 let saved=core.normalizeSession({phase:'reward',introSeen:true,teams});
 await page.route(/\/api\/game\/cq-timing\/colonyquest(?:\/session)?$/,async route=>{
 if(route.request().method()==='PUT'){saved=core.normalizeSession(route.request().postDataJSON().session);return route.fulfill({json:{ok:true}});}
 return route.fulfill({json:{game:{id:'cq-timing',lessonTitle:'Habitats',questions:[{question:'Which is a habitat?',options:['Forest','Pencil','Spoon','Shoe'],correctIndex:0}],colonyquest:{teamCount:2,rounds:6,sound:false,teams}},session:saved}});
 });
 await page.goto('/colonyquest/cq-timing');await page.locator('#resumeBtn').click();await page.locator('[data-reward="workers"]').click();
 await page.locator('#deductAmount').fill('5');await page.locator('#deductPointsBtn').click();await expect(page.locator('#deductStatus')).toContainText('5 points deducted');
 await page.waitForTimeout(1200);await expect(page.locator('#questionOverlay')).toBeHidden();expect(saved.phase).toBe('event');
 await expect(page.locator('#questionOverlay')).toBeVisible({timeout:9000});await expect(page.locator('.score-card').first()).toBeVisible();expect(saved.teams[0].teacherDeduction).toBe(5);expect(saved.teams[0].workers).toBe(2);
});
