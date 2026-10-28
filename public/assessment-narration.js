/* Teacher presentation only. One reading at a time, never automatic playback. */
window.AssessmentReader=class {
 constructor(id){this.id=id;this.audio=new Audio();this.cache=new Map();this.key=null;this.selection='';this.version=0;this.loading=false;
  this.audio.onended=()=>this.stop();this.audio.onerror=()=>{this.stop();this.status('Could not play this reading. Please try again.');};
  document.addEventListener('click',e=>{const button=e.target.closest('[data-read]');if(button)this.play(button.dataset.read);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});window.addEventListener('pagehide',()=>{this.stop();for(const url of this.cache.values())URL.revokeObjectURL(url);this.cache.clear();});
 }
 status(text){document.getElementById('readingStatus').textContent=text;}
 stop(){this.version++;this.audio.pause();this.key=null;this.loading=false;this.sync();}
 select(key){if(key!==this.selection){this.stop();for(const url of this.cache.values())URL.revokeObjectURL(url);this.cache.clear();this.selection=key;this.status('AI voice · tap a play button to listen.');}}
 button(params,label){const b=document.createElement('button');b.type='button';b.className='read-aloud';b.dataset.read=params;b.dataset.label=label;b.setAttribute('aria-label','Read '+label);b.dataset.icon='▶';return b;}
 sync(){document.querySelectorAll('[data-read]').forEach(b=>{const playing=b.dataset.read===this.key;b.dataset.icon=playing?(this.loading?'…':'■'):'▶';b.setAttribute('aria-label',(playing?'Stop reading ':'Read ')+b.dataset.label);b.setAttribute('aria-pressed',String(playing));});}
 async play(params){
  if(this.key===params){this.stop();return;}
  this.stop();const version=this.version;this.key=params;this.loading=true;this.sync();this.status('Preparing natural voice…');
  try{
   let url=this.cache.get(params);
   if(!url){const response=await fetch(`/api/assignment/${encodeURIComponent(this.id)}/presentation-audio?${params}`);if(!response.ok){const d=await response.json();throw Error(d.error||'Could not prepare this reading.');}const blob=await response.blob();if(version!==this.version)return;url=URL.createObjectURL(blob);this.cache.set(params,url);}
   if(version!==this.version)return;
   this.audio.src=url;await this.audio.play();if(version!==this.version)return;
   this.loading=false;this.status('Reading aloud · tap ■ to stop.');this.sync();
  }catch(error){if(version!==this.version)return;this.stop();this.status(error.message||'Could not play this reading.');}
 }
};
