const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('simultaneous duels: rabbit choice, shared time, private answers and team reveal',async({page,browser},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await signInDisposableTeacher(page,'-duels');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
 await page.getByRole('button',{name:'Test team duels',exact:true}).click();await page.waitForURL('**/moonquest?session=*');
 const id=new URL(page.url()).searchParams.get('session'),base='/api/games/moonquest/sessions/'+id;
 const state=await(await page.request.get(base+'/teacher')).json();const contexts=[];const students=[];
 async function command(action,extra={}){const fresh=await(await page.request.get(base+'/teacher')).json();const r=await page.request.post(base+'/command',{data:{action,seq:fresh.seq,...extra}});expect(r.ok()).toBeTruthy();return r.json();}
 try{
 for(let i=0;i<2;i++){
  const joined=await(await page.request.post('/api/games/moonquest/rooms/'+state.code+'/test-enter',{data:{deviceKey:'00000000-0000-0000-0000-00000000005'+i}})).json();
  const context=await browser.newContext({viewport:page.viewportSize()});contexts.push(context);const learner=await context.newPage();learner.on('pageerror',e=>errors.push(e.message));
  await learner.goto('/moonquest/join');await learner.evaluate(({id,token})=>sessionStorage.setItem('moonquest:'+id,token),{id,token:joined.token});await learner.goto('/moonquest?session='+id);students.push(learner);
  await command('set-team',{studentId:'practice-'+i,team:i});
 }
 const [a,b]=students;await expect(a.locator('[data-avatar]')).toHaveCount(9);await a.getByRole('button',{name:'Festival DJ',exact:true}).click();await a.reload();await expect(a.getByRole('button',{name:'Festival DJ',exact:true})).toHaveAttribute('aria-pressed','true');await a.screenshot({path:'/tmp/moon-rabbit-picker-'+info.project.name+'.png',fullPage:true});await a.getByRole('button',{name:'Pink bow'}).click();await expect(a.getByRole('button',{name:'Pink bow'})).toHaveAttribute('aria-pressed','true');
 await command('next');await expect(a.locator('.matchup-large')).toContainText('Practice learner 2');await expect(b.locator('.matchup-large')).toContainText('Practice learner 1');await expect(a.locator('.duel-strip')).toContainText('Practice learner 2');await expect(b.locator('.duel-strip')).toContainText('Practice learner 1');
 await a.getByRole('button',{name:'Need more time',exact:true}).click();await expect(b.getByRole('button',{name:'10 extra seconds added'})).toBeDisabled();
 await a.locator('#diagram polygon[data-region="left-hand"]').click();await expect(a.locator('#answer-status')).toContainText('locked in');
 expect(await a.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2)).toBeTruthy();
 await expect(b.locator('.duel-strip')).not.toContainText('points');await expect(a.getByRole('progressbar',{name:'School illumination'})).toHaveAttribute('aria-valuenow','0');
 await b.locator('#diagram polygon[data-region="left-hand"]').click();await command('advance');
 await expect(a.locator('.duel-verdict')).toBeVisible();await expect(b.locator('.duel-verdict')).toHaveText(await a.locator('.duel-verdict').innerText());
 await a.screenshot({path:'/tmp/moon-duels-learner-'+info.project.name+'.png'});
 await a.reload();await expect(a.getByRole('progressbar',{name:'School illumination'}).first()).toHaveAttribute('aria-valuenow','25');
 const board=await page.context().newPage();await board.goto('/moonquest?session='+id+'&board='+state.boardToken);await expect(board.locator('.lighting-school')).toBeVisible({timeout:10000});await board.screenshot({path:'/tmp/moon-duels-board-'+info.project.name+'.png',fullPage:true});await board.close();
 await expect(a.locator('.question-label')).toHaveText('QUESTION 2',{timeout:12000});await a.locator('#diagram polygon[data-region="eyes"]').click();await b.locator('#diagram polygon[data-region="eyes"]').click();await command('advance');await command('next');
 await expect(a.locator('.story-options')).toBeVisible();await a.locator('[data-story-choice=bridge]').click();await b.locator('[data-story-choice=stars]').click();
 await expect(page.locator('.crew-story-results')).toBeVisible({timeout:12000});await expect(page.locator('.crew-story-results')).toContainText('Jade Rabbits');await expect(page.locator('.crew-story-results')).toContainText('Golden Rabbits');
 await command('end');await expect(a.locator('.duel-race')).toContainText('Festival Champions');expect(errors).toEqual([]);
 }finally{for(const c of contexts)await c.close();}
});
