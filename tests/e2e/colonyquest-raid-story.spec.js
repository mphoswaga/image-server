const {test,expect}=require('@playwright/test');
const event={id:'raid-one',attacker:'a',target:'b',attackerName:'Mia',targetName:'Leo',success:true,stolen:5,attackerFoodChange:5,targetFoodChange:-5};
async function open(page){await page.goto('/healthz');await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="learner"><section class="colony-stage"></section><section id="decision">Choose your next action</section></main>');await page.addStyleTag({url:'/colonyquest-raid-story.css'});await page.addScriptTag({url:'/colonyquest-raid-story.js'});await page.evaluate(()=>window.story=new ColonyRaidStory());}
function state(id,remaining=8400,e=event){return {id:'game',phase:'raidWatching',serverNow:Date.now(),me:{id},raid:{event:e,remaining}};}
test('both involved learners share approach, clash and result; others keep playing',async({page,context},info)=>{
 const b=await context.newPage(),other=await context.newPage();for(const p of [page,b,other])await open(p);
 for(const [p,id] of [[page,'a'],[b,'b'],[other,'c']])await p.evaluate(s=>story.sync(s),state(id));
 await expect(page.locator('.raid-story')).toBeVisible();await expect(b.locator('.raid-story')).toBeVisible();await expect(other.locator('.raid-story')).toBeHidden();
 await expect(page.locator('[data-role]')).toHaveText('YOUR COLONY IS RAIDING');await expect(b.locator('[data-role]')).toHaveText('DEFEND YOUR COLONY');
 for(const p of [page,b]){await p.evaluate(s=>story.sync(s),state(p===page?'a':'b',4500));await expect(p.locator('.raid-story')).toHaveAttribute('data-phase','clash');}
 await page.screenshot({path:info.outputPath('raid-clash.png')});
 for(const p of [page,b]){await p.evaluate(s=>story.sync(s),state(p===page?'a':'b',2000));await expect(p.locator('h1')).toHaveText('Mia wins the raid!');await expect(p.locator('[data-reward]')).toHaveText('Mia: +5 food  |  Leo: -5 food');}
 await page.screenshot({path:info.outputPath('raid-victory.png')});
 await page.evaluate(()=>story.sync({phase:'answer',me:{id:'a'}}));await expect(page.locator('.raid-story')).toBeHidden();await expect(page.locator('#decision')).toBeVisible();
});
test('defence result uses server values and paused raids do not advance',async({page})=>{
 await open(page);const s=state('b',5000,{...event,success:false,stolen:0,attackerFoodChange:-2,targetFoodChange:5});s.phase='paused';await page.evaluate(s=>story.sync(s),s);await page.waitForTimeout(2000);await page.evaluate(()=>story.clock());await expect(page.locator('.raid-story')).toHaveAttribute('data-phase','clash');
 s.phase='raidWatching';s.raid.remaining=1000;await page.evaluate(s=>story.sync(s),s);await expect(page.locator('.raid-story')).toHaveAttribute('data-phase','defence');await expect(page.locator('h1')).toHaveText('Leo wins the raid!');await expect(page.locator('[data-reward]')).toHaveText('Mia: -2 food  |  Leo: +5 food');
});
test('rejoining a duel goes straight to its current story beat and reduced motion disables movement',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await open(page);const now=Date.now();await page.evaluate(s=>story.sync(s),{phase:'duelRaid',me:{id:'a'},serverNow:now,duel:{raid:{event,startedAt:now-5000,until:now+1800}}});await expect(page.locator('.raid-story')).toHaveAttribute('data-phase','victory');expect(await page.locator('.raid-story-art').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});
test('raid soundtrack advances, does not restart on snapshots, and stops on mute and exit',async({page})=>{
 await open(page);await page.evaluate(s=>{story.configure(true,.5);window.raidState=s;const b=document.createElement('button');b.textContent='Play raid';b.onclick=()=>story.sync(raidState);document.body.append(b);},state('a'));
 await page.getByRole('button',{name:'Play raid'}).click();
 await expect.poll(()=>page.evaluate(()=>story.audio.currentTime)).toBeGreaterThan(.2);
 const before=await page.evaluate(()=>story.audio.currentTime);
 await page.evaluate(s=>story.sync(s),state('a',7800));
 expect(await page.evaluate(()=>story.audio.currentTime)).toBeGreaterThanOrEqual(before-.1);
 await page.evaluate(()=>story.configure(false,.5));expect(await page.evaluate(()=>story.audio.paused)).toBe(true);
 await page.evaluate(()=>story.hide());expect(await page.evaluate(()=>story.audio.paused)).toBe(true);
});
test('actual engine raid snapshot opens story on the complete student page',async({page})=>{
 const {ColonyMatch}=require('../../colonyquest-multiplayer');const now=Date.now();
 const m=new ColonyMatch({id:'raid-real',lessonTitle:'Raid',questions:Array.from({length:4},()=>({question:'Pick',options:['Yes','No'],correctIndex:0}))},{pacing:'individual',storyEnabled:false,now});
 const a=m.join({studentId:'a',name:'Mia'},now),b=m.join({studentId:'b',name:'Leo'},now);m.start(now);
 Object.assign(a.colony,{soldiers:5,food:20,barracksBuilt:true});Object.assign(b.colony,{soldiers:1,food:20,barracksBuilt:true});
 m.answer(a.id,0,0,now+10);m.upgrade(a.id,0,'raid',b.id,now+20);
 const snapshot=m.snapshot(a.id,false,now+30);
 await page.route('**/colonyquest-live/ticket',r=>r.fulfill({json:{token:'test'}}));
 await page.addInitScript(()=>{class Socket{static OPEN=1;constructor(){this.readyState=1;window.testSocket=this;setTimeout(()=>this.onopen?.(),0);}send(){}close(){}}window.WebSocket=Socket;});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/colonyquest-live-play/raid-real');await page.waitForFunction(()=>window.testSocket?.onmessage);
 await page.evaluate(s=>testSocket.onmessage({data:JSON.stringify({type:'state',state:s})}),snapshot);
 await expect(page.locator('.raid-story')).toBeVisible();await expect(page.locator('.raid-story')).toHaveAttribute('data-phase','approach');expect(errors).toEqual([]);
});
