const {test,expect}=require('@playwright/test');
const {signInDisposableTeacher}=require('./helpers');
test('presentation reads individual questions and choices, survives polling and stops on navigation',async({page})=>{
 await signInDisposableTeacher(page,'-voice');
 let questionId='q1';const requests=[];
 await page.addInitScript(()=>{
  window.audioPlays=[];window.audioStops=0;
  window.Audio=class{pause(){window.audioStops++;}async play(){window.audioPlays.push(this.src);}};
 });
 await page.route('**/api/assignment/voice/presentation',r=>r.fulfill({json:{slides:[],delivery:{mode:'live',phase:'open',questionSyncEnabled:true},currentQuestion:{id:questionId,question:questionId==='q1'?'What is software?':'What is hardware?',options:['Instructions','Mouse'],number:questionId==='q1'?1:2,total:2},responseProgress:{assigned:2,answered:0}}}));
 await page.route('**/api/assignment/voice/presentation-audio?*',r=>{requests.push(r.request().url());return r.fulfill({contentType:'audio/mpeg',body:Buffer.from('mock audio')});});
 await page.goto('/assessment/voice/present');
 await page.getByRole('button',{name:'Read question',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop reading question',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>audioPlays.length)).toBe(1);
 await page.waitForTimeout(1700);
 await expect(page.getByRole('button',{name:'Stop reading question',exact:true})).toBeVisible();
 expect(requests).toHaveLength(1);
 await page.getByRole('button',{name:'Read answer choice B',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>audioPlays.length)).toBe(2);
 expect(new URL(requests[1]).searchParams.get('choice')).toBe('1');
 await page.getByRole('button',{name:'Stop reading answer choice B'}).click();
 await page.getByRole('button',{name:'Read answer choice B'}).click();
 await expect.poll(()=>page.evaluate(()=>audioPlays.length)).toBe(3);expect(requests).toHaveLength(2);
 questionId='q2';await expect(page.locator('#title')).toContainText('What is hardware?');
 await expect(page.getByRole('button',{name:'Read question',exact:true})).toBeVisible();
 const count=await page.evaluate(()=>audioPlays.length);await page.waitForTimeout(300);expect(await page.evaluate(()=>audioPlays.length)).toBe(count);
});
