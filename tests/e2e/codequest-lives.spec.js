const {test,expect}=require('@playwright/test'),E=require('../../codequest-engine'),C=require('../../public/codequest-core');
test('teacher can choose optional three lives when opening the lobby',async({page})=>{
 let s=null;
 await page.route('**/api/game/lives/codequest**',async r=>{if(r.request().method()==='POST'){const b=r.request().postDataJSON();expect(b.livesEnabled).toBe(true);s=E.create({...b,students:[{id:'a',name:'Mia'},{id:'b',name:'Leo'}]});}await r.fulfill({json:{teacher:true,classes:[{id:'r',name:'Grade 3'}],joinUrl:'/play/lives',state:s?E.view(s,null,true):null}});});
 await page.goto('/codequest.html?game=lives');await expect(page.locator('#livesMode')).toHaveValue('off');await page.locator('#livesMode').selectOption('on');await page.locator('#create').click();await expect(page.locator('#playerSelection')).toContainText('3 lives');
});
test('zero lives close gameplay across reload and later rounds and disable teacher selection',async({page,context})=>{
 const s=E.create({students:['Mia','Leo','Ava','Noah'].map((name,i)=>({id:String(i),name})),livesEnabled:true,preview:true,rounds:10,generated:false,staged:false},Date.now());s.players['0'].livesRemaining=1;E.start(s,Date.now());const pair=s.pairs.find(p=>[p.a,p.b].includes('0'));s.players[pair.a==='0'?pair.b:pair.a].program=C.solve(E.view(s,'0',false).mission);E.tick(s,s.deadline);E.tick(s,s.replayEnd);
 await page.route('**/api/game/lives/codequest**',r=>r.fulfill({json:{teacher:false,preview:true,state:E.view(s,'0',false)}}));await page.goto('/codequest.html?game=lives');await expect(page.locator('#eliminated')).toBeVisible();await expect(page.locator('#livesStatus')).toContainText('0 / 3');await expect(page.locator('#game')).toBeHidden();await expect(page.locator('#join')).not.toBeVisible();await page.reload();await expect(page.locator('#eliminated')).toBeVisible();
 const teacher=await context.newPage();await teacher.route('**/api/game/lives/codequest**',r=>r.fulfill({json:{teacher:true,preview:true,joinUrl:'/play/lives',state:E.view(s,null,true)}}));await teacher.goto('/codequest.html?game=lives');await expect(teacher.locator('#playerSelection input[value="0"]')).toBeDisabled();
 E.start(s,Date.now());await expect(page.locator('#eliminated')).toBeVisible();await expect(page.locator('#game')).toBeHidden();await expect(page.locator('#stage')).toBeHidden();
});
test('lives podium puts the last survivor first, then the latest eliminated pirates',async({page})=>{
 const s=E.create({students:['Mia','Leo','Ava'].map((name,i)=>({id:String(i),name})),livesEnabled:true,preview:true,rounds:10,generated:false},Date.now());s.phase='ended';s.round=5;s.players['0'].wins=1;Object.assign(s.players['1'],{livesRemaining:0,eliminatedRound:3,wins:4});Object.assign(s.players['2'],{livesRemaining:0,eliminatedRound:5,wins:2});
 await page.route('**/api/game/lives/codequest**',r=>r.fulfill({json:{teacher:false,state:E.view(s,'0',false)}}));await page.goto('/codequest.html?game=lives');await expect(page.locator('#podium strong')).toHaveText(['Mia','Ava','Leo']);
});
