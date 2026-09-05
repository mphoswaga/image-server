const crypto = require('crypto');

const CONFIG = Object.freeze({ width:2400, height:1600, initialMass:100, maxMass:900, eatRatio:1.18,
  foodCount:320, foodGrowth:4, foodRespawnMs:4000, questionMs:30000, cooldownMs:4000,
  protectionMs:5000, escapeMs:3000, respawnMs:2000, inputExpiryMs:400, maxPlayers:30 });
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const radius=p=>18*Math.sqrt(p.mass/100);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

class FishMatch {
  constructor(game,{now=Date.now,random=Math.random,persist=()=>{},log=()=>{}}={}) {
    this.game=game; this.now=now; this.random=random; this.persist=persist; this.log=log;
    this.state={id:crypto.randomUUID(),gameId:game.id,phase:'lobby',endsAt:null,players:[],food:[],interactions:[],revision:0};
    for(let i=0;i<CONFIG.foodCount;i++)this.state.food.push({id:i,...this.point(),readyAt:0});
    this.lastTick=now(); this.lastPersist=now();
  }
  point(){return {x:80+this.random()*(CONFIG.width-160),y:80+this.random()*(CONFIG.height-160)};}
  save(){ this.state.revision++;this.persist(this.state);this.lastPersist=this.now(); }
  player(id){return this.state.players.find(p=>p.id===id);}
  join(identity){
    let p=this.state.players.find(p=>p.studentId===identity.studentId);
    if(!p){
      if(this.state.phase==='ended')throw Error('This match has ended.');
      if(this.state.phase==='running'&&this.game.fishquest.lateJoin===false)throw Error('Late joining is closed.');
      if(this.state.players.length>=CONFIG.maxPlayers)throw Error('This room is full.');
      p={id:crypto.randomUUID(),studentId:identity.studentId,name:identity.name,variant:this.state.players.length%5,
        mass:100,score:0,...this.point(),dx:0,dy:0,inputAt:0,seq:-1,connected:true,protectedUntil:this.now()+CONFIG.protectionMs,
        cooldownUntil:0,respawnAt:0,lock:null,attempts:[],presented:[],collections:0,swallows:0};
      this.state.players.push(p); this.spawn(p);
    }
    p.connected=true;p.dx=0;p.dy=0;p.seq=-1;this.save();this.log('join',{playerId:p.id});return p;
  }
  start(minimumPlayers=2){if(this.state.phase!=='lobby')throw Error('The match has already started.');
    if(this.state.players.filter(p=>p.connected).length<minimumPlayers)throw Error('Wait for at least two learners.');
    this.state.phase='running';this.state.endsAt=this.now()+this.game.fishquest.durationMinutes*60000;
    for(const p of this.state.players)p.protectedUntil=this.now()+CONFIG.protectionMs;
    this.lastTick=this.now();this.save();this.log('start',{});
  }
  end(reason='teacher'){
    if(this.state.phase==='ended')return;
    for(const i of this.state.interactions.filter(i=>i.status==='pending'))this.resolve(i,'cancelled');
    this.state.phase='ended';this.state.reason=reason;this.state.endedAt=this.now();
    for(const p of this.state.players){p.dx=0;p.dy=0;}
    this.save();this.log('end',{reason});
  }
  disconnect(id){const p=this.player(id);if(!p)return;
    for(const i of this.state.interactions.filter(i=>i.status==='pending'&&(i.attacker===id||i.victim===id)))this.resolve(i,'cancelled');
    p.connected=false;p.dx=0;p.dy=0;this.save();this.log('disconnect',{playerId:id});
  }
  input(id,message){const p=this.player(id);if(!p||this.state.phase!=='running'||!p.connected)return;
    if(!Number.isSafeInteger(message.seq)||message.seq<=p.seq)return;
    if(!Number.isFinite(message.x)||!Number.isFinite(message.y))return;
    p.seq=message.seq;const length=Math.max(1,Math.hypot(message.x,message.y));
    p.dx=clamp(message.x/length,-1,1);p.dy=clamp(message.y/length,-1,1);p.inputAt=this.now();
  }
  eligible(a,b){const t=this.now();return this.state.phase==='running'&&a.id!==b.id&&a.connected&&b.connected&&!a.lock&&!b.lock&&!a.respawnAt&&!b.respawnAt&&
    a.protectedUntil<=t&&b.protectedUntil<=t&&a.cooldownUntil<=t&&a.mass>=b.mass*CONFIG.eatRatio&&distance(a,b)<=radius(a)+radius(b)*.6;}
  question(p){
    if(!this.game.questions.length)throw Error('This match has no questions.');
    const counts=this.game.questions.map((_,n)=>p.presented.filter(i=>i===n).length);
    const min=Math.min(...counts);
    return counts.map((count,n)=>({count,n,miss:p.attempts.some(a=>a.questionIndex===n&&a.outcome==='incorrect')}))
      .filter(v=>v.count===min).sort((a,b)=>Number(b.miss)-Number(a.miss)||a.n-b.n)[0].n;
  }
  claim(a,b){if(!this.eligible(a,b))return null;
    const questionIndex=this.question(a);
    const i={id:crypto.randomUUID(),attacker:a.id,victim:b.id,questionIndex,startedAt:this.now(),expiresAt:this.now()+CONFIG.questionMs,status:'pending'};
    a.lock=i.id;b.lock=i.id;a.presented.push(questionIndex);this.state.interactions.push(i);this.save();
    this.log('swallow_attempt',{interactionId:i.id});return i;
  }
  answer(id,message){
    const i=this.state.interactions.find(i=>i.id===message.interactionId&&i.attacker===id);
    if(!i)throw Error('That question is no longer active.');
    if(i.status!=='pending'){this.log('duplicate_answer',{interactionId:i.id});return i;}
    if(this.state.phase!=='running'){this.resolve(i,'cancelled');return i;}
    if(this.now()>=this.state.endsAt){this.end('time');return i;}
    const q=this.game.questions[i.questionIndex];
    if(!Number.isInteger(message.choice)||message.choice<0||message.choice>=q.options.length)throw Error('Choose one answer.');
    if(this.now()>=i.expiresAt)this.resolve(i,'timeout');
    else {i.choice=message.choice;this.resolve(i,message.choice===q.correctIndex?'correct':'incorrect');}
    return i;
  }
  resolve(i,outcome){
    if(i.status!=='pending')return;
    const a=this.player(i.attacker),b=this.player(i.victim),t=this.now();
    i.status=outcome;i.finishedAt=t;a.lock=null;b.lock=null;
    a.cooldownUntil=t+CONFIG.cooldownMs;b.protectedUntil=t+CONFIG.escapeMs;
    a.attempts.push({interactionId:i.id,questionIndex:i.questionIndex,choice:i.choice??-1,outcome,correct:outcome==='correct',responseMs:t-i.startedAt,trigger:'swallow'});
    if(outcome==='correct'){
      a.mass=Math.min(CONFIG.maxMass,a.mass+Math.min(80,b.mass*.2));a.score+=75;a.swallows++;
      b.mass=Math.max(CONFIG.initialMass,b.mass*.6);b.respawnAt=t+CONFIG.respawnMs;b.dx=0;b.dy=0;
    }
    this.save();this.log('swallow_resolved',{interactionId:i.id,outcome});
  }
  spawn(p){
    let best=this.point(),clearance=-Infinity;
    for(let i=0;i<40;i++){const point=this.point();const gap=Math.min(...this.state.players.filter(q=>q.id!==p.id&&q.connected&&!q.respawnAt).map(q=>distance(point,q)-radius(q)));
      if(gap>clearance){best=point;clearance=gap;}}
    Object.assign(p,best);p.protectedUntil=this.now()+CONFIG.protectionMs;p.respawnAt=0;
  }
  tick(){
    const t=this.now(),dt=Math.min(.1,Math.max(0,(t-this.lastTick)/1000));this.lastTick=t;
    if(this.state.phase!=='running')return;
    if(t>=this.state.endsAt){this.end('time');return;}
    for(const i of this.state.interactions.filter(i=>i.status==='pending'&&t>=i.expiresAt))this.resolve(i,'timeout');
    for(const p of this.state.players){
      if(p.respawnAt){if(t>=p.respawnAt)this.spawn(p);continue;}
      if(!p.connected||p.lock)continue;
      if(t-p.inputAt>CONFIG.inputExpiryMs){p.dx=0;p.dy=0;}
      const speed=180/Math.pow(p.mass/100,.18),r=radius(p);
      p.x=clamp(p.x+p.dx*speed*dt,r,CONFIG.width-r);p.y=clamp(p.y+p.dy*speed*dt,r,CONFIG.height-r);
      for(const f of this.state.food)if(f.readyAt<=t&&distance(p,f)<r+6){
        f.readyAt=t+CONFIG.foodRespawnMs;Object.assign(f,this.point());p.mass=Math.min(CONFIG.maxMass,p.mass+CONFIG.foodGrowth/Math.sqrt(p.mass/100));p.score++;p.collections++;
      }
    }
    for(const a of this.state.players)for(const b of this.state.players)if(this.eligible(a,b))this.claim(a,b);
    if(t-this.lastPersist>=3000)this.save();
  }
  snapshot(id,teacher=false){
    const t=this.now(),me=this.player(id);
    const players=this.state.players.map(p=>({id:p.id,name:p.name,variant:p.variant,x:Math.round(p.x),y:Math.round(p.y),mass:Math.round(p.mass),score:p.score,connected:p.connected,
      protected:p.protectedUntil>t,respawning:!!p.respawnAt,locked:!!p.lock}));
    const result={matchId:this.state.id,phase:this.state.phase,endsAt:this.state.endsAt,now:t,players,world:{width:CONFIG.width,height:CONFIG.height},eatRatio:CONFIG.eatRatio,
      food:this.state.food.filter(f=>f.readyAt<=t).map(f=>[f.id,Math.round(f.x),Math.round(f.y)])};
    if(me){
      const interaction=this.state.interactions.find(i=>i.id===me.lock&&i.attacker===id&&i.status==='pending');
      result.me=id;
      if(interaction){const q=this.game.questions[interaction.questionIndex];result.question={id:interaction.id,prompt:q.question,options:q.options,expiresAt:interaction.expiresAt};}
      const last=this.state.interactions.filter(i=>i.attacker===id||i.victim===id).at(-1);
      if(last&&last.status!=='pending')result.event={id:last.id,outcome:last.status,attacker:last.attacker,victim:last.victim};
      result.personal=this.education(me);
    }
    if(teacher)result.education=this.state.players.map(p=>({id:p.id,studentId:p.studentId,name:p.name,...this.education(p)}));
    return result;
  }
  education(p){const graded=p.attempts.filter(a=>['correct','incorrect','timeout'].includes(a.outcome));return {correct:graded.filter(a=>a.correct).length,answered:graded.length,coverage:new Set(graded.map(a=>a.questionIndex)).size,total:this.game.questions.length};}
}
module.exports={FishMatch,CONFIG,radius};
