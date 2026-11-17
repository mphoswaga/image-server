/* Shared raid story: presentation only; server snapshots own outcomes and timing. */
(function(root){
 const assets='/assets/colonyquest/raid-story/';
 class ColonyRaidStory {
  constructor(){
   this.node=document.createElement('section');this.node.className='raid-story';this.node.hidden=true;this.node.setAttribute('aria-label','Colony raid');
   this.node.innerHTML='<div class="raid-story-art"></div><div class="raid-story-shade"></div><div class="raid-story-top"><span>COLONY QUEST</span><span data-role>RAID</span></div><div class="raid-story-names"><strong data-attacker></strong><strong data-defender></strong></div><div class="raid-story-title"><span data-stage></span><h1></h1><p data-reward></p></div><div class="raid-story-caption" role="status"><strong></strong><small></small><div class="raid-story-progress"><i></i></div></div>';
   document.body.append(this.node);this.images={};
   this.audio=new Audio(assets+'raid-drums-and-shields.wav');this.audio.preload='auto';this.enabled=false;this.volume=.5;
   document.addEventListener('visibilitychange',()=>this.clock());
   window.addEventListener('pagehide',()=>this.audio.pause());
   for(const name of ['approach','clash','victory','defence']){const img=new Image();img.decoding='async';img.fetchPriority='low';img.src=assets+name+'.webp';this.images[name]=img;}
  }
  configure(enabled,volume){this.enabled=!!enabled;this.volume=Math.max(0,Math.min(1,Number(volume)||0));this.audio.volume=this.volume*.65;if(!this.enabled||!this.volume)this.audio.pause();}
  sync(state){
   this.state=state;const raid=state?.raid||state?.duel?.raid;
   if(!raid?.event||!state.me||!['raidWatching','duelRaid','paused'].includes(state.phase)){this.hide();return;}
   const e=raid.event;
   if(e.attacker!==state.me.id&&e.target!==state.me.id){this.hide();return;}
   this.raid=raid;this.event=e;this.received=performance.now();
   this.remaining=raid.remaining??Math.max(0,raid.until-state.serverNow);
   this.duration=raid.startedAt!=null?raid.until-raid.startedAt:(root.ColonyPresentation?.raidDuration(true)||6400)+2000;
   this.node.querySelector('[data-attacker]').textContent=e.attackerName||'Attacking colony';
   this.node.querySelector('[data-defender]').textContent=e.targetName||'Defending colony';
   this.node.querySelector('[data-role]').textContent=e.attacker===state.me.id?'YOUR COLONY IS RAIDING':'DEFEND YOUR COLONY';
   this.node.hidden=false;document.body.classList.add('raid-story-active');this.clock();
  }
  clock(){
   if(this.node.hidden)return;
   const held=this.state.phase==='paused'||this.state.me?.teacherPaused||document.body.classList.contains('offline');
   const remaining=Math.max(0,this.remaining-(held?0:performance.now()-this.received));
   const progress=Math.max(0,Math.min(1,1-remaining/this.duration));
   const phase=progress<.25?'approach':progress<.6?'clash':this.event.success?'victory':'defence';
   const e=this.event,result=['victory','defence'].includes(phase);
   if(this.phase!==phase||this.eventId!==e.id){
    this.phase=phase;this.eventId=e.id;
    this.node.dataset.phase=phase;
    this.node.querySelector('.raid-story-art').style.backgroundImage='url("'+assets+phase+'.webp")';
    this.node.querySelector('[data-stage]').textContent=result?'RAID COMPLETE':phase==='approach'?'RAID INCOMING':'RAID IN PROGRESS';
    this.node.querySelector('h1').textContent=result?(e.success?e.attackerName:e.targetName)+' wins the raid!':phase==='approach'?(e.attackerName||'A rival')+' approaches the nest!':'The guards defend the food store!';
    const a=e.attackerFoodChange??(e.success?e.stolen:0),d=e.targetFoodChange??(e.success?-e.stolen:5);
    const signed=n=>(n>0?'+':'')+n;
    this.node.querySelector('[data-reward]').textContent=result?`${e.attackerName}: ${signed(a)} food  |  ${e.targetName}: ${signed(d)} food`:'';
    this.node.querySelector('.raid-story-caption strong').textContent=result?(e.success?'The raiders carry their seeds home.':'The defenders keep their seeds safe!'):phase==='approach'?'The raiders are approaching. Guards, get ready!':'A clash at the gate! Who will protect the seeds?';
   }
   this.node.querySelector('.raid-story-caption small').textContent=held?'Paused - your raid will resume with the game.':remaining===0?'Returning to your colony…':'Both colonies return to play automatically.';
   this.node.style.setProperty('--raid-progress',progress);
   this.node.classList.toggle('is-paused',held);
   if(held||document.hidden||!this.enabled||!this.volume||remaining===0){this.audio.pause();return;}
   // Follow shared raid progress, without restarting on repeated snapshots.
   const position=progress*8.4;
   if(Number.isFinite(this.audio.duration)&&Math.abs(this.audio.currentTime-position)>.8)this.audio.currentTime=Math.min(position,this.audio.duration);
   this.audio.playbackRate=8.4/(this.duration/1000);
   if(this.audio.paused&&!this.audio.ended&&!this.playPending){this.playPending=true;this.audio.play().catch(()=>{}).finally(()=>{this.playPending=false;if(this.node.hidden||!this.enabled||document.hidden)this.audio.pause();});}

  }
  hide(){this.audio.pause();this.audio.currentTime=0;this.node.hidden=true;this.phase=null;this.eventId=null;document.body.classList.remove('raid-story-active');}
 }
 root.ColonyRaidStory=ColonyRaidStory;
})(window);
