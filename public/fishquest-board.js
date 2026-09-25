(()=>{
'use strict';
const $=id=>document.getElementById(id), game=new URLSearchParams(location.search).get('game');
const colors=['#ffbd65','#68e6d3','#c1a2ff','#ff99bd'];
let data,state,timer,saved,storageKey,students=[],sound=true,context;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fish(color,smile){return '<svg viewBox="0 0 130 70" aria-hidden="true"><path d="M37 35L7 10Q17 35 7 60Z" fill="'+color+'"/><ellipse cx="76" cy="35" rx="45" ry="28" fill="'+color+'"/><path d="M62 11Q77 0 87 12M62 58Q77 70 87 58" fill="'+color+'"/><ellipse cx="53" cy="35" rx="9" ry="15" fill="#fff" opacity=".25"/><circle cx="98" cy="26" r="8" fill="white"/><circle cx="101" cy="27" r="4" fill="#123b52"/><path d="'+(smile?'M94 43Q106 57 116 40':'M108 44L116 42')+'" fill="none" stroke="#184052" stroke-width="3" stroke-linecap="round"/></svg>'}
function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify(state))}catch{$('error').textContent='This browser cannot save session progress. Keep this tab open.'}}
function tone(){if(!sound)return;try{context=context||new(window.AudioContext||window.webkitAudioContext)();context.resume();[523,659,784].forEach((f,i)=>{const o=context.createOscillator(),g=context.createGain(),t=context.currentTime+i*.13;o.frequency.value=f;g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(.07,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(g).connect(context.destination);o.start(t);o.stop(t+.31)})}catch{}}
function setupRoster(){
 const n=Number($('teams').value);students=data.attendance.filter(p=>String(p.rosterId)===$('class').value).map((p,i)=>({...p,team:i%n}));
 $('roster').innerHTML=students.map((p,i)=>'<label>'+esc(p.name)+'<select aria-label="Team for '+esc(p.name)+'" data-player="'+i+'">'+colors.slice(0,n).map((_,t)=>'<option value="'+t+'" '+(t===p.team?'selected':'')+'>Team '+(t+1)+'</option>').join('')+'</select></label>').join('');
 $('roster').querySelectorAll('select').forEach(el=>el.onchange=()=>students[Number(el.dataset.player)].team=Number(el.value));
 $('plan').textContent=students.length?students.length+' learners · '+data.game.questions.length+' questions · Everyone gets a turn.':'No learners in this class. Assign a roster in My games first.';
 $('start').disabled=!students.length||!data.game.questions.length;
}
function schedule(){clearTimeout(timer);if(state?.phase==='reveal'&&!state.paused)timer=setTimeout(()=>{FishBoard.next(state);persist();render()},6500)}
function render(){
 clearTimeout(timer);$('setup').hidden=true;$('play').hidden=false;document.body.classList.toggle('paused',state.paused);
 const p=state.players[state.turn%state.players.length],q=state.questions[state.turn%state.questions.length],a=state.answers.at(-1);
 $('scores').innerHTML=state.food.map((f,t)=>'<div style="--team:'+colors[t]+'">Team '+(t+1)+' · <b>'+f+'</b> food</div>').join('');
 $('fish').style.setProperty('--teams',state.teamCount);
 $('fish').innerHTML=state.food.map((_,t)=>'<div class="reef">'+state.players.map((s,i)=>s.team===t?'<div class="swimmer '+(s===p?'active':'')+'" style="--delay:-'+(i%5)+'s">'+fish(colors[t],false)+'<span>'+esc(s.name)+'</span></div>':'').join('')+'</div>').join('');
 $('hero').hidden=!(state.phase==='reveal'&&a?.correct);
 $('hero').innerHTML=fish(colors[p.team],true)+'<strong>'+esc(p.name)+'</strong><p>Two bites for you. Three to share!</p>';
 $('food').innerHTML=state.phase==='reveal'&&a?.correct?Array.from({length:22},(_,i)=>'<i class="pellet" style="--x:'+((p.team+(i+.5)/22)/state.teamCount*100)+'%;--delay:'+((i%7)*.16)+'s"></i>').join(''):'';
 $('turn').textContent='Turn '+(state.turn+1)+' of '+state.rounds+' · Team '+(p.team+1)+' · '+p.name;
 $('question').textContent=state.paused?'Ocean paused — talk together':q.question;
 $('options').innerHTML=q.options.map((o,i)=>'<button data-answer="'+i+'" '+(state.phase!=='question'||state.paused?'disabled':'')+' class="'+(state.phase==='reveal'&&i===q.correctIndex?'correct':'')+'">'+String.fromCharCode(65+i)+'. '+esc(o)+'</button>').join('');
 $('options').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(FishBoard.answer(state,Number(b.dataset.answer))){persist();if(state.answers.at(-1).correct)tone();render()}});
 $('feedback').textContent=state.phase==='reveal'?(a.correct?'Great teamwork! +5 food for your team. ':'Let’s learn together. ')+(q.explanation||'The answer is '+q.options[q.correctIndex]+'.'):'Think together, then '+p.name+' taps one answer.';
 $('pause').textContent=state.paused?'Resume':'Pause';$('next').hidden=state.phase!=='reveal';$('next').disabled=state.paused;$('pause').hidden=state.phase==='ended';
 if(state.phase==='ended'){
  const max=Math.max(...state.food),winners=state.food.flatMap((f,i)=>f===max?['Team '+(i+1)]:[]);
  $('turn').textContent='Expedition complete · Everyone had a turn';$('question').textContent=max?winners.join(' & ')+' led the feeding!':'Our ocean learned together!';
  $('options').innerHTML='';$('feedback').textContent=state.answers.filter(a=>a.correct).length+' correct answers from '+state.answers.length+' turns. Every fish is part of our crew.';$('hero').hidden=true;$('food').innerHTML='';
 }
 schedule();
}
$('class').onchange=setupRoster;$('teams').onchange=setupRoster;
$('start').onclick=()=>{try{state=FishBoard.create(students,data.game.questions,Number($('teams').value));persist();tone();render()}catch(e){$('error').textContent=e.message}};
$('restore').onclick=()=>{state=saved;state.paused=true;render()};
$('pause').onclick=()=>{state.paused=!state.paused;persist();render()};
$('next').onclick=()=>{if(FishBoard.next(state)){persist();render()}};
$('restart').onclick=()=>{if(state.phase!=='ended'&&!confirm('Finish this board game and return to team setup?'))return;clearTimeout(timer);sessionStorage.removeItem(storageKey);state=null;saved=null;$('restore').hidden=true;$('play').hidden=true;$('setup').hidden=false;document.body.classList.remove('paused')};
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
  setupRoster();
  try{saved=JSON.parse(sessionStorage.getItem(storageKey));if(saved&&Array.isArray(saved.players)&&saved.players.length&&Array.isArray(saved.questions)&&saved.questions.length&&['question','reveal'].includes(saved.phase))$('restore').hidden=false;else saved=null}catch{}
 }catch(e){$('error').textContent=e.message;$('start').disabled=true}
}
load();
})();
