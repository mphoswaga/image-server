(()=>{
'use strict';
const $=id=>document.getElementById(id), game=new URLSearchParams(location.search).get('game');
const colors=['#ffbd65','#68e6d3','#c1a2ff','#ff99bd'];
let data,state,timer,saved,storageKey,students=[],teamNames=['Coral Crew','Lagoon Legends','Pearl Patrol','Reef Rangers'],sound=true,context,lastCue='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fish(player,smile){
 const stage=FishQuestGrowth.evolution(player.mass),style=FishQuestGrowth.style[stage],scale=FishQuestGrowth.scale(player.mass);
 const index=state.players.indexOf(player),before=state.phase==='reveal'&&state.lastGrowth?.turn===state.turn?state.lastGrowth.before[index]:player.mass;
 const grew=before<player.mass,variant=player.variant;
 const tail=style.tail/style.body*100,fin=style.fin/style.body*100;
 const tailLeft=50+style.tailX/(160*style.body)*100-.9*tail,tailTop=50-.5*tail;
 const finLeft=50+style.finX/(160*style.body)*100-.68*fin,finTop=50+style.finY/(112*style.body)*100-.28*fin;
 return '<span class="fish-growth '+(grew?'fed':'')+'" data-stage="'+stage+'" data-mass="'+Math.round(player.mass)+'" data-variant="'+variant+'" style="--fish-size:'+scale+';--growth-from:'+FishQuestGrowth.scale(before)/scale+'"><span class="fish-sprite '+(smile?'happy':'')+'"><img class="fish-tail" alt="" style="width:'+tail+'%;height:'+tail+'%;left:'+tailLeft+'%;top:'+tailTop+'%" src="'+FishQuestArt.data(variant,'tail',stage)+'"><img class="fish-body" alt="" src="'+FishQuestArt.data(variant,'body',stage,smile?'happy':'neutral')+'"><img class="fish-fin" alt="" style="width:'+fin+'%;height:'+fin+'%;left:'+finLeft+'%;top:'+finTop+'%" src="'+FishQuestArt.data(variant,'fin',stage)+'"></span></span>';
}
function growthLabel(player){
 const stage=FishQuestGrowth.evolution(player.mass),progress=FishQuestGrowth.progress(player.mass);
 return '<div class="growth-label">'+(progress.next?'Growing into a '+esc(FishQuestGrowth.name(FishQuestGrowth.evolution(progress.next))):'Fully grown whale')+'<div class="growth-meter"><i style="width:'+Math.round(progress.fraction*100)+'%"></i></div></div>';
}

function sizeOcean(){
 const panel=$('storyPanel').hidden?document.querySelector('.question'):$('storyPanel');
 $('ocean').style.setProperty('--dock-height',(panel.offsetHeight+26)+'px');
 document.querySelectorAll('.reef').forEach(reef=>{
  const rows=Number(reef.style.getPropertyValue('--rows'))||1;
  const rowHeight=(reef.clientHeight-18-4*rows)/rows;
  reef.style.setProperty('--school-fish-max',Math.max(18,(rowHeight-19)*160/112)+'px');
 });
}
window.addEventListener('resize',sizeOcean);
if(window.ResizeObserver){const observer=new ResizeObserver(sizeOcean);observer.observe(document.querySelector('.question'));observer.observe($('storyPanel'))}
function shortNames(players){
 const names=players.map(p=>(p.displayName||p.name).trim().split(/\s+/));
 const labels=names.map(parts=>parts.length>2?parts.slice(-2).join(' '):parts.join(' '));
 return labels.map((label,i)=>labels.filter(x=>x===label).length>1?label+' · '+(i+1):label);
}
function dangerArt(kind){
 if(kind==='shark')return '<svg class="shark-art" viewBox="0 0 700 280"><defs><linearGradient id="sharkPaint" x2="0" y2="1"><stop stop-color="#8faeba"/><stop offset="1" stop-color="#284c66"/></linearGradient></defs><path d="M180 146L40 47 72 146 36 244 188 170Q365 257 627 161L677 143 627 119Q559 81 465 83L372 16 354 91Q264 88 180 146Z" fill="url(#sharkPaint)" stroke="#153b50" stroke-width="5"/><path d="M227 175Q431 228 631 156Q433 192 227 175Z" fill="#d7e7df"/><path d="M400 170L338 253 477 186" fill="#3e6880"/><circle cx="596" cy="126" r="7" fill="#163041"/><path d="M584 158Q609 167 634 155M525 117L516 150M510 114L500 149M494 112L484 147" fill="none" stroke="#24475b" stroke-width="5"/></svg>';
 return '<svg class="boat-art" viewBox="0 0 650 200"><ellipse cx="325" cy="100" rx="295" ry="67" fill="#021929" opacity=".4"/><path d="M57 68Q316 4 595 74L546 150Q297 188 103 144Z" fill="#674b34" stroke="#302c29" stroke-width="7"/><path d="M118 72L135 139M211 47L225 157M319 38L322 162M425 47L420 158M524 64L501 146" stroke="#ba9970" stroke-width="6"/><path d="M278 36L279 149 386 149 388 40" fill="#344b50" stroke="#b7afa0" stroke-width="6"/></svg><div class="fishing-net"><span></span></div>';
}
function warningSound(kind){
 if(!sound)return;try{
 context=context||new(window.AudioContext||window.webkitAudioContext)();context.resume();
 [0,.45,.9].forEach((delay,i)=>{const o=context.createOscillator(),g=context.createGain(),at=context.currentTime+delay;o.type='sine';o.frequency.setValueAtTime(kind==='shark'?100+i*15:180-i*20,at);g.gain.setValueAtTime(.001,at);g.gain.linearRampToValueAtTime(.065,at+.08);g.gain.exponentialRampToValueAtTime(.001,at+.4);o.connect(g).connect(context.destination);o.start(at);o.stop(at+.42)});
 }catch{}
}
function renderStory(){
 const e=FishBoardStory.current(state),phase=state.phase,isEvent=phase.startsWith('event_'),special=phase==='intro'||isEvent;
 $('storyPanel').hidden=!special;
 document.querySelector('.question').classList.toggle('story-mode',special);
 $('ocean').dataset.phase=phase;$('ocean').dataset.motion=e?.result?.motion||'';
 $('danger').className=isEvent?e.kind+' '+phase:'';
 $('danger').innerHTML=isEvent?dangerArt(e.kind):'';
 $('journey').hidden=!state.story;
 $('journey').textContent=state.story?(phase==='ended'?'✦ Deep-water sanctuary':e?(e.kind==='shark'?'⚠ The shadow below':'⚠ The boat above'):state.story.completed.includes('shark')?'2 · Beyond the shark — keep feeding':'1 · Feed your school — a shark is coming'):'';
 if(!special)return;
 $('hero').hidden=phase==='intro'||phase==='event_warning';
 $('food').innerHTML=e?.result?.motion==='distract'?Array.from({length:16},(_,i)=>'<i class="pellet" style="--x:'+(30+i*2.5)+'%;--delay:'+((i%5)*.13)+'s"></i>').join(''):'';
 $('next').hidden=true;
 $('storyContinue').hidden=phase!=='intro';
 $('storyContinue').disabled=state.paused;
 $('storyChoices').innerHTML='';
 if(phase==='intro'){
  $('storyChapter').textContent='THE LANTERN REEF EXPEDITION';
  $('storyTitle').textContent='A shadow is coming…';
  $('storyText').textContent='Feed your fish by solving challenges together. A shark is approaching, and a fishing boat waits above. Grow your school, protect its food, and guide every fish to the deep-water sanctuary. Your team will choose together when danger arrives.';
  $('storyContinue').textContent='Dive in — feed the school';
 }else{
  $('storyChapter').textContent=(e.kind==='shark'?'CHAPTER 2 · THE SHADOW BELOW':'CHAPTER 3 · THE BOAT ABOVE')+(phase==='event_warning'?'':' · '+teamName(e.team));
  $('storyTitle').textContent=phase==='event_warning'?(e.kind==='shark'?'Look at that shadow!':'A boat… and a falling net!'):phase==='event_result'?e.result.text:e.captain.name+', lead your school';
  $('storyText').textContent=phase==='event_warning'?(e.kind==='shark'?'A hungry shark is circling the reef. Get ready to choose how your team escapes.':'The fishing net is coming down. Even large fish need a safe route. Get ready to choose together.'):phase==='event_result'?(e.result.lost?e.result.lost+' food left behind. Every learner’s fish is still in the expedition.':'All your food is protected!'):'Discuss with your team. '+e.captain.name+' taps one choice for everyone. You have '+state.food[e.team]+' food.';
  if(phase==='event_choice'){
   $('storyChoices').innerHTML=FishBoardStory.choices(state).map(o=>'<button data-choice="'+o.id+'" '+(!o.enabled||state.paused?'disabled':'')+'><b>'+esc(o.title)+'</b><span>'+esc(o.detail)+(!o.enabled?' You need more food.':'')+'</span></button>').join('');
   $('storyChoices').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(FishBoard.choose(state,b.dataset.choice)){persist();render()}});
  }
  const cue=state.turn+':'+phase+':'+e.team;
  if(!state.paused&&phase==='event_warning'&&lastCue!==cue){warningSound(e.kind);lastCue=cue}
 }
 if(state.paused)$('storyText').textContent='Paused — take your time to discuss. Press Resume when the class is ready.';
}
$('storyContinue').onclick=()=>{if(FishBoard.advance(state)){persist();render()}};

function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify(state))}catch{$('error').textContent='This browser cannot save session progress. Keep this tab open.'}}
function tone(){if(!sound)return;try{context=context||new(window.AudioContext||window.webkitAudioContext)();context.resume();[523,659,784].forEach((f,i)=>{const o=context.createOscillator(),g=context.createGain(),t=context.currentTime+i*.13;o.frequency.value=f;g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(.07,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(g).connect(context.destination);o.start(t);o.stop(t+.31)})}catch{}}
function teamName(t){return state?.teamNames?.[t]||teamNames[t]||('Team '+(t+1))}
function setupRoster(){
 const n=Number($('teams').value);students=data.attendance.filter(p=>String(p.rosterId)===$('class').value).map((p,i)=>({...p,team:i%n,displayName:p.name.trim().split(/\s+/).slice(-2).join(' ')}));
 $('teamEditor').innerHTML=colors.slice(0,n).map((c,t)=>'<label style="--team:'+c+'"><span></span><input maxlength="35" aria-label="Team '+(t+1)+' name" value="'+esc(teamNames[t])+'" data-team="'+t+'"></label>').join('');
 $('teamEditor').querySelectorAll('input').forEach(el=>el.oninput=()=>{teamNames[Number(el.dataset.team)]=el.value.trim()||('Team '+(Number(el.dataset.team)+1))});
 $('roster').innerHTML=students.map((p,i)=>'<label><span class="roster-name">'+esc(p.name)+'<input class="fish-display-name" maxlength="30" aria-label="Fish name for '+esc(p.name)+'" data-name="'+i+'" value="'+esc(p.displayName)+'"></span><select aria-label="Team for '+esc(p.name)+'" data-player="'+i+'">'+colors.slice(0,n).map((_,t)=>'<option value="'+t+'" '+(t===p.team?'selected':'')+'>Team '+(t+1)+'</option>').join('')+'</select></label>').join('');
 $('roster').querySelectorAll('select').forEach(el=>el.onchange=()=>students[Number(el.dataset.player)].team=Number(el.value));
 $('roster').querySelectorAll('[data-name]').forEach(el=>el.oninput=()=>students[Number(el.dataset.name)].displayName=el.value.trim()||students[Number(el.dataset.name)].name);
 $('plan').textContent=students.length?students.length+' learners · '+data.game.questions.length+' questions · Everyone gets a turn.':'No learners in this class. Assign a roster in My games first.';
 $('start').disabled=!students.length||!data.game.questions.length;
}
function schedule(){
 clearTimeout(timer);if(!state||state.paused)return;
 const delay={reveal:6500,event_warning:7000,event_result:5500}[state.phase];
 if(delay)timer=setTimeout(()=>{if(state.phase==='reveal')FishBoard.next(state);else FishBoard.advance(state);persist();render()},delay);
}
function render(){
 clearTimeout(timer);$('setup').hidden=true;$('play').hidden=false;document.body.classList.add('game-active');document.body.classList.toggle('paused',state.paused);
 const event=FishBoardStory.current(state),p=event?.captain||state.players[state.turn%state.players.length],q=state.questions[state.turn%state.questions.length],a=state.answers.at(-1);
 $('scores').innerHTML=state.food.map((f,t)=>'<div style="--team:'+colors[t]+'"><span>'+esc(teamName(t))+'</span><b>'+f+' <small>food</small></b><i style="width:'+Math.min(100,20+f*2)+'%"></i></div>').join('');
 $('fish').style.setProperty('--teams',state.teamCount);
 const displayNames=shortNames(state.players);
 $('fish').innerHTML=state.food.map((_,t)=>{
  const members=state.players.filter(s=>s.team===t),cols=members.length>8?4:Math.min(3,members.length),rows=Math.ceil(members.length/cols);
  return '<div class="reef '+(event?.team===t?'event-team':'')+'" data-team="'+t+'" style="--rows:'+rows+';--cols:'+cols+'"><span class="reef-flag" style="--team:'+colors[t]+'">'+esc(teamName(t))+'</span>'+members.map((s,i)=>'<div class="swimmer '+(s===p&&state.phase!=='ended'?'active':'')+'" title="'+esc(s.name)+'" style="--team:'+colors[t]+';--delay:-'+(i%7)+'s;--speed:'+(5+i%5)+'s">'+fish(s,false)+'<span>'+esc(displayNames[state.players.indexOf(s)])+'</span></div>').join('')+'</div>';
 }).join('');
 $('hero').hidden=state.phase==='ended';
 $('hero').classList.toggle('celebrating',state.phase==='reveal'&&a?.correct);
 $('hero').innerHTML='<div class="hero-banner">'+esc(teamName(p.team))+' · '+(state.phase==='reveal'&&a?.correct?'Food for the whole crew!':'Your fish is up!')+'</div>'+fish(p,state.phase==='reveal'&&a?.correct)+'<strong>'+esc(p.name)+'</strong><p>'+(state.phase==='reveal'&&a?.correct?(state.lastGrowth?.evolved?'You evolved into a '+FishQuestGrowth.name(FishQuestGrowth.evolution(p.mass))+'!':'Two bites for you. Three to share!'):'Think with your team, then choose below.')+'</p>'+growthLabel(p);
 $('food').innerHTML=state.phase==='reveal'&&a?.correct?Array.from({length:22},(_,i)=>'<i class="pellet" style="--x:'+(i%2?45+(i%6)*2:20+(p.team+(i+.5)/22)/state.teamCount*75)+'%;--delay:'+((i%7)*.16)+'s"></i>').join(''):'';
 $('turn').textContent='Turn '+(state.turn+1)+' of '+state.rounds+' · '+teamName(p.team)+' · '+p.name;
 $('question').textContent=state.paused?'Ocean paused — talk together':q.question;
 $('options').innerHTML=q.options.map((o,i)=>'<button data-answer="'+i+'" '+(state.phase!=='question'||state.paused?'disabled':'')+' class="'+(state.phase==='reveal'&&i===q.correctIndex?'correct':'')+'">'+String.fromCharCode(65+i)+'. '+esc(o)+'</button>').join('');
 $('options').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(FishBoard.answer(state,Number(b.dataset.answer))){persist();if(state.answers.at(-1).correct)tone();render()}});
 $('feedback').textContent=state.phase==='reveal'?(a.correct?'Great teamwork! +5 food for your team. ':'Let’s learn together. ')+(q.explanation||'The answer is '+q.options[q.correctIndex]+'.'):'Think together, then '+p.name+' taps one answer.';
 $('pause').textContent=state.paused?'Resume':'Pause';$('next').hidden=state.phase!=='reveal';$('next').disabled=state.paused;$('pause').hidden=state.phase==='ended';
 if(state.phase==='ended'){
  const max=Math.max(...state.food),winners=state.food.flatMap((f,i)=>f===max?[teamName(i)]:[]);
  $('turn').textContent=state.story?'Sanctuary reached · Every fish made it home!':'Expedition complete · Everyone had a turn';$('question').textContent=max?winners.join(' & ')+' led the feeding!':'Our ocean learned together!';
  $('options').innerHTML='';$('feedback').textContent=state.answers.filter(a=>a.correct).length+' correct answers from '+state.answers.length+' turns. Every fish is part of our crew.';$('hero').hidden=true;$('food').innerHTML='';
 }
 renderStory();
 requestAnimationFrame(sizeOcean);
 schedule();
}
$('class').onchange=setupRoster;$('teams').onchange=setupRoster;
$('start').onclick=()=>{try{state=FishBoard.create(students,data.game.questions,Number($('teams').value),Number($('rounds').value),$('storyEnabled').checked);state.teamNames=teamNames.slice(0,state.teamCount);persist();tone();render()}catch(e){$('error').textContent=e.message}};
$('restore').onclick=()=>{state=FishBoard.upgrade(saved);state.paused=true;persist();render()};
$('pause').onclick=()=>{state.paused=!state.paused;persist();render()};
$('next').onclick=()=>{if(FishBoard.next(state)){persist();render()}};
$('restart').onclick=()=>{if(state.phase!=='ended'&&!confirm('Finish this board game and return to team setup?'))return;clearTimeout(timer);sessionStorage.removeItem(storageKey);state=null;saved=null;$('restore').hidden=true;$('play').hidden=true;$('setup').hidden=false;document.body.classList.remove('paused','game-active')};
$('sound').onclick=()=>{sound=!sound;$('sound').textContent=sound?'Sound on':'Sound off'};
$('full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{$('error').textContent='Use your browser’s full-screen control on this device.'}};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state&&state.phase!=='ended'){state.paused=true;persist();render()}});
async function load(){
 try{
  if(!game)throw Error('Open this game from the FishQuest teacher controls.');
  $('back').href='/fishquest/'+encodeURIComponent(game);
  const r=await fetch('/api/game/'+encodeURIComponent(game)+'/fishquest/smartboard');
  if(!r.ok)throw Error(r.status===401?'Sign in to LessonScope, then open this game again.':'This game could not be loaded. Check that it belongs to your account.');
  data=await r.json();storageKey='fishboard:'+data.storageKey;
  $('class').innerHTML=data.classes.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  $('review').innerHTML=data.game.questions.map((q,i)=>'<p><b>'+esc(i+1)+'. '+esc(q.question)+'</b><br>'+esc(q.options[q.correctIndex])+'</p>').join('');
  $('bubbles').innerHTML=Array.from({length:22},(_,i)=>'<i style="left:'+((i*37)%100)+'%;--delay:-'+(i%11)+'s;--speed:'+(9+i%8)+'s"></i>').join('');
  setupRoster();
  try{saved=JSON.parse(sessionStorage.getItem(storageKey));if(saved&&Array.isArray(saved.players)&&saved.players.length&&Array.isArray(saved.questions)&&saved.questions.length&&['intro','question','reveal','event_warning','event_choice','event_result'].includes(saved.phase))$('restore').hidden=false;else saved=null}catch{}
 }catch(e){$('error').textContent=e.message;$('start').disabled=true}
}
load();
})();
