/* Local effects + the ColonyQuest soundtrack; narration reads the prompt only. */
window.BlockQuestAudio=class {
 constructor(endpoint,status){
  this.endpoint=endpoint;this.status=status;this.enabled=true;this.voice=true;this.musicOn=true;this.run='';this.voiceKey='';this.epoch=0;this.audio=new Audio();
  this.music=new ColonyMusic();this.music.index=1;this.music.selectTrack();this.music.media.loop=true;this.music.setVolume(.18);
  this.audio.onended=()=>{this.speaking=false;this.music.setVolume(.18);this.status('');};
  this.audio.onerror=()=>{this.speaking=false;this.music.setVolume(.18);this.status('Voice unavailable · read the question on screen.');};
  document.addEventListener('pointerdown',()=>this.unlock(),{once:true});document.addEventListener('keydown',()=>this.unlock(),{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.audio.pause();else if(this.state?.phase==='answer'&&this.speaking)this.audio.play().catch(()=>{});});
  window.addEventListener('pagehide',()=>this.stop());
 }
 unlock(){try{this.context ||=new(window.AudioContext||window.webkitAudioContext)();this.context.resume();}catch{}}
 cue(kind){if(!this.enabled)return;this.unlock();const c=this.context;if(!c)return;
  const notes=kind==='build'?[180,230,300]:kind==='clear'?[392,523,659,784,1046]:kind==='correct'?[392,523,659]:kind==='tick'?[680]:[160];
  notes.forEach((hz,i)=>{const o=c.createOscillator(),g=c.createGain(),at=c.currentTime+i*(kind==='build'?.075:.1);o.type=kind==='build'?'triangle':'sine';o.frequency.setValueAtTime(hz,at);if(kind==='build')o.frequency.exponentialRampToValueAtTime(70,at+.08);g.gain.setValueAtTime(.001,at);g.gain.exponentialRampToValueAtTime(kind==='tick'?.015:.055,at+.012);g.gain.exponentialRampToValueAtTime(.001,at+.16);o.connect(g).connect(c.destination);o.start(at);o.stop(at+.18);});
 }
 stop(){this.epoch++;this.status('');this.audio.pause();this.speaking=false;this.music.setVolume(.18);if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null;}}
 sync(s){this.state=s;this.music.setActive(this.musicOn&&s&&!['paused','ended'].includes(s.phase));
  const key=s?.id+':'+s?.turn;
  if(!this.voice||s?.phase!=='answer'){if(s?.phase==='paused'){if(!this.speaking){this.stop();this.voiceKey='';}else this.audio.pause();return;}this.stop();return;}
  if(key===this.voiceKey){if(this.speaking&&!document.hidden&&this.audio.paused)this.audio.play().catch(()=>{});return;}
  this.stop();this.voiceKey=key;const epoch=this.epoch;
  this.status('Preparing question voice…');
  const separator=this.endpoint.includes('?')?'&':'?';
  const url=this.endpoint.replace('/blockquest','/blockquest/voice')+separator+new URLSearchParams({run:s.id,turn:s.turn});
  fetch(url).then(async response=>{if(!response.ok)throw Error('Voice unavailable');return response.blob();}).then(async blob=>{
   if(epoch!==this.epoch||this.state?.phase!=='answer'||!this.voice)return;
   this.objectUrl=URL.createObjectURL(blob);this.audio.src=this.objectUrl;this.speaking=true;this.music.setVolume(.05);await this.audio.play();this.status('');
  }).catch(()=>{if(epoch!==this.epoch)return;this.speaking=false;this.music.setVolume(.18);this.status('Voice unavailable · read the question on screen.');});
 }
 toggleVoice(){this.voice=!this.voice;if(!this.voice)this.stop();else this.voiceKey='';this.sync(this.state);return this.voice;}
 toggleMusic(){this.musicOn=!this.musicOn;this.sync(this.state);return this.musicOn;}
};
