const {test,expect} = require('@playwright/test');

test('pirate stays centred on each executed tile at every supported board size',async ({page},testInfo)=>{
  test.slow();
  test.skip(!['windows-100','mobile'].includes(testInfo.project.name));
  await page.goto('/practical-practice.html?activity=codequest');
  const iframe = page.locator('.practice-card:visible iframe');
  const frame = await (await iframe.elementHandle()).contentFrame();
  await expect(frame.locator('#test')).toBeVisible();
  for (const size of [4,5,6,8]) {
    await frame.evaluate(size=>{
      const mission={size,start:[0,size-1,1],chest:[size-1,0],rocks:[],water:[],requireReturn:false,blocks:['move','left','right','collect']};
      const program=[...Array(size-1).fill({op:'move'}),{op:'left'},...Array(size-1).fill({op:'move'}),{op:'collect'}];
      window.mountAssessmentStage({mission},program,()=>{},()=>{});
    },size);
    // Check every coordinate directly, using the game's renderer.
    const positions = await frame.evaluate(size=>{
      const board=document.getElementById('island');
      const points=[];
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        window.mountAssessmentStage({mission:{size,start:[x,y,1],chest:[size-1,0],rocks:[],water:[],requireReturn:false}},[],()=>{},()=>{});
        const tile=board.children[y*size+x].getBoundingClientRect();
        const pirate=board.querySelector('.pirate').getBoundingClientRect();
        points.push(Math.abs(tile.x+tile.width/2-pirate.x-pirate.width/2),Math.abs(tile.y+tile.height/2-pirate.y-pirate.height/2));
      }
      return points;
    },size);
    expect(Math.max(...positions)).toBeLessThan(1);
    await frame.evaluate(size=>{
      const mission={size,start:[0,size-1,1],chest:[size-1,0],rocks:[],water:[],requireReturn:false};
      const program=[...Array(size-1).fill({op:'move'}),{op:'left'},...Array(size-1).fill({op:'move'}),{op:'collect'}];
      window.mountAssessmentStage({mission},program,()=>{},()=>{});
    },size);
    await frame.getByRole('button',{name:'Test my code'}).click();
    await expect(frame.locator('#testResult')).toContainText('Treasure collected',{timeout:15000});
    await expect.poll(()=>frame.locator('#island').evaluate(board=>{
      const chest=board.querySelector('.treasure-collected').getBoundingClientRect();
      const pirate=board.querySelector('.pirate').getBoundingClientRect();
      return Math.abs(chest.x+chest.width/2-pirate.x-pirate.width/2)+Math.abs(chest.y+chest.height/2-pirate.y-pirate.height/2);
    })).toBeLessThan(1);
  }
});
