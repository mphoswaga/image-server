const { test, expect } = require('@playwright/test');

test('FishQuest updates paused questions and recovers a silent connection without tab takeover loops', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One desktop browser covers the connection state machine.');
  await page.clock.install();
  await page.route('**/api/game/recovery-test', route => route.fulfill({json:{lessonTitle:'Recovery test',hasRoster:false}}));
  await page.route('**/api/game/recovery-test/fishquest/ticket', route => route.fulfill({json:{token:'test-ticket'}}));
  await page.addInitScript(() => {
    window.testSockets=[];
    window.WebSocket=class {
      static OPEN=1;static CLOSING=2;
      constructor(){this.readyState=0;this.bufferedAmount=0;this.messages=[];window.testSockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
      send(value){this.messages.push(JSON.parse(value));}
      close(code=1000){this.readyState=3;this.onclose?.({code});}
      receive(state){this.onmessage?.({data:JSON.stringify({type:'state',state})});}
    };
  });
  await page.goto('/fishquest-play/recovery-test');
  await expect.poll(()=>page.evaluate(()=>window.testSockets.length)).toBe(1);
  await page.evaluate(()=>{
    Phaser.Game=function(){};
    window.testState={matchId:'match',phase:'running',me:'me',now:Date.now(),endsAt:Date.now()+600000,
      players:[{id:'me',name:'Learner',mass:100,score:0,variant:0}],food:[],world:{width:2400,height:1600},
      question:{id:'question',prompt:'Choose yes',options:['Yes','No'],expiresAt:Date.now()+30000}};
    window.testSockets[0].receive(window.testState);
  });
  await expect(page.locator('#prompt')).toHaveText('Choose yes');
  await page.evaluate(()=>{
    window.testState.phase='paused';window.testState.pausedAt=Date.now();
    window.testSockets[0].receive(window.testState);
  });
  await page.clock.fastForward(500);
  await expect(page.locator('#qtime')).toHaveText('Paused');
  await page.evaluate(()=>{
    window.testState.phase='running';window.testState.now=Date.now();
    window.testState.question.expiresAt=Date.now()+55000;
    window.testSockets[0].receive(window.testState);
  });
  await page.clock.fastForward(500);
  await expect(page.locator('#qtime')).toContainText('55 seconds');
  await page.getByRole('button',{name:'Yes',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.testSockets[0].messages.some(m=>m.type==='answer'&&m.choice===0))).toBe(true);
  await page.clock.fastForward(16000);
  await expect.poll(()=>page.evaluate(()=>window.testSockets.length)).toBe(2);
  await page.evaluate(()=>window.testSockets.at(-1).close(4002));
  await expect(page.locator('#waitText')).toContainText('another device');
  await page.clock.fastForward(60000);
  expect(await page.evaluate(()=>window.testSockets.length)).toBe(2);
});
