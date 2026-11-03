const {test,expect}=require('@playwright/test');
test('shared teacher review renders evidence, searches safely, and prints',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{document.body.innerHTML='<main id="review"></main>';});
 await page.evaluate(()=>{document.querySelector('#review').innerHTML=LearningReport.html(LearningReport.game({lessonTitle:'Devices and our senses',questionStats:[{question:'Which device produces sound?',correct:8,answered:12},{question:'Explain the output',correct:0,answered:0}],results:[{name:'An Nguyen',score:2,total:3},{name:'Mai Tran',score:0,total:3}],notPlayed:[{name:'Binh'}]}));});
 await expect(page.getByRole('heading',{name:'Devices and our senses'})).toBeVisible();await page.locator('.lr-bar summary').first().click();await expect(page.locator('.lr-bar').first()).toContainText('8 correct of 12');await page.locator('.lr-learners summary').click();await page.getByRole('searchbox').fill('Mai');await expect(page.locator('[data-lr-name="mai tran"]')).toBeVisible();await expect(page.locator('[data-lr-name="an nguyen"]')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
 await page.screenshot({path:'/tmp/shared-report-'+test.info().project.name+'.png',fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV'}).click();expect((await download).suggestedFilename()).toBe('learning-review.csv');
 const popupEvent=page.waitForEvent('popup');await page.getByRole('button',{name:'Print / Save PDF'}).click();const popup=await popupEvent;await expect(popup.getByRole('heading',{name:'Devices and our senses'})).toBeVisible();
});
test('Marks and Practice mount the shared reports in their real teacher pages',async({page})=>{
 const {signInDisposableTeacher}=require('./helpers');await signInDisposableTeacher(page,'-reports');
 await page.evaluate(()=>{hideAllPanels();document.querySelector('#marksPanel').style.display='block';renderGradebook({classAverage:.5,students:[{id:'a'}],assessments:[{id:'x',title:'Device project',kind:'assignment',average:.5,weight:1}],rows:[{name:'Alex',done:1,average:.5,cells:{x:{mark:5,max:10,pct:.5}}}]});});
 await expect(page.getByRole('heading',{name:'Assessment overview',exact:true})).toBeVisible();await expect(page.locator('.gb-weight-input')).toHaveValue('1');
 await page.route('**/api/practice/results',r=>r.fulfill({json:{activities:[],students:[{id:'a',name:'Alex',rosters:[]}],results:[{studentId:'a',studentName:'Alex',activityId:'g2-pointer-control',status:'completed',mastery:'independent',accuracyPercent:75,checkpoints:[],rosters:[]}]}}));await page.goto('/practice');await page.getByRole('button',{name:'View progress',exact:true}).click();await expect(page.getByRole('heading',{name:'Practice learning review'})).toBeVisible();await expect(page.locator('#practiceInsights')).toContainText('75%');
});

test('Marks shows correctly scaled percentages in summary, bars, focus cards and CSV',async({page})=>{
 const {signInDisposableTeacher}=require('./helpers');await signInDisposableTeacher(page,'-mark-percentages');
 await page.evaluate(()=>{hideAllPanels();document.querySelector('#marksPanel').style.display='block';renderGradebook({classAverage:.84,students:[{id:'a'}],assessments:[{id:'p',title:'Project',average:.9158333333333334,weight:1},{id:'m',title:'MoonQuest',average:.7384259259259259,kind:'game',excluded:true,weight:0},{id:'f',title:'Files',average:.6704861111111111,kind:'game',excluded:true,weight:0},{id:'r',title:'Robots',average:null,weight:1},{id:'q',title:'Quiz',average:.46376811594202894,weight:1}],rows:[{name:'Sample learner',done:1,average:.84,cells:{p:{mark:41,max:50,pct:.82}}}]});});
 await expect(page.locator('.gb-summary').getByText('84%',{exact:true})).toBeVisible();await expect(page.locator('.lr-stats b').first()).toHaveText('70%');
 const report=page.locator('#marksBody .learning-report');for(const [i,value]of ['92%','74%','67%','—','46%'].entries())await expect(report.locator('.lr-bar summary b').nth(i)).toHaveText(value);
 await expect(report.locator('.lr-bar .lr-track i').first()).toHaveAttribute('style','width:92%');await expect(report.locator('.lr-focus').first()).toContainText('Quiz · 46%');await expect(report.locator('.lr-stats b').nth(1)).toHaveText('4/5');
 const downloaded=page.waitForEvent('download');await report.getByRole('button',{name:'Download CSV'}).click();const download=await downloaded;const text=require('node:fs').readFileSync(await download.path(),'utf8');expect(text).toContain('"Project","92"');expect(text).not.toContain('0.915833');
});
