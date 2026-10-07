/* Teacher game selection. Content remains in the existing stores and launchers. */
window.GamesHub = (() => {
  const catalog = [
    {id:'moonquest',name:'MoonQuest',icon:'🌙',text:'Rabbit teams, diagram duels and a moonlit festival.',modes:[['Learner devices','/moonquest?game=']]},
    {id:'fishquest',name:'FishQuest',icon:'🐠',text:'Feed your fish and grow an ocean of classroom heroes.',modes:[['Smartboard','/fishquest/'],['Independent practice','/fishquest-play/']]},
    {id:'colonyquest',name:'ColonyQuest',icon:'🐜',text:'Build a colony, gather supplies and survive together.',modes:[['Smartboard','/colonyquest/'],['Learner devices · colony rivals','/colonyquest-live/']]},
    {id:'arcade',name:'Arcade games',icon:'🎮',text:'Car Dodge, Space Blaster, Answer Runner and Target Shot.',modes:[['Independent practice · learner chooses a game','/play/']]},
  ];
  let games=[], classes=()=>[], dialog;
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
  function link(text,url){const a=node('a',text,'btn ghost');a.href=url;return a;}
  function open(game){
    if(!dialog){dialog=node('dialog',null,'games-picker');document.body.append(dialog);dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});}
    dialog.replaceChildren();
    const header=node('div',null,'games-picker-head'), heading=node('h2','Choose a game');heading.id='games-picker-title';dialog.setAttribute('aria-labelledby',heading.id);
    const close=node('button','Close','btn ghost');close.type='button';close.onclick=()=>dialog.close();header.append(heading,close);dialog.append(header);
    dialog.append(node('p',game?game.lessonTitle:'Choose a game, then select your saved content.','hint'));
    const grid=node('div',null,'games-catalog');
    for(const item of catalog){
      const card=node('section',null,'games-option');card.append(node('div',item.icon,'games-icon'),node('h3',item.name),node('p',item.text));
      const compatible=g=>(g.mode==='moonquest')===(item.id==='moonquest');
      const available=games.filter(compatible);
      if(game&&!compatible(game)){
        card.append(node('p',item.id==='moonquest'?'Needs a diagram mission. Your multiple-choice questions stay saved.':'This content uses clickable diagrams. Choose a question set for this game.','hint'));
        if(item.id==='moonquest')card.append(link('Create diagram content','/moonquest'));
        else {const change=node('button','Choose other content','btn ghost');change.onclick=()=>open();card.append(change);}
      }else if(!game&&!available.length){
        card.append(node('p','No compatible content saved yet.','hint'));
        if(item.id==='moonquest')card.append(link('Create diagram content','/moonquest'));
        else {const create=node('button','Create question set','btn ghost');create.onclick=()=>{dialog.close();document.getElementById('fromPptxDetails').open=true;document.getElementById('fromPptxDetails').scrollIntoView({behavior:'smooth'});};card.append(create);}
      }else{
        const select=node('select');select.setAttribute('aria-label',item.name+' content');
        for(const g of game?[game]:available){const option=node('option',g.lessonTitle);option.value=g.id;select.append(option);}
        if(!game)card.append(select);
        const formats=node('details',null,'games-formats');formats.append(node('summary','Choose play format'));
        const actions=node('div',null,'games-mode-actions');formats.append(actions);
        const render=()=>{
          actions.replaceChildren();const selected=(game?[game]:available).find(g=>g.id===select.value);if(!selected)return;
          const names=classes(selected);actions.append(node('p',names.length?'Classes: '+names.join(', '):'Choose your class and check learners before starting.','hint'));
          if(item.id!=='moonquest'){
            const review=node('button','Review assigned classes','btn ghost');
            review.onclick=()=>{
              dialog.close();
              const button=[...document.querySelectorAll('.gc-class-btn')].find(el=>el.dataset.id===selected.id);
              if(button){button.closest('details').open=true;button.click();button.scrollIntoView({behavior:'smooth',block:'center'});}
              else {document.getElementById('gamesSearch').value='';document.getElementById('gamesClassFilter').value='all';document.getElementById('gamesStatusFilter').value='all';document.getElementById('gamesSearch').dispatchEvent(new Event('input'));const found=[...document.querySelectorAll('.gc-class-btn')].find(el=>el.dataset.id===selected.id);if(found){found.closest('details').open=true;found.click();found.scrollIntoView({behavior:'smooth',block:'center'});}}
            };actions.append(review);
          }
          for(const [label,path] of item.modes)actions.append(link(label+' →',path+encodeURIComponent(selected.id)));
          const preview=item.id==='moonquest'?'/moonquest?game='+encodeURIComponent(selected.id)+'&action=test':item.id==='colonyquest'?'/colonyquest/'+encodeURIComponent(selected.id)+'?test=1':item.id==='fishquest'?'/fishquest-play/'+encodeURIComponent(selected.id)+'?test=1':'/play/'+encodeURIComponent(selected.id)+'?test=1';
          const test=link('Try without saving scores',preview);test.target='_blank';test.rel='noopener';actions.append(test);
          actions.append(node('small',item.id==='moonquest'?'Choose duel, cooperative or battle royale in class setup.':'Live formats open teacher setup. Independent practice opens the learner activity.'));
        };select.onchange=render;render();card.append(formats);
      }
      grid.append(card);
    }
    dialog.append(grid);if(!dialog.open)dialog.showModal();
  }
  function decorate(wrap,visible,all,classNames){
    games=all;classes=classNames;
    for(const [index,card] of [...wrap.querySelectorAll('.game-card')].entries()){
      const game=visible[index];if(!game)continue;
      const body=card.querySelector('.gc-body'),actions=body.querySelector('.gc-actions');
      const choose=node('button','Choose a game','btn accent');choose.onclick=()=>open(game);
      const primary=node('div',null,'gc-actions');primary.append(choose);
      const more=node('details',null,'games-more');more.append(node('summary','More options'));
      if(game.mode==='moonquest'){
        const results=node('details',null,'games-more');results.append(node('summary','Results'));
        for(const a of [...actions.querySelectorAll('a')]){
          if(a.href.includes('?report='))results.append(a);
          else if(a.textContent.startsWith('Resume'))primary.append(a);
          else if(a.textContent==='Edit questions')more.append(a);
        }
        if(results.children.length===1)results.append(node('p','Results appear here after a class plays.','hint'));
        primary.append(results);
      }else{
        const result=actions.querySelector('.gc-results-btn');if(result)primary.append(result);
        for(const el of [...actions.children]){
          if(el.matches('.gc-class-btn,.gc-question-btn,.gc-extend-btn')||el.getAttribute('href')?.startsWith('/game-participants'))more.append(el);
        }
      }
      actions.remove();body.prepend(primary);primary.append(more);
    }
  }
  return {open,decorate};
})();
