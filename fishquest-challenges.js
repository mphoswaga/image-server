// Independent answers: neither speed nor an opponent's answer changes a learner's mark.
const crypto=require('crypto');
const WHALE=800, COOLDOWN=15000, PEARL_INTERVAL=45000;
function available(p,t){return !p.npc&&p.connected&&!p.removed&&!p.lock&&!p.respawnAt&&(p.challengeUntil||0)<=t;}
function start(match,players,kind){
 const t=match.now(),questionIndex=match.question(players[0]);
 const i={id:crypto.randomUUID(),kind,attacker:players[0].id,victim:players[1]?.id||null,participants:players.map(p=>p.id),answers:{},questionIndex,startedAt:t,expiresAt:t+30000,status:'pending'};
 for(const p of players){p.lock=i.id;p.presented.push(questionIndex);p.nextPearlAt=t+PEARL_INTERVAL;}
 match.state.interactions.push(i);match.save();return i;
}
function settle(match,i,id,outcome,choice=-1){
 if(i.answers[id])return;
 const p=match.player(id),t=match.now();
 i.answers[id]={outcome,choice,finishedAt:t};
 if(p){
  if(p.lock===i.id)p.lock=null;
  p.challengeUntil=t+COOLDOWN;p.cooldownUntil=t+4000;p.protectedUntil=t+3000;p.nextPearlAt=t+PEARL_INTERVAL;
  p.attempts.push({interactionId:i.id,questionIndex:i.questionIndex,choice,outcome,correct:outcome==='correct',responseMs:t-i.startedAt,trigger:i.kind});
  if(outcome==='correct'){
   p.score+=i.kind==='whale'?75:35;p.hungryMs=0;
   p.challengeWins=(p.challengeWins||0)+1;
   if(i.kind==='pearl')p.mass=Math.min(900,p.mass+20);
  }
 }
 if(i.participants.every(id=>i.answers[id])){i.status='complete';i.finishedAt=t;}
 match.save();
}
function resolve(match,i,outcome){for(const id of i.participants)settle(match,i,id,outcome);}
function tick(match){
 const t=match.now(),players=match.state.players;
 for(let a=0;a<players.length;a++){
  const p=players[a];if(!available(p,t)||p.mass<WHALE||p.protectedUntil>t)continue;
  const rival=players.slice(a+1).find(q=>available(q,t)&&q.mass>=WHALE&&q.protectedUntil<=t&&Math.hypot(q.x-p.x,q.y-p.y)<150);
  if(rival)start(match,[p,rival],'whale');
 }
 for(const p of players){
  if(p.npc||!p.connected||p.removed)continue;
  p.nextPearlAt??=t+PEARL_INTERVAL;
  if(available(p,t)&&p.nextPearlAt<=t&&p.protectedUntil<=t)start(match,[p],'pearl');
 }
}
module.exports={tick,settle,resolve,WHALE,COOLDOWN,PEARL_INTERVAL};
