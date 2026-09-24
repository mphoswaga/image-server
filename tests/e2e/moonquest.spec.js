const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher, expectNoPageOverflow } = require('./helpers');
const sharp = require('sharp');

test('MoonQuest editor, isolated practice and durable results work together', async ({ page }) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await signInDisposableTeacher(page,'-moonquest');await page.goto('/moonquest');
  await page.getByRole('button',{name:'Try the senses example'}).click();
  await expect(page.locator('#reviewed')).toBeVisible();
  await expect(page.locator('[data-question]')).toHaveCount(5);
  await page.locator('[data-edit-region="eyes"]').click();
  await page.locator('#region-label').fill('Eyes / vision');
  await page.getByRole('button',{name:'Apply area changes'}).click();
  await expect(page.locator('[data-question]').nth(1)).toContainText('Eyes / vision');
  await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
  await expect(page.getByRole('button',{name:'Test game',exact:true})).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole('button',{name:'Test game',exact:true}).click();
  await expect(page.getByText('Teacher test · Practice learners only')).toBeVisible();
  await page.getByRole('button',{name:'Begin mission',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A watch vibrates on your wrist.' , exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Open answers',exact:true}).click();
  await page.getByRole('button',{name:'Simulate learner answers'}).click();
  await expect(page.locator('#answer-status')).toContainText('6 of 6');
  await expect(page.getByRole('heading',{name:'Discuss your choice with your partner.'})).toBeVisible();
  await page.getByRole('button',{name:'Reconsider',exact:true}).click();
  await page.getByRole('button',{name:'Reveal answer',exact:true}).click();
  await expect(page.getByText('Touch detects vibration through the skin.',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('Touch detects vibration through the skin.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View report',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(6);await expect(page.getByText('First thinking → discussion → later application')).toBeVisible();
  expect(errors).toEqual([]);
});

test('teacher, board and learner are separated; real PIN join keeps answers private until reveal',async({page,browser})=>{
  await signInDisposableTeacher(page,'-moonquest-live');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
  const lib=await(await page.request.get('/api/games/moonquest/library')).json();
  // Use the normal roster API rather than a MoonQuest-only fixture.
  const rosterResponse=await page.request.post('/api/roster',{data:{name:'Moon crew',idCol:'id',nameCol:'name',rows:[{id:'MQ'+Date.now(),name:'Moon Learner'}]}});
  expect(rosterResponse.ok()).toBeTruthy();const roster=await rosterResponse.json();
  const created=await(await page.request.post(`/api/games/moonquest/games/${lib.games[0].id}/sessions`,{data:{rosterId:roster.id||roster.roster?.id}})).json();expect(created.id).toBeTruthy();
  await page.goto('/moonquest?session='+created.id);
  const teacher=await(await page.request.get(`/api/games/moonquest/sessions/${created.id}/teacher`)).json();
  const bypass=await page.request.post('/api/games/moonquest/rooms/'+teacher.code+'/test-enter',{data:{deviceKey:'00000000-0000-0000-0000-000000000001'}});
  expect(bypass.ok()).toBe(false);
  const learnerContext=await browser.newContext();const learner=await learnerContext.newPage();await learner.goto('/moonquest/join?code='+teacher.code);
  await learner.locator('#join-name').selectOption({label:'Moon L.'});await learner.locator('#join-pin').fill('4829');await learner.getByRole('button',{name:'Join the mission'}).click();await expect(learner.getByText('You’re in the crew!')).toBeVisible();
  const boardContext=await browser.newContext();const board=await boardContext.newPage();await board.goto(`/moonquest?session=${created.id}&board=${teacher.boardToken}`);
  await expect(board.locator('.code')).toHaveText(teacher.code);await expect(board.getByText('Teacher controls · private')).toHaveCount(0);
  await page.getByRole('button',{name:'Begin mission',exact:true}).click();await page.getByRole('button',{name:'Open answers',exact:true}).click();
  await learner.getByRole('button',{name:'Left hand / skin',exact:true}).last().click();await expect(learner.locator('#answer-status')).toContainText('saved');
  await expect(board.locator('#answer-status')).toContainText('1 of 1');
  await expectNoPageOverflow(learner);
  const raw=await(await board.request.get(`/api/games/moonquest/sessions/${created.id}/state?board=${teacher.boardToken}`)).json();expect(raw.question.accepted).toBeUndefined();expect(raw.learners).toBeUndefined();expect(raw.queue).toBeUndefined();
  await page.getByRole('button',{name:'Reconsider',exact:true}).click();await page.getByRole('button',{name:'Reveal answer',exact:true}).click();
  await expect(learner.getByText('1 correct',{exact:true})).toBeVisible();await learner.reload();await expect(learner.getByText('1 correct',{exact:true})).toBeVisible();
  await learnerContext.close();await boardContext.close();
});

test('scanning the test QR opens a practice learner without a name or PIN and simulation preserves their answer',async({page,browser})=>{
  await signInDisposableTeacher(page,'-moonquest-qr');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();await page.getByRole('button',{name:'Test game',exact:true}).click();
  const url=await page.getByRole('link',{name:'Open practice learner',exact:true}).getAttribute('href');
  const context=await browser.newContext();const learner=await context.newPage();
  try {
    await learner.goto('http://127.0.0.1:4341'+url);
    await expect(learner.getByText('You’re in the crew!')).toBeVisible();
    await expect(learner.locator('#join-name')).toHaveCount(0);await expect(learner.locator('#join-pin')).toHaveCount(0);
    await expect(learner.locator('.preview-note')).toContainText('Practice learners only');
    await page.getByRole('button',{name:'Begin mission',exact:true}).click();await page.getByRole('button',{name:'Open answers',exact:true}).click();
    await learner.getByRole('button',{name:'Left hand / skin',exact:true}).last().click();await expect(learner.locator('#answer-status')).toContainText('saved');
    await page.getByRole('button',{name:'Simulate a misconception',exact:true}).click();await page.getByRole('button',{name:'Reconsider',exact:true}).click();await page.getByRole('button',{name:'Reveal answer',exact:true}).click();
    await expect(learner.getByText('1 correct',{exact:true})).toBeVisible();
    await learner.goto('http://127.0.0.1:4341'+url);await expect(learner.locator('[data-region-answer="left-hand"]')).toHaveClass(/selected/);
    const id=new URL(page.url()).searchParams.get('session');const report=await(await page.request.get(`/api/games/moonquest/sessions/${id}/report`)).json();
    expect(report.test).toBe(true);expect(report.students[0].rounds[0].initial).toBe('Left hand / skin');
  }finally{await context.close();}
});

test('later challenges preserve teacher edits and stay hidden until two intervening rounds',async({page})=>{
  await signInDisposableTeacher(page,'-moonquest-queue');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();await page.getByRole('button',{name:'Test game',exact:true}).click();
  await page.getByRole('button',{name:'Begin mission',exact:true}).click();await page.getByRole('button',{name:'Open answers',exact:true}).click();await page.getByRole('button',{name:'Simulate a misconception'}).click();await page.getByRole('button',{name:'Reconsider',exact:true}).click();await page.getByRole('button',{name:'Reveal answer',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A concept to revisit'})).toBeVisible();
  const prompt='A silent controller shakes in your hand. Which part notices this?';
  await page.locator('[data-prompt]').fill(prompt);await page.locator('[data-explanation]').fill('The skin detects the shaking.');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.locator('[data-prompt]')).toHaveValue(prompt);await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.getByRole('button',{name:'Approve for later'}).click();await expect(page.getByRole('button',{name:'Ask later challenge now'})).toBeDisabled();
  for(let i=0;i<2;i++){
    await page.getByRole('button',{name:'Next question',exact:true}).click();await page.getByRole('button',{name:'Open answers',exact:true}).click();await page.getByRole('button',{name:'Simulate learner answers'}).click();await page.getByRole('button',{name:'Reconsider',exact:true}).click();await page.getByRole('button',{name:'Reveal answer',exact:true}).click();
  }
  await page.getByRole('button',{name:'Ask later challenge now'}).click();await expect(page.getByRole('heading',{name:prompt,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View report',exact:true}).click();await expect(page.locator('thead')).toContainText('Later check · 4');
});

test('30 simultaneous learner requests retain every receipt and isolate board and teacher data', async ({ page, playwright }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'Server load is independent of browser layout.');
  test.setTimeout(90000);
  await signInDisposableTeacher(page,'-moonquest-load');
  const prefix='MQL'+Date.now();
  const roster=await(await page.request.post('/api/roster',{data:{name:'Load test crew',idCol:'id',nameCol:'name',rows:Array.from({length:30},(_,i)=>({id:prefix+i,name:'Learner '+i}))}})).json();
  const image=await sharp({create:{width:200,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();
  const uploaded=await(await page.request.post('/api/games/moonquest/assets',{multipart:{file:{name:'diagram.png',mimeType:'image/png',buffer:image}}})).json();
  const game=await(await page.request.post('/api/games/moonquest/games',{data:{title:'Load mission',reviewed:true,diagrams:[{id:'d',asset:uploaded.asset,regions:[{id:'a',label:'A',points:[[0,0],[.4,0],[.4,1],[0,1]]},{id:'b',label:'B',points:[[.6,0],[1,0],[1,1],[.6,1]]}]}],questions:[{id:'q',diagramId:'d',prompt:'Choose A',concept:'Identify A',accepted:['a'],explanation:'A is the first area.'}]}})).json();
  const session=await(await page.request.post(`/api/games/moonquest/games/${game.game.id}/sessions`,{data:{rosterId:roster.id}})).json();
  const endpoint=`/api/games/moonquest/sessions/${session.id}`;
  const state=async()=>await(await page.request.get(endpoint+'/teacher')).json();
  const clients=await Promise.all(Array.from({length:30},()=>playwright.request.newContext({baseURL:'http://127.0.0.1:4341'})));
  try {
    let room=await state();const handles=await(await clients[0].get('/api/games/moonquest/rooms/'+room.code)).json();
    const tokens=await Promise.all(clients.map(async(c,i)=>{const result=await c.post(endpoint+'/join',{data:{handle:handles.students[i].handle,pin:'4829'}});expect(result.ok()).toBeTruthy();return(await result.json()).token;}));
    const command=async action=>{const s=await state();expect((await page.request.post(endpoint+'/command',{data:{action,seq:s.seq}})).ok()).toBeTruthy();};
    await command('next');await command('open');const times=[];
    await Promise.all(clients.map(async(c,i)=>{const start=Date.now();const r=await c.post(endpoint+'/answer',{headers:{Authorization:'Bearer '+tokens[i]},data:{round:0,phase:'choose',regionId:i<5?'b':'a',eventId:'first-'+i}});times.push(Date.now()-start);expect(r.ok()).toBeTruthy();}));
    expect((await state()).answered).toBe(30);
    await command('advance');
    await Promise.all(clients.map(async(c,i)=>{expect((await c.post(endpoint+'/answer',{headers:{Authorization:'Bearer '+tokens[i]},data:{round:0,phase:'reconsider',regionId:'a',eventId:'final-'+i}})).ok()).toBeTruthy();}));
    await command('advance');room=await state();expect(room.stats.correct).toBe(30);expect(room.stats.improved).toBe(5);
    expect((await clients[0].get(endpoint+'/teacher')).ok()).toBe(false);expect((await clients[0].get(endpoint+'/report')).ok()).toBe(false);
    const report=await(await page.request.get(endpoint+'/report')).json();expect(report.students).toHaveLength(30);expect(report.students.every(s=>s.rounds[0].confirmed)).toBe(true);
    times.sort((a,b)=>a-b);console.log('MoonQuest local 30-client answer acknowledgement p95:',times[Math.floor(times.length*.95)],'ms');
  } finally { await Promise.all(clients.map(c=>c.dispose())); }
});
