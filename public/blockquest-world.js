/* Original, shared procedural scenery. No game state or timing is changed here. */
(()=>{'use strict';
const palettes=[{name:'Aurora',hue:175,second:270},{name:'Ember city',hue:32,second:345},{name:'Stardust',hue:218,second:288}];
window.BlockQuestWorld=class {
 constructor(audio){
  this.audio=audio;this.time=0;this.frame=0;this.last=0;this.scene=0;this.previous=0;this.transition=0;this.manual=false;this.events=[];this.seen=new Set();this.paused=false;this.light=false;
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');
  this.canvas=document.createElement('canvas');this.canvas.id='blockquest-world';this.canvas.setAttribute('aria-hidden','true');
  this.fx=document.createElement('canvas');this.fx.id='blockquest-impact';this.fx.setAttribute('aria-hidden','true');
  document.body.prepend(this.canvas);document.body.append(this.fx);this.ctx=this.canvas.getContext('2d');this.ink=this.fx.getContext('2d');
  this.control=document.createElement('details');this.control.className='world-controls';this.control.innerHTML='<summary>Scenery</summary><div><label>World<select aria-label="Scenery world"><option value="auto">Journey · changes with rows</option>'+palettes.map((p,i)=>`<option value="${i}">${p.name}</option>`).join('')+'</select></label><button type="button" aria-pressed="false">Gentle effects</button></div>';
  document.querySelector('header nav').append(this.control);
  this.control.querySelector('select').onchange=e=>{this.manual=e.target.value!=='auto';this.setScene(this.manual?Number(e.target.value):this.progressScene||0);};
  this.control.querySelector('button').onclick=e=>{this.light=!this.light;e.target.setAttribute('aria-pressed',String(this.light));this.resetMotion();};
  this.stars=Array.from({length:180},(_,i)=>({x:this.rand(i*5),y:this.rand(i*7+2),z:.2+this.rand(i*3+5)*.8,phase:this.rand(i+9)*6.28}));
  this.sprites=palettes.map(p=>[this.sprite(p.hue),this.sprite(p.second)]);
  this.resize=()=>{this.w=innerWidth;this.h=innerHeight;this.dpr=Math.min(devicePixelRatio||1,innerWidth<650?1:1.5);for(const c of [this.canvas,this.fx]){c.width=Math.round(this.w*this.dpr);c.height=Math.round(this.h*this.dpr);}this.cityCache=null;this.measure();this.paint();};
  addEventListener('resize',this.resize);addEventListener('scroll',()=>this.measure(),{passive:true});
  this.motion.addEventListener('change',()=>this.resetMotion());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.events=[];this.schedule();});
  addEventListener('pagehide',()=>{this.destroyed=true;cancelAnimationFrame(this.frame);});
  this.resize();this.resetMotion();
 }
 rand(n){const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);}
 sprite(hue){const c=document.createElement('canvas');c.width=c.height=48;const g=c.getContext('2d'),r=g.createRadialGradient(24,24,0,24,24,24);r.addColorStop(0,'#ffffff');r.addColorStop(.1,`hsl(${hue} 100% 85%)`);r.addColorStop(.3,`hsla(${hue},100%,60%,.45)`);r.addColorStop(1,`hsla(${hue},100%,50%,0)`);g.fillStyle=r;g.fillRect(0,0,48,48);return c;}
 resetMotion(){this.gentle=this.light||this.motion.matches;document.body.classList.toggle('world-gentle',this.gentle);this.events=[];this.paint();this.schedule();}
 setScene(next){next%=palettes.length;if(next!==this.scene){this.previous=this.scene;this.scene=next;this.transition=this.time;}document.body.dataset.world=palettes[this.scene].name;this.paint();}
 measure(){this.reading=!!document.querySelector('#arena:not([hidden]) #answers button');this.safe=[...document.querySelectorAll('header,.dock,.round,.panel:not(.dock),.tower-top')].filter(e=>!e.hidden&&e.getClientRects().length).map(e=>e.getBoundingClientRect());}
 sync(state){
  if(!state)return;const run=state.run||state;this.paused=state.phase==='paused'||run.phase==='paused';
  const lines=(run.teams||[]).reduce((n,t)=>n+(t.lines||0),0);this.progressScene=(Math.floor(lines/3)+Math.max(0,(state.roundNumber||1)-1))%3;
  if(!this.manual)this.setScene(this.progressScene);this.measure();
  if(run.phase==='placing'&&run.lastDrop){const key=run.id+':'+run.turn+':'+run.placementStartedAt;
   if(!this.seen.has(key)){this.seen.add(key);if(this.seen.size>100)this.seen.delete(this.seen.values().next().value);
    const age=(run.serverNow||state.serverNow||Date.now())-(run.placementStartedAt||Date.now());
    const rect=document.querySelector('.tower.active .grid')?.getBoundingClientRect();
    if(rect&&age<3400){const rows=run.lastPlacement||[],ys=rows.length?rows:[run.lastDrop.y];for(const y of ys)this.burst(rect,y,rows.length?'clear':'build',rows.length?.65-age/1000:-age/1000);}
   }
  }
  if(state.phase==='ended'&&!this.seen.has(state.id+':win')){this.seen.add(state.id+':win');this.events.push({kind:'win',born:this.time,x:this.w/2,y:this.h*.32,seed:19});}
  this.schedule();
 }
 burst(rect,row,kind,delay){if(this.gentle)return;this.events.push({kind,born:this.time+delay,x:rect.left+rect.width/2,y:rect.top+(row+.5)*rect.height/10,width:rect.width,seed:Math.floor(this.time*100)});this.events=this.events.slice(-12);}
 schedule(){cancelAnimationFrame(this.frame);this.frame=0;this.last=0;this.canvas.dataset.motion=this.gentle||this.paused||document.hidden?'still':'animated';
  if(this.destroyed||this.gentle||this.paused||document.hidden){this.paint();return;}
  const tick=stamp=>{if(!this.last)this.last=stamp;const delta=stamp-this.last;if(delta>=1000/this.fps){this.time+=Math.min(delta,100)/1000;this.last=stamp;const start=performance.now();this.paint();const cost=performance.now()-start;this.slow=cost>18?(this.slow||0)+1:Math.max(0,(this.slow||0)-1);if(this.slow>12){this.fps=20;this.budget=60;}}this.frame=requestAnimationFrame(tick);};
  this.fps=this.w<650?24:30;this.budget=this.w<650?80:150;this.frame=requestAnimationFrame(tick);
 }
 paint(){if(!this.ctx)return;const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.w,this.h);
  const blend=this.gentle?1:Math.min(1,(this.time-this.transition)/2.5);if(blend<1&&this.previous!==this.scene)this.world(this.previous,1-blend);this.world(this.scene,blend<1&&this.previous!==this.scene?blend:1);this.impacts();
 }
 world(index,opacity){const c=this.ctx,{hue,second}=palettes[index],w=this.w,h=this.h,t=this.time,pulse=this.gentle?0:(this.audio.pulseLevel||0),quiet=this.reading;
  c.save();c.globalAlpha=opacity;c.fillStyle='#030611';c.fillRect(0,0,w,h);
  const glow=c.createRadialGradient(w*.5,h*.6,0,w*.5,h*.6,w*.65);glow.addColorStop(0,`hsla(${hue},80%,24%,${.38+pulse*.18})`);glow.addColorStop(.55,`hsla(${second},65%,13%,.25)`);glow.addColorStop(1,'transparent');c.fillStyle=glow;c.fillRect(0,0,w,h);
  if(index===0)this.aurora(c,w,h,t,hue,second,pulse);else if(index===1)this.city(c,w,h,t,hue,pulse);else this.orbits(c,w,h,t,hue,second,pulse);
  c.globalCompositeOperation='screen';const count=this.gentle?35:(this.budget||100);
  for(let i=0;i<count;i++){const s=this.stars[i],x=(s.x*w+Math.sin(t*.08+s.phase)*12+w)%w,y=((s.y*h-t*(index===1?9:3)*s.z)%h+h)%h,size=(1+s.z*3)*(1+pulse*.35);c.globalAlpha=opacity*(.3+.4*s.z)*(quiet?.75:1);c.drawImage(this.sprites[index][i%2],x-size,y-size,size*2,size*2);}
  c.restore();
 }
 aurora(c,w,h,t,hue,second,pulse){
  c.save();c.globalCompositeOperation='screen';
  for(let ribbon=0;ribbon<5;ribbon++){
   const grad=c.createLinearGradient(0,h*.08,0,h*.7);grad.addColorStop(0,`hsla(${ribbon%2?hue:second},95%,65%,0)`);grad.addColorStop(.5,`hsla(${ribbon%2?hue:second},95%,55%,${.06+pulse*.045})`);grad.addColorStop(1,'transparent');c.fillStyle=grad;c.beginPath();
   for(let x=0;x<=w+16;x+=16){const y=h*(.23+ribbon*.035)+Math.sin(x/w*5+t*.13+ribbon*.6)*h*.12; if(x===0)c.moveTo(x,y);else c.lineTo(x,y);}
   for(let x=w+16;x>=0;x-=16){const y=h*(.44+ribbon*.03)+Math.sin(x/w*5+t*.13+ribbon*.6+.4)*h*.12;c.lineTo(x,y);}c.closePath();c.fill();
  }
  c.strokeStyle=`hsla(${hue},85%,65%,.18)`;c.lineWidth=1;
  for(let j=0;j<3;j++){c.beginPath();for(let x=0;x<=w+16;x+=16){const y=h*(.78+j*.06)+Math.sin(x/w*7+t*.2+j)*h*.035;x===0?c.moveTo(x,y):c.lineTo(x,y);}c.stroke();}c.restore();
 }
 city(c,w,h,t,hue,pulse){
  const baseline=h*.72;
  // Cache hundreds of windows once per resize rather than repainting each frame.
  if(!this.cityCache){const cache=document.createElement('canvas');cache.width=Math.ceil(w+40);cache.height=h;const g=cache.getContext('2d'),bw=Math.max(22,w/36);
   for(let layer=0;layer<2;layer++)for(let i=-1;i<40;i++){const height=(.08+this.rand(i+layer*60)*.3)*h,x=i*bw,y=baseline-height+layer*38;g.fillStyle=layer?'#070b16':'#0b1020';g.fillRect(x,y,bw-3,h-y);g.strokeStyle=`hsla(${hue},80%,55%,${.18+layer*.07})`;g.strokeRect(x,y,bw-3,height);g.fillStyle=`hsla(${hue},100%,65%,.48)`;
    for(let wy=y+9;wy<baseline;wy+=12)for(let wx=5;wx<bw-5;wx+=8)if(this.rand(i*8+wy+wx)>.4)g.fillRect(x+wx,wy,2,3);
    if(i%5===0){g.beginPath();g.moveTo(x+bw/2,y);g.lineTo(x+bw/2,y-24);g.stroke();}
   }this.cityCache=cache;
  }
  c.save();c.globalAlpha*=.8+pulse*.2;c.drawImage(this.cityCache,-20+Math.sin(t*.06)*7,0);c.restore();
  c.strokeStyle=`hsla(${hue},95%,60%,.18)`;for(let i=0;i<8;i++){const y=baseline+((i/8+t*.035)%1)**2*h*.2;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}for(let i=-5;i<6;i++){c.beginPath();c.moveTo(w*.5,baseline);c.lineTo(w*.5+i*w*.25,h);c.stroke();}
 }
 orbits(c,w,h,t,hue,second,pulse){
  c.save();c.translate(w*.5,h*.41);c.rotate(-.35);c.globalCompositeOperation='screen';
  for(let i=0;i<5;i++){c.strokeStyle=`hsla(${i%2?hue:second},90%,70%,${.08+pulse*.07})`;c.lineWidth=i===0?2:1;c.beginPath();c.ellipse(0,0,w*(.14+i*.07),h*(.11+i*.025),0,0,Math.PI*2);c.stroke();
   const a=t*(.08+i*.012)+i*1.8,x=Math.cos(a)*w*(.14+i*.07),y=Math.sin(a)*h*(.11+i*.025);c.drawImage(this.sprites[2][i%2],x-14,y-14,28,28);
  }c.restore();
 }
 impacts(){const c=this.ink,w=this.w,h=this.h;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,w,h);if(this.gentle)return;
  c.save();c.beginPath();c.rect(0,0,w,h);for(const r of this.safe||[])c.rect(r.left-2,r.top-2,r.width+4,r.height+4);c.clip('evenodd');c.globalCompositeOperation='screen';
  this.events=this.events.filter(e=>this.time-e.born<3.4);
  for(const e of this.events){const age=this.time-e.born;if(age<0)continue;const win=e.kind==='win',clear=e.kind==='clear',life=win?3.4:clear?2.6:1,fade=Math.max(0,1-age/life);if(!fade)continue;
   const count=this.w<650?(clear?32:win?70:14):(clear?64:win?130:24),radius=age*(win?250:clear?210:65);
   c.globalAlpha=fade*.6;c.strokeStyle=clear?'#8df9ff':'#ffc675';c.lineWidth=2;c.beginPath();c.ellipse(e.x,e.y,(e.width||80)/2+radius,radius*.25+2,0,0,Math.PI*2);c.stroke();
   for(let i=0;i<count;i++){const a=this.rand(i+e.seed)*Math.PI*2,speed=.3+this.rand(i*3+e.seed),x=e.x+Math.cos(a)*radius*speed,y=e.y+Math.sin(a)*radius*speed+age*age*18,sz=(clear||win?9:5)*(1-age/life);c.globalAlpha=fade*(.45+speed*.4);c.drawImage(this.sprites[this.scene][i%2],x-sz,y-sz,sz*2,sz*2);
    if(i%4===0){c.strokeStyle=i%2?'#d9aaff':'#bafcff';c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x-Math.cos(a)*age*14,y-Math.sin(a)*age*14);c.stroke();}
   }
  }c.restore();
 }
};
})();
