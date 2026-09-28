const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('MoonQuest is available in teacher game previews and opens diagram missions',async({page})=>{
 await signInDisposableTeacher(page,'-moon-picker');
 await page.route('**/api/game/chooser',r=>r.fulfill({json:{id:'chooser',lessonTitle:'Devices',subject:'ICT',topic:'Devices',summary:{overview:'Explore devices',concepts:[]},students:[],canManageColonyQuest:true}}));
 await page.goto('/play/chooser');await page.locator('#startBtn').click();await expect(page.locator('#moonQuestPick')).toBeVisible();await page.locator('#moonQuestPick').click();await expect(page).toHaveURL(/\/moonquest$/);await expect(page.getByRole('button',{name:'Create a diagram game',exact:false})).toBeVisible();
});
test('learner chooser does not offer teacher-only MoonQuest authoring',async({page})=>{
 await page.route('**/api/game/chooser',r=>r.fulfill({json:{id:'chooser',lessonTitle:'Devices',subject:'ICT',topic:'Devices',summary:{overview:'Explore devices',concepts:[]},students:[],canManageColonyQuest:false}}));
 await page.goto('/play/chooser');await page.locator('#startBtn').click();await expect(page.locator('#moonQuestPick')).toBeHidden();await expect(page.locator('[data-game="car"]')).toBeVisible();
});
