/* Shared visual rules only: game rules and outcomes remain in their existing engines. */
(function(root){
 'use strict';
 const clamp=n=>Math.max(0,Math.min(1,Number(n)||0));
 function creaturePose(kind,seconds,reduced=false){
  const speed=reduced?2:kind==='bird'?6:5.5;
  const phase=seconds*speed;
  return {frame:Math.floor(phase)%2,bob:Math.sin(phase*Math.PI)*(reduced?.008:.025)};
 }
 function swarmPose(index,progress,width,height,reduced=false){
  const p=clamp(progress),side=index%2?1:-1,column=(index*61%100)/100,row=(index*37%100)/100;
  const inside=40+column*Math.max(1,width-80),arrival=Math.min(1,p/.25),departure=Math.max(0,(p-.72)/.28);
  return {x:reduced?inside+Math.sin(p*12+index)*6:inside+side*(1-arrival)*(width+100)+side*departure*(width+120)+Math.sin(p*22+index)*20,
   y:50+row*Math.max(1,height-100)+Math.sin(p*(reduced?10:17)+index)*(reduced?4:14),
   alpha:reduced&&p>.72?1-departure:1,right:side<0,seconds:p*9+index*.2};
 }
 function raidBeat(progress){
  const p=clamp(progress);
  return {phase:p<.15?'rally':p<.5?'approach':p<.68?'clash':'return',
   travel:p<.15?0:p<.5?(p-.15)/.35:p<.68?1:1-(p-.68)/.32,
   clash:clamp((p-.5)/.18),moment:p<.15?'versus':p>=.76?'result':''};
 }
 function raidDuration(individual){return individual?6400:8400;}
 function raidResult(event){
  const attacker=event.attackerName||'Raiding colony',defender=event.targetName||'Defending colony';
  const stolen=Math.max(0,Number(event.stolen)||0);
  return {attacker,defender,winner:event.success?attacker:defender,
   title:event.success?'Raid successful!':'Raid defended!',
   detail:event.success?`${stolen} food carried home`:`Food protected${event.targetFoodChange>0?' · +'+event.targetFoodChange+' food':''}`};
 }
 class RaidMoment {
  constructor(parent){
   this.element=document.createElement('aside');this.element.className='colony-raid-moment';this.element.hidden=true;
   this.element.setAttribute('aria-live','polite');parent.append(this.element);
  }
  clear(){this.element.hidden=true;this.signature='';delete this.element.dataset.moment;}
  destroy(){this.element.remove();}
  pause(paused){this.element.classList.toggle('is-paused',paused);}
  update(event,progress){
   const moment=raidBeat(progress).moment;if(!moment){this.clear();return;}
   const result=raidResult(event),signature=JSON.stringify([event.id||event.at,result,moment]);
   if(signature===this.signature)return;this.signature=signature;
   this.element.replaceChildren();this.element.dataset.moment=moment;this.element.hidden=false;
   const title=document.createElement('strong');title.className='raid-moment-title';title.textContent=moment==='versus'?'COLONY CHALLENGE':result.title;this.element.append(title);
   const row=document.createElement('div');row.className='raid-moment-contestants';
   for(const [i,name] of [result.attacker,result.defender].entries()){
    if(i){const vs=document.createElement('b');vs.className='raid-moment-vs';vs.textContent=moment==='versus'?'VS':'·';row.append(vs);}
    const side=document.createElement('div');side.className='raid-moment-side';
    if(moment==='result'&&i===(event.success?0:1))side.classList.add('is-winner');
    const ant=document.createElement('img');ant.src='/assets/colonyquest/guardian.webp';ant.alt='';ant.width=72;ant.height=60;
    const label=document.createElement('span');label.textContent=(moment==='result'&&i===(event.success?0:1)?'★ ':'')+name;side.append(ant,label);row.append(side);
   }
   this.element.append(row);
   if(moment==='result'){const detail=document.createElement('p');detail.textContent=result.detail;this.element.append(detail);}
  }
 }
 const api={creaturePose,swarmPose,raidBeat,raidDuration,raidResult,RaidMoment};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ColonyPresentation=api;
})(typeof window==='object'?window:globalThis);
