const {test,expect}=require('@playwright/test');
test('real soundtrack keeps advancing across repeated game updates for one minute',async({page})=>{
  test.setTimeout(90000);
  await page.goto('/healthz');
  await page.setContent('<button id="start">Start music</button>');
  await page.addScriptTag({url:'/colonyquest-music.js'});
  await page.evaluate(()=>{
    window.music=new ColonyMusic();window.interruptions=[];
    for(const name of ['error','stalled','waiting','pause'])music.media.addEventListener(name,()=>{if(music.media.currentTime>2)interruptions.push(name);});
    document.querySelector('#start').onclick=()=>music.setActive(true);
  });
  await page.click('#start');
  await expect.poll(()=>page.evaluate(()=>music.media.currentTime)).toBeGreaterThan(1);
  let previous=await page.evaluate(()=>music.media.currentTime);
  for(let i=0;i<12;i++){
    await page.waitForTimeout(5000);
    const current=await page.evaluate(()=>{music.setActive(true);music.setVolume(.3);return music.media.currentTime;});
    expect(current-previous).toBeGreaterThan(3);previous=current;
  }
  expect(await page.evaluate(()=>interruptions)).toEqual([]);
});
