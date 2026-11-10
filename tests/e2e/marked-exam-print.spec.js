const {test,expect}=require('@playwright/test');
test('print window fetches saved marks and has a working PDF print button without marking-source labels',async({page})=>{
 await page.goto('/codequest.html');await page.addScriptTag({url:'/marked-exam-print.js'});
 await page.route('**/api/assignment/paper/results',r=>r.fulfill({json:{title:'ICT exam',rosterName:'Grade 3B1',questions:[{id:'q',question:'Explain your answer',kind:'short',marks:5}],submissions:[{studentId:'1',name:'Mia',answers:{q:'My answer'},grades:{q:{marksAwarded:4,source:'ai-confirmed',rationale:'Good explanation.'}}}]}}));
 const popupPromise=page.waitForEvent('popup');await page.evaluate(()=>MarkedExamPrint.open('paper','1'));const popup=await popupPromise;
 await expect(popup.locator('h1')).toHaveText('ICT exam');await expect(popup.locator('.score')).toHaveText('Total: 4 / 5');await expect(popup.locator('.answer')).toHaveText('My answer');await expect(popup.locator('body')).not.toContainText('AI');await expect(popup.locator('body')).toContainText('Grade 3B1');
 await popup.evaluate(()=>{window.print=()=>{document.body.dataset.printCalled='yes';};});await popup.locator('#printExam').click();await expect(popup.locator('body')).toHaveAttribute('data-print-called','yes');await popup.emulateMedia({media:'print'});await expect(popup.locator('.toolbar')).toBeHidden();
});
