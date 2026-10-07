const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('Finish during a question celebrates named bunnies and team podiums on learner and teacher screens',async({page,browser})=>{
 test.setTimeout(90000);
 await signInDisposableTeacher(page,'-celebration');await page.goto('/moonquest');
 await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
 await page.getByRole('button',{name:'Test team duels',exact:true}).click();await page.waitForURL('**/moonquest?session=*');
 const id=new URL(page.url()).searchParams.get('session'),base='/api/games/moonquest/sessions/'+id;
 const state=await(await page.request.get(base+'/teacher')).json();
 async function command(action){const fresh=await(await page.request.get(base+'/teacher')).json();const r=await page.request.post(base+'/command',{data:{action,seq:fresh.seq}});expect(r.ok()).toBeTruthy();}
 const joined=await(await page.request.post('/api/games/moonquest/rooms/'+state.code+'/test-enter',{data:{deviceKey:'00000000-0000-0000-0000-000000000089'}})).json();
 const context=await browser.newContext();const learner=await context.newPage();const errors=[];learner.on('pageerror',e=>errors.push(e.message));
 try{
 await learner.goto('/moonquest/join');await learner.evaluate(({id,token})=>sessionStorage.setItem('moonquest:'+id,token),{id,token:joined.token});await learner.goto('/moonquest?session='+id);
 await page.locator('#music').click();await expect(page.locator('audio[data-moonquest-finale]')).toHaveCount(0);
 await command('next');await expect(learner.locator('#diagram')).toBeVisible({timeout:20000});await learner.locator('#diagram polygon[data-region="left-hand"]').click();await expect(learner.locator('#answer-status')).toContainText('locked');await command('advance');
 await expect(learner.locator('.victory-screen .duel-verdict')).toBeVisible();
 await command('end');await expect(learner.locator('.final-victory')).toBeVisible();await expect(learner.locator('.team-podium')).toHaveCount(2);await expect(learner.locator('.podium-place').first()).toContainText('points');await expect(page.locator('.final-victory')).toBeVisible();const track=page.locator('audio[data-moonquest-finale]');await expect.poll(()=>track.evaluate(a=>!a.paused&&a.currentTime>0)).toBe(true);await expect(track).toHaveAttribute('src','/assets/colonyquest/music/toys-are-us-blue-deer-studio.mp3');await page.locator('#music').click();await expect.poll(()=>track.evaluate(a=>a.paused)).toBe(true);await learner.reload();await expect(learner.locator('.final-victory')).toBeVisible();expect(errors).toEqual([]);
 await learner.screenshot({path:'/tmp/moonquest-final-celebration.png',fullPage:true});
 }finally{await context.close();}
});
