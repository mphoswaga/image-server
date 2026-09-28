const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher,expectNoPageOverflow}=require('./helpers');
test('festival reveal, private missing answers and an earned learner story choice',async({page,browser})=>{
 test.setTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signInDisposableTeacher(page,'-story');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();await page.getByRole('button',{name:'Test game',exact:true}).click();
 await page.waitForURL('**/moonquest?session=*');
 const id=new URL(page.url()).searchParams.get('session'),base='/api/games/moonquest/sessions/'+id;
 let state=await(await page.request.get(base+'/teacher')).json();
 const join=await(await page.request.post('/api/games/moonquest/rooms/'+state.code+'/test-enter',{data:{deviceKey:'00000000-0000-0000-0000-000000000031'}})).json();
 await page.request.post('/api/games/moonquest/rooms/'+state.code+'/test-enter',{data:{deviceKey:'00000000-0000-0000-0000-000000000032'}});
 const context=await browser.newContext(),learner=await context.newPage();learner.on('pageerror',e=>errors.push(e.message));
 await learner.goto('/moonquest/join');await learner.evaluate(({id,token})=>sessionStorage.setItem('moonquest:'+id,token),{id,token:join.token});await learner.goto('/moonquest?session='+id);
 async function command(action){const fresh=await(await page.request.get(base+'/teacher')).json();const r=await page.request.post(base+'/command',{data:{action,seq:fresh.seq}});expect(r.ok()).toBeTruthy();return r.json()}
 try{
 await command('next');
 for(let round=0;round<2;round++){
  await expect(learner.locator('.question-label')).toHaveText('QUESTION '+(round+1));await learner.getByRole('button',{name:round===0?'Left hand / skin':'Eyes',exact:true}).last().click();await expect(learner.locator('#answer-status')).toContainText('locked in');
  await command('advance');await expect(page.locator('.unanswered-private')).toContainText('No answer received');
  if(round===0){await expect(page.locator('.festival-fireworks')).toHaveCount(1);await page.screenshot({path:'/tmp/moonquest-reveal-'+test.info().project.name+'.png',fullPage:true});}
  await command('next');
 }
 await expect(learner.locator('.story-options')).toBeVisible();await expect(page.locator('.story-chapter')).toBeVisible();
 await expectNoPageOverflow(learner);await learner.locator('[data-story-choice="stars"]').click();await expect(learner.locator('.story-options .chosen')).toHaveCount(1);
 await expect(page.locator('.story-result')).toBeVisible({timeout:12000});await expect(page.locator('.story-result')).toContainText('Follow the guiding stars');
 await page.screenshot({path:'/tmp/moonquest-story-'+test.info().project.name+'.png',fullPage:true});
 await expect(learner.locator('.question-focus')).toBeVisible({timeout:10000});expect(errors).toEqual([]);
 const board=await(await page.request.get(base+'/state?board='+state.boardToken)).json();expect(board.unansweredLearners).toBeUndefined();
 }finally{await context.close();}
});
