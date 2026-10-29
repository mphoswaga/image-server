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
