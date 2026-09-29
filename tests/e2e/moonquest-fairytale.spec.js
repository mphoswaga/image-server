const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher,expectNoPageOverflow}=require('./helpers');
test('fairy tale acts out choices, survives pause and reload, and returns home through the chosen route',async({page,browser},info)=>{
 test.setTimeout(150000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signInDisposableTeacher(page,'-fairytale');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();await page.getByRole('button',{name:'Test team duels',exact:true}).click();await page.waitForURL('**/moonquest?session=*');
 const id=new URL(page.url()).searchParams.get('session'),base='/api/games/moonquest/sessions/'+id;
 const initial=await(await page.request.get(base+'/teacher')).json();
 const join=await(await page.request.post('/api/games/moonquest/rooms/'+initial.code+'/test-enter',{data:{deviceKey:'00000000-0000-0000-0000-000000000061'}})).json();
 const context=await browser.newContext({viewport:page.viewportSize()}),learner=await context.newPage();learner.on('pageerror',e=>errors.push(e.message));
 async function fresh(){return(await page.request.get(base+'/teacher')).json();}
 async function cmd(action){const state=await fresh();const response=await page.request.post(base+'/command',{data:{action,seq:state.seq}});expect(response.ok()).toBeTruthy();return response.json();}
 try{
 await learner.goto('/moonquest/join');await learner.evaluate(({id,token})=>sessionStorage.setItem('moonquest:'+id,token),{id,token:join.token});await learner.goto('/moonquest?session='+id);
 await cmd('launch');await expect(learner.locator('.tale-intro')).toBeVisible();await expect(learner.locator('.tale-intro')).toHaveAttribute('data-beat','1',{timeout:9000});await cmd('pause');await learner.reload();await expect(learner.locator('.tale-intro')).toHaveAttribute('data-beat','1');
 await learner.screenshot({path:'/tmp/moon-fairytale-intro-'+info.project.name+'.png'});await cmd('pause');await cmd('skip-intro');
 let chapter=0;
 for(let round=0;round<5;round++){
  await expect(learner.locator('.question-label')).toHaveText('QUESTION '+(round+1),{timeout:12000});
  const state=await fresh();
  // Use the sample game's reviewed accepted area via the teacher's saved game.
  const games=await(await page.request.get('/api/games/moonquest/library')).json();
  const record=await(await page.request.get('/api/games/moonquest/games/'+games.games[0].id)).json();
  const q=record.game.questions.find(q=>q.id===state.question.id);
  const answer=await learner.request.post(base+'/answer',{headers:{Authorization:'Bearer '+join.token},data:{round,phase:'choose',regionIds:q.answerMode==='all'?q.accepted:[q.accepted[0]],eventId:'test-'+round}});expect(answer.ok()).toBeTruthy();await cmd('advance');await cmd('next');
  const next=await fresh();if(next.phase==='story-vote'){
   await expect(learner.locator('.story-options')).toBeVisible();await learner.locator('[data-story-choice="'+['stars','tower','drums'][chapter]+'"]').click();
   await expect(learner.locator('.tale-action')).toBeVisible({timeout:12000});
   const actor=learner.locator('.tale-traveller').first(),position=await actor.evaluate(el=>getComputedStyle(el).transform);
   await expect.poll(()=>actor.evaluate(el=>getComputedStyle(el).transform)).not.toBe(position);
   await expect(learner.locator('.tale-action')).toHaveAttribute('data-beat','1',{timeout:6000});await cmd('pause');
   await learner.screenshot({path:'/tmp/moon-fairytale-action-'+chapter+'-'+info.project.name+'.png'});
   const stored=await fresh();expect(stored.narrative.worlds.some(w=>w.decisions.some(d=>d.id===['stars','tower','drums'][chapter]))).toBeTruthy();
   await learner.reload();await expect(learner.locator('.tale-action')).toHaveAttribute('data-beat','1');await expectNoPageOverflow(learner);
   const frozen=await actor.evaluate(el=>getComputedStyle(el).transform);await learner.waitForTimeout(200);expect(await actor.evaluate(el=>getComputedStyle(el).transform)).toBe(frozen);
   await cmd('pause');await cmd('skip-story');chapter++;
  }
 }
 await expect(learner.locator('.tale-finale')).toBeVisible();await expect(learner.locator('.tale-journal')).toContainText('Follow the guiding stars');await expect(learner.locator('.tale-journal')).toContainText('Build a lantern tower');await expect(learner.locator('.tale-journal')).toContainText('Lead a lantern parade');
 await learner.reload();await expect(learner.locator('.tale-finale')).toHaveClass(/route-stars/);await expect(learner.locator('.built-tower')).toBeVisible();await expect(learner.locator('.tale-finale')).toHaveAttribute('data-beat','2',{timeout:9000});
 await learner.screenshot({path:'/tmp/moon-fairytale-finale-'+info.project.name+'.png',fullPage:true});await learner.emulateMedia({reducedMotion:'reduce'});await expect(learner.locator('.tale-traveller').first()).toHaveCSS('animation-name','none');
 expect((await fresh()).narrative.complete).toBe(true);expect(errors).toEqual([]);
 }finally{await context.close();}
});
