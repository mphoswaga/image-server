const {test,expect}=require('@playwright/test'),pptxgen=require('pptxgenjs');
const {signInDisposableTeacher,expectNoPageOverflow}=require('./helpers');
async function create(page){
 await signInDisposableTeacher(page,'-blockquest');const pptx=new pptxgen();pptx.addSlide().addText('Computers have screens.',{x:1,y:1,w:5,h:1});
 const r=await page.request.post('/api/game/from-pptx',{multipart:{file:{name:'devices.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await pptx.write({outputType:'nodebuffer'})},subject:'ICT',topic:'Devices',grade:'Grade 2',questionCount:'4',mode:'arcade'}});expect(r.ok(),await r.text()).toBeTruthy();const {gameId}=await r.json();
 expect((await page.request.patch(`/api/game/${gameId}/questions`,{data:{questions:[{question:'Which device shows pictures?',options:['Monitor','Keyboard'],correctIndex:0,explanation:'A monitor shows pictures.'},{question:'Which device types letters?',options:['Mouse','Keyboard'],correctIndex:1}]}})).ok()).toBeTruthy();return gameId;
}
for(const solo of [false,true])test(`${solo?'solo':'smartboard'} answer, choose, rotate, place, resume and celebrate`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const id=await create(page);
 await page.goto(`/blockquest.html?game=${id}${solo?'&mode=solo':''}`);await page.locator('#start').click();
 await expect(page.locator('.tower')).toHaveCount(solo?1:2);await expect(page.locator('#question')).toContainText('Which device shows pictures?');
 await page.locator('#answers button').first().click();await expect(page.locator('#explanation')).toContainText('Monitor');await page.locator('#next').click();await expect(page.locator('.piece')).toHaveCount(3);
 await page.locator('#rotate').click();if(await page.locator('#place').isDisabled())await page.locator('#left').click();await page.locator('#place').click();
 await expect(page.locator('#phase')).toContainText('tower');await expect(page.locator('.tower.active')).toContainText('10 points');await page.screenshot({path:info.outputPath('block-placement.png'),fullPage:true});
 await page.reload();await page.locator('#resume').click();await expect(page.locator('.tower.active')).toContainText('10 points');await page.locator('#next').click();
 await expect(page.locator('#question')).toContainText('Which device types letters?');await page.locator('#answers button').first().click();await page.locator('#next').click();await expect(page.locator('#celebration')).toBeVisible();
 expect(errors).toEqual([]);await expectNoPageOverflow(page);
});
test('server protects board access, rejects forged rewards and duplicate answers',async({page,browser})=>{
 const id=await create(page),url=`/api/game/${id}/blockquest`;
 let s=await(await page.request.post(url,{data:{action:'start'}})).json();expect(s.questions).toBeUndefined();expect(s.question.correctIndex).toBeUndefined();
 const version=s.revision;const good=await page.request.post(url,{data:{action:'answer',revision:version,choice:0}});expect(good.ok()).toBeTruthy();
 expect((await page.request.post(url,{data:{action:'answer',revision:version,choice:0}})).ok()).toBeFalsy();
 const outsider=await browser.newContext();try{expect((await outsider.request.get(new URL(url,page.url()).href)).status()).toBe(401);}finally{await outsider.close();}
 s=await good.json();expect((await page.request.post(url,{data:{action:'place',revision:s.revision,shape:'I',rotation:0,column:0}})).ok()).toBeFalsy();
});

test('learner solo progress is private, cannot use teacher controls, and saves learning evidence',async({page,browser})=>{
 const id=await create(page),origin=new URL(page.url()).origin;const context=await browser.newContext();
 try{
  const entered=await context.request.post(`${origin}/api/game/${id}/enter`,{data:{studentId:'BLOCK-STUDENT',name:'Mia',pin:'1234'}});expect(entered.ok(),await entered.text()).toBeTruthy();
  const url=`${origin}/api/game/${id}/blockquest`;
  let s=await(await context.request.post(url,{data:{action:'start'}})).json();expect(s.mode).toBe('solo');expect(s.learner).toBe('Mia');
  expect((await context.request.post(url,{data:{action:'finish',revision:s.revision}})).ok()).toBeFalsy();
  for(let round=0;round<2;round++){
   s=await(await context.request.post(url,{data:{action:'answer',revision:s.revision,choice:round===0?1:0}})).json();
   s=await(await context.request.post(url,{data:{action:'next',revision:s.revision}})).json();
  }
  expect(s.phase).toBe('ended');
  const teacher=await(await page.request.get(`/api/game/${id}/blockquest`)).json();expect(teacher.state).toBeNull();
  const results=await(await page.request.get(`/api/game/${id}/results`)).json();
  expect(JSON.stringify(results)).toContain('BLOCK-STUDENT');expect(results.results.find(r=>r.studentId==='BLOCK-STUDENT')).toMatchObject({score:0,total:2});expect(results.questionStats.every(q=>q.answered===1&&q.correct===0)).toBe(true);
 }finally{await context.close();}
});

test('corresponding team turns get the same offer after a refresh',async({page})=>{
 const id=await create(page),url=`/api/game/${id}/blockquest`;
 const command=async(action,s,extra={})=>{const r=await page.request.post(url,{data:{action,revision:s?.revision,...extra}});expect(r.ok(),await r.text()).toBeTruthy();return r.json();};
 let s=await command('start');s=await command('answer',s,{choice:0});s=await command('next',s);const first=s.choices.slice();expect(s.pieceRounds).toBeUndefined();
 s=await command('place',s,{shape:first[0],rotation:0,column:0});await page.waitForTimeout(1050);s=await command('next',s);
 const resumed=await(await page.request.get(url)).json();expect(resumed.state.turn).toBe(1);
 s=await command('answer',resumed.state,{choice:1});s=await command('next',s);expect(s.choices).toEqual(first);
});

for(const reduced of [false,true])test(`two-row clear builds a rocket and keeps controls visible (${reduced?'reduced':'full'} motion)`,async({page},info)=>{
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 const core=require('../../public/blockquest-core'),board=core.empty();for(const y of [8,9])board[y]=['T','T','T','T','T','T',null,null];board[7][0]='S';
 const result=core.place(board,'O',0,6);let snapshot;
 await page.route('**/api/game/rocket/blockquest',r=>{
  const now=Date.now();snapshot={id:'rocket',mode:'board',phase:'placing',revision:3,turn:0,total:4,active:0,learner:'Mia',answers:[{correct:true}],lastBefore:board,lastDrop:{...core.landing(board,'O',0,6),shape:'O'},lastPlacement:[8,9],lastLinesBefore:1,lastAward:{points:result.points,bonus:result.bonus},placementStartedAt:now,readyAt:now+2700,serverNow:now,teams:[{name:'Sun Builders',board:result.board,points:260,lines:3,names:['Mia']},{name:'Moon Builders',board:core.empty(),points:0,lines:0,names:['Noah']}]};
  return r.fulfill({json:{teacher:true,board:true,title:'Rocket builders',state:snapshot}});
 });
 await page.goto('/blockquest.html?game=rocket');await page.locator('#resume').click();
 await expect(page.locator('#phase')).toContainText('2 rows! +260 points · 50 combo bonus');
 await expect(page.locator('.tower.active .rocket-build')).toHaveAttribute('data-mission-stage','1');await expect(page.locator('#next')).toBeDisabled();
 if(!reduced){await expect(page.locator('.cell.clearing')).toHaveCount(16);await expect(page.locator('.row-party i')).toHaveCount(16);}
 await page.waitForTimeout(1050);await page.screenshot({path:info.outputPath('row-celebration.png'),fullPage:true});
 await expect(page.locator('.tower.active .rocket-build')).toHaveAttribute('data-mission-stage','3');
 await expect(page.locator('.tower.active .grid .cell.S')).toHaveCount(1);
 if(reduced)expect(await page.locator('.launching svg').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.screenshot({path:info.outputPath('rocket-built.png'),fullPage:true});
 await expect(page.locator('#next')).toBeEnabled();await expectNoPageOverflow(page);
 if(info.project.name==='windows-100')expect((await page.locator('#next').boundingBox()).y+44).toBeLessThanOrEqual(768);
});
