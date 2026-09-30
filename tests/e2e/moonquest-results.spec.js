const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('saved results remain discoverable after fifty newer practice rooms',async({page})=>{
 test.setTimeout(90000);await signInDisposableTeacher(page,'-saved-results');await page.goto('/moonquest');await page.getByRole('button',{name:'Try the senses example'}).click();await page.locator('#reviewed').check();await page.getByRole('button',{name:'Save adventure',exact:true}).click();
 let lib=await(await page.request.get('/api/games/moonquest/library')).json();const game=lib.games[0].id;
 const s=await(await page.request.post('/api/games/moonquest/games/'+game+'/sessions',{data:{test:true}})).json();const base='/api/games/moonquest/sessions/'+s.id;
 async function command(action){const v=await(await page.request.get(base+'/teacher')).json();const res=await page.request.post(base+'/command',{data:{action,seq:v.seq}});expect(res.ok()).toBeTruthy();}
 await command('next');const sim=await page.request.post(base+'/simulate',{data:{pattern:'mixed'}});expect(sim.ok()).toBeTruthy();await command('advance');await command('end');
 const original=await(await page.request.get(base+'/report')).json();
 for(let i=0;i<51;i++){const r=await page.request.post('/api/games/moonquest/games/'+game+'/sessions',{data:{test:true}});expect(r.ok()).toBeTruthy();}
 lib=await(await page.request.get('/api/games/moonquest/library')).json();expect(lib.sessions).toHaveLength(52);const saved=lib.sessions.find(v=>v.id===s.id);expect(saved.savedAnswers).toBeGreaterThan(0);expect(saved.completedRounds).toBe(1);
 await page.goto('/moonquest');await expect(page.getByRole('heading',{name:'Saved sessions and results'})).toBeVisible();await page.locator('[data-report="'+s.id+'"]').click();await expect(page.getByRole('heading',{name:'Understanding by question'})).toBeVisible();await page.getByRole('tab',{name:'Learners',exact:true}).click();await expect(page.locator('#review-learners')).toContainText('Practice learner');
 await page.reload();await page.goto('/moonquest?report='+s.id);await expect(page.getByRole('heading',{name:'Understanding by question'})).toBeVisible();
 expect(await(await page.request.get(base+'/report')).json()).toEqual(original);
 await page.locator('.review-chart-row').first().click();await expect(page.locator('dialog')).toBeVisible();await expect(page.locator('#review-detail')).toContainText('Incorrect final choices');await page.getByRole('button',{name:'Close details'}).click();
 await page.locator('textarea[name=noticed]').fill('Learners confused sound and vibration.');await page.locator('textarea[name=action]').fill('We compared a silent vibration with an alarm.');await page.getByRole('button',{name:'Save reflection',exact:true}).click();await expect(page.locator('#reflection-status')).toHaveText('Saved with this session');await page.reload();await expect(page.locator('textarea[name=action]')).toHaveValue('We compared a silent vibration with an alarm.');
 await page.screenshot({path:'/tmp/moonquest-report-'+test.info().project.name+'.png',fullPage:true});
 await page.evaluate(()=>{window.print=()=>{window.printRequested=true;};});await page.getByRole('button',{name:'Print / Save PDF'}).click();expect(await page.evaluate(()=>window.printRequested)).toBeTruthy();await expect(page.locator('.print-reflection').nth(1)).toHaveText('We compared a silent vibration with an alarm.');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV'}).click();expect((await download).suggestedFilename()).toBe('moonquest-learning.csv');
 await page.getByRole('tab',{name:'Learners',exact:true}).click();await page.locator('#review-filter').selectOption('missing');await expect(page.locator('#review-learners')).toBeVisible();
 await page.getByRole('tab',{name:'All answers'}).click();await page.locator('[data-cell]').first().click();await expect(page.locator('#review-detail')).toContainText('First answer');
 const before=await(await page.request.get(base+'/report')).json();const a=before.students[0].rounds[0];
 await page.locator('#assessment-form select').selectOption(String(!a.revisedCorrect));
 await page.locator('#assessment-form textarea').fill('Explained correctly after discussion.');
 await page.getByRole('button',{name:'Save assessment',exact:true}).click();
 await expect(page.locator('#assessment-status')).toContainText('Saved.');
 await page.screenshot({path:'/tmp/moonquest-assessment-'+test.info().project.name+'.png',fullPage:true});
 const after=await(await page.request.get(base+'/report')).json();expect(after.students[0].rounds[0].revisedCorrect).toBe(!a.revisedCorrect);expect(after.students[0].rounds[0].initialCorrect).toBe(a.initialCorrect);expect(after.summary.totals.finalCorrect).toBe(before.summary.totals.finalCorrect+(a.revisedCorrect?-1:1));
 await page.reload();await page.getByRole('tab',{name:'All answers'}).click();await page.locator('[data-cell]').first().click();await expect(page.locator('#review-detail')).toContainText('Explained correctly after discussion.');
 await page.getByRole('button',{name:'Close details'}).click();const revisedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV'}).click();const csvText=require('fs').readFileSync(await(await revisedDownload).path(),'utf8');expect(csvText).toContain('Teacher assessed correct');expect(csvText).toContain('Explained correctly after discussion.');await page.locator('[data-cell]').first().click();
 await page.locator('#assessment-form select').selectOption('restore');await page.locator('#assessment-form textarea').fill('Restore original result.');await page.getByRole('button',{name:'Save assessment',exact:true}).click();await expect(page.locator('#assessment-status')).toContainText('Saved.');
 expect((await(await page.request.get(base+'/report')).json()).summary.totals.finalCorrect).toBe(before.summary.totals.finalCorrect);

});
