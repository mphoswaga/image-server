const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('already signed-in learner joins from normal start page and another class cannot enter',async({page,browser},info)=>{
  test.skip(info.project.name!=='windows-100','Shared server identity contract.');
  await signInDisposableTeacher(page,'-moon-shared');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
  const library=await(await page.request.get('/api/games/moonquest/library')).json();
  const studentId='MS'+Date.now(),otherId=studentId+'X';
  const roster=await(await page.request.post('/api/roster',{data:{name:'Heroes class',idCol:'id',nameCol:'name',rows:[{id:studentId,name:'Hero learner'}]}})).json();
  await page.request.post('/api/roster',{data:{name:'Other class',idCol:'id',nameCol:'name',rows:[{id:otherId,name:'Other learner'}]}});
  const room=await(await page.request.post('/api/games/moonquest/games/'+library.games[0].id+'/sessions',{data:{rosterId:roster.id}})).json();
  const state=await(await page.request.get('/api/games/moonquest/sessions/'+room.id+'/teacher')).json();
  const context=await browser.newContext(),learner=await context.newPage();
  try{
    expect((await context.request.post('http://127.0.0.1:4341/api/student/login',{data:{studentId,pin:'4829'}})).ok()).toBe(true);
    await learner.goto('http://127.0.0.1:4341/start');await learner.locator('#roomCode').fill(state.code);await learner.locator('#joinBtn').click();
    await expect(learner.getByText('You’re in the crew!')).toBeVisible();await expect(learner.locator('#join-pin')).toHaveCount(0);await expect(learner.locator('.hero-welcome')).toContainText('Hero learner');
    expect((await context.request.post('http://127.0.0.1:4341/api/student/login',{data:{studentId:otherId,pin:'4829'}})).ok()).toBe(true);
    expect((await context.request.post('http://127.0.0.1:4341/api/student/join-room',{data:{code:state.code}})).status()).toBe(403);
  }finally{await context.close();}
});
