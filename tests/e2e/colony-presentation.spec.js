const {test,expect}=require('@playwright/test');
for(const width of [390,1366])test(`shared multiplayer raid moments are brief, named, and fit ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:740});await page.goto('/healthz');
 await page.setContent('<style>body{margin:0}.colony-stage{position:relative;height:600px}canvas{width:100%;height:100%}</style><section class="colony-stage"><canvas></canvas></section><button id="answer">Answer</button>');
 await page.addStyleTag({url:'/colony-presentation.css'});
 for(const src of ['colonyquest-core','colony-presentation','colonyquest-live-art'])await page.addScriptTag({url:`/${src}.js`});
 await page.evaluate(()=>{
  window.fixture={id:'test',phase:'answer',pacing:'individual',events:[],world:{},me:{id:'a',colony:ColonyQuestCore.createTeam({},0)}};
  window.scene=new ColonyScene(document.querySelector('canvas'));scene.update(structuredClone(fixture));
  fixture.events=[{id:'raid1',kind:'raid',attacker:'a',target:'b',attackerName:'Nguyễn Hoàng Minh',targetName:'Trần Thùy Bảo Trân',stolen:4,success:true}];scene.update(structuredClone(fixture));
 });
 const card=page.locator('.colony-raid-moment');await expect(card).toHaveAttribute('data-moment','versus');await expect(card).toContainText('Nguyễn Hoàng Minh');
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`versus-${width}.png`)});
 await page.evaluate(()=>{const raid=scene.effects.find(e=>e.kind==='raid');scene.clock=raid.start+raid.duration*.55;});
 await expect(card).toBeHidden();await expect(page.locator('canvas')).toHaveAttribute('data-raid-phase','clash');
 await page.evaluate(()=>{const raid=scene.effects.find(e=>e.kind==='raid');scene.clock=raid.start+raid.duration*.8;});
 await expect(card).toHaveAttribute('data-moment','result');await expect(card).toContainText('4 food carried home');
 await expect(card.locator('.is-winner')).toContainText('Nguyễn Hoàng Minh');
 await page.evaluate(()=>{fixture.phase='paused';scene.update(structuredClone(fixture));});
 const clock=await page.evaluate(()=>scene.clock);await page.waitForTimeout(250);expect(await page.evaluate(()=>scene.clock)).toBe(clock);await expect(card).toHaveClass(/is-paused/);
 await page.screenshot({path:info.outputPath(`result-${width}.png`)});
 await page.evaluate(()=>{fixture.phase='answer';scene.update(structuredClone(fixture));const raid=scene.effects.find(e=>e.kind==='raid');scene.clock=raid.start+raid.duration+1;});
 await expect(card).toBeHidden();await expect(page.locator('#answer')).toBeVisible();
 expect(await page.evaluate(()=>fixture.me.colony.food)).toBe(8);
 await page.evaluate(()=>scene.destroy());await expect(card).toHaveCount(0);
});
