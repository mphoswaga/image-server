const {test,expect}=require('@playwright/test'),pptxgen=require('pptxgenjs');
const {signInDisposableTeacher,expectNoPageOverflow}=require('./helpers');
async function create(page){
 await page.route('**/blockquest/voice?*',r=>r.fulfill({contentType:'audio/mpeg',body:Buffer.from('test voice')}));
 await signInDisposableTeacher(page,'-blockquest');const pptx=new pptxgen();pptx.addSlide().addText('Computers have screens.',{x:1,y:1,w:5,h:1});
 const r=await page.request.post('/api/game/from-pptx',{multipart:{file:{name:'devices.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await pptx.write({outputType:'nodebuffer'})},subject:'ICT',topic:'Devices',grade:'Grade 2',questionCount:'4',mode:'arcade'}});expect(r.ok(),await r.text()).toBeTruthy();const {gameId}=await r.json();
 expect((await page.request.patch(`/api/game/${gameId}/questions`,{data:{questions:[{question:'Which device shows pictures?',options:['Monitor','Keyboard'],correctIndex:0,explanation:'A monitor shows pictures.'},{question:'Which device types letters?',options:['Mouse','Keyboard'],correctIndex:1}]}})).ok()).toBeTruthy();return gameId;
}
for(const solo of [false,true])test(`${solo?'solo':'smartboard'} answer, choose, rotate, place, resume and celebrate`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const id=await create(page);
 await page.goto(`/blockquest.html?game=${id}${solo?'&mode=solo':''}`);await page.locator('#start').click();
 await expect(page.locator('.tower')).toHaveCount(solo?1:2);await expect(page.locator('#question')).toContainText('Which device shows pictures?');await expect(page.locator('#countdown')).toBeVisible();await expect(page.locator('#seconds')).toHaveText(/^(20|19)$/);await expect(page.locator('.moving-block')).toHaveCount(0);await page.screenshot({path:info.outputPath('answer-countdown.png'),fullPage:true});if(info.project.name==='windows-100'){const box=await page.locator('#answers').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(768);}
 await page.locator('#answers button').first().click();await expect(page.locator('#phase')).toContainText('Correct');await expect(page.locator('.piece')).toHaveCount(3);await expect(page.locator('.moving-block')).toHaveCount(1);await expect(page.locator('#seconds')).toHaveText(/^(15|14)$/);
 await page.locator('#rotate').click();if(await page.locator('#place').isDisabled())await page.locator('#left').click();await page.locator('#place').click();
 await expect(page.locator('#phase')).toContainText('tower');await expect(page.locator('.tower.active')).toContainText('110 points');await page.screenshot({path:info.outputPath('block-placement.png'),fullPage:true});
 await page.reload();await page.locator('#resume').click();await expect(page.locator('.tower.active')).toContainText('110 points');
 await expect(page.locator('#question')).toContainText('Which device types letters?');await page.locator('#answers button').first().click();await expect(page.locator('#celebration')).toBeVisible();
 expect(errors).toEqual([]);await expectNoPageOverflow(page);
});
test('server protects board access, rejects forged rewards and duplicate answers',async({page,browser})=>{
 const id=await create(page),url=`/api/game/${id}/blockquest`;
 let s=await(await page.request.post(url,{data:{action:'start'}})).json();expect(s.questions).toBeUndefined();expect(s.question.correctIndex).toBeUndefined();
 const version=s.revision;const good=await page.request.post(url,{data:{action:'answer',revision:version,choice:0}});expect(good.ok()).toBeTruthy();
 expect((await page.request.post(url,{data:{action:'answer',revision:version,choice:0}})).ok()).toBeFalsy();
 const outsider=await browser.newContext();try{expect((await outsider.request.get(new URL(url,page.url()).href)).status()).toBe(401);}finally{await outsider.close();}
 s=await good.json();expect((await page.request.post(url,{data:{action:'move',revision:s.revision,shape:'FAKE',rotation:0,column:0}})).ok()).toBeFalsy();
});

test('learner solo progress is private, cannot use teacher controls, and saves learning evidence',async({page,browser})=>{
 const id=await create(page),origin=new URL(page.url()).origin;const context=await browser.newContext();
 try{
  const entered=await context.request.post(`${origin}/api/game/${id}/enter`,{data:{studentId:'BLOCK-STUDENT',name:'Mia',pin:'1234'}});expect(entered.ok(),await entered.text()).toBeTruthy();
  const url=`${origin}/api/game/${id}/blockquest`;
  expect((await context.request.get(url+'?test=1')).status()).toBe(403);
  let s=await(await context.request.post(url,{data:{action:'start'}})).json();expect(s.mode).toBe('solo');expect(s.learner).toBe('Mia');
  expect((await context.request.post(url,{data:{action:'finish',revision:s.revision}})).ok()).toBeFalsy();
  for(let round=0;round<2;round++){
   s=await(await context.request.post(url,{data:{action:'answer',revision:s.revision,choice:round===0?1:0}})).json();
   await page.waitForTimeout(2600);s=(await(await context.request.get(url)).json()).state;
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
 let s=await command('start');s=await command('answer',s,{choice:0});const first=s.choices.slice();expect(s.pieceRounds).toBeUndefined();
 s=await command('place',s,{shape:first[0],rotation:0,column:0});await page.waitForTimeout(1050);s=(await(await page.request.get(url)).json()).state;
 const resumed=await(await page.request.get(url)).json();expect(resumed.state.turn).toBe(1);
 s=await command('answer',resumed.state,{choice:1});expect(s.choices).toEqual(first);
});

for(const reduced of [false,true])test(`two-row clear builds a rocket and keeps controls visible (${reduced?'reduced':'full'} motion)`,async({page},info)=>{
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 const core=require('../../public/blockquest-core'),board=core.empty();for(const y of [8,9])board[y]=['T','T','T','T','T','T',null,null];board[7][0]='S';
 const result=core.place(board,'O',0,6);let snapshot;
 await page.route('**/api/game/rocket/blockquest',r=>{
  const now=Date.now();snapshot ||= {id:'rocket',mode:'board',phase:'placing',revision:3,turn:0,total:4,active:0,learner:'Mia',answers:[{correct:true}],lastBefore:board,lastDrop:{...core.landing(board,'O',0,6),shape:'O'},lastPlacement:[8,9],lastLinesBefore:1,lastAward:{points:result.points,bonus:result.bonus},placementStartedAt:now,readyAt:now+3400,serverNow:now,teams:[{name:'Sun Builders',board:result.board,points:260,lines:3,names:['Mia']},{name:'Moon Builders',board:core.empty(),points:0,lines:0,names:['Noah']}]};
  return r.fulfill({json:{teacher:true,board:true,title:'Rocket builders',state:{...snapshot,serverNow:now}}});
 });
 await page.goto('/blockquest.html?game=rocket');await page.locator('#resume').click();
 await expect(page.locator('#phase')).toContainText('2 rows! +260 points · 50 combo bonus');
 await expect(page.locator('.tower.active .rocket-build')).toHaveAttribute('data-mission-stage','1');await expect(page.locator('#next')).toBeDisabled();await expect(page.locator('.clear-beam')).toHaveCount(2);await expect(page.locator('.clear-award')).toContainText('2 ROW COMBO');
 if(!reduced){await expect(page.locator('.cell.clearing')).toHaveCount(16);await expect(page.locator('.row-party i')).toHaveCount(16);}
 await page.waitForTimeout(1050);await page.screenshot({path:info.outputPath('row-celebration.png'),fullPage:true});
 await expect(page.locator('.tower.active .rocket-build')).toHaveAttribute('data-mission-stage','3');
 await expect(page.locator('.tower.active .grid .cell.S')).toHaveCount(1);
 if(reduced)expect(await page.locator('.launching svg').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.screenshot({path:info.outputPath('rocket-built.png'),fullPage:true});
 await expect(page.locator('#next')).toBeEnabled();await expectNoPageOverflow(page);
 if(info.project.name==='windows-100')expect((await page.locator('#next').boundingBox()).y+44).toBeLessThanOrEqual(768);
});

test('long questions expand upward between tall side boards',async({page},info)=>{
 test.skip(!['windows-100','windows-150'].includes(info.project.name),'Desktop side-board layout');
 const core=require('../../public/blockquest-core'),question='A class is making a digital poster about animals. Which action helps you add a picture to your document while keeping the words easy to read?';
 await page.route('**/api/game/layout/blockquest',r=>r.fulfill({json:{teacher:true,board:true,title:'Layout preview',state:{id:'layout',phase:'answer',revision:1,mode:'board',turn:0,total:4,active:0,learner:'Nguyễn Minh Anh',answers:[],teams:['Sun Builders','Moon Builders'].map(name=>({name,board:core.empty(),points:0,lines:0,names:['Minh']})),question:{question,options:['Insert an image and resize it carefully so the words remain visible.','Cover every word with a very large image.','Delete the document and start a different task.','Make the words the same colour as the background.']}}}}));
 await page.goto('/blockquest.html?game=layout');await page.locator('#voice').click();await page.locator('#resume').click();
 const left=await page.locator('.tower').first().boundingBox(),right=await page.locator('.tower').last().boundingBox(),dock=await page.locator('.dock').boundingBox(),choices=await page.locator('#answers').boundingBox();
 expect(left.x+left.width).toBeLessThan(dock.x);expect(dock.x+dock.width).toBeLessThan(right.x);expect(left.height).toBeGreaterThan(300);expect(Math.abs(dock.y+dock.height-left.y-left.height)).toBeLessThan(3);expect(choices.y+choices.height).toBeLessThanOrEqual(page.viewportSize().height);
 await expectNoPageOverflow(page);await page.screenshot({path:info.outputPath('long-question-side-boards.png'),fullPage:true});
});

test('returning teacher can resume, cancel restart, or restart from question one',async({page})=>{
 const id=await create(page),url=`/api/game/${id}/blockquest`;
 await page.goto(`/blockquest.html?game=${id}`);await page.locator('#start').click();await page.locator('#answers button').first().click();
 const old=(await(await page.request.get(url)).json()).state.id;
 await page.reload();await expect(page.locator('#resume')).toBeVisible();await expect(page.locator('#restart')).toBeVisible();
 page.once('dialog',d=>d.dismiss());await page.locator('#restart').click();await expect(page.locator('#resume')).toBeVisible();expect((await(await page.request.get(url)).json()).state.id).toBe(old);
 page.once('dialog',d=>d.accept());await page.locator('#restart').click();await expect(page.locator('#question')).toContainText('Which device shows pictures?');await expect(page.locator('#seconds')).toHaveText(/^(20|19)$/);
 const state=(await(await page.request.get(url)).json()).state;expect(state.id).not.toBe(old);expect(state.answers).toEqual([]);expect(state.teams.every(t=>t.points===0)).toBe(true);
});

test('teacher can test both smartboard teams without changing the real game',async({page})=>{
 const id=await create(page),url=`/api/game/${id}/blockquest`;
 await page.goto(`/blockquest.html?game=${id}`);await expect(page.locator('#testBoard')).toBeVisible();await page.locator('#start').click();const real=(await(await page.request.get(url)).json()).state;
 await page.goto(`/blockquest.html?game=${id}&test=1`);await expect(page.locator('#setupHint')).toContainText('no learner marks saved');await page.locator('#start').click();await expect(page.locator('.tower')).toHaveCount(2);await expect(page.locator('#turn')).toContainText('(demo)');await expect(page.locator('#progress')).toContainText('Test');
 await page.locator('#answers button').first().click();await page.locator('#place').click();await expect(page.locator('#turn')).toContainText('Moon Builders');await page.locator('#answers button').first().click();await expect(page.locator('#celebration')).toBeVisible();await expect(page.locator('#learning')).toContainText('no learner marks saved');
 expect((await(await page.request.get(url)).json()).state.id).toBe(real.id);expect((await(await page.request.get(url)).json()).state.answers).toEqual([]);
 const results=await(await page.request.get(`/api/game/${id}/results`)).json();expect(results.results).toEqual([]);
});

test('BlockQuest controls use versioned assets and bypass stale browser caches',async({request})=>{
 const html=await request.get('/blockquest.html');expect(html.headers()['cache-control']).toContain('no-store');const body=await html.text();expect(body).toContain('/blockquest.js?v=8');expect(body).toContain('/blockquest.css?v=8');
 for(const path of ['/blockquest-motion.js?v=1','/blockquest-world.js?v=2','/blockquest-world.css?v=2','/blockquest.js?v=8','/blockquest-core.js?v=8','/blockquest-audio.js?v=8','/blockquest.css?v=8','/blockquest-neon.css?v=8','/games-hub.js?v=4']){const response=await request.get(path);expect(response.ok()).toBe(true);expect(response.headers()['cache-control']).toContain('no-store');expect(response.headers()['cloudflare-cdn-cache-control']).toBe('no-store');}
});

function pulsingSoundtrack(){
 const rate=22050,frames=rate*3,buffer=Buffer.alloc(44+frames*2);
 buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++){const t=i/rate,beat=t%1,amplitude=beat<.38?.8:.001;buffer.writeInt16LE(Math.round(Math.sin(2*Math.PI*110*t)*amplitude*32767),44+i*2);}return buffer;
}
test('neon glow follows actual music and stops for mute, pause and reduced motion',async({page})=>{
 test.setTimeout(45000);const core=require('../../public/blockquest-core');let state;
 await page.route('**/assets/colonyquest/music/*.mp3',r=>r.fulfill({contentType:'audio/wav',body:pulsingSoundtrack()}));
 await page.route('**/api/game/pulse/blockquest',r=>{
  const now=Date.now();state ||= {id:'pulse',timed:true,mode:'board',phase:'answer',revision:1,turn:0,total:4,active:0,learner:'Mia',answers:[],deadline:now+20000,phaseStartedAt:now,answerPreview:'T',teams:['Sun Builders','Moon Builders'].map(name=>({name,board:core.empty(),points:0,lines:0,names:['Mia']})),question:{question:'Which device shows pictures?',options:['Monitor','Keyboard']}};
  if(r.request().method()==='POST'){const b=r.request().postDataJSON();if(b.action==='pause'){state.phase=state.phase==='paused'?'answer':'paused';state.beforePause='answer';state.pausedAt=now;state.revision++;}return r.fulfill({json:{...state,serverNow:now}});}
  return r.fulfill({json:{teacher:true,board:true,title:'Music test',state:{...state,serverNow:now}}});
 });
 await page.goto('/blockquest.html?game=pulse');await page.locator('#voice').click();await page.locator('#resume').click();
 await expect(page.locator('html')).toHaveAttribute('data-music-pulse','on');
 const levels=await page.evaluate(async()=>{const values=[];for(let i=0;i<50;i++){values.push(Number(document.documentElement.style.getPropertyValue('--music-pulse')));await new Promise(r=>setTimeout(r,50));}return values;});
 expect(Math.max(...levels)).toBeGreaterThan(.08);expect(Math.max(...levels)-Math.min(...levels)).toBeGreaterThan(.04);
 await page.locator('#music').click();await expect(page.locator('html')).toHaveAttribute('data-music-pulse','off');expect(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--music-pulse'))).toBe('0');
 await page.locator('#music').click();await expect(page.locator('html')).toHaveAttribute('data-music-pulse','on');
 await page.locator('#pause').click();await expect(page.locator('html')).toHaveAttribute('data-music-pulse','off');await page.locator('#pause').click();await expect(page.locator('html')).toHaveAttribute('data-music-pulse','on');
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('html')).toHaveAttribute('data-music-pulse','off');await page.emulateMedia({reducedMotion:'no-preference'});await expect(page.locator('html')).toHaveAttribute('data-music-pulse','on');
 // Verify the bundled production soundtrack also drives the analyser, not just the fixture.
 await page.unroute('**/assets/colonyquest/music/*.mp3');
 await page.evaluate(async()=>{const music=document.querySelector('[data-colony-music]');music.pause();music.src='/assets/colonyquest/music/toys-are-us-blue-deer-studio.mp3';await music.play();});
 await expect.poll(()=>page.evaluate(()=>Number(document.documentElement.style.getPropertyValue('--music-pulse')))).toBeGreaterThan(.02);
});

test('large answer timer gives one warning beep per second from ten and respects pause and sound off',async({page})=>{
 const core=require('../../public/blockquest-core');let state;
 await page.route('**/api/game/warnings/blockquest',r=>{
  const now=Date.now();state ||= {id:'warnings',timed:true,mode:'board',phase:'answer',revision:1,turn:0,total:2,active:0,learner:'Mia',answers:[],deadline:now+12000,phaseStartedAt:now-8000,teams:['Sun Builders','Moon Builders'].map(name=>({name,board:core.empty(),points:0,lines:0,names:['Mia']})),question:{question:'Which device shows pictures?',options:['Monitor','Keyboard']}};
  if(r.request().method()==='POST'){
   if(state.phase==='paused'){state.deadline+=now-state.pausedAt;state.phase='answer';}else{state.phase='paused';state.beforePause='answer';state.pausedAt=now;}state.revision++;return r.fulfill({json:{...state,serverNow:now}});
  }
  return r.fulfill({json:{teacher:true,board:true,title:'Countdown test',state:{...state,serverNow:now}}});
 });
 await page.goto('/blockquest.html?game=warnings');await page.locator('#voice').click();
 await page.evaluate(()=>{window.warningBeeps=[];const original=BlockQuestAudio.prototype.cue;BlockQuestAudio.prototype.cue=function(kind){if(kind==='warning'&&this.enabled)window.warningBeeps.push(document.getElementById('seconds').textContent);return original.call(this,kind);};});
 await page.locator('#resume').click();await expect(page.locator('#seconds')).toHaveText('11');expect(await page.evaluate(()=>window.warningBeeps)).toEqual([]);await expect(page.locator('.moving-block')).toHaveCount(0);
 const clock=await page.locator('#countdown').boundingBox();expect(clock.width).toBeGreaterThanOrEqual(80);expect(Number.parseFloat(await page.locator('#seconds').evaluate(el=>getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(39);
 await expect(page.locator('#seconds')).toHaveText('10');await expect(page.locator('#countdown')).toHaveClass(/urgent/);await expect.poll(()=>page.evaluate(()=>window.warningBeeps)).toEqual(['10']);
 await expect(page.locator('#seconds')).toHaveText('9');expect(await page.evaluate(()=>window.warningBeeps)).toEqual(['10','9']);
 await page.locator('#pause').click();await page.waitForTimeout(1200);expect(await page.evaluate(()=>window.warningBeeps)).toEqual(['10','9']);
 await page.locator('#sound').click();await page.locator('#pause').click();await expect(page.locator('#seconds')).toHaveText('8');expect(await page.evaluate(()=>window.warningBeeps)).toEqual(['10','9']);
});
