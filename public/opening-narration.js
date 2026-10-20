/* Bundled AI story narration. No browser speech synthesis or runtime API calls. */
(function(root){
 'use strict';
 root.OpeningNarration=class {
  constructor(button,onSpeaking=()=>{}){
   this.button=button;this.onSpeaking=onSpeaking;this.enabled=true;this.active=false;this.blocked=false;
   this.media=new Audio();this.media.preload='metadata';this.media.dataset.openingNarration='true';document.body.append(this.media);
   this.media.addEventListener('playing',()=>{if(this.active&&this.enabled&&!this.paused&&!document.hidden)this.onSpeaking(true);else this.media.pause();});
   this.media.addEventListener('pause',()=>this.onSpeaking(false));
   this.media.addEventListener('ended',()=>this.onSpeaking(false));
   this.media.addEventListener('error',()=>{this.failed=true;this.onSpeaking(false);this.label();});
   button.title='AI-generated storybook voice. Only the opening is narrated.';
   button.onclick=()=>{if(this.blocked){this.blocked=false;this.failed=false;}else this.enabled=!this.enabled;this.update();};
   const unlock=()=>{if(this.blocked&&this.active&&this.enabled){this.blocked=false;this.update();}};
   document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);
   document.addEventListener('visibilitychange',()=>this.update());
   window.addEventListener('pagehide',()=>this.stop());this.label();
  }
  label(){this.button.textContent=this.failed?'Opening audio unavailable':this.blocked?'Tap to hear opening':this.enabled?'Opening voice on':'Opening voice off';this.button.setAttribute('aria-pressed',String(this.enabled));}
  sync(src,key,position=0,paused=false){
   if(!src){this.stop();return;}
   this.active=true;this.paused=paused;
   if(this.key!==key){this.key=key;this.media.src=src;this.failed=false;}
   this.position=Math.max(0,position);
   if(this.media.readyState>=1&&Math.abs(this.media.currentTime-this.position)>1.5)this.media.currentTime=Math.min(this.position,this.media.duration||this.position);
   this.media.onloadedmetadata=()=>{if(this.active)this.media.currentTime=Math.min(this.position,this.media.duration||this.position);};
   this.update();
  }
  update(){
   if(!this.active||!this.enabled||this.paused||document.hidden){this.media.pause();this.label();return;}
   if(!this.blocked&&!this.failed&&this.media.paused&&!this.media.ended){
    const key=this.key;this.media.play().catch(()=>{if(this.active&&key===this.key){this.blocked=true;this.label();}});
   }
   this.label();
  }
  stop(){this.active=false;this.media.pause();this.key=null;this.onSpeaking(false);}
 };
})(window);
