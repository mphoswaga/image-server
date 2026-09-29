/* Original SVG stagecraft. Saved choices are the source of every landmark. */
(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const star='<path d="M50 5L61 35L94 37L69 58L77 91L50 73L22 91L31 58L6 37L39 35Z" fill="#ffe79b" stroke="#fff6d7" stroke-width="3"/>';
  const shapes={
    bridge:'<path d="M8 81Q90 23 172 81" fill="none" stroke="#8f4c57" stroke-width="18"/><path d="M8 73Q90 15 172 73" fill="none" stroke="#ffe4a1" stroke-width="7"/><path d="M8 49Q90 -9 172 49M8 49V80M38 32V60M69 23V47M111 23V47M142 32V60M172 49V80" fill="none" stroke="#f2b759" stroke-width="5"/><g fill="#dc5d73" stroke="#ffe8a5" stroke-width="2"><ellipse cx="38" cy="24" rx="9" ry="12"/><ellipse cx="142" cy="24" rx="9" ry="12"/></g>',
    stars:'<g transform="translate(5 55) scale(.38)">'+star+'</g><g transform="translate(65 27) scale(.48)">'+star+'</g><g transform="translate(131 3) scale(.4)">'+star+'</g><path d="M16 80Q100 4 160 30" fill="none" stroke="#ffeaaa" stroke-width="3" stroke-dasharray="3 9"/>',
    kite:'<path d="M88 78Q132 110 60 132T91 160" fill="none" stroke="#ffe2a3" stroke-width="3"/><path d="M88 0L144 41L88 86L32 41Z" fill="#7bdcca" stroke="#fff0b3" stroke-width="4"/><path d="M88 0V86M32 41H144" stroke="#f5d987" stroke-width="3"/><path d="M88 4L140 41H88Z" fill="#e695b3"/><path d="M88 46L38 42L88 80Z" fill="#ffcb7d"/><path d="M15 75H53M6 94H40M129 105H171" stroke="#c4f4ef" stroke-width="4" stroke-linecap="round"/>',
    tower:'<path d="M64 145L72 40H108L117 145Z" fill="#73454e" stroke="#eabd76" stroke-width="4"/><path d="M71 73H110M68 104H113M68 138L110 75M72 74L113 138" stroke="#e9aa6a" stroke-width="4"/><rect x="58" y="28" width="65" height="50" rx="14" fill="#f7d581" stroke="#fff0b5" stroke-width="4"/><path d="M49 29L90 1L131 29Z" fill="#be5968" stroke="#ffe8a2" stroke-width="3"/><path d="M82 30V73M101 30V73" stroke="#fff4c9" stroke-width="4"/>',
    mooncakes:'<path d="M15 112H163M31 111V151M145 111V151" stroke="#8e5354" stroke-width="12"/><path d="M9 105H169" stroke="#ffdaa0" stroke-width="10"/><g fill="#da9858" stroke="#ffe6aa" stroke-width="5"><circle cx="48" cy="76" r="25"/><circle cx="91" cy="76" r="25"/><circle cx="133" cy="76" r="25"/></g><g fill="none" stroke="#925333" stroke-width="3"><path d="M48 60L62 76L48 92L34 76ZM91 60L105 76L91 92L77 76ZM133 60L147 76L133 92L119 76Z"/></g>',
    drums:'<ellipse cx="87" cy="53" rx="47" ry="18" fill="#ffe6b2" stroke="#96404f" stroke-width="4"/><path d="M40 53V103Q87 141 134 103V53Q87 90 40 53Z" fill="#c85368" stroke="#ffe4ac" stroke-width="4"/><path d="M48 63L61 118L74 74L88 126L102 74L118 118L127 63M52 139L67 115M124 139L109 115" fill="none" stroke="#ffd49a" stroke-width="4"/><path d="M36 18L83 44M139 13L98 43" stroke="#efd5a6" stroke-width="7" stroke-linecap="round"/>',
    garden:'<path d="M88 149V71M88 124Q43 133 33 93Q65 84 88 124M88 111Q135 115 148 76Q113 70 88 111" fill="#74c6a1" stroke="#d4edb5" stroke-width="3"/><g fill="#ee93b5" stroke="#ffe0b3" stroke-width="3"><ellipse cx="68" cy="61" rx="24" ry="32" transform="rotate(-40 68 61)"/><ellipse cx="109" cy="61" rx="24" ry="32" transform="rotate(40 109 61)"/><ellipse cx="88" cy="44" rx="24" ry="33"/></g><circle cx="88" cy="69" r="16" fill="#ffe291"/>'
  };
  function icon(id){return `<svg viewBox="0 0 180 ${['bridge','stars'].includes(id)?100:160}" aria-hidden="true">${shapes[id]||shapes.stars}</svg>`;}
  function spirit(){return '<svg viewBox="0 0 170 180" aria-hidden="true"><path d="M85 10Q158 16 148 91Q138 142 164 158Q121 181 101 153Q61 177 24 156Q45 130 26 91Q12 22 85 10Z" fill="#aba1f2" stroke="#e3d7ff" stroke-width="4"/><ellipse cx="62" cy="77" rx="10" ry="15" fill="#343254"/><ellipse cx="107" cy="77" rx="10" ry="15" fill="#343254"/><circle cx="65" cy="72" r="3" fill="white"/><circle cx="110" cy="72" r="3" fill="white"/><path d="M69 110Q86 125 103 110" fill="none" stroke="#55436f" stroke-width="5" stroke-linecap="round"/><circle cx="47" cy="100" r="10" fill="#ec98c4"/><circle cx="125" cy="100" r="10" fill="#ec98c4"/></svg>';}
  function worlds(s,role){const all=s.narrative?.worlds||[];return role==='student'&&s.duels?all.filter(w=>w.team===s.duels.me.team):all;}
  function landmarks(s){
    return `<div class="tale-landmarks" aria-label="Your saved story choices">${(s.narrative?.worlds||[]).map(w=>`<div class="tale-territory territory-${w.team??'all'}">${w.decisions.map(d=>`<span class="tale-landmark landmark-${esc(d.id)}" title="${esc(d.title)}" data-landmark="${esc(d.id)}">${icon(d.id)}</span>`).join('')}</div>`).join('')}</div>`;
  }
  function captionLines(s,w,choice,mode){
    const route=w.route==='stars'?'the stepping stars':w.route==='bridge'?'your lantern bridge':'the moonlit path';
    if(mode==='intro')return ['Tonight, Vinschool is ready for the Moon Festival.','Whoosh! A playful moon spirit scatters the lantern light.','One tiny spark remains. The rabbit heroes catch it!','Your discoveries make magic. Help the rabbits bring the festival home.'];
    if(mode==='finale')return [s.narrative?.complete?'The rabbit heroes return with the sparks you earned.':'Our heroes rest here. Their discoveries are safe.',`They follow ${route}, the path your crew created.`,w.celebration==='mooncakes'?'Mooncakes for everyone! Your feast is ready.':w.celebration==='drums'?'Listen! Your lantern parade is coming home.':'Every light you restored has a story. Thank you, heroes!'];
    if(mode==='vote')return [s.story?.obstacle||'Which adventure will your crew choose?'];
    const scenes={
      bridge:['The rabbits stop at the broken bridge.','Your sparks mend each missing plank!','Hop, hop! The bridge is safe. It will be here when you return.'],
      stars:['There is no way across the river… yet.','Your sparks become bright stepping stars!','The rabbits leap across. Your star path will guide them home.'],
      kite:[`Across ${route}, the rabbits find a garden hidden in mist.`,'Up goes your kite! Its tail catches a magical breeze.','The mist rolls away. Your kite stays to guide the journey.'],
      tower:[`Beyond ${route}, the rabbits cannot see the school.`,'They stack your sparks into a glowing lantern tower!','Its beam cuts through the mist. Now there is a way home.'],
      mooncakes:[`Home along ${route}! The rabbits carry their baskets.`,'Your crew sets out a delicious mooncake feast.','The moon spirit helps light the table. There is room for everyone.'],
      drums:[`The rabbits return along ${route}, lanterns held high.`,'Boom, tap, boom! Your festival parade begins.','The moon spirit joins the dance. Your choices brought everyone home.'],
      garden:[`The rabbits follow ${route} to the sleeping garden.`,'Your sparks wake the lantern flowers.','A glowing garden welcomes the heroes home.']
    };
    return scenes[choice]||['The rabbits gather your sparks.','A new path begins to glow.','Your adventure is taking shape.'];
  }
  function scene(s,w,choice,mode,rabbit){
    const style=s.duels?.me?.team===w.team?s.duels.me.avatar:w.team===1?'bow':'scarf';
    const route=w.route||'bridge',lines=captionLines(s,w,choice,mode);
    const garden=(mode==='vote'||mode==='action')&&!['mooncakes','drums'].includes(choice);
    const backdrop=garden?'moon-garden-river.webp':'vinschool-festival.webp';
    const id=[s.id,s.story?.id||s.round,w.team,mode].join('-');
    return `<section class="tale-stage ${garden?'tale-garden':''} tale-${mode} choice-${esc(choice||'none')} route-${route} ${w.beacon?'has-'+w.beacon:''}" style="--tale-light:${.35+(s.lighting?.percent||0)*.0055}" data-tale-mode="${mode}" data-tale-id="${esc(id)}" data-lines="${esc(JSON.stringify(lines))}" data-beat="0" aria-label="${esc(mode==='intro'?'The vanishing lantern light':mode==='finale'?'Your festival ending':s.story?.title||'Moon Festival story')}">
      <div class="tale-set" aria-hidden="true"><img class="tale-school" src="/moonquest-art/${backdrop}" alt=""><div class="tale-night"></div><div class="tale-moon"></div><div class="tale-river"><i></i><i></i><i></i></div>
      <div class="tale-existing">${w.decisions.filter(d=>d.id!==choice||mode==='finale').map(d=>`<div class="tale-built built-${esc(d.id)}">${icon(d.id)}</div>`).join('')}</div>
      <div class="tale-mist mist-back"></div><div class="tale-mist mist-front"></div><div class="tale-beam"></div>
      <div class="tale-magic">${Array.from({length:12},(_,i)=>`<i style="--i:${i}">✦</i>`).join('')}</div>
      ${choice?`<div class="tale-creation creation-${esc(choice)}">${icon(choice)}</div>`:''}
      <div class="tale-spirit">${spirit()}</div><div class="tale-last-spark">✦</div>
      <div class="tale-traveller hero-one"><div class="tale-bounce">${rabbit(style,w.team||0)}</div></div><div class="tale-traveller hero-two"><div class="tale-bounce">${rabbit(w.team===1?'crown':'blossom',w.team||0)}</div></div>
      <div class="tale-parade">${['explorer','headphones','leaf'].map((style,i)=>`<div style="--i:${i}">${rabbit(style,w.team||0)}</div>`).join('')}</div>
      <div class="tale-sky-lights">${Array.from({length:8},(_,i)=>`<i style="--i:${i}"><svg viewBox="0 0 60 95"><path d="M30 0V15M30 76V95" stroke="#f5d286" stroke-width="3"/><rect x="10" y="16" width="40" height="60" rx="20" fill="#d65469" stroke="#ffe0a1" stroke-width="3"/><ellipse cx="30" cy="46" rx="9" ry="29" fill="#ffdc8988" stroke="#ffeab5" stroke-width="2"/></svg></i>`).join('')}</div></div>
      <div class="tale-scene-heading"><span>${s.duels?esc(w.team===1?'Golden Rabbits':'Jade Rabbits'):'OUR FESTIVAL ADVENTURE'}</span><b>${mode==='intro'?'The vanishing light':mode==='finale'?'Home to Vinschool':esc(s.story?.title)}</b></div>
      <div class="tale-subtitles" aria-live="off"><span class="tale-caption">${esc(lines[0])}</span><div class="tale-beats">${lines.map((_,i)=>`<i data-beat-dot="${i}"></i>`).join('')}</div></div>
    </section>`;
  }
  function film(s,role,rabbit,mode){
    const ws=worlds(s,role),fallback={team:s.duels?.me?.team??null,decisions:[]};
    return `<div class="tale-films ${ws.length>1&&mode!=='intro'?'tale-split':''}">${(mode==='intro'?[ws[0]||fallback]:ws.length?ws:[fallback]).map(w=>{
      const result=s.story?.teamResults?.find(t=>t.team===w.team)||s.story;
      const choice=mode==='action'?s.story?.options[result?.winner??0]?.id:null;
      return scene(s,w,choice,mode,rabbit);
    }).join('')}</div>`;
  }
  function journey(s,role){return `<div class="tale-journal">${worlds(s,role).map(w=>`<section><h3>${s.duels?esc(w.team===1?'Golden Rabbits':'Jade Rabbits'):'Our story'} · ${w.decisions.length} choices brought to life</h3><ol>${w.decisions.map(d=>`<li>${icon(d.id)}<div><strong>${esc(d.title)}</strong><p>${esc(d.result)}</p></div></li>`).join('')}</ol></section>`).join('')}</div>`;}
  function choiceFrom(el){return [...el.classList].find(c=>c.startsWith('choice-'))?.slice(7);}
  function sync(s,now){
    const stages=[...document.querySelectorAll('.tale-stage')];let spoken=null;
    for(const el of stages){
      const mode=el.dataset.taleMode,base=mode==='intro'?s.introElapsedMs:mode==='action'?s.storyElapsedMs:0;
      const total=mode==='intro'?24:mode==='action'?(s.narrative?.version===2?9:5):9;
      if(mode==='finale'&&!el.dataset.localStart)el.dataset.localStart=String(now);
      const elapsed=mode==='finale'?Math.max(0,(now-Number(el.dataset.localStart))/1000):Math.max(0,(base||0)/1000+(s.paused?0:(now-s.serverNow)/1000));
      const lines=el._taleLines||(el._taleLines=JSON.parse(el.dataset.lines)),beat=mode==='vote'?0:Math.min(lines.length-1,Math.floor(elapsed/(total/lines.length)));
      el.dataset.beat=String(beat);el.style.setProperty('--tale-time',`${-Math.min(elapsed,total)}s`);el.style.setProperty('--tale-duration',`${total}s`);
      // Seeking the same CSS timeline on every render makes reload/pause safe.
      if(el._beat!==beat){el.querySelector('.tale-caption').textContent=lines[beat];el._beat=beat;}
      el.querySelectorAll('[data-beat-dot]').forEach(dot=>dot.classList.toggle('active',Number(dot.dataset.beatDot)===beat));
      const voice=mode==='intro'?['Tonight is the Moon Festival.','Oh no! The lantern light has scattered!','Catch that tiny spark, rabbit heroes!','Your discoveries can bring the light home.'][beat]:mode==='finale'?['Welcome home, festival heroes!', 'Look at the path you created!', 'Your choices made this celebration.'][beat]:beat===0?'A new adventure awaits your crew.':beat===1?({bridge:'Your sparks are building a bridge!',stars:'Look! A path of stepping stars!',kite:'Your kite is sweeping the mist away!',tower:'Your lantern tower lights the way!',mooncakes:'A mooncake feast for everyone!',drums:'Here comes your lantern parade!',garden:'The lantern flowers are waking up!'}[choiceFrom(el)]||'Your magic is working!'):'You did it! Your creation stays in the story.';
      if(!spoken)spoken={voice,key:el.dataset.taleId+':'+beat,text:lines[beat],beat,mode,choice:[...el.classList].find(c=>c.startsWith('choice-'))?.slice(7)};
    }
    return spoken;
  }
  window.MoonStory={icon,film,landmarks,journey,sync};
})();
