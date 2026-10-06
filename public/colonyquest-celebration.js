/* Shared presentation only: scoring remains owned by each game mode. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const seen = new Set();
  function ant(name, index, queen = false) {
    return `<figure class="cq-champion" style="--delay:${index % 7 * .13}s"><figcaption>${esc(name)}</figcaption><img src="/assets/colonyquest/${queen ? 'queen' : index % 2 ? 'guardian' : 'pip-worker'}.webp" alt="Celebrating ant"></figure>`;
  }
  window.ColonyCelebration = {
    show(key, entries) {
      if (seen.has(key)) return;
      seen.add(key);
      document.getElementById('cqCelebration')?.remove();
      const winners = entries.filter(e => e.rank === 1);
      const top = entries.filter(e => e.rank <= 3);
      const stage = document.createElement('section');
      stage.id = 'cqCelebration';
      stage.className = 'cq-celebration';
      stage.setAttribute('role', 'dialog');
      stage.setAttribute('aria-modal', 'true');
      stage.setAttribute('aria-label', 'ColonyQuest champions');
      const previous = document.activeElement;
      stage.innerHTML = `<div class="cq-sparks" aria-hidden="true">${Array.from({length:32},(_,i)=>`<i style="--x:${i*3.17}%;--delay:${i%9*.24}s;--hue:${i*47}"></i>`).join('')}</div><div class="cq-celebration-content"><p class="cq-kicker">THE ANCIENT ACORN AWARDS</p><h1>${winners.length ? winners.length > 1 ? 'Shared champions!' : `${esc(winners[0].name)} wins!` : 'Thank you, meadow explorers!'}</h1><p>Strong colonies. Brilliant teamwork. A meadow worth celebrating.</p><div class="cq-winners">${winners.flatMap(e => e.members?.length ? e.members.map(m=>m.name) : [e.name]).map((name,i)=>ant(name,i)).join('')}</div><div class="cq-podium">${top.map(e=>`<article class="cq-place cq-rank-${e.rank}">${ant(e.name,e.rank,true)}<div class="cq-plinth"><b>${e.rank === 1 ? '🏆' : e.rank === 2 ? '🥈' : '🥉'} ${e.rank}</b><strong>${esc(e.name)}</strong><span>${esc(e.score)} colony points</span></div></article>`).join('')}</div><button type="button" class="cq-results">View results</button></div>`;
      document.body.append(stage);
      const button = stage.querySelector('button');
      const close = () => { stage.remove(); previous?.focus(); };
      button.onclick = close;
      stage.onkeydown = event => { if (event.key === 'Escape') close(); if(event.key === 'Tab') { event.preventDefault(); button.focus(); } };
      button.focus({preventScroll:true});
    },
    multiplayer(s) {
      let rank = 0, last;
      const entries = [...s.players].sort((a,b)=>b.strength-a.strength).map((p,i)=>{
        if(p.strength !== last) rank = i+1;
        last = p.strength;
        return {name:p.name,score:p.strength,rank};
      });
      this.show('live:'+s.id, entries);
    }
  };
})();
