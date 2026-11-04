/* Reuse the locally hosted, credited ColonyQuest soundtrack. Music never blocks play. */
window.CodeQuestMusic=class {
 constructor(button){
  this.button=button;this.enabled=true;this.player=new ColonyMusic(track=>{this.trackTitle=track.title+' — '+track.artist;button.title=this.trackTitle;});
  // Preserve the button’s retry intent before the shared gesture handler unblocks media.
  this.celebration=new ColonyMusic(()=>{});this.celebration.media.src='/assets/codequest/celebration.wav';this.celebration.media.loop=true;this.celebration.media.dataset.codequestCelebration='true';this.celebration.setVolume(.3);this.celebrationKey='';
  this.retryRequested=false;button.addEventListener('pointerdown',()=>{this.retryRequested=this.enabled&&this.audiblePlayer().blocked;});button.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))this.retryRequested=this.enabled&&this.audiblePlayer().blocked;});
  this.player.index=1;this.player.selectTrack();this.player.media.loop=true;this.player.media.dataset.codequestMusic='true';this.player.setVolume(.14);
  const unlock=event=>{if(event.target?.closest?.('#music'))return;if(this.enabled){this.player.blocked=false;this.celebration.blocked=false;this.sync(this.state,this.practice);}};
  document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);
  document.addEventListener('visibilitychange',()=>this.sync(this.state,this.practice));
  window.addEventListener('pagehide',()=>{this.player.setActive(false);this.celebration.setActive(false);});
  this.player.media.addEventListener('error',()=>this.updateButton());this.updateButton();
 }
 audiblePlayer(){return this.celebrating?this.celebration:this.player;}
 updateButton(){this.button.textContent=this.enabled?(this.audiblePlayer().blocked?'Play music':'Music on'):'Music off';this.button.setAttribute('aria-pressed',String(this.enabled));}
 sync(state,practice=false){this.state=state;this.practice=practice;const phase=state?.phase,active=this.enabled&&!!state&&(practice||['build','replay','results'].includes(phase))&&phase!=='paused';
  this.celebrating=!practice&&(phase==='replay'&&state.serverNow>=state.replayEnd-6000||phase==='results'||phase==='ended'&&state.round>0);const key=state?.id+':'+state?.round;if(this.celebrating&&this.celebrationKey!==key){this.celebrationKey=key;this.celebration.media.currentTime=0;}this.celebration.setActive(this.enabled&&this.celebrating);this.player.setActive(active&&!this.celebrating);this.button.title=this.celebrating?'Original CodeQuest treasure celebration':this.trackTitle||'CodeQuest soundtrack';const urgent=phase==='build'&&state.deadline-state.serverNow<=6000;this.player.setVolume(practice?.1:urgent?.035:phase==='build'?.14:['countdown','launch'].includes(phase)?.23:.19);this.updateButton();
 }
 toggle(){if(this.retryRequested||this.enabled&&this.audiblePlayer().blocked){this.retryRequested=false;this.player.blocked=false;this.celebration.blocked=false;}else this.enabled=!this.enabled;this.sync(this.state,this.practice);return this.enabled;}
};

/* Two local, metallic bell strikes for each new opponent announcement. */
window.CodeQuestBell=class {
 constructor(){this.context=null;this.nodes=new Set();this.handled=new Set();this.enabled=true;
  const unlock=()=>{if(this.enabled)this.unlock();};document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);
  document.addEventListener('visibilitychange',()=>this.sync(this.state,this.enabled));window.addEventListener('pagehide',()=>this.cancel());
 }
 unlock(){try{if(!this.context){const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return null;this.context=new Context();this.master=this.context.createGain();this.master.gain.value=.7;const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-8;limiter.ratio.value=8;this.master.connect(limiter);limiter.connect(this.context.destination);}this.context.resume().then(()=>this.sync(this.state,this.enabled)).catch(()=>{});return this.context;}catch{return null;}}
 cancel(){for(const o of this.nodes){try{o.stop();}catch{}}this.nodes.clear();}
 sync(state,enabled=true){if(this.snapshot!==state){this.snapshot=state;this.receivedAt=Date.now();}this.state=state;this.enabled=enabled;if(this.session!==state?.id){this.session=state?.id;this.handled.clear();this.cancel();}
  if(!enabled||document.hidden||state?.phase!=='countdown'){this.cancel();return;}
  const key=state.id+':'+state.round,remaining=(state.buildAt-state.serverNow-(Date.now()-this.receivedAt))/1000;
  if(this.handled.has(key))return;if(remaining<1.6){this.handled.add(key);return;}
  if(!this.context||this.context.state!=='running')return;
  this.handled.add(key);const start=this.context.currentTime+.04;for(const delay of [0,.8])this.strike(start+delay);
 }
 strike(at){const c=this.context;for(const [ratio,volume]of [[1,.2],[2.01,.08],[2.76,.045],[4.07,.025]]){const o=c.createOscillator(),gain=c.createGain();o.type='sine';o.frequency.setValueAtTime(660*ratio,at);gain.gain.setValueAtTime(.001,at);gain.gain.exponentialRampToValueAtTime(volume,at+.008);gain.gain.exponentialRampToValueAtTime(.001,at+1.05);o.connect(gain);gain.connect(this.master);this.nodes.add(o);o.onended=()=>{this.nodes.delete(o);o.disconnect();gain.disconnect();};o.start(at);o.stop(at+1.1);}}
};
