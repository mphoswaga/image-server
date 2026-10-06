const { test, expect } = require('@playwright/test');
test('colony celebrations show named winners, tied podiums and dismiss safely', async ({page}) => {
  await page.route('**/colonyquest-live.js*', route => route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto('/colonyquest-live.html');
  await page.evaluate(() => window.ColonyCelebration.multiplayer({id:'celebration-test',players:[{name:'Amina',strength:120},{name:'Bao',strength:120},{name:'Chi',strength:90},{name:'Dan',strength:70}]}));
  await expect(page.locator('#cqCelebration')).toBeVisible();
  await expect(page.locator('#cqCelebration h1')).toHaveText('Shared champions!');
  await expect(page.locator('.cq-winners figcaption')).toHaveText(['Amina','Bao']);
  await expect(page.locator('.cq-place')).toHaveCount(3);
  await expect(page.locator('.cq-rank-1')).toHaveCount(2);
  await page.screenshot({path:'/tmp/colonyquest-celebration.png'});
  await page.getByRole('button',{name:'View results',exact:true}).click();
  await page.evaluate(() => window.ColonyCelebration.multiplayer({id:'celebration-test',players:[]}));
  await expect(page.locator('#cqCelebration')).toHaveCount(0);
  await page.evaluate(() => window.ColonyCelebration.show('board-test',[{name:'Leaf Legends',score:200,rank:1,members:[{name:'Amina'},{name:'Bao'}]},{name:'Root Rangers',score:150,rank:2,members:[]}]));
  await expect(page.locator('.cq-winners figcaption')).toHaveText(['Amina','Bao']);
  await expect(page.locator('#cqCelebration h1')).toHaveText('Leaf Legends wins!');
  await page.keyboard.press('Escape');
  await expect(page.locator('#cqCelebration')).toHaveCount(0);
});
test('smartboard finish early opens a celebration with winning team members', async ({page}) => {
  const core = require('../../public/colonyquest-core');
  const teams = [core.createTeam({name:'Leaf Legends',members:[{id:'a',name:'Amina'}]},0),core.createTeam({name:'Root Rangers'},1)];
  let session = core.normalizeSession({phase:'question',introSeen:true,teams});
  await page.route(/\/api\/game\/cq-party\/colonyquest(?:\/session)?$/, async route => {
    if(route.request().method() === 'PUT') { session = core.normalizeSession(route.request().postDataJSON().session); return route.fulfill({json:{ok:true}}); }
    return route.fulfill({json:{game:{id:'cq-party',lessonTitle:'Habitats',questions:[{question:'Where do ants live?',options:['Nest','Cup','Cloud','Moon'],correctIndex:0}],colonyquest:{teamCount:2,rounds:5,teams}},session}});
  });
  await page.goto('/colonyquest/cq-party');
  await page.locator('#resumeBtn').click();
  await page.locator('#teacherHandle').click();
  page.on('dialog', dialog=>dialog.accept());
  await page.locator('#endGameBtn').click();
  await expect(page.locator('#cqCelebration')).toBeVisible({timeout:20000});
  await expect(page.locator('.cq-winners')).toContainText('Amina');
});
