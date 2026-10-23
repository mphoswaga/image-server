const { test, expect } = require('@playwright/test');
const pptxgen = require('pptxgenjs');
const { signInDisposableTeacher } = require('./helpers');
test('admin enables PIN-free games for one teacher without granting account access', async ({page,browser}) => {
 test.setTimeout(60000);
 const admin=await browser.newContext({baseURL:'http://127.0.0.1:4341'});
 await admin.addInitScript(() => localStorage.setItem('lc_wizard_done','1'));
 const learner=await browser.newContext({baseURL:'http://127.0.0.1:4341'});
 try {
  await admin.request.post('/api/signup',{data:{email:'games-admin@example.test',password:'Test-password-123!',name:'Admin'}});
  await signInDisposableTeacher(page,'pin-free');
  const me=await(await page.request.get('/api/me')).json();const id=me.user.id;
  const endpoint='/api/admin/accounts/'+id+'/game-joining';
  expect((await page.request.put(endpoint,{data:{enabled:true}})).status()).toBe(403);
  const roster=await(await page.request.post('/api/roster',{data:{name:'PIN free class',idCol:'id',nameCol:'name',rows:[{id:'PINFREE1',name:'Test Learner'}]}})).json();
  const deck=new pptxgen();deck.addSlide().addText('Files and folders: save a document in a folder.');
  const created=await page.request.post('/api/game/from-pptx',{multipart:{file:{name:'files.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await deck.write({outputType:'nodebuffer'})},subject:'ICT',topic:'Files',grade:'Grade 2',questionCount:'4',mode:'arcade',rosterIds:JSON.stringify([roster.id])}});
  expect(created.ok(),await created.text()).toBeTruthy();const game=await created.json();
  const base='/api/game/'+game.gameId;
  expect((await learner.request.post('/api/student/login',{data:{studentId:'PINFREE1',pin:'4829'}})).ok()).toBe(true);await learner.clearCookies();
  const meta=await(await learner.request.get(base+'/join')).json();const handle=meta.students[0].handle;
  expect((await learner.request.post(base+'/enter',{data:{handle}})).status()).toBe(428);
  expect((await admin.request.put(endpoint,{data:{enabled:true}})).ok()).toBeTruthy();
  expect((await(await learner.request.get(base+'/join')).json()).pinFreeGames).toBe(true);
  expect((await learner.request.post(base+'/enter',{data:{handle:'invalid'}})).ok()).toBe(false);
  expect((await learner.request.post(base+'/enter',{data:{studentId:'PINFREE1'}})).status()).toBe(428);
  expect((await learner.request.post(base+'/enter',{data:{handle}})).ok()).toBe(true);
  expect((await learner.cookies()).some(c=>c.name==='lc_student')).toBe(false);
  expect((await learner.request.post('/api/student/login',{data:{studentId:'PINFREE1'}})).ok()).toBe(false);
  const fishContext=await browser.newContext({baseURL:'http://127.0.0.1:4341'});
  try { const fish=await fishContext.newPage();await fish.goto('/fishquest-play/'+game.gameId);
   await expect(fish.locator('select#studentId')).toBeVisible();await expect(fish.locator('#pin')).toBeHidden();
   await fish.locator('#studentId').selectOption(handle);await fish.locator('#joinButton').click();
   await expect.poll(async()=> (await fishContext.cookies()).some(c=>c.name==='lc_game')).toBe(true);
   expect((await fishContext.cookies()).some(c=>c.name==='lc_student')).toBe(false);
  } finally {await fishContext.close();}
  // MoonQuest uses its own session join route and must enforce the same policy.
  await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
  const library=await(await page.request.get('/api/games/moonquest/library')).json();
  const room=await(await page.request.post('/api/games/moonquest/games/'+library.games[0].id+'/sessions',{data:{rosterId:roster.id}})).json();
  const state=await(await page.request.get('/api/games/moonquest/sessions/'+room.id+'/teacher')).json();
  const pupil=await learner.newPage();await pupil.goto('/moonquest/join?code='+state.code);
  await expect(pupil.locator('[data-learner-handle]')).toHaveCount(1);
  await expect(pupil.locator('#join-pin')).toHaveCount(0);
  await pupil.locator('[data-learner-handle]').click();await pupil.getByRole('button',{name:'Join the mission'}).click();
  await expect(pupil.getByText('You’re in the crew!')).toBeVisible();
  expect((await learner.cookies()).some(c=>c.name==='lc_student')).toBe(false);
  const adminPage=await admin.newPage();await adminPage.goto('/');await adminPage.locator('#adminBtn').click();
  const toggle=adminPage.locator('[data-pin-free="'+id+'"]');await expect(toggle).toBeChecked();await toggle.uncheck();
  await expect(adminPage.locator('#teacherAccountStatus')).toContainText('Game joining updated');
  expect((await learner.request.post(base+'/enter',{data:{handle}})).status()).toBe(428);
 } finally {await admin.close();await learner.close();}
});
