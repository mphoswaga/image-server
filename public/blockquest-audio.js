/* Local effects + the ColonyQuest soundtrack; narration reads the prompt only. */
window.BlockQuestAudio=class {
 constructor(endpoint,status){
  this.endpoint=endpoint;this.status=status;this.enabled=true;this.voice=true;this.musicOn=true;this.energy=0;this.lastBeat=0;this.run='';this.voiceKey='';this.epoch=0;this.audio=new Audio();
  this.music=new ColonyMusic();this.music.index=1;this.music.selectTrack();this.music.media.loop=true;this.music.setVolume(.18);
  this.motion=matchMedia('(prefers-reduced-motion: reduce)');this.pulseFrame=0;this.pulseLevel=0;
  this.motion.addEventListener('change',()=>this.syncPulse());
  for(const event of ['playing','pause','ended','error'])this.music.media.addEventListener(event,()=>this.syncPulse());
  this.audio.onended=()=>{this.speaking=false;this.music.setVolume(.18);this.status('');};
  this.audio.onerror=()=>{this.speaking=false;this.music.setVolume(.18);this.status('Voice unavailable · read the question on screen.');};
  document.addEventListener('pointerdown',()=>this.unlock(),{once:true});document.addEventListener('keydown',()=>this.unlock(),{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.audio.pause();else if(this.state?.phase==='answer'&&this.speaking)this.audio.play().catch(()=>{});this.syncPulse();});
  window.addEventListener('pagehide',()=>{this.stop();this.stopPulse();});
 }
 unlock(){
  try{
   if(!this.context){this.context=new(window.AudioContext||window.webkitAudioContext)();this.context.addEventListener('statechange',()=>this.syncPulse());}
   if(!this.musicSource&&!this.analysisFailed){
    try{
     // Analyse only the soundtrack. Narration and building effects do not drive the glow.
     this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;this.analyser.smoothingTimeConstant=.65;
     this.musicSource=this.context.createMediaElementSource(this.music.media);
     this.musicSource.connect(this.analyser);this.analyser.connect(this.context.destination);
     this.wave=new Float32Array(this.analyser.fftSize);this.spectrum=new Uint8Array(this.analyser.frequencyBinCount);
    }catch{this.analysisFailed=true;this.musicSource?.disconnect();this.musicSource?.connect(this.context.destination);}
   }
   this.context.resume().then(()=>this.syncPulse()).catch(()=>{});
  }catch{}
 }
 pulseAllowed(){return this.analyser&&!this.analysisFailed&&this.context?.state==='running'&&this.musicOn&&this.music.active&&!this.music.media.paused&&!this.music.media.error&&!document.hidden&&!this.motion.matches;}
 stopPulse(){cancelAnimationFrame(this.pulseFrame);this.pulseFrame=0;this.pulseLevel=0;document.documentElement.style.setProperty('--music-pulse','0');document.documentElement.dataset.musicPulse='off';}
 syncPulse(){
  if(!this.pulseAllowed()){this.stopPulse();return;}
  if(this.pulseFrame)return;
  document.documentElement.dataset.musicPulse='on';let last=0,target=0,sampleAt=0;
  const frame=now=>{
   if(!this.pulseAllowed()){this.stopPulse();return;}
   const dt=last?Math.min(100,now-last):16.7;last=now;
   if(now-sampleAt>=50){
    sampleAt=now;this.analyser.getFloatTimeDomainData(this.wave);this.analyser.getByteFrequencyData(this.spectrum);
    let energy=0;for(const sample of this.wave)energy+=sample*sample;
    const rms=Math.sqrt(energy/this.wave.length),binHz=this.context.sampleRate/this.analyser.fftSize;
    let bass=0,count=0;for(let i=Math.max(1,Math.floor(45/binHz));i<=Math.min(this.spectrum.length-1,Math.ceil(220/binHz));i++){bass+=this.spectrum[i]/255;count++;}
    target=rms<.002?0:Math.min(.9,Math.max(0,(rms-.008)*3.2+(count?bass/count:0)*.35));
   }
   this.pulseLevel+=(target-this.pulseLevel)*(1-Math.exp(-dt/(target>this.pulseLevel?85:300)));
   document.documentElement.style.setProperty('--music-pulse',this.pulseLevel.toFixed(3));
   this.pulseFrame=requestAnimationFrame(frame);
  };
  this.pulseFrame=requestAnimationFrame(frame);
 }
 setEnergy(level,clock=Date.now()){
  const active=this.musicOn&&this.music.active&&!document.hidden&&this.state?.phase!=='paused'&&this.state?.phase!=='ended';this.energy+=((active?Math.max(0,Math.min(1,level)):0)-this.energy)*.18;
  this.music.media.preservesPitch=true;this.music.media.playbackRate=1+this.energy*.12;
  const volume=this.speaking?.05:.18+this.energy*.045;if(Math.abs(this.music.media.volume-volume)>.004)this.music.setVolume(volume);
  document.body.classList.toggle('game-climax',active&&this.energy>.15);
  const interval=900-this.energy*250;
  if(active&&this.energy>.15&&clock-this.lastBeat>=interval&&this.context?.state==='running'&&!this.music.media.paused){this.lastBeat=clock;const c=this.context,o=c.createOscillator(),g=c.createGain(),at=c.currentTime;o.frequency.setValueAtTime(90,at);o.frequency.exponentialRampToValueAtTime(42,at+.12);g.gain.setValueAtTime(this.speaking?.008:.025*this.energy,at);g.gain.exponentialRampToValueAtTime(.001,at+.18);o.connect(g).connect(c.destination);o.start();o.stop(at+.2);}
 }
 cue(kind){if(!this.enabled)return;this.unlock();const c=this.context;if(!c)return;
  const notes=kind==='build'?[180,230,300]:kind==='clear'?[392,523,659,784,1046]:kind==='correct'?[392,523,659]:kind==='attack'?[196,147,98]:kind==='shield'?[523,659]:kind==='warning'?[880]:kind==='tick'?[680]:[160];
  notes.forEach((hz,i)=>{const o=c.createOscillator(),g=c.createGain(),at=c.currentTime+i*(kind==='build'?.075:.1);o.type=kind==='build'?'triangle':'sine';o.frequency.setValueAtTime(hz,at);if(kind==='build')o.frequency.exponentialRampToValueAtTime(70,at+.08);g.gain.setValueAtTime(.001,at);g.gain.exponentialRampToValueAtTime(kind==='warning'?.09:kind==='tick'?.015:.055,at+.012);g.gain.exponentialRampToValueAtTime(.001,at+.16);o.connect(g).connect(c.destination);o.start(at);o.stop(at+.18);});
 }
 stop(){this.epoch++;this.status('');this.audio.pause();this.speaking=false;this.music.setVolume(.18);if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null;}}
 sync(s){this.state=s;this.music.setActive(this.musicOn&&s&&!['paused','ended'].includes(s.phase));this.syncPulse();
  const key=s?.id+':'+(s?.voiceTurn??s?.turn);
  if(!this.voice||s?.phase!=='answer'){if(s?.phase==='paused'){if(!this.speaking){this.stop();this.voiceKey='';}else this.audio.pause();return;}this.stop();return;}
  if(key===this.voiceKey){if(this.speaking&&!document.hidden&&this.audio.paused)this.audio.play().catch(()=>{});return;}
  this.stop();this.voiceKey=key;const epoch=this.epoch;
  this.status('Preparing question voice…');
  const separator=this.endpoint.includes('?')?'&':'?';
  const url=this.endpoint.replace(/\/blockquest(-live)?(?=\?|$)/,'/blockquest$1/voice')+separator+new URLSearchParams({run:s.id,turn:s.turn});
  fetch(url).then(async response=>{if(!response.ok)throw Error('Voice unavailable');return response.blob();}).then(async blob=>{
   if(epoch!==this.epoch||this.state?.phase!=='answer'||!this.voice)return;
   this.objectUrl=URL.createObjectURL(blob);this.audio.src=this.objectUrl;this.speaking=true;this.music.setVolume(.05);await this.audio.play();this.status('');
  }).catch(()=>{if(epoch!==this.epoch)return;this.speaking=false;this.music.setVolume(.18);this.status('Voice unavailable · read the question on screen.');});
 }
 toggleVoice(){this.voice=!this.voice;if(!this.voice)this.stop();else this.voiceKey='';this.sync(this.state);return this.voice;}
 toggleMusic(){this.musicOn=!this.musicOn;this.sync(this.state);return this.musicOn;}
};
