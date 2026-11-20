const {test,expect} = require('@playwright/test');

test('home practice works without sign-in for both grades', async ({page}, testInfo) => {
  test.skip(!['windows-100','mobile'].includes(testInfo.project.name));
  await page.goto('/practical-practice.html?activity=codequest');
  await expect(page.getByRole('heading',{name:'Grade 2 · CodeQuest practice'})).toBeVisible();
  const game = page.locator('.practice-card:visible').frameLocator('iframe');
  await game.getByRole('button',{name:'Move 1 square'}).click();
  await game.getByRole('button',{name:'Test my code'}).click();
  await expect(game.locator('#testResult')).toContainText('Testing');
  const first = page.locator('.practice-card:visible');
  await expect(first.getByRole('button',{name:'Continue to Moderate'})).toBeHidden();
  for (const name of ['Move 1 square','Move 1 square','Collect']) await game.getByRole('button',{name,exact:false}).first().click();
  await game.getByRole('button',{name:'Test my code'}).click();
  await first.getByRole('button',{name:'Continue to Moderate'}).click();
  await expect(first).toContainText('Moderate · Harbour bend');
  for (let i=0;i<4;i++) await page.getByRole('button',{name:'Next task'}).click();
  await expect(page.locator('.practice-card:visible').frameLocator('iframe').locator('.assessment-flag')).toHaveCount(2);

  await page.goto('/practical-practice.html?activity=data');
  const current = page.locator('.practice-card:visible');
  await current.getByLabel('Name',{exact:true}).fill('Võ Khánh Linh');
  await current.getByLabel('Age',{exact:true}).fill('8');
  await current.getByLabel('Date of birth',{exact:true}).fill('3 June 2018');
  await current.getByLabel('Family phone',{exact:true}).fill('090 000 0018');
  await current.getByRole('button',{name:'Check my work'}).click();
  await expect(current.getByRole('status').last()).toContainText('All answers match');
  await current.getByRole('button',{name:'Continue to Moderate'}).click();
  await expect(current).toContainText('Room');
  await page.getByRole('button',{name:'Next task'}).click();
  await expect(page.getByRole('group',{name:'Name'})).toBeVisible();
  for (let i=0;i<3;i++) await page.getByRole('button',{name:'Next task'}).click();
  const list=page.locator('.practice-card:visible .unit-order');
  const handles=list.locator('.unit-handle');
  await list.scrollIntoViewIfNeeded();
  const start=await handles.nth(1).boundingBox(), end=await handles.first().boundingBox();
  const x=start.x+10, y=start.y+start.height/2, to=end.y+end.height/2;
  if (testInfo.project.name==='mobile') {
    const touch=await page.context().newCDPSession(page);
    for (const [type,touchPoints] of [['touchStart',[{x,y}]],['touchMove',[{x,y:to}]],['touchEnd',[]]]) {
      await touch.send('Input.dispatchTouchEvent',{type,touchPoints});
    }
  } else {
    await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x,to,{steps:8}); await page.mouse.up();
  }
  await expect(handles.first()).toHaveText('Byte (B)');
  for (const [index,unit] of ['Byte (B)','Kilobyte (KB)','Megabyte (MB)','Gigabyte (GB)','Terabyte (TB)'].entries()) {
    let position=(await list.locator('.unit-handle').allTextContents()).indexOf(unit);
    while(position-- > index) await list.getByRole('button',{name:'Move '+unit+' up'}).click();
  }
  await current.getByRole('button',{name:'Check my work'}).click();
  await expect(page.locator('.practice-card:visible [role=status]').last()).toContainText('All answers match');
  await page.getByRole('button',{name:'Next task'}).click();
  await expect(page.getByRole('heading',{name:'Turn data into information'})).toBeVisible();
});
