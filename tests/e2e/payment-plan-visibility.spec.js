const {test,expect}=require('@playwright/test');const {signInDisposableTeacher}=require('./helpers');
test('EducScope switch hides and restores LessonScope plan offers without hiding account access',async({page})=>{
 let visible=false;await page.route('https://educscope.com/api/public-settings',route=>route.fulfill({json:{paymentPlansVisible:visible},headers:{'Access-Control-Allow-Origin':'*'}}));
 await page.route('**/api/credits',route=>route.fulfill({json:{billingEnabled:true,purchasable:true,source:'educscope',balance:20,available:20,accountUrl:'https://educscope.com/account'}}));
 await page.route('**/api/credit-prices',route=>route.fulfill({json:{billingEnabled:true,unlimited:false,prices:{},fairUse:{freeRegensPerLesson:3},accountUrl:'https://educscope.com/account'}}));
 await signInDisposableTeacher(page,'-plans');await page.locator('#creditsBtn').click();await expect(page.locator('#creditsPanel')).toBeVisible();await expect(page.locator('#lessonCreditEstimator')).toBeHidden();await expect(page.locator('#creditsTopup')).toBeEmpty();await expect(page.locator('#creditsBalanceCard')).toContainText('20');
 visible=true;await page.evaluate(()=>window.EducScopePlans.refresh());await expect(page.locator('#lessonCreditEstimator')).toBeVisible();await expect(page.locator('#creditsTopup')).toContainText('Choose an EducScope plan');
 visible=false;await page.evaluate(()=>window.EducScopePlans.refresh());await expect(page.locator('#lessonCreditEstimator')).toBeHidden();await expect(page.locator('#creditsTopup')).toBeEmpty();await expect(page.locator('#creditsBalanceCard')).toContainText('20');
});
