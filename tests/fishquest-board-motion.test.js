const test=require('node:test'),assert=require('node:assert/strict');
const Motion=require('../public/fishquest-board-motion');
function school(){return Array.from({length:25},(_,i)=>Motion.create({reef:'one',seed:i,width:550,height:400,w:70,h:48,homeX:(i%5)/4,homeY:Math.floor(i/5)/4}))}
test('crowded fish glide with bounded speed and acceleration instead of jumping apart',()=>{
 const fish=school();let travel=0,turns=0;
 for(let frame=1;frame<=1800;frame++){
  const before=fish.map(f=>({...f}));Motion.step(fish,frame/60,1/60);
  fish.forEach((f,i)=>{
   const old=before[i],distance=Math.hypot(f.x-old.x,f.y-old.y);travel+=distance;
   assert.ok(distance<=Motion.SPEED/60+1e-8,'No fish teleports between frames');
   assert.ok(Math.hypot(f.vx-old.vx,f.vy-old.vy)<=Motion.ACCELERATION/60+1e-8,'Turns accelerate gradually');
   if(f.heading!==old.heading){assert.ok(f.lastTurn-old.lastTurn>1.5);turns++}
  });
 }
 assert.ok(travel>1000);assert.ok(turns>0);
});
test('swimming stays consistent across refresh rates and invalid time cannot change positions',()=>{
 const run=hz=>{const fish=school();for(let frame=1;frame<=hz*10;frame++){let dt=1/hz,time=(frame-1)/hz;while(dt>1e-10){const step=Math.min(dt,1/120);time+=step;Motion.step(fish,time,step);dt-=step}}return fish};
 const low=run(30),high=run(120);
 low.forEach((f,i)=>assert.ok(Math.hypot(f.x-high[i].x,f.y-high[i].y)<.01));
 const before=JSON.stringify(low);Motion.step(low,10,0);Motion.step(low,10,NaN);assert.equal(JSON.stringify(low),before);
});
