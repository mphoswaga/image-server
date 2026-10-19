const {test,expect}=require('@playwright/test');
test('personal feedback, next question and a private colony watch view',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/colonyquest-live/ticket',route=>route.fulfill({json:{token:'test'}}));
 await page.addInitScript(()=>{
  class Socket {static OPEN=1;constructor(){this.readyState=1;window.testSocket=this;setTimeout(()=>this.onopen?.(),0);}send(message){window.lastCommand=JSON.parse(message);}close(){}}
  window.WebSocket=Socket;
  window.pushState=state=>window.testSocket.onmessage({data:JSON.stringify({type:'state',state})});
 });
 await page.goto('/colonyquest-live-play/individual-ui');
 await page.waitForFunction(()=>window.testSocket?.onmessage && window.ColonyQuestCore);
 await page.evaluate(()=>{
  const c=ColonyQuestCore.createTeam({name:'Mia'},0),other=ColonyQuestCore.createTeam({name:'Noah'},1);
  window.nextState={id:'match',pacing:'individual',title:'Habitats',phase:'answer',round:0,total:3,serverNow:Date.now(),deadline:Date.now()+25000,world:{},events:[],players:[{id:'a',name:'Mia',strength:10},{id:'b',name:'Noah',strength:8}],question:{question:'Where do ants live?',options:['Nest','Cloud']},me:{id:'a',name:'Mia',colony:c,choice:null,upgrades:[]}};
  window.otherColony=other;pushState(structuredClone(nextState));
 });
 await page.getByRole('button',{name:'A. Nest',exact:true}).click();
 await expect(page.locator('#instruction')).toHaveText('Saving your answer…');
 await page.evaluate(()=>{nextState.phase='upgrade';nextState.me.choice=0;nextState.me.correct=true;nextState.question.correctIndex=0;nextState.me.upgrades=[{key:'food',label:'Gather food',allowed:true}];pushState(structuredClone(nextState));});
 await expect(page.locator('#question')).toHaveText('Correct! Grow your colony.');
 await page.getByRole('button',{name:/Gather food/}).click();
 await page.evaluate(()=>{nextState.phase='reveal';nextState.me.upgraded=true;nextState.me.lastUpgrade={round:0,key:'food'};nextState.me.colony.food+=5;nextState.me.upgrades=[];pushState(structuredClone(nextState));});
 await expect(page.locator('#instruction')).toContainText('ants are on the move');
 await page.evaluate(()=>{nextState.round=1;nextState.phase='answer';nextState.question={question:'What do ants collect?',options:['Food','Cars']};nextState.me.choice=null;nextState.me.upgraded=false;delete nextState.me.correct;pushState(structuredClone(nextState));});
 await expect(page.locator('#question')).toHaveText('What do ants collect?');
 await page.evaluate(()=>{nextState.phase='spectating';nextState.spectators=[{id:'b',name:'Noah',round:1,finished:false}];pushState(structuredClone(nextState));});
 await expect(page.locator('#question')).toHaveText('Your questions are complete!');
 await page.locator('#watchColony').selectOption('b');
 expect(await page.evaluate(()=>window.lastCommand)).toMatchObject({type:'watch',target:'b',matchId:'match'});
 await page.evaluate(()=>{nextState.watching={id:'b',name:'Noah',colony:otherColony,lastUpgrade:null,events:[]};pushState(structuredClone(nextState));});
 await expect(page.locator('#myName')).toHaveText('Watching Noah');
 await expect(page.locator('#rank')).toHaveText('#2 of 2');
 await expect(page.locator('[data-choice]')).toHaveCount(0);await expect(page.locator('[data-upgrade]')).toHaveCount(0);
 await expect(page.locator('#watchColony')).toHaveValue('b');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('watch-colony.png')});expect(errors).toEqual([]);
});

for (const incoming of [false,true]) test(`individual raid camera follows ${incoming?'incoming':'outgoing'} attacks and resets`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/healthz');
 await page.setContent('<canvas id="world" style="width:100%;height:600px"></canvas>');
 await page.addScriptTag({url:'/colonyquest-core.js'});
 await page.addScriptTag({url:'/colonyquest-live-art.js'});
 await page.evaluate(incoming=>{
  const colony=ColonyQuestCore.createTeam({},0);colony.soldiers=4;
  window.raidScene=new ColonyScene(document.querySelector('canvas'));
  raidScene.update({id:'test',phase:'reveal',pacing:'individual',me:{id:'me',colony},world:{},players:[]});
  raidScene.cue('raid',{event:{attacker:incoming?'rival':'me',target:incoming?'me':'rival',success:true}});
 },incoming);
 await expect.poll(()=>page.evaluate(()=>Number(document.querySelector('canvas').dataset.raidZoom))).toBeGreaterThan(2);
 await expect(page.locator('canvas')).toHaveAttribute('data-raid-phase','clash',{timeout:5000});
 await page.screenshot({path:info.outputPath(incoming?'incoming-raid.png':'outgoing-raid.png')});
 await expect(page.locator('canvas')).toHaveAttribute('data-raid-zoom','1.00',{timeout:6000});
 expect(errors).toEqual([]);
});
