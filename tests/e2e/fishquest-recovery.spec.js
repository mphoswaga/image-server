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

test('FishQuest names the winner while showing only the learner own result', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100', 'One desktop browser covers the private ending screen.');
  await page.route('**/api/game/ending-test', route => route.fulfill({ json: { lessonTitle: 'Ocean lesson', hasRoster: false } }));
  await page.route('**/api/game/ending-test/fishquest/ticket', route => route.fulfill({ json: { token: 'ending-ticket' } }));
  await page.addInitScript(() => {
    window.testSockets=[];
    window.WebSocket=class {
      static OPEN=1;static CLOSING=2;
      constructor(){this.readyState=0;this.bufferedAmount=0;window.testSockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
      send(){}
      close(){this.readyState=3;}
      receive(state){this.onmessage?.({data:JSON.stringify({type:'state',state})});}
    };
  });
  await page.goto('/fishquest-play/ending-test');
  await expect.poll(()=>page.evaluate(()=>window.testSockets.length)).toBe(1);
  await page.evaluate(() => {
    Phaser.Game=function(){};
    window.testSockets[0].receive({
      matchId:'finished-match',phase:'ended',resultsSaved:true,me:'me',now:Date.now(),endsAt:Date.now(),
      players:[
        {id:'me',name:'Lebo',mass:180,score:125,variant:0},
        {id:'winner',name:'Amina',mass:260,score:200,variant:1},
      ],
      personal:{correct:3,answered:4,coverage:4,collections:17,swallows:1},
      food:[],world:{width:2400,height:1600},
    });
  });
  await expect(page.locator('#ended')).toBeVisible();
  await expect(page.locator('#winnerLine')).toHaveText('Amina won this game.');
  await expect(page.locator('#rank')).toContainText('place 2 of 2');
  await expect(page.locator('#finalScore')).toHaveText('125 points');
  await expect(page.locator('#endFacts')).toContainText('3/4');
  await expect(page.locator('#endFacts')).toContainText('17');
  await expect(page.locator('#ended')).not.toContainText('200 points');
  await page.screenshot({ path: `/tmp/fishquest-ending-${testInfo.project.name}.png` });
});

test('defender sees the shared question read-only and the respawn countdown', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'windows-100');
  await page.route('**/api/game/defender-test', r=>r.fulfill({json:{lessonTitle:'Ocean',hasRoster:false}}));
  await page.route('**/api/game/defender-test/fishquest/ticket', r=>r.fulfill({json:{token:'ticket'}}));
  await page.addInitScript(()=>{
    window.testSockets=[];
    window.WebSocket=class {
      static OPEN=1;static CLOSING=2;
      constructor(){this.readyState=0;this.bufferedAmount=0;this.messages=[];window.testSockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.();},0);}
      send(v){this.messages.push(JSON.parse(v));} close(){this.readyState=3;}
      receive(state){this.onmessage?.({data:JSON.stringify({type:'state',state})});}
    };
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/fishquest-play/defender-test');
  await expect.poll(()=>page.evaluate(()=>window.testSockets.length)).toBe(1);
  await page.evaluate(()=>{
    Phaser.Game=function(){};
    window.defenderState={matchId:'m',phase:'running',me:'me',now:Date.now(),endsAt:Date.now()+600000,
      players:[{id:'me',name:'Defender',mass:100,score:0,variant:0}],food:[],world:{width:2400,height:1600},
      question:{id:'q',prompt:'Two plus two?',options:['3','4'],expiresAt:Date.now()+30000,canAnswer:false,attackerName:'Amina'}};
    window.testSockets[0].receive(window.defenderState);
  });
  await expect(page.locator('#qrole')).toContainText('Amina');
  await expect(page.locator('#prompt')).toHaveText('Two plus two?');
  await expect(page.locator('#options button').first()).toBeDisabled();
  await expect(page.locator('#options button').last()).toBeDisabled();
  await page.screenshot({path:'/tmp/fishquest-defender.png'});
  await page.evaluate(()=>{
    delete window.defenderState.question;
    window.defenderState.respawnAt=Date.now()+3000;
    window.defenderState.event={id:'q',outcome:'correct',attacker:'other',victim:'me'};
    window.testSockets[0].receive(window.defenderState);
  });
  await expect(page.locator('#question')).toBeHidden();
  await expect(page.locator('#encounterStatus')).toContainText('Returning in');
  expect(await page.evaluate(()=>window.testSockets[0].messages.filter(m=>m.type==='answer'))).toEqual([]);
  expect(errors).toEqual([]);
});
