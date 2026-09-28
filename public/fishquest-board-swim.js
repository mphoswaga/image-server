/* One animation loop, with persistent velocities across question renders. */
window.FishBoardSwim=(()=>{
 let swimmers=[],elapsed=0,last=0,paused=true,meals=[];
 const positions=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function bind(isFeeding){
  const ocean=document.getElementById('ocean').getBoundingClientRect();
  swimmers=Array.from(document.querySelectorAll('.reef')).flatMap(reef=>{
   const rect=reef.getBoundingClientRect(),nodes=[...reef.querySelectorAll('.swimmer')],cols=Number(reef.style.getPropertyValue('--cols'))||1,rows=Math.ceil(nodes.length/cols);
   return nodes.map((node,i)=>{
    const key=node.dataset.playerIndex,layout={reef:reef.dataset.team,seed:i,width:reef.clientWidth,height:reef.clientHeight,w:node.offsetWidth,h:node.offsetHeight,homeX:cols===1?.5:(i%cols)/(cols-1),homeY:rows===1?.5:Math.floor(i/cols)/(rows-1)};
    let motion=positions.get(key);
    if(!motion){motion=FishBoardMotion.create(layout);positions.set(key,motion)}else Object.assign(motion,layout);
    node.style.left='0';node.style.top='0';
    node.classList.toggle('feeding',isFeeding&&node.dataset.fed==='true');
    return {node,key,motion,body:node.querySelector('.fish-sprite'),originX:rect.left-ocean.left,originY:rect.top-ocean.top};
   });
  });
  paint();
 }
 function paint(){
  for(const s of swimmers){
   const p=s.motion;
   s.node.style.transform='translate3d('+p.x.toFixed(3)+'px,'+p.y.toFixed(3)+'px,0)';
   s.body.style.setProperty('--heading',p.heading);
  }
  for(const meal of meals){
   if(!meal.node.isConnected)continue;
   const s=swimmers.find(s=>s.key===meal.key);if(!s)continue;
   const p=s.motion,x=s.originX+p.x+p.w*(p.heading>0?.7:.3),y=s.originY+p.y+(p.h-16)*.5;
   meal.node.style.setProperty('--dx',(x-meal.start)+'px');meal.node.style.setProperty('--dy',y+'px');
  }
 }
 function frame(now){
  let dt=last?Math.min(.05,(now-last)/1000):0;last=now;
  if(!paused&&!reduced.matches){
   // Small integration steps keep movement consistent on 30/60/120 Hz displays.
   while(dt>0){const step=Math.min(dt,1/120);elapsed+=step;FishBoardMotion.step(swimmers.map(s=>s.motion),elapsed,step);dt-=step}
   paint();
  }
  requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);
 return {bind,meal:()=>{meals=[...document.querySelectorAll('.pellet[data-target]')].map(node=>({node,key:node.dataset.target,start:Number(node.dataset.start)}))},pause:value=>{paused=value},clear:()=>{swimmers=[];positions.clear();meals=[];paused=true;elapsed=0}};
})();
