/* Reuse the locally hosted, credited ColonyQuest soundtrack. Music never blocks play. */
window.CodeQuestMusic=class {
 constructor(button){
  this.button=button;this.enabled=true;this.player=new ColonyMusic(track=>{button.title=track.title+' — '+track.artist;});
  // Preserve the button’s retry intent before the shared gesture handler unblocks media.
  this.retryRequested=false;button.addEventListener('pointerdown',()=>{this.retryRequested=this.enabled&&this.player.blocked;});button.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))this.retryRequested=this.enabled&&this.player.blocked;});
  this.player.index=1;this.player.selectTrack();this.player.media.loop=true;this.player.media.dataset.codequestMusic='true';this.player.setVolume(.14);
  const unlock=event=>{if(event.target?.closest?.('#music'))return;if(this.enabled){this.player.blocked=false;this.sync(this.state,this.practice);}};
  document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);
  document.addEventListener('visibilitychange',()=>this.sync(this.state,this.practice));
  window.addEventListener('pagehide',()=>this.player.setActive(false));
  this.player.media.addEventListener('error',()=>this.updateButton());this.updateButton();
 }
 updateButton(){this.button.textContent=this.enabled?(this.player.blocked?'Play music':'Music on'):'Music off';this.button.setAttribute('aria-pressed',String(this.enabled));}
 sync(state,practice=false){this.state=state;this.practice=practice;const phase=state?.phase,active=this.enabled&&!!state&&(practice||['countdown','build','launch','replay','results'].includes(phase))&&phase!=='paused';
  this.player.setActive(active);this.player.setVolume(practice?.1:phase==='build'?.14:['countdown','launch'].includes(phase)?.23:.19);this.updateButton();
 }
 toggle(){if(this.retryRequested||this.enabled&&this.player.blocked){this.retryRequested=false;this.player.blocked=false;}else this.enabled=!this.enabled;this.sync(this.state,this.practice);return this.enabled;}
};
