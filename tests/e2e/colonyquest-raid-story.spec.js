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
