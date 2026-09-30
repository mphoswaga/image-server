const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('teacher shares a private live observer dashboard, then withdraws access',async({page,browser})=>{
 await signInDisposableTeacher(page,'-observer');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
 const lib=await(await page.request.get('/api/games/moonquest/library')).json();const s=await(await page.request.post('/api/games/moonquest/games/'+lib.games[0].id+'/sessions',{data:{test:true}})).json();const base='/api/games/moonquest/sessions/'+s.id;
 await page.goto('/moonquest?session='+s.id);await page.getByRole('button',{name:'Share analysis report',exact:true}).click();const url=await page.locator('dialog input').inputValue();expect(url).toContain('#');
 const context=await browser.newContext({viewport:{width:390,height:844}});const observer=await context.newPage();
 try{await observer.goto(url);await expect(observer.getByRole('heading',{name:'See understanding develop'})).toBeVisible();await observer.getByRole('button',{name:'View live learning'}).click();await expect(observer.locator('#connection')).toContainText('Live');await expect(observer.locator('#dashboard')).not.toContainText('Practice learner');
 async function command(action){const v=await(await page.request.get(base+'/teacher')).json();expect((await page.request.post(base+'/command',{data:{action,seq:v.seq}})).ok()).toBeTruthy();}
 await command('next');await page.request.post(base+'/simulate',{data:{pattern:'mixed'}});await expect(observer.locator('#dashboard')).toContainText('Answered this question');await expect(observer.locator('#dashboard')).toContainText('Waiting for the first answer reveal');await command('advance');await expect(observer.locator('#dashboard details')).toHaveCount(1);await observer.locator('#dashboard summary').first().click();await expect(observer.locator('#dashboard')).toContainText('Incorrect final choices');

 const report=await(await page.request.get(base+'/report')).json();const learner=report.students[0];
 const changed=await page.request.post(base+'/assessment',{data:{version:report.assessmentVersion,round:0,studentId:learner.id,correct:!learner.rounds[0].revisedCorrect,reason:'Private evidence note'}});expect(changed.ok()).toBeTruthy();const adjusted=await changed.json();
 const publicData=await(await observer.request.get(base+'/observe',{headers:{Authorization:'Bearer '+new URL(url).hash.slice(1)}})).json();expect(publicData.totals.finalCorrect).toBe(adjusted.summary.totals.finalCorrect);expect(JSON.stringify(publicData)).not.toMatch(/Private evidence note|assessmentHistory|adjusted|Teacher checked/);
 expect((await observer.request.post(base+'/assessment',{data:{version:1,round:0,studentId:learner.id,correct:true,reason:'Unauthorized'}})).ok()).toBeFalsy();
 await expect(observer.locator('#dashboard')).not.toContainText('teacher adjustments');
 expect(await observer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await observer.screenshot({path:'/tmp/moonquest-observer.png',fullPage:true});
 const token=new URL(url).hash.slice(1);expect((await observer.request.post(base+'/command',{headers:{Authorization:'Bearer '+token},data:{action:'end'}})).ok()).toBeFalsy();
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Withdraw report access',exact:true}).click();await expect(observer.locator('#connection')).toHaveText('Access unavailable');await expect(observer.locator('#dashboard')).toBeEmpty();
 }finally{await context.close();}
});
