const { test, expect } = require('@playwright/test');
const { signInDisposableTeacher } = require('./helpers');
test('activity is admin-only and profile directory stays collapsed',async({page,browser})=>{
  const setup=await browser.newContext();await setup.request.post('/api/signup',{data:{email:'games-admin@example.test',password:'Test-password-123!',name:'Activity Admin'}});await setup.close();
  await signInDisposableTeacher(page,'-activity');
  expect((await page.request.get('/api/admin/activity')).status()).toBe(403);
  await page.locator('#rostersBtn').click();
  const directory=page.locator('#studentProfileDirectory');
  await directory.locator('summary').click();
  await expect(page.locator('#studentProfileSearch')).toBeHidden();
  await page.reload();await page.locator('#rostersBtn').click();
  await expect(page.locator('#studentProfileSearch')).toBeHidden();
  await directory.locator('summary').click();
  await expect(page.locator('#studentProfileSearch')).toBeVisible();
  const roster=await page.request.post('/api/roster',{data:{name:'Activity class',rows:[{ID:'ACTIVITY-STUDENT',Name:'Sample Learner'}],idCol:'ID',nameCol:'Name'}});
  expect(roster.ok()).toBeTruthy();
  const learner=await browser.newContext();
  const signed=await learner.request.post('/api/student/login',{data:{studentId:'ACTIVITY-STUDENT',pin:'4826'}});
  expect(signed.ok()).toBeTruthy();
  expect((await learner.request.get('/api/admin/activity')).status()).toBe(401);
  await learner.close();
  const admin=await browser.newContext();
  try{
    await admin.request.post('/api/signup',{data:{email:'games-admin@example.test',password:'Test-password-123!',name:'Activity Admin'}});
    const login=await admin.request.post('/api/login',{data:{email:'games-admin@example.test',password:'Test-password-123!'}});
    expect(login.ok()).toBeTruthy();
    const response=await admin.request.get('/api/admin/activity?role=admin');
    expect(response.ok()).toBeTruthy();const data=await response.json();
    expect(data.events.some(e=>e.action==='Signed in'&&e.name==='Activity Admin')).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain('Test-password');
    const studentEvents=await (await admin.request.get('/api/admin/activity?role=student&search=Sample%20Learner')).json();
    expect(studentEvents.events.some(e=>e.action==='Signed in'&&e.id==='ACTIVITY-STUDENT')).toBeTruthy();
    expect(JSON.stringify(studentEvents)).not.toContain('4826');
    expect(studentEvents.events.find(e=>e.id==='ACTIVITY-STUDENT').classes).toContain('Activity class');
    const classSearch=await (await admin.request.get('/api/admin/activity?role=student&search=Activity%20class')).json();
    expect(classSearch.events.some(e=>e.id==='ACTIVITY-STUDENT')).toBeTruthy();
    expect((await (await admin.request.get('/api/admin/activity?from=2099-01-01')).json()).events).toHaveLength(0);

    const adminPage=await admin.newPage();await adminPage.addInitScript(()=>localStorage.setItem('lc_wizard_done','1'));await adminPage.goto('/');
    await adminPage.locator('#adminBtn').click();
    await adminPage.locator('#adminActivityPanel summary').click();
    await expect(adminPage.locator('#activityResults')).toContainText('Signed in');
    const accountId=data.events.find(e=>e.action==='Signed in').id;
    expect((await page.request.get('/api/admin/accounts/'+accountId+'/overview')).status()).toBe(403);
    const overview=await admin.request.get('/api/admin/accounts/'+accountId+'/overview');
    expect(overview.ok()).toBeTruthy();const detail=await overview.json();
    expect(detail.profile.email).toBe('games-admin@example.test');
    expect(detail.activity.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toContain('passwordHash');
    expect(JSON.stringify(detail)).not.toContain('Test-password-123!');
    await adminPage.locator('#activityResults [data-admin-account]').filter({hasText:'Activity Admin'}).first().click();
    const modal=adminPage.getByRole('dialog',{name:'Teacher account overview'});
    await expect(modal).toContainText('games-admin@example.test');
    await expect(modal).toContainText('Recorded AI usage');
    await modal.locator('[data-account-close]').click();
    await expect(modal).not.toBeVisible();

  }finally{await admin.close();}
});
