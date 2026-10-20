/* Bundled AI character voices and playback-timed story passages. */
(function(root){
 'use strict';
 root.ColonyActionVoice=class {
  constructor(allowed,onSpeaking=()=>{},volume=()=>.75){this.volume=volume;this.allowed=allowed;this.onSpeaking=onSpeaking;this.audio=new Audio();this.audio.preload='none';this.last=0;this.audio.onended=()=>onSpeaking(false);this.audio.onerror=()=>onSpeaking(false);document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});}
  stop(){this.audio.pause();this.onSpeaking(false);clearTimeout(this.captionTimer);this.caption?.remove();}
  play(key){const aliases={predator:'spider','heavy-rain':'rain','birds-warning':'birds','footsteps-warning':'stomp',footsteps:'stomp',expansion:'build',defense:'build',soldiers:'guard',supplies:'food'};key=aliases[key]||key;
   if(!['raid','spider','build','rain','birds','stomp','guard','food'].includes(key)||!this.allowed()||document.hidden||Date.now()-this.last<1800)return;
   this.last=Date.now();this.stop();this.audio.src='/assets/game-narration/action-'+key+'.mp3';this.audio.volume=Math.max(0,Math.min(1,this.volume()));
   this.caption=document.createElement('div');this.caption.className='colony-voice-caption';this.caption.textContent={raid:'RAIDING!',spider:'SPIDERS INCOMING!',build:'BUILD!',rain:'RAIN INCOMING!',birds:'BIRDS OVERHEAD!',stomp:'GIANT FOOTSTEPS!',guard:'GUARDS READY!',food:'FOOD COLLECTED!'}[key];document.body.append(this.caption);this.captionTimer=setTimeout(()=>this.caption?.remove(),1800);
   this.audio.play().then(()=>{if(!this.allowed()||document.hidden){this.stop();return;}this.onSpeaking(true);}).catch(()=>this.onSpeaking(false));
  }
 };
 root.ColonyStoryText=class {
  constructor(voice){this.voice=voice;voice.media.addEventListener('timeupdate',()=>this.update());voice.media.addEventListener('seeked',()=>this.update());voice.media.addEventListener('loadedmetadata',()=>this.update());voice.media.addEventListener('play',()=>this.update());voice.media.addEventListener('pause',()=>this.update());voice.button.addEventListener('click',()=>this.update());}
  attach(element,key){
   const segments=root.ColonyVoiceTimings?.[key];if(!segments?.length||!element)return;
   if(this.element===element&&this.key===key&&element.querySelector('.spoken-passage')){this.update();return;}
   this.index=-1;this.element=element;this.key=key;this.segments=segments;element.classList.add('spoken-story');element.replaceChildren();
   this.track=document.createElement('span');this.track.className='spoken-track';
   this.spans=segments.map(segment=>{const span=document.createElement('span');span.className='spoken-passage';span.textContent=segment.text+' ';this.track.append(span);return span;});element.append(this.track);this.update();
  }
  update(){if(!this.element?.isConnected)return;const time=this.voice.media.currentTime||0;let index=this.segments.findIndex(s=>time>=s.start&&time<s.end);if(index<0)index=time>=this.segments.at(-1).end?this.segments.length-1:0;
   this.spans.forEach((span,i)=>{span.classList.toggle('is-speaking',i===index);span.classList.toggle('was-spoken',i<index);});
   const current=this.spans[index],next=this.spans[index+1];const segment=this.segments[index];const progress=Math.max(0,Math.min(1,(time-segment.start)/Math.max(.1,segment.end-segment.start)));
   const offset=current.offsetTop+(next?(next.offsetTop-current.offsetTop)*progress:0);
   const manual=!this.voice.enabled||this.voice.paused||this.voice.failed||this.voice.blocked;this.element.classList.toggle('manual-reading',manual);
   if(manual){this.track.style.transform='none';return;}
   if(matchMedia('(prefers-reduced-motion: reduce)').matches){this.track.style.transform='none';if(this.index!==index)this.element.scrollTop=current.offsetTop;}
   else this.track.style.transform=`translateY(${this.element.clientHeight*.3-offset}px)`;
   this.index=index;
  }
 };
})(window);
