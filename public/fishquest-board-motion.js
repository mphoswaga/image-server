(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FishBoardMotion=factory()})(this,()=>{
 const SPEED=28,ACCELERATION=18;
 const limit=(x,y,max)=>{const length=Math.hypot(x,y);return length>max?{x:x*max/length,y:y*max/length}:{x,y}};
 function bounds(f){return {x:Math.max(0,f.width-f.w),y:Math.max(0,f.height-24-f.h)}}
 function create(layout){
  const b=bounds(layout);
  return {...layout,x:b.x*layout.homeX,y:24+b.y*layout.homeY,vx:0,vy:0,heading:1,lastTurn:-10};
 }
 function step(fish,time,dt){
  if(!Number.isFinite(dt)||dt<=0)return;
  dt=Math.min(dt,.05);
  // Steering affects velocity, never position: neighbours cannot push a fish
  // instantly sideways, even when a crowded school crosses paths.
  const velocities=fish.map(f=>{
   const b=bounds(f),phase=time/(6+f.seed%4)+f.seed*2.4;
   const tx=b.x*(f.homeX*.45+.275+Math.sin(phase)*.25);
   const ty=24+b.y*(f.homeY*.7+.15+Math.cos(phase*.8)*.13);
   let vx=(tx-f.x)*.65,vy=(ty-f.y)*.65;
   for(const other of fish){
    if(other===f||other.reef!==f.reef)continue;
    const dx=(f.x+f.w/2-other.x-other.w/2)/((f.w+other.w)/2+8);
    const dy=(f.y+f.h/2-other.y-other.h/2)/((f.h+other.h)/2+8);
    const distance=Math.hypot(dx,dy);
    if(distance>0&&distance<1.3){const force=SPEED*(1.3-distance);vx+=dx/distance*force;vy+=dy/distance*force}
   }
   // Slow before a reef edge instead of bouncing or teleporting on contact.
   if(f.x<25)vx+=Math.max(0,25-f.x)*.9;
   if(f.x>b.x-25)vx-=Math.max(0,f.x-(b.x-25))*.9;
   if(f.y<44)vy+=Math.max(0,44-f.y)*.9;
   if(f.y>24+b.y-20)vy-=Math.max(0,f.y-(24+b.y-20))*.9;
   const desired=limit(vx,vy,SPEED),change=limit(desired.x-f.vx,desired.y-f.vy,ACCELERATION*dt);
   return {x:f.vx+change.x,y:f.vy+change.y};
  });
  fish.forEach((f,i)=>{
   f.vx=velocities[i].x;f.vy=velocities[i].y;
   f.x+=f.vx*dt;f.y+=f.vy*dt;
   // Direction hysteresis prevents flickering when a fish slows or changes course.
   if(Math.abs(f.vx)>5&&time-f.lastTurn>1.5){const heading=f.vx<0?-1:1;if(heading!==f.heading){f.heading=heading;f.lastTurn=time}}
  });
 }
 return {create,step,SPEED,ACCELERATION};
});
