/* Presentation only: the server remains responsible for scores and encounters. */
(() => {
  let lastRank=null, signature='', timer;
  const $=id=>document.getElementById(id);
  function update(state,me){
    const order=[...state.players].sort((a,b)=>b.score-a.score||b.mass-a.mass||String(a.name).localeCompare(String(b.name)));
    const rank=1+order.filter(p=>p.score>me.score||(p.score===me.score&&p.mass>me.mass)).length;
    const progress=FishQuestGrowth.progress(me.mass);
    $('growthFill').style.width=`${Math.round(progress.fraction*100)}%`;
    $('growthLabel').textContent=progress.next?`${Math.ceil(progress.next-me.mass)} size to ${FishQuestGrowth.name(FishQuestGrowth.evolution(progress.next))}`:'Maximum evolution!';
    $('oceanRank').textContent=`${me.name} · #${rank} of ${order.length}`;
    const next=JSON.stringify(order.slice(0,3).map(p=>[p.id,p.name,p.score,p.mass]));
    if(signature!==next){
      signature=next;$('oceanLeaders').replaceChildren(...order.slice(0,3).map(p=>{
        const el=document.createElement('span');
        const place=1+order.filter(other=>other.score>p.score||(other.score===p.score&&other.mass>p.mass)).length;
        el.textContent=`${place===1?'♛':'#'+place} ${p.name}`;el.className=p.id===me.id?'is-me':'';return el;
      }));
    }
    if(state.phase==='running'&&!state.question&&lastRank!==null&&rank<lastRank){
      $('oceanMoment').textContent=rank===1?'You lead the ocean!':`Overtake! Now #${rank}`;
      $('oceanMoment').classList.remove('active');void $('oceanMoment').offsetWidth;$('oceanMoment').classList.add('active');
      clearTimeout(timer);timer=setTimeout(()=>$('oceanMoment').classList.remove('active'),2200);
    }
    if(state.question||state.phase!=='running')$('oceanMoment').classList.remove('active');
    lastRank=rank;
    $('rivalry').hidden=state.phase!=='running'||!!state.question;
    if(state.phase==='ended'){
      const podium=$('oceanPodium');
      if(podium.dataset.signature===next)return;
      podium.dataset.signature=next;
      podium.replaceChildren(...order.slice(0,3).map(p=>{
        const place=1+order.filter(other=>other.score>p.score||(other.score===p.score&&other.mass>p.mass)).length;
        const card=document.createElement('div');card.className='podium-fish';card.dataset.place=place;
        const name=document.createElement('strong');name.textContent=p.name;
        const fish=document.createElement('span');fish.className='prize-fish';fish.textContent='🐠';fish.setAttribute('aria-hidden','true');
        const medal=document.createElement('b');medal.textContent=`#${place}`;
        card.append(name,fish,medal);return card;
      }));
    }
  }
  window.FishQuestRivalry={update};
})();
