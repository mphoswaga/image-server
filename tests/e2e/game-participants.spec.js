const {test,expect}=require('@playwright/test');
const pptxgen=require('pptxgenjs');
const {signInDisposableTeacher}=require('./helpers');
test('remove and add back learners across arcade, FishQuest and ColonyQuest without changing roster or results',async({page,browser})=>{
 test.setTimeout(90000);await signInDisposableTeacher(page,'-participants');
 const roster=await(await page.request.post('/api/roster',{data:{name:'Ocean class',rows:[{ID:'REMOVE1',Name:'Learner One'},{ID:'KEEP2',Name:'Learner Two'}],idCol:'ID',nameCol:'Name'}})).json();
 const deck=new pptxgen();deck.addSlide().addText('Fish live in water.',{x:1,y:1,w:5,h:1});
 const created=await(await page.request.post('/api/game/from-pptx',{multipart:{file:{name:'water.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await deck.write({outputType:'nodebuffer'})},subject:'Science',topic:'Water',grade:'Grade 3',questionCount:'4',mode:'arcade',rosterIds:JSON.stringify([roster.id])}})).json();
 const id=created.gameId;expect(id).toBeTruthy();
 const context=await browser.newContext({baseURL:new URL(page.url()).origin});const student=context.request;
 try{
 const entered=await student.post(`/api/game/${id}/enter`,{data:{studentId:'REMOVE1',pin:'2468'}});expect(entered.ok()).toBeTruthy();
 const finished=await student.post(`/api/game/${id}/finish`,{data:{answers:[0,0,0,0],arcadeScore:5,gameType:'car'}});expect(finished.ok()).toBeTruthy();
 const results=await(await page.request.get(`/api/game/${id}/results`)).json();
 await page.goto(`/game-participants.html?game=${id}`);await page.getByRole('button',{name:'Remove Learner One',exact:true}).click();await expect(page.getByRole('button',{name:'Add back Learner One'})).toBeVisible();
 expect((await student.get(`/api/game/${id}`)).status()).toBe(403);
 expect((await student.post(`/api/game/${id}/enter`,{data:{studentId:'REMOVE1',pin:'2468'}})).status()).toBe(403);
 expect((await student.patch(`/api/game/${id}/participants`,{data:{studentId:'KEEP2',removed:true}})).status()).toBe(401);
 const join=await(await student.get(`/api/game/${id}/join`)).json();expect(join.students).toHaveLength(1);
 const board=await(await page.request.get(`/api/game/${id}/fishquest/smartboard`)).json();expect(board.attendance.map(s=>s.studentId)).toEqual(['KEEP2']);
 const colony=await(await page.request.get(`/api/game/${id}/colonyquest`)).json();expect(colony.roster.students.map(s=>s.id)).toEqual(['KEEP2']);
 expect((await(await page.request.get(`/api/game/${id}/results`)).json()).results).toEqual(results.results);
 const unchanged=await(await page.request.get(`/api/roster/${roster.id}`)).json();expect(unchanged.students).toHaveLength(2);
 await page.reload();await page.getByRole('button',{name:'Add back Learner One'}).click();await expect(page.getByRole('button',{name:'Remove Learner One',exact:true})).toBeVisible();
 expect((await student.get(`/api/game/${id}`)).ok()).toBeTruthy();
 await page.goto(`/fishquest-board.html?game=${id}`);await page.getByRole('button',{name:'Remove Learner One from this game'}).click();await expect(page.locator('#roster label')).toHaveCount(1);await page.reload();await expect(page.locator('#roster label')).toHaveCount(1);
 await page.request.patch(`/api/game/${id}/participants`,{data:{studentId:'REMOVE1',removed:false}});
 await page.goto(`/colonyquest/${id}`);await page.locator('[data-student-id="REMOVE1"]').selectOption('__remove__');await expect(page.locator('[data-student-id="REMOVE1"]')).toHaveCount(0);await page.reload();await expect(page.locator('[data-student-id="REMOVE1"]')).toHaveCount(0);
 }finally{await context.close()}
});

test('MoonQuest crew removal and add back persist across refresh',async({page})=>{
 await signInDisposableTeacher(page,'-remove-moon');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();await page.getByRole('button',{name:'Test game',exact:true}).click();
 const remove=page.locator('[data-remove-learner]').first();const id=await remove.getAttribute('data-remove-learner');await remove.click();await expect(page.locator(`[data-remove-learner="${id}"]`)).toHaveText('Add back');await page.reload();await expect(page.locator(`[data-remove-learner="${id}"]`)).toHaveText('Add back');await page.locator(`[data-remove-learner="${id}"]`).click();await expect(page.locator(`[data-remove-learner="${id}"]`)).toHaveText('Remove');
});
