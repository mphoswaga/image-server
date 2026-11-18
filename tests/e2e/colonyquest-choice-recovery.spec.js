const {test,expect}=require('@playwright/test');
test('a missed answer acknowledgement retries the same choice without duplicate reward',async({page})=>{
 await page.route('**/colonyquest-live/ticket',r=>r.fulfill({json:{token:'test'}}));
 await page.addInitScript(()=>{class Socket{static OPEN=1;constructor(){this.readyState=1;window.testSocket=this;window.sent=[];setTimeout(()=>this.onopen?.(),0);}send(raw){const msg=JSON.parse(raw);sent.push(msg);if(msg.type==='ping')this.onmessage?.({data:JSON.stringify({type:'pong'})});}close(){}}window.WebSocket=Socket;});
 await page.goto('/colonyquest-live-play/recovery');await page.waitForFunction(()=>testSocket?.onmessage);
 await page.evaluate(()=>{const c=ColonyQuestCore.createTeam({name:'Mia'},0);testSocket.onmessage({data:JSON.stringify({type:'state',state:{id:'match',phase:'answer',pacing:'individual',round:10,total:20,serverNow:Date.now(),deadline:Date.now()+45000,world:{},events:[],players:[],me:{id:'a',name:'Mia',colony:c,choice:null,upgrades:[],upgraded:false},question:{question:'Question 11: Where do ants live?',options:['Nest','Car']}}})});});
 await page.locator('[data-choice="0"]').click();
 await expect.poll(()=>page.evaluate(()=>sent.filter(m=>m.type==='answer').length),{timeout:12000}).toBeGreaterThan(1);
 const choices=await page.evaluate(()=>sent.filter(m=>m.type==='answer'));expect(choices[0].commandId).toBe(choices[1].commandId);expect(choices[1].round).toBe(10);expect(choices[1].choice).toBe(0);
 await page.evaluate(() => {
   ColonyRaidStory.prototype.sync = function () {
     this.node.hidden = false;
     document.body.classList.add('raid-story-active');
     throw new Error('Simulated raid presentation failure');
   };
   const colony = ColonyQuestCore.createTeam({name:'Mia'},0);
   testSocket.onmessage({data:JSON.stringify({type:'state',state:{
     id:'match',phase:'answer',pacing:'individual',round:11,total:20,
     serverNow:Date.now(),deadline:Date.now()+45000,world:{},events:[],players:[],
     me:{id:'a',name:'Mia',colony,choice:null,upgrades:[],upgraded:false},
     question:{question:'Question 12: What do ants collect?',options:['Seeds','Cars']},
   }})});
 });
 await expect(page.locator('#question')).toHaveText('Question 12: What do ants collect?');
 await expect(page.locator('.raid-story')).toBeHidden();
 await page.getByRole('button',{name:'A. Seeds'}).click();
 expect(await page.evaluate(()=>sent.filter(m=>m.type==='answer').at(-1).round)).toBe(11);
});
