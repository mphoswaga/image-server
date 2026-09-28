/* One animation loop for the ocean; question renders never start extra loops. */
window.FishBoardSwim=(()=>{
 let swimmers=[],elapsed=0,last=0,paused=true,feeding=false;
 const positions=new Map();
 let meals=[];
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function bind(isFeeding){
  feeding=isFeeding;
  const ocean=document.getElementById('ocean').getBoundingClientRect();
  swimmers=Array.from(document.querySelectorAll('.reef')).flatMap(reef=>{
   const rect=reef.getBoundingClientRect(),nodes=[...reef.querySelectorAll('.swimmer')],cols=Number(reef.style.getPropertyValue('--cols'))||1;
   return nodes.map((node,i)=>({node,reef,originX:rect.left-ocean.left,originY:rect.top-ocean.top,key:node.dataset.playerIndex,body:node.querySelector('.fish-sprite'),i,cols,rows:Math.ceil(nodes.length/cols),width:reef.clientWidth,height:reef.clientHeight,w:node.offsetWidth,h:node.offsetHeight,previousX:null}));
  });
  paint();
 }
 function paint(){
  const points=swimmers.map(s=>{
   const usableH=Math.max(0,s.height-24-s.h),usableW=Math.max(0,s.width-s.w);
   const col=s.i%s.cols,row=Math.floor(s.i/s.cols),phase=elapsed/(4.8+s.i%4)+s.i*2.4;
   const homeX=s.cols===1?.5:col/(s.cols-1),homeY=s.rows===1?.5:row/(s.rows-1);
   const drift=reduced.matches?0:Math.sin(phase)*.28;
   return {s,maxX:usableW,maxY:usableH+24,x:usableW*(homeX*.4+.3+drift),y:24+usableH*(homeY*.6+.2+(reduced.matches?0:Math.cos(phase*.83)*.18))};
  });
  // Give passing fish and their nameplates room without freezing them in a grid.
  for(let pass=0;pass<8;pass++)for(let i=0;i<points.length;i++){
   const a=points[i];
   for(let j=i+1;j<points.length;j++){
    const b=points[j];if(a.s.reef!==b.s.reef)continue;
    const dx=a.x+a.s.w/2-b.x-b.s.w/2,dy=a.y+a.s.h/2-b.y-b.s.h/2;
    const ox=(a.s.w+b.s.w)/2+4-Math.abs(dx),oy=(a.s.h+b.s.h)/2+6-Math.abs(dy);
    if(ox>0&&oy>0){
     if(ox<oy){const push=(dx>=0?1:-1)*ox*.51;a.x+=push;b.x-=push}
     else{const push=(dy>=0?1:-1)*oy*.51;a.y+=push;b.y-=push}
     for(const p of [a,b]){p.x=Math.max(0,Math.min(p.maxX,p.x));p.y=Math.max(24,Math.min(p.maxY,p.y))}
    }
   }
  }
  for(const {s,x,y} of points){
   const old=positions.get(s.key),blend=reduced.matches||!old?1:.12;
   const position={x:old?old.x+(x-old.x)*blend:x,y:old?old.y+(y-old.y)*blend:y};
   s.node.style.left=position.x+'px';s.node.style.top=position.y+'px';
   if(old&&Math.abs(position.x-old.x)>.02)s.body.style.setProperty('--heading',position.x<old.x?-1:1);
   positions.set(s.key,position);
   s.node.classList.toggle('feeding',feeding&&s.node.dataset.fed==='true');
  }
  for(const meal of meals){
   if(!meal.node.isConnected)continue;
   const swimmer=swimmers.find(s=>s.key===meal.key),position=positions.get(meal.key);
   if(!swimmer||!position)continue;
   const heading=Number(swimmer.body.style.getPropertyValue('--heading'))||1;
   const x=swimmer.originX+position.x+swimmer.w*(heading>0?.7:.3),y=swimmer.originY+position.y+(swimmer.h-16)*.5;
   meal.node.style.setProperty('--dx',(x-meal.start)+'px');meal.node.style.setProperty('--dy',y+'px');
  }
 }
 function frame(now){
  const dt=last?Math.min(64,now-last):0;last=now;
  if(!paused){elapsed+=dt/1000;paint()}
  requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);
 return {bind,meal:()=>{meals=[...document.querySelectorAll('.pellet[data-target]')].map(node=>({node,key:node.dataset.target,start:Number(node.dataset.start)}))},pause:value=>{paused=value},clear:()=>{swimmers=[];positions.clear();meals=[];paused=true}};
})();
