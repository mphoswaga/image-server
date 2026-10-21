const { test, expect } = require('@playwright/test');
const pptxgen = require('pptxgenjs');
const JSZip = require('jszip');
const { signInDisposableTeacher, expectNoPageOverflow } = require('./helpers');

async function deck(topic) {
  const pptx = new pptxgen();
  pptx.addSlide().addText(topic, { x: 1, y: 1, w: 8, h: 1 });
  const slide = pptx.addSlide();
  slide.addText('Learning objectives', { x: 1, y: 1, w: 8, h: 1 });
  slide.addText(`Explain ${topic} using an example.`, { x: 1, y: 2, w: 8, h: 1 });
  return { name: `${topic}.pptx`, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: await pptx.write({ outputType: 'nodebuffer' }) };
}
function plan(topic) {
  return { sections: [{ heading: 'Starter', content: `Introduce ${topic}.` }, { heading: 'Teaching and practice', content: `Explore ${topic} with examples.` }], teachingModelId: 'standard' };
}
async function prepare(page) {
  await signInDisposableTeacher(page);
  await page.getByRole('button', { name: /I already have slides/ }).click();
  await page.locator('#isSubject').fill('ICT');
  await page.locator('#isGrade').selectOption('Grade 3');
  await page.locator('#isFile').setInputFiles(await Promise.all(['File sizes', 'Safe searching'].map(deck)));
}

test('batch saves distinct lessons, survives a save failure and reopens the matching plan', async ({ page }) => {
  const generated=[];
  await page.route('**/api/lesson-plan', route => {
    const input=route.request().postDataJSON();generated.push(input);
    return route.fulfill({json:plan(input.topic)});
  });
  let failed=false;
  await page.route('**/api/lesson-workspaces/*', route => {
    const request=route.request();
    if(request.method()==='PATCH'&&request.postDataJSON().topic==='Safe searching'&&!failed){failed=true;return route.fulfill({status:503,json:{error:'Temporary save failure'}});}
    return route.continue();
  });
  await prepare(page);
  const rows=page.locator('#slideBatchPanel li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole('button',{name:'Open saved lesson'})).toBeHidden();
  await expect(page.getByRole('button',{name:'Stop after this file'})).toBeHidden();
  await expectNoPageOverflow(page);
  await page.locator('#slideBatchPanel').screenshot({path:test.info().outputPath('batch-upload.png')});
  await page.locator('#importSlidesPlanBtn').click();
  await expect(rows.nth(0)).toContainText('Lesson plan saved in My lessons.');
  await expect(rows.nth(1)).toContainText('Temporary save failure');
  expect(generated).toHaveLength(2);
  for(const input of generated){
    expect(input.grade).toBe('Grade 3');
    expect(input.objectives).toBe(`Explain ${input.topic} using an example.`);
    expect(input.sourceMaterialText).toContain(input.topic);
    expect(input.sourceMaterialText).not.toContain(input.topic==='File sizes'?'Safe searching':'File sizes');
  }
  await page.locator('#importSlidesPlanBtn').click();
  await expect(rows.nth(1)).toContainText('Lesson plan saved in My lessons.');
  expect(generated).toHaveLength(2); // Retrying the save does not charge for another generation.
  const {lessons}=await (await page.request.get('/api/lesson-workspaces')).json();
  expect(lessons).toHaveLength(2);
  for(const item of lessons){
    const {workspace,decks}=await (await page.request.get(`/api/lesson-workspaces/${item.id}/resume`)).json();
    expect(workspace.plan.sections[0].content).toBe(`Introduce ${item.topic}.`);
    expect(decks).toHaveLength(1);
    expect(decks[0].slides[0].title).toBe(item.topic);
  }
  await rows.nth(1).getByRole('button',{name:'Open saved lesson'}).click();
  await expect(page.locator('#planStage')).toBeVisible();
  await expect(page.locator('#planSections')).toContainText('Introduce Safe searching.');
});

test('upload-only batch can subsequently generate plans without uploading again', async ({ page }) => {
  let uploads=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/import/slides')uploads++;});
  await page.route('**/api/lesson-plan',route=>route.fulfill({json:plan(route.request().postDataJSON().topic)}));
  await prepare(page);
  await page.locator('#importSlidesOnlyBtn').click();
  await expect(page.locator('#slideBatchPanel')).toContainText('2 of 2 lessons completed');
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#slideBatchPanel li').nth(1)).toContainText('Lesson plan saved in My lessons.');
  expect(uploads).toBe(2);
  const {lessons}=await (await page.request.get('/api/lesson-workspaces')).json();
  expect(lessons).toHaveLength(2);
  expect(lessons.every(item=>item.hasPlan)).toBe(true);
});

test('single-file import still opens its plan', async ({ page }) => {
  await signInDisposableTeacher(page);
  await page.route('**/api/lesson-plan',route=>route.fulfill({json:plan(route.request().postDataJSON().topic)}));
  await page.getByRole('button',{name:/I already have slides/}).click();
  await page.locator('#isSubject').fill('ICT');
  await page.locator('#isTopic').fill('File sizes');
  await page.locator('#isFile').setInputFiles(await deck('File sizes'));
  await expect(page.locator('#slideBatchPanel')).toBeHidden();
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#planSections')).toContainText('Introduce File sizes.');
});

test('real upload accepts a 150 MB PowerPoint and rejects a larger file', async ({ page }) => {
  test.setTimeout(120000);
  await signInDisposableTeacher(page);
  const zip=new JSZip();
  zip.file('ppt/slides/slide1.xml','<a:p><a:t>Large media lesson</a:t></a:p>');
  zip.file('ppt/media/padding.bin',Buffer.alloc(0));
  const empty=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});
  zip.file('ppt/media/padding.bin',Buffer.alloc(150*1024*1024-empty.length));
  const buffer=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});
  expect(buffer.length).toBe(150*1024*1024);
  const result=await page.request.post('/api/import/slides',{timeout:90000,multipart:{
    file:{name:'large.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer},subject:'ICT',topic:'Large media lesson'
  }});
  expect(result.ok(),await result.text()).toBeTruthy();
  expect((await result.json()).slides[0].title).toBe('Large media lesson');
  const oversized=await page.request.post('/api/import/slides',{timeout:90000,multipart:{
    file:{name:'oversized.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.concat([buffer,Buffer.alloc(1)])},subject:'ICT',topic:'Oversized'
  }});
  expect(oversized.status()).toBe(413);
  expect((await oversized.json()).error).toContain('150 MB');
});

test('lost save confirmation does not duplicate a lesson on retry', async ({ page }) => {
  let lost=false;
  await page.route('**/api/lesson-workspaces', async route=>{
    if(route.request().method()==='POST'&&!lost){
      lost=true;
      const saved=await route.fetch();expect(saved.ok()).toBeTruthy();
      return route.fulfill({status:503,json:{error:'Save confirmation interrupted'}});
    }
    return route.continue();
  });
  await prepare(page);
  await page.locator('#importSlidesOnlyBtn').click();
  await expect(page.locator('#slideBatchPanel li').nth(0)).toContainText('Save confirmation interrupted');
  await expect(page.locator('#importSlidesOnlyBtn')).toBeEnabled();
  await page.locator('#importSlidesOnlyBtn').click();
  await expect(page.locator('#slideBatchPanel')).toContainText('2 of 2 lessons completed');
  const {lessons}=await (await page.request.get('/api/lesson-workspaces')).json();
  expect(lessons).toHaveLength(2);
});

test('stop finishes the current lesson and resume processes only the remaining file', async ({ page }) => {
  let pending;let calls=0;
  await page.route('**/api/lesson-plan',route=>{
    calls++;
    if(calls===1){pending=route;return;}
    return route.fulfill({json:plan(route.request().postDataJSON().topic)});
  });
  await prepare(page);
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#slideBatchPanel li').nth(0)).toContainText('Writing this lesson plan');
  await expect.poll(()=>!!pending).toBe(true);
  await page.getByRole('button',{name:'Stop after this file'}).click();
  await pending.fulfill({json:plan('File sizes')});
  await expect(page.locator('#importSlidesPlanBtn')).toBeEnabled();
  expect(calls).toBe(1);
  await expect(page.locator('#slideBatchPanel li').nth(1)).toContainText('Ready');
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#slideBatchPanel')).toContainText('2 of 2 lessons completed');
  expect(calls).toBe(2);
});

test('single upload survives generation connection failure and retries without reupload', async ({page})=>{
  let attempts=0,uploads=0;
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/import/slides')uploads++;});
  await page.route('**/api/lesson-plan',route=>{
    attempts++;
    return attempts===1?route.abort('failed'):route.fulfill({json:plan('File sizes')});
  });
  await signInDisposableTeacher(page);
  await page.getByRole('button',{name:/I already have slides/}).click();
  await page.locator('#isSubject').fill('ICT');await page.locator('#isTopic').fill('File sizes');
  await page.locator('#isFile').setInputFiles(await deck('File sizes'));
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#slideBatchPanel')).toContainText('Writing this lesson plan failed: The connection was interrupted');
  const saved=await (await page.request.get('/api/lesson-workspaces')).json();
  expect(saved.lessons).toHaveLength(1);
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#planSections')).toContainText('Introduce File sizes.');
  expect(uploads).toBe(1);
  expect((await (await page.request.get('/api/lesson-workspaces')).json()).lessons).toHaveLength(1);
});

test('missing objectives can be supplied after upload without losing the saved source', async ({page})=>{
  let calls=0;
  await page.route('**/api/lesson-plan',route=>{
    calls++;
    expect(route.request().postDataJSON().objectives).toBe('Compare bytes and kilobytes.');
    return route.fulfill({json:plan('File sizes')});
  });
  await signInDisposableTeacher(page);
  await page.getByRole('button',{name:/I already have slides/}).click();
  await page.locator('#isSubject').fill('ICT');await page.locator('#isTopic').fill('File sizes');
  const pptx=new pptxgen();pptx.addSlide().addText('File sizes',{x:1,y:1,w:8,h:1});
  await page.locator('#isFile').setInputFiles({name:'files.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await pptx.write({outputType:'nodebuffer'})});
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#slideBatchPanel')).toContainText('Add this file’s learning objectives');
  expect(calls).toBe(0);
  await page.locator('#isObjectives').fill('Compare bytes and kilobytes.');
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#planSections')).toContainText('Introduce File sizes.');
  expect(calls).toBe(1);
});

test('long unit objective lists survive the upload form and server intact', async ({page})=>{
  const objectives=require('fs').readFileSync(require('path').join(__dirname,'../fixtures/science-unit-review-objectives.txt'),'utf8').trim();
  await signInDisposableTeacher(page);
  await page.getByRole('button',{name:/I already have slides/}).click();
  await page.locator('#isSubject').fill('Science');await page.locator('#isTopic').fill('Unit 2 review');
  await page.locator('#isObjectives').fill(objectives);
  expect(await page.locator('#isObjectives').getAttribute('maxlength')).toBe('12000');
  await page.locator('#isFile').setInputFiles(await deck('Materials'));
  const imported=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/import/slides');
  await page.locator('#importSlidesOnlyBtn').click();
  expect((await (await imported).json()).objectives.replace(/\r\n/g,'\n')).toBe(objectives);
  const {lessons}=await (await page.request.get('/api/lesson-workspaces')).json();
  expect(lessons).toHaveLength(1);
  const {workspace}=await (await page.request.get(`/api/lesson-workspaces/${lessons[0].id}/resume`)).json();
  expect(workspace.context.objectives).toBe(objectives);
});

test('provided review PowerPoint imports with all supplied objectives', async ({page})=>{
  test.skip(!process.env.E2E_REVIEW_PPTX,'Optional teacher-provided diagnostic file');
  const fs=require('fs'),path=require('path');
  const objectives=fs.readFileSync(path.join(__dirname,'../fixtures/science-unit-review-objectives.txt'),'utf8').trim();
  await signInDisposableTeacher(page);
  const response=await page.request.post('/api/import/slides',{multipart:{file:{name:'review.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:fs.readFileSync(process.env.E2E_REVIEW_PPTX)},subject:'Science',topic:'Unit 2 review',objectives,grade:'Grade 2'}});
  expect(response.ok(),await response.text()).toBe(true);
  const imported=await response.json();expect(imported.objectives).toBe(objectives);
  expect(imported.slides.length).toBeGreaterThan(0);
  console.log(JSON.stringify({uploaded:true,slideCount:imported.slideCount,objectives:objectives.split('\n').length}));
});

test('uploaded deck supports seven 35-minute lessons and retains sequence on resume', async ({ page }) => {
  const inputs=[];
  await signInDisposableTeacher(page);
  await page.route('**/api/lesson-plan',route=>{
    const input=route.request().postDataJSON();inputs.push(input);
    return route.fulfill({json:{...plan(`Period ${input.sequenceLessonNumber}`),sequenceLessonNumber:input.sequenceLessonNumber,sequence:{enabled:true,lessonCount:7,periodMinutes:35}}});
  });
  await page.getByRole('button',{name:/I already have slides/}).click();
  await page.locator('#isSubject').fill('Science');
  await page.locator('#isTopic').fill('Unit review');
  await page.locator('#isLessonCount').fill('7');
  await page.locator('#isLessonMinutes').fill('35');
  await page.locator('#isFile').setInputFiles(await deck('Unit review'));
  await page.locator('#importSlidesPlanBtn').click();
  await expect(page.locator('#planSections')).toContainText('Introduce Period 1.');
  for(let n=2;n<=7;n++){
    await page.locator('#nextSequencePlanBtn').click();
    await expect(page.locator('#planSections')).toContainText(`Introduce Period ${n}.`);
  }
  expect(inputs).toHaveLength(7);
  expect(inputs.every(input=>input.sequenceLessonCount===7&&input.periodMinutes===35&&input.lessonSettings.durationMinutes===35)).toBe(true);
  expect(inputs[6].previousLessonPlanText).toContain('Introduce Period 1.');
  expect(inputs[6].previousLessonPlanText).toContain('Introduce Period 6.');
  await expect.poll(async()=>{
    const {lessons}=await(await page.request.get('/api/lesson-workspaces')).json();
    const {workspace}=await(await page.request.get(`/api/lesson-workspaces/${lessons[0].id}/resume`)).json();
    return workspace.sequencePlans.length;
  }).toBe(7);
});
