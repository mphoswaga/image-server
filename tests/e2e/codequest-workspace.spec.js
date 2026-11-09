const {test,expect}=require('@playwright/test'),C=require('../../public/codequest-core'),E=require('../../codequest-engine');
const {expectNoPageOverflow}=require('./helpers');
async function open(page,program){const s=E.create({students:[{id:'a',name:'Mia',gender:'female'},{id:'b',name:'Leo',gender:'male'}],preview:true,requireReturn:false},Date.now());E.start(s,Date.now());s.phase='build';s.round=3;s.deadline=Date.now()+180000;s.players.a.program=program;await page.route('**/api/game/workspace/codequest*',r=>r.fulfill({json:{teacher:false,preview:true,joinUrl:'/play/workspace',state:E.view(s,'a',false)}}));await page.goto('/codequest.html?game=workspace');await expect(page.locator('#editor')).toBeVisible();return s;}
async function rect(page,id){return page.locator('#'+id).boundingBox();}
async function visibleSteps(page){return page.locator('#program>li').evaluateAll(nodes=>{const box=document.getElementById('codeCanvas').getBoundingClientRect();return nodes.map(n=>{const r=n.getBoundingClientRect();return {number:n.dataset.index,inside:r.left>=box.left-1&&r.right<=box.right+1&&r.top>=box.top-1&&r.bottom<=box.bottom+1};});});}
test('code is left and larger, island is right and fully visible, test controls remain reachable',async({page},info)=>{await open(page,Array.from({length:12},(_,i)=>({op:i%4===3?'left':'move'})));await expectNoPageOverflow(page);const editor=await rect(page,'editor'),stage=await rect(page,'island'),testButton=await rect(page,'test');if(page.viewportSize().width>=720){expect(editor.x+editor.width).toBeLessThan(stage.x);expect(editor.width).toBeGreaterThan(stage.width);expect(stage.width).toBeGreaterThan(page.viewportSize().width>=1300?430:page.viewportSize().width>=1000?290:210);expect(stage.y+stage.height).toBeLessThanOrEqual(page.viewportSize().height);expect(testButton.y+testButton.height).toBeLessThanOrEqual(page.viewportSize().height);}await page.screenshot({path:info.outputPath('coding-workspace.png'),fullPage:true});});
test('32 steps and an eight-action repeat are all visible in Fit all code',async({page},info)=>{const program=Array.from({length:32},()=>({op:'move'}));program[9]={op:'repeat',count:2,body:Array.from({length:8},(_,i)=>({op:i%2?'right':'move'}))};C.expand(program);await open(page,program);await expect(page.locator('#program li')).toHaveCount(32);await expect(page.locator('.repeatBody .repeatChild')).toHaveCount(8);await page.locator('#fitCode').click();await expect(page.locator('#fitCode')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#palette')).toBeHidden();await expect(page.locator('#fitClock')).toContainText('s');await expectNoPageOverflow(page);if(page.viewportSize().width>=720){await expect.poll(async()=> (await visibleSteps(page)).filter(p=>!p.inside)).toEqual([]);const stage=await rect(page,'island'),controls=await rect(page,'ready');expect(stage.y+stage.height).toBeLessThanOrEqual(page.viewportSize().height);expect(controls.y+controls.height).toBeLessThanOrEqual(page.viewportSize().height);}await page.screenshot({path:info.outputPath('whole-program.png'),fullPage:true});await page.locator('#program>li').last().getByRole('button').click();await expect(page.locator('#stepEditor')).toBeVisible();await page.locator('#stepChoices button').nth(1).click();await expect(page.locator('#program>li').last()).toContainText('Left');await page.locator('#fitCode').click();await expect(page.locator('#palette')).toBeVisible();});
test('instruction highlighting follows the code without moving the stage',async({page})=>{const s=await open(page,[{op:'left'},{op:'right'}]);await page.locator('#test').scrollIntoViewIfNeeded();const before=await rect(page,'island');await page.locator('#test').click();await expect(page.locator('#program li.active')).toHaveCount(1);const after=await rect(page,'island');expect(Math.abs(before.x-after.x)).toBeLessThan(1);expect(Math.abs(before.y-after.y)).toBeLessThan(1);expect(s.players.a.program).toEqual([{op:'left'},{op:'right'}]);});
test('inline Times converts an action to a repeat and back without opening the dialog',async({page})=>{
 const s=await open(page,[{op:'move'}]);
 s.map.blocks=['move','left','right','collect','repeat'];
 await page.reload();
 const count=page.getByRole('spinbutton',{name:'Times for step 1',exact:true});
 await expect(count).toBeEnabled();
 await count.fill('3');await count.press('Tab');
 await expect(page.locator('#program>li').first()).toContainText('Repeat 3 times');
 await expect(page.locator('#stepEditor')).not.toBeVisible();
 await count.fill('1');await count.press('Tab');
 await expect(page.locator('#program>li').first()).toHaveClass('block-move');
 await count.fill('6');await count.press('Tab');
 await expect(count).toHaveValue('1');
 await expect(page.locator('#status')).toContainText('whole number');
});
test('drag inserts a palette block, reorders a step and removes it outside code',async({page})=>{
 await open(page,[{op:'move'},{op:'left'},{op:'collect'}]);
 const drag=async(source,target,after=false)=>{await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+70,b.y+(after?b.height-8:8),{steps:12});await page.mouse.up();};
 await drag(page.locator('#palette [data-op="right"]'),page.locator('#program>li').nth(1));
 await expect(page.locator('#program>li')).toHaveCount(4);
 await expect(page.locator('#program>li').nth(1)).toHaveClass(/block-right/);
 await drag(page.locator('#program>li').nth(3).locator('button'),page.locator('#program>li').first());
 await expect(page.locator('#program>li').first()).toHaveClass(/block-collect/);
 const a=await page.locator('#program>li').first().locator('button').boundingBox();await page.mouse.move(a.x+20,a.y+15);await page.mouse.down();await page.mouse.move(5,5,{steps:12});await page.mouse.up();
 await expect(page.locator('#program>li')).toHaveCount(3);
 await expect(page.locator('#stepEditor')).not.toBeVisible();
});
test('Start stays separate from executable blocks and accepts insertion at the beginning',async({page},info)=>{
 await open(page,[{op:'repeat',count:3,body:[{op:'move'}]},{op:'left'},{op:'repeat',count:2,body:[{op:'move'}]},{op:'right'},{op:'collect'}]);
 await expect(page.locator('#codeStart')).toBeVisible();await expect(page.locator('#codeCount')).toContainText('5 steps');
 await page.locator('#codeStart').scrollIntoViewIfNeeded();
 const first=await page.locator('#codeStart').boundingBox(),last=await page.locator('#program>li').last().boundingBox();
 if(info.project.name==='windows-100')await page.screenshot({path:'/Users/mphogiftmokoena/Documents/Codex/2026-11-09/whe/outputs/physical-codequest-blocks.png',clip:{x:first.x-2,y:first.y,width:240,height:last.y+last.height-first.y+4}});
 const source=page.locator('#palette [data-op="right"]');await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await page.locator('#codeStart').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+70,b.y+20,{steps:12});await page.mouse.up();
 await expect(page.locator('#program>li').first()).toHaveClass(/block-right/);await expect(page.locator('#program>li')).toHaveCount(6);await expect(page.locator('#codeStart')).toHaveCount(1);
});
test('round briefing explains Repeat before revealing rivals',async({page})=>{
 const s=await open(page,[]);s.phase='countdown';s.buildAt=Date.now()+6000;s.map.blocks=['move','left','right','collect'];
 await page.reload();await expect(page.locator('#stageTitle')).toHaveText('No Repeat this round');await expect(page.locator('#versusFaces')).toBeHidden();
 await expect(page.locator('#versusFaces')).toBeVisible({timeout:8000});
 s.buildAt=Date.now()+6000;s.map.blocks.push('repeat');await page.reload();await expect(page.locator('#stageTitle')).toHaveText('Repeat is available this round');await expect(page.locator('#versusFaces')).toBeHidden();
});
test('teacher can choose next duel players using the class checklist',async({page})=>{
 const s=E.create({students:[{id:'a',name:'Mia'},{id:'b',name:'Leo'},{id:'c',name:'Bao'}],preview:true},Date.now());
 await page.route('**/api/game/selection/codequest*',r=>{if(r.request().method()==='POST'){const b=r.request().postDataJSON();if(b.action==='participants')E.selectPlayers(s,b.studentIds);}return r.fulfill({json:{teacher:true,preview:true,joinUrl:'/play/selection',state:E.view(s,null,true)}});});
 await page.goto('/codequest.html?game=selection');await expect(page.locator('#playerSelection')).toBeVisible();
 await page.locator('#playerSelection input[value="c"]').uncheck();await expect.poll(()=>s.players.c.selected).toBe(false);
 await page.locator('#playerSelection input[value="c"]').check();await expect.poll(()=>s.players.c.selected).toBe(true);
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();await expect(page.locator('#start')).toBeDisabled();
});
