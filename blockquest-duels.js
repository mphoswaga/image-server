// Server-owned class competition. One turn engine is shared with solo and smartboard.
const crypto=require('node:crypto'),core=require('./public/blockquest-core'),turns=require('./blockquest-turns');
const shuffle=list=>{const a=list.slice();for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
function create(game,{students,teams,minutes=3,rounds=3,rosterId,preview=false},now=Date.now()){
 if(![3,5].includes(Number(minutes)))throw Error('Choose a 3 or 5 minute duel.');
 if(!Number.isInteger(Number(rounds))||rounds<1||rounds>10)throw Error('Choose between 1 and 10 rounds.');
 const bank=game.questions.map((q,sourceIndex)=>({...q,sourceIndex})).filter(q=>q.options?.length>=2);if(!bank.length)throw Error('Add multiple-choice questions first.');
 const allowed=new Map(students.map(p=>[String(p.id),p])),seen=new Set();
 const clean=teams.map((t,index)=>({id:'team-'+index,name:String(t.name||'Team '+(index+1)).trim().slice(0,60),members:t.members.map(String).map(id=>{if(!allowed.has(id)||seen.has(id))throw Error('Assign each selected learner once.');seen.add(id);return id;})}));
 if(clean.length<2||clean.length>6||clean.filter(t=>t.members.length).length<2)throw Error('Include learners in at least two teams.');
 const players={};for(const team of clean)for(const id of team.members){const p=allowed.get(id);players[id]={id,name:p.name,team:team.id,rosterId,joined:preview,lastSeen:0,isBot:preview&&id!=='demo-1',score:0,wins:0,answers:[],run:null};}
 return {id:crypto.randomUUID(),gameId:game.id,preview,rosterId,phase:'lobby',minutes:Number(minutes),rounds:Number(rounds),roundNumber:0,teams:clean,players,bank,matchups:[],pairCounts:{},lastRound:[],saved:false,updatedAt:now};
}
function pairRound(s,now){
 const ids=shuffle(Object.values(s.players).filter(p=>p.joined).map(p=>p.id));if(ids.length<2)throw Error('Wait for at least two learners to join.');
 s.roundNumber++;s.matchups=[];s.roundBank=shuffle(s.bank);s.offers=Object.fromEntries(s.roundBank.map((_,i)=>[i,core.choices()]));
 const pairKey=(a,b)=>[a,b].sort().join('|');
 while(ids.length){
  const a=ids.shift();let b;
  if(ids.length){ids.sort((x,y)=>{const px=s.players[x],py=s.players[y],pa=s.players[a];const cost=id=>(s.players[id].team===pa.team?10000:0)+(s.pairCounts[pairKey(a,id)]||0)*100;return cost(x)-cost(y);});b=ids.shift();}
  else b='computer-'+s.roundNumber;
  const bot=b.startsWith('computer-')?{id:b,name:'Nova · computer',team:null,isBot:true,score:0,wins:0,answers:[],joined:true}:null;
  if(bot)s.computer=bot;
  s.matchups.push({id:crypto.randomUUID(),a,b,friendly:!bot&&s.players[a].team===s.players[b].team});s.pairCounts[pairKey(a,b)]=(s.pairCounts[pairKey(a,b)]||0)+1;
 }
 for(const p of Object.values(s.players))p.run=null;
 s.phase='matchup';s.transitionAt=Math.max(now,s.resultsUntil||0)+6000;s.updatedAt=now;
}
function participant(s,id){return s.players[id]||s.computer?.id===id&&s.computer;}
function startRound(s,now){
 for(const pair of s.matchups)for(const id of [pair.a,pair.b]){
  const p=participant(s,id);p.run={id:crypto.randomUUID(),revision:0,timed:true,mode:'board',loopQuestions:true,phase:'answer',turn:0,active:0,learner:p.name,teams:[{name:p.name,members:[{id:p.id,name:p.name}],board:core.empty(),points:0,lines:0,picks:1}],answers:[],choices:[],questions:s.roundBank,pieceRounds:s.offers};turns.questionClock(p.run,now);p.nextBotAt=now+2500+crypto.randomInt(2500);
 }
 s.phase='running';s.roundEndsAt=now+s.minutes*60000;s.updatedAt=now;
}
function runPoints(p){return p?.run?.teams[0]?.points||0;}
function finishRound(s,now,final=false){
 s.lastRound=s.matchups.map(pair=>{
  const a=participant(s,pair.a),b=participant(s,pair.b),ap=runPoints(a),bp=runPoints(b),winner=ap===bp?null:ap>bp?a:b;
  if(winner&&!winner.isBot)winner.wins++;
  return {aId:a.id,bId:b.id,a:a.name,b:b.name,aPoints:ap,bPoints:bp,winner:winner?.name||null,winnerId:winner?.id||null,friendly:pair.friendly};
 });
 for(const p of Object.values(s.players)){if(!p.run)continue;p.score+=runPoints(p);p.answers.push(...p.run.answers);p.run=null;}
 s.resultsUntil=now+4000;
 if(final||s.roundNumber>=s.rounds){s.phase='ended';s.updatedAt=now;}else pairRound(s,now);
}
function botTurn(p,now){
 if(!p.run||now<p.nextBotAt)return;const run=p.run;
 if(run.phase==='answer'){const q=run.questions[run.turn],choice=crypto.randomInt(100)<65?q.correctIndex:(q.correctIndex+1)%q.options.length;turns.answerTimed(run,choice,now);run.revision++;p.nextBotAt=now+1800+crypto.randomInt(2200);}
 else if(run.phase==='choose'){const candidates=[];for(const shape of run.choices)for(let rotation=0;rotation<4;rotation++)for(let column=0;column<8;column++)if(core.fits(run.teams[0].board,core.cells(shape,rotation),column,run.falling.y))candidates.push({shape,rotation,column});
  if(candidates.length)Object.assign(run.falling,candidates[crypto.randomInt(candidates.length)]);turns.lockBlock(run,now);run.revision++;p.nextBotAt=now+2200;
 }
}
function tick(s,now=Date.now()){
 if(['ended','lobby','paused'].includes(s.phase))return false;
 if(s.phase==='matchup'){if(now>=s.transitionAt){startRound(s,now);return true;}return false;}
 let changed=false;const until=Math.min(now,s.roundEndsAt);
 for(const pair of s.matchups)for(const id of [pair.a,pair.b]){const p=participant(s,id);if(turns.tick(p.run,until))changed=true;if(p.isBot&&now<s.roundEndsAt){const rev=p.run.revision;botTurn(p,until);if(p.run.revision!==rev)changed=true;}}
 if(now>=s.roundEndsAt){finishRound(s,now);changed=true;}if(changed)s.updatedAt=now;return changed;
}
function pause(s,now=Date.now()){
 if(s.phase==='paused'){
  const delay=now-s.pausedAt;s.phase=s.beforePause;for(const field of ['roundEndsAt','transitionAt','resultsUntil'])if(Number.isFinite(s[field]))s[field]+=delay;
  for(const p of [...Object.values(s.players),s.computer].filter(Boolean))if(p.run){const r=p.run;r.phase=r.beforePause;for(const field of ['deadline','readyAt','placementStartedAt','phaseStartedAt'])if(Number.isFinite(r[field]))r[field]+=delay;if(r.falling)r.falling.lastStepAt+=delay;delete r.pausedAt;p.nextBotAt+=delay;}
  delete s.pausedAt;
 }else{
  if(!['running','matchup'].includes(s.phase))throw Error('Start the duels before pausing.');s.beforePause=s.phase;s.phase='paused';s.pausedAt=now;
  for(const p of [...Object.values(s.players),s.computer].filter(Boolean))if(p.run){p.run.beforePause=p.run.phase;p.run.phase='paused';p.run.pausedAt=now;}
 }s.updatedAt=now;
}
function action(s,id,b,now=Date.now()){
 if(s.phase!=='running')throw Error('Wait for your duel to start.');const p=s.players[id],r=p?.run;if(!r)throw Error('You will join the next round.');
 if(b.run!==r.id||b.revision!==r.revision)throw Error('Your turn has changed. Try again.');
 if(b.action==='answer'&&r.phase==='answer'){
  const q=r.questions[r.turn];if(!Number.isInteger(b.choice)||b.choice<0||b.choice>=q.options.length)throw Error('Choose an answer.');turns.answerTimed(r,b.choice,now);
 }else if(b.action==='move'&&r.phase==='choose'){
  const f={...r.falling,...Object.fromEntries(['shape','rotation','column'].filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]]))};if(!r.choices.includes(f.shape)||!Number.isInteger(f.rotation)||f.rotation<0||f.rotation>3||!Number.isInteger(f.column)||!core.fits(r.teams[0].board,core.cells(f.shape,f.rotation),f.column,f.y))throw Error('That move is blocked.');r.falling=f;
 }else if(b.action==='place'&&r.phase==='choose')turns.lockBlock(r,now);else throw Error('Wait for this action to finish.');
 r.revision++;s.updatedAt=now;
}
function ranking(s){return Object.values(s.players).map(p=>{const answers=p.answers.concat(p.run?.answers||[]);return {id:p.id,name:p.name,team:p.team,points:p.score+runPoints(p),wins:p.wins,correct:answers.filter(a=>a.correct).length,answered:answers.length,rows:p.run?.teams[0]?.lines||0,joined:p.joined};}).sort((a,b)=>b.points-a.points||b.wins-a.wins||a.name.localeCompare(b.name));}
function publicRun(r){if(!r)return null;const q=r.questions[r.turn];return {...r,questions:undefined,pieceRounds:undefined,teams:r.teams.map(t=>({...t,members:undefined})),question:r.phase==='answer'?{question:q.question,options:q.options}:null,feedback:r.phase==='feedback'?{correct:r.answers.at(-1)?.correct,answer:q.options[q.correctIndex],explanation:q.explanation||''}:undefined};}
function view(s,id,teacher=false,now=Date.now()){
 const ranks=ranking(s),p=s.players[id],pair=s.matchups.find(m=>m.a===id||m.b===id),foe=pair?participant(s,pair.a===id?pair.b:pair.a):null;
 return {id:s.id,phase:s.phase,preview:s.preview,minutes:s.minutes,rounds:s.rounds,roundNumber:s.roundNumber,serverNow:now,roundEndsAt:s.roundEndsAt,transitionAt:s.transitionAt,resultsUntil:s.resultsUntil,pausedAt:s.pausedAt,beforePause:s.beforePause,rosterId:s.rosterId,
  teams:s.teams.map(t=>({id:t.id,name:t.name,points:ranks.filter(p=>p.team===t.id).reduce((n,p)=>n+p.points,0)})),top10:ranks.filter(p=>p.joined).slice(0,10),lastRound:s.lastRound,
  me:p?{id:p.id,name:p.name,team:p.team,joined:p.joined,points:p.score+runPoints(p),rank:ranks.findIndex(q=>q.id===id)+1}:null,run:publicRun(p?.run),opponent:foe?{id:foe.id,name:foe.name,team:foe.team,points:runPoints(foe),board:foe.run?.teams[0]?.board||core.empty(),rows:foe.run?.teams[0]?.lines||0,answered:foe.run?.answers.length||0}:null,friendly:pair?.friendly||false,
  ...(teacher?{players:ranks,matchups:s.matchups.map(m=>({id:m.id,a:participant(s,m.a).name,b:participant(s,m.b).name,aPoints:runPoints(participant(s,m.a)),bPoints:runPoints(participant(s,m.b)),friendly:m.friendly}))}:{})};
}
module.exports={create,pairRound,startRound,finishRound,tick,pause,action,view,ranking};
