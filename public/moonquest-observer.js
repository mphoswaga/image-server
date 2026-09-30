(() => {
  'use strict';
  const $=id=>document.getElementById(id), e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id=new URLSearchParams(location.search).get('session'), token=location.hash.slice(1);
  let stopped=false, last='', timer;
  $('enter').onclick=()=>{$('welcome').hidden=true;$('dashboard').hidden=false;};
  $('help').onclick=()=>{$('welcome').hidden=false;$('welcome').scrollIntoView({behavior:'smooth'});};
  function render(s){
    const key=JSON.stringify({...s,updatedAt:0}); if(last===key)return;last=key;
    const root=$('dashboard');
    const tab=root.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab||'overview';
    const search=root.querySelector('#review-search')?.value||'',filter=root.querySelector('#review-filter')?.value||'all';
    if(root.querySelector('dialog[open]')){last='';return;}
    window.MoonQuestReport.render(root,s.report,{readOnly:true});
    const live=document.createElement('p');live.className='review-context';live.textContent=s.phase==='ended'?'Completed session':s.answered+'/'+s.expected+' answered this question · '+s.joined+' joined · '+(s.paused?'Paused':'Live');root.prepend(live);
    root.querySelector('[data-tab="'+tab+'"]').click();
    root.querySelector('#review-search').value=search;root.querySelector('#review-filter').value=filter;root.querySelector('#review-filter').dispatchEvent(new Event('change'));
  }

  async function poll(){
    if(stopped)return;
    try{
      if(!id||!token){stopped=true;throw Error('Open the complete analysis report link supplied by the teacher.');}
      const res=await fetch('/api/games/moonquest/sessions/'+encodeURIComponent(id)+'/observe',{headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      if(res.status===403){stopped=true;$('dashboard').replaceChildren();throw Error('This report link is invalid or has been withdrawn. Ask the teacher for a new link.');}
      if(!res.ok)throw Error('Updates interrupted. Reconnecting automatically…');
      const s=await res.json();render(s);$('error').textContent='';$('connection').textContent=(s.phase==='ended'?'Final snapshot':'Live')+' · Updated '+new Date(s.updatedAt).toLocaleTimeString();
    }catch(err){$('error').textContent=err.message;$('connection').textContent=stopped?'Access unavailable':'Connection interrupted · displayed data may be out of date';}
    if(!stopped)timer=setTimeout(poll,2500);
  }
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});poll();
})();
