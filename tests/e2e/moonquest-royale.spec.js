const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('royale elimination becomes a persistent read-only spectator screen',async({page,browser})=>{
 test.setTimeout(60000);
 await signInDisposableTeacher(page,'-royale');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
 const library=await(await page.request.get('/api/games/moonquest/library')).json();
 const game=(await(await page.request.get('/api/games/moonquest/games/'+library.games[0].id)).json()).game;
 const session=await(await page.request.post('/api/games/moonquest/games/'+game.id+'/sessions',{data:{test:true,mode:'royale'}})).json();
 const base='/api/games/moonquest/sessions/'+session.id;
 const fresh=async()=>await(await page.request.get(base+'/teacher')).json();
 const initial=await fresh();const joins=[];
 for(let i=0;i<3;i++)joins.push(await(await page.request.post('/api/games/moonquest/rooms/'+initial.code+'/test-enter',{data:{deviceKey:'00000000-0000-0000-0000-00000000009'+i}})).json());
 const context=await browser.newContext();const learner=await context.newPage();
 const command=async action=>{const s=await fresh();const response=await page.request.post(base+'/command',{data:{action,seq:s.seq}});expect(response.ok(),await response.text()).toBeTruthy();};
 try{
 await learner.goto('/moonquest/join');await learner.evaluate(({id,token})=>sessionStorage.setItem('moonquest:'+id,token),{id:session.id,token:joins[0].token});await learner.goto('/moonquest?session='+session.id);
 await learner.locator('[data-action=battle-audio]').click();
 await expect(learner.locator('[data-action=battle-audio]')).toHaveAttribute('aria-pressed','true');
 for(let round=0;round<3;round++){
 await command('next');await expect(learner.locator('body')).toHaveAttribute('data-battle-score','matchup');await expect.poll(async()=> (await fresh()).phase).toBe('choose');const s=await fresh();const q=game.questions.find(q=>q.id===s.question.id),d=game.diagrams.find(d=>d.id===q.diagramId);
 for(let i=0;i<3;i++){const response=await page.request.post(base+'/answer',{headers:{Authorization:'Bearer '+joins[i].token},data:{round,phase:'choose',eventId:`e${round}-${i}`,regionId:i? q.accepted[0]:d.regions.find(r=>!q.accepted.includes(r.id)).id}});expect(response.ok(),await response.text()).toBeTruthy();}
 await command('advance');if((await fresh()).paused)await command('pause');
 }
 await expect(learner.getByRole('heading',{name:'You are now a spectator'})).toBeVisible();await expect(learner.locator('#royale-watch option')).toHaveCount(2);await learner.locator('#royale-watch').selectOption({index:1});await learner.reload();await expect(learner.getByRole('heading',{name:'You are now a spectator'})).toBeVisible();await expect(learner.locator('[data-region-answer]')).toHaveCount(0);await command('next');
 await expect(learner.getByRole('heading',{name:'Meet your rival!'})).toBeVisible();
 await expect.poll(async()=> (await fresh()).phase).toBe('choose');
 await learner.locator('#royale-watch').selectOption({index:0});
 await learner.locator('[data-fan-answer]').first().click();
 await expect(learner.locator('[data-fan-answer]').first()).toHaveAttribute('aria-pressed','true');
 const supported=await context.newPage();
 await supported.goto('/moonquest/join');
 await supported.evaluate(({id,token})=>sessionStorage.setItem('moonquest:'+id,token),{id:session.id,token:joins[1].token});
 await supported.goto('/moonquest?session='+session.id);
 await expect(supported.locator('.fan-area')).toBeVisible({timeout:15000});
 await supported.locator('.fan-strip summary').click();
 await expect(supported.locator('.fan-strip')).toContainText('Practice learner 1');
 await supported.locator('[data-action=battle-audio]').click();
 await expect(supported.locator('body')).toHaveAttribute('data-battle-score','answering');
 await supported.locator('[data-action=battle-audio]').click();
 await expect(supported.locator('[data-action=battle-audio]')).toHaveAttribute('aria-pressed','false');
 await supported.screenshot({path:'/tmp/moonquest-fan-advice.png'});
 await command('end');await expect(learner.getByRole('heading',{name:'Festival champions'})).toBeVisible();await learner.screenshot({path:'/tmp/moonquest-royale.png'});
 }finally{await context.close();}
});
