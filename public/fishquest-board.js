(()=>{
'use strict';
const $=id=>document.getElementById(id), game=new URLSearchParams(location.search).get('game');
const colors=['#ffbd65','#68e6d3','#c1a2ff','#ff99bd'];
let data,state,timer,saved,storageKey,students=[],teamNames=['Coral Crew','Lagoon Legends','Pearl Patrol','Reef Rangers'],sound=true,context;
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
 return '<div class="growth-label">'+esc(FishQuestGrowth.name(stage))+' · '+Math.round(player.mass)+' size'+(progress.next?' / '+progress.next+' to grow':' · Fully grown')+'<div class="growth-meter"><i style="width:'+Math.round(progress.fraction*100)+'%"></i></div></div>';
}
function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify(state))}catch{$('error').textContent='This browser cannot save session progress. Keep this tab open.'}}
function tone(){if(!sound)return;try{context=context||new(window.AudioContext||window.webkitAudioContext)();context.resume();[523,659,784].forEach((f,i)=>{const o=context.createOscillator(),g=context.createGain(),t=context.currentTime+i*.13;o.frequency.value=f;g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(.07,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(g).connect(context.destination);o.start(t);o.stop(t+.31)})}catch{}}
function teamName(t){return state?.teamNames?.[t]||teamNames[t]||('Team '+(t+1))}
function setupRoster(){
 const n=Number($('teams').value);students=data.attendance.filter(p=>String(p.rosterId)===$('class').value).map((p,i)=>({...p,team:i%n}));
 $('teamEditor').innerHTML=colors.slice(0,n).map((c,t)=>'<label style="--team:'+c+'"><span></span><input maxlength="35" aria-label="Team '+(t+1)+' name" value="'+esc(teamNames[t])+'" data-team="'+t+'"></label>').join('');
 $('teamEditor').querySelectorAll('input').forEach(el=>el.oninput=()=>{teamNames[Number(el.dataset.team)]=el.value.trim()||('Team '+(Number(el.dataset.team)+1))});
 $('roster').innerHTML=students.map((p,i)=>'<label>'+esc(p.name)+'<select aria-label="Team for '+esc(p.name)+'" data-player="'+i+'">'+colors.slice(0,n).map((_,t)=>'<option value="'+t+'" '+(t===p.team?'selected':'')+'>Team '+(t+1)+'</option>').join('')+'</select></label>').join('');
 $('roster').querySelectorAll('select').forEach(el=>el.onchange=()=>students[Number(el.dataset.player)].team=Number(el.value));
 $('plan').textContent=students.length?students.length+' learners · '+data.game.questions.length+' questions · Everyone gets a turn.':'No learners in this class. Assign a roster in My games first.';
 $('start').disabled=!students.length||!data.game.questions.length;
}
function schedule(){clearTimeout(timer);if(state?.phase==='reveal'&&!state.paused)timer=setTimeout(()=>{FishBoard.next(state);persist();render()},6500)}
function render(){
 clearTimeout(timer);$('setup').hidden=true;$('play').hidden=false;document.body.classList.add('game-active');document.body.classList.toggle('paused',state.paused);
 const p=state.players[state.turn%state.players.length],q=state.questions[state.turn%state.questions.length],a=state.answers.at(-1);
 $('scores').innerHTML=state.food.map((f,t)=>'<div style="--team:'+colors[t]+'"><span>'+esc(teamName(t))+'</span><b>'+f+' <small>food</small></b><i style="width:'+Math.min(100,20+f*2)+'%"></i></div>').join('');
 $('fish').style.setProperty('--teams',state.teamCount);
 $('fish').innerHTML=state.food.map((_,t)=>'<div class="reef">'+state.players.filter(s=>s.team===t).map((s,i)=>'<div class="swimmer '+(s===p&&state.phase!=='ended'?'active':'')+'" style="--team:'+colors[t]+';--delay:-'+(i%7)+'s;--x:'+(12+(i%3)*25)+'%;--y:'+(18+Math.floor(i/3)*18)+'%;--speed:'+(5+i%5)+'s">'+fish(s,false)+'<span>'+esc(s.name)+'</span></div>').join('')+'</div>').join('');
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
  $('turn').textContent='Expedition complete · Everyone had a turn';$('question').textContent=max?winners.join(' & ')+' led the feeding!':'Our ocean learned together!';
  $('options').innerHTML='';$('feedback').textContent=state.answers.filter(a=>a.correct).length+' correct answers from '+state.answers.length+' turns. Every fish is part of our crew.';$('hero').hidden=true;$('food').innerHTML='';
 }
 schedule();
}
$('class').onchange=setupRoster;$('teams').onchange=setupRoster;
$('start').onclick=()=>{try{state=FishBoard.create(students,data.game.questions,Number($('teams').value),Number($('rounds').value));state.teamNames=teamNames.slice(0,state.teamCount);persist();tone();render()}catch(e){$('error').textContent=e.message}};
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
  try{saved=JSON.parse(sessionStorage.getItem(storageKey));if(saved&&Array.isArray(saved.players)&&saved.players.length&&Array.isArray(saved.questions)&&saved.questions.length&&['question','reveal'].includes(saved.phase))$('restore').hidden=false;else saved=null}catch{}
 }catch(e){$('error').textContent=e.message;$('start').disabled=true}
}
load();
})();
