const {test,expect}=require('@playwright/test');
test('teacher FishQuest picker separates multiplayer, smartboard and practice',async({page})=>{
 await page.goto('/');
 await page.addScriptTag({url:'/games-hub.js?v=3'});
 await page.evaluate(()=>GamesHub.open({id:'sample-ocean',lessonTitle:'Ocean questions',mode:'fishquest'}));
 const card=page.locator('.games-option').filter({has:page.getByRole('heading',{name:'FishQuest',exact:true})});
 await card.locator('summary').click();
 await expect(card.getByRole('link',{name:'Live multiplayer · learner devices →'})).toHaveAttribute('href','/fishquest/sample-ocean');
 await expect(card.getByRole('link',{name:'Smartboard →',exact:true})).toHaveAttribute('href','/fishquest-board.html?game=sample-ocean');
 await expect(card.getByRole('link',{name:'Independent practice →',exact:true})).toHaveAttribute('href','/fishquest-play/sample-ocean');
});
test('multiplayer control room rejects unauthenticated visitors',async({request})=>{
 expect((await request.get('/fishquest/sample-ocean')).status()).toBe(401);
 expect((await request.post('/api/game/sample-ocean/fishquest/open',{data:{}})).status()).toBe(401);
});
