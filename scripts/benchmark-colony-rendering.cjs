// Local synthetic renderer comparison; not a classroom device/network capacity claim.
const { chromium } = require('playwright');
const express = require('express');
const { once } = require('events');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
(async () => {
  const root=path.resolve(__dirname,'..'), app=express();
  app.use(express.static(path.join(root,'public')));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const browser=await chromium.launch();
  try {
    const sources=[['baseline',execFileSync('git',['show','HEAD:public/colonyquest-live-art.js'],{cwd:root,encoding:'utf8'})],['working',fs.readFileSync(path.join(root,'public/colonyquest-live-art.js'),'utf8')]];
    for(const [name,source] of sources) for(const scenario of ['colony','spider']) {
      const page=await browser.newPage({viewport:{width:1366,height:768}});
      await page.goto(`http://127.0.0.1:${server.address().port}/colonyquest-core.js`);
      await page.setContent('<canvas style="width:1300px;height:700px"></canvas>');
      await page.addScriptTag({content:fs.readFileSync(path.join(root,'public/colonyquest-core.js'),'utf8')});
      await page.addScriptTag({url:'/colony-presentation.js'});
      const story=name==='baseline'?execFileSync('git',['show','HEAD:public/colonyquest-live-story.js'],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,'public/colonyquest-live-story.js'),'utf8');
      await page.addScriptTag({content:story});
      await page.addScriptTag({content:source});
      await page.evaluate(scenario=>{
        window.scene=new ColonyScene(document.querySelector('canvas'));cancelAnimationFrame(scene.raf);
        const colony=ColonyQuestCore.createTeam({name:'Benchmark'},0);
        Object.assign(colony,{workers:20,soldiers:8,territory:8,expansionRooms:5,pantryBuilt:true,barracksBuilt:true,defense:5,food:80});
        scene.update({id:'benchmark',phase:scenario==='spider'?'story':'answer',story:scenario==='spider'?{key:'predator',duration:9000,elapsed:0,results:[{playerId:'a',food:-4}]}:null,world:{},events:[],me:{id:'a',colony}});
      },scenario);
      await page.waitForLoadState('networkidle');
      const result=await page.evaluate(()=>{
        let t=performance.now();scene.last=t;scene.lastPaint=t;
        const samples=[];
        for(let i=0;i<180;i++) {
          const before=performance.now();scene.draw(t+=40);cancelAnimationFrame(scene.raf);
          // Force completion of pending canvas work rather than timing command submission alone.
          scene.ctx.getImageData(0,0,1,1);
          if(i>=30)samples.push(performance.now()-before);
        }
        samples.sort((a,b)=>a-b);
        return {medianMs:samples[Math.floor(samples.length/2)],p95Ms:samples[Math.floor(samples.length*.95)],spriteBuilds:scene.spriteBuilds||0,cachePixels:scene.spritePixels||0};
      });
      console.log(name,scenario,JSON.stringify(result));await page.close();
    }
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
