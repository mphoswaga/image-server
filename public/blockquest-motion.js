/* Shared presentation-only interpolation. The server still owns collisions and scoring. */
(()=>{'use strict';
window.BlockQuestMotion=class {
 constructor(container,clock){this.container=container;this.clock=clock;this.frame=0;this.motion=matchMedia('(prefers-reduced-motion: reduce)');this.gentle=()=>this.motion.matches||document.body.classList.contains('world-gentle');this.resize=new ResizeObserver(()=>this.measure());this.resize.observe(container);addEventListener('resize',()=>this.measure());document.addEventListener('visibilitychange',()=>this.schedule());this.motion.addEventListener('change',()=>this.schedule());addEventListener('pagehide',()=>{this.destroyed=true;cancelAnimationFrame(this.frame);this.resize.disconnect();});}
 boards(html,key){const signature=typeof key==='string'?key:JSON.stringify(key);if(this.key===signature)return;this.key=signature;
  const template=document.createElement('template');template.innerHTML=html;const parts=[...template.content.children],keys=Array.isArray(key)?key:parts.map(()=>key);
  parts.forEach((part,i)=>{if(this.partKeys?.[i]===keys[i]&&this.container.children[i])return;const current=this.container.children[i];if(current)current.replaceWith(part);else this.container.append(part);});
  while(this.container.children.length>parts.length)this.container.lastElementChild.remove();this.partKeys=keys;
  const grid=this.container.querySelector('.tower.active .grid');if(this.layer&&grid&&!grid.contains(this.layer))grid.append(this.layer);this.measure();
 }
 reveal(element,key){if(!element||element.hidden||!element.getClientRects().length||element.dataset.motionKey===key)return;element.dataset.motionKey=key;element.getAnimations().forEach(a=>a.cancel());if(!this.gentle())element.animate([{opacity:.65,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});}
 dropDistance(run){const d=run.lastDrop;if(!d)return 0;const key=run.id+':'+run.turn+':'+(run.answers?.length??run.placementStartedAt);
  if(this.dropKey!==key){this.dropKey=key;const visual=this.layer&&this.run?.id===run.id?this.y:0;this.drop=Math.max(0,d.y-Math.max(d.fromY||0,visual));}return this.drop;
 }
 measure(){const grid=this.container.querySelector('.tower.active .grid');if(!grid)return;this.width=grid.clientWidth-10;this.height=grid.clientHeight-10;this.dx=(this.width+2)/8;this.dy=(this.height+2)/10;}
 sync(run,active=true){this.run=run;this.active=active;const show=active&&run?.falling&&(run.phase==='choose'||run.phase==='paused'&&run.beforePause==='choose');
  if(!show){this.layer?.remove();this.layer=null;this.identity=null;this.cells=null;this.schedule();return;}
  const grid=this.container.querySelector('.tower.active .grid');if(!grid)return;
  const f=run.falling,key=run.id+':'+run.turn+':'+(run.answers?.length||0);
  if(!this.layer){this.layer=document.createElement('div');this.layer.className='moving-block smooth-piece';this.layer.setAttribute('aria-hidden','true');grid.append(this.layer);this.measure();}
  const shapeKey=f.shape+':'+f.rotation;
  if(this.shapeKey!==shapeKey||!this.layer.children.length){const cells=BlockQuest.cells(f.shape,f.rotation),old=this.cells;this.shapeKey=shapeKey;
   cells.forEach(([x,y],i)=>{let cell=this.layer.children[i];if(!cell){cell=document.createElement('span');this.layer.append(cell);}cell.className='cell '+f.shape;cell.style.gridColumn=x+1;cell.style.gridRow=y+1;
    cell.getAnimations().forEach(a=>a.cancel());if(old&&this.identity===key&&!this.gentle())cell.animate([{transform:`translate(${(old[i][0]-x)*this.dx}px,${(old[i][1]-y)*this.dy}px)`},{transform:'translate(0,0)'}],{duration:160,easing:'cubic-bezier(.2,.7,.2,1)'});
   });this.cells=cells;
  }
  if(this.identity!==key){this.identity=key;this.x=f.column;this.y=f.y;}
  this.draw(0);this.schedule();
 }
 target(){const r=this.run,f=r.falling,board=r.teams[r.active||0].board,shape=BlockQuest.cells(f.shape,f.rotation),at=r.phase==='paused'?r.pausedAt:this.clock();let y=f.y;
  const steps=Math.max(0,(Math.min(at,r.deadline||at)-f.lastStepAt)/1500),whole=Math.min(10,Math.floor(steps));
  for(let i=0;i<whole;i++){if(!BlockQuest.fits(board,shape,f.column,y+1))return y;y++;}
  if(!this.gentle()&&BlockQuest.fits(board,shape,f.column,y+1))y+=Math.min(1,steps-whole);return y;
 }
 draw(dt){if(!this.layer||!this.run?.falling)return;const f=this.run.falling,target=this.target(),ease=this.gentle()?1:1-Math.exp(-dt/55);
  this.x+=(f.column-this.x)*ease;this.y+=(target-this.y)*ease;
  if(this.gentle()){this.x=f.column;this.y=target;}
  this.layer.style.transform=`translate3d(${this.x*this.dx}px,${this.y*this.dy}px,0)`;
 }
 schedule(){const stop=this.destroyed||document.hidden||!this.layer||!this.active||this.run?.phase!=='choose';if(stop){cancelAnimationFrame(this.frame);this.frame=0;this.last=0;return;}if(this.frame)return;
  const tick=t=>{const dt=this.last?Math.min(80,t-this.last):16.7;this.last=t;this.draw(dt);this.frame=requestAnimationFrame(tick);};this.frame=requestAnimationFrame(tick);
 }
};
})();
