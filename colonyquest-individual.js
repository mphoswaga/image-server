'use strict';
const core = require('./public/colonyquest-core');
const story = require('./colonyquest-story');
// Personal questions advance independently. World time advances only while the room runs.
module.exports = {
  startIndividual(now) {
    const s=this.state;
    s.elapsedMs=0;
    s.encounters=Object.entries(story.schedule(s.questions.length)).flatMap(([round,keys])=>keys.filter(key=>key!=='acorn').map(key=>({key,at:Number(round)/s.questions.length*Math.max(60000,s.questions.length*12000)})));
    for(const p of this.active()) {p.round=0;this.setPersonalPhase(p,'answer',s.questionSeconds,now);}
    s.phase='answer'; s.deadline=null; s.phaseStartedAt=now; this.lastTick=now;
  },
  setPersonalPhase(p,phase,seconds,now) {
    delete p.personalRemaining;
    p.phase=phase;p.phaseStartedAt=now;p.deadline=seconds===null?null:now+seconds*1000;
  },
  personalFeedback(p,now) {
    this.settleAnswers();
    const answer=p.answers.find(a=>a.round===p.round);
    this.setPersonalPhase(p,answer?.correct?'upgrade':'reveal',answer?.correct?this.state.upgradeSeconds:3,now);
  },
  finishPersonalQuestion(p,now) {
    core.applyUpkeep([p.colony]);
    if(p.round+1>=this.state.questions.length) {
      this.setPersonalPhase(p,'spectating',null,now);p.finishedAt=now;
    } else {p.round++;this.setPersonalPhase(p,'answer',this.state.questionSeconds,now);}
  },
  tickIndividual(now) {
    const s=this.state,dt=Math.min(1000,Math.max(0,now-this.lastTick));
    this.lastTick=now;s.elapsedMs=(s.elapsedMs||0)+dt;
    const world=this.world();core.advanceEconomy(world,dt);
    const {teams,phase,...rest}=world;s.world=rest;
    if(s.ambient && s.elapsedMs>=s.ambient.until) {
      if(s.ambient.key==='rain')s.world.birdStage='rush';
      if(s.ambient.key==='birds')s.world.birdStage='done';
      s.ambient=null;
    }
    const next=s.encounters?.[0];
    if(s.storyVersion && !s.ambient && next && s.elapsedMs>=next.at) {
      s.encounters.shift();
      const beat=story.beats[next.key],results=story.apply(this,next.key);
      s.storySeen.push(next.key);
      s.ambient={...beat,key:next.key,id:'world:'+next.key,duration:beat.seconds*1000,until:s.elapsedMs+beat.seconds*1000,results,winners:[]};
      this.event(beat.title,{kind:'story',key:next.key,results},now);
    }
    for(const p of this.active()) {
      if(p.phase==='spectating')continue;
      if(!p.connected) {
        if(p.personalRemaining===undefined)p.personalRemaining=Math.max(0,p.deadline-now);
        continue;
      }
      if(p.personalRemaining!==undefined) {p.deadline=now+p.personalRemaining;delete p.personalRemaining;}
      if(p.npc && p.phase==='answer' && now-p.phaseStartedAt>=5000+(s.players.indexOf(p)%3)*1500 && now<p.deadline) {
        const q=s.questions[p.round];this.answer(p.id,p.round,p.round%4===3?(q.correctIndex+1)%q.options.length:q.correctIndex,now);
      }
      if(p.npc && p.phase==='upgrade' && now-p.phaseStartedAt>=1000 && now<p.deadline) {
        const options=this.options(p),preferred=['expansion','soldiers','defense','workers','supplies','food'];
        const pick=options.find(o=>o.key==='raid'&&o.allowed)||preferred.map(key=>options.find(o=>o.key===key&&o.allowed)).find(Boolean);
        if(pick)this.upgrade(p.id,p.round,pick.key,pick.target,now);
      }
      if(now<p.deadline)continue;
      if(p.phase==='answer')this.personalFeedback(p,now);
      else if(p.phase==='upgrade')this.upgrade(p.id,p.round,'food',null,p.deadline-1);
      else if(p.phase==='reveal')this.finishPersonalQuestion(p,now);
    }
    const humans=this.active().filter(p=>!p.npc);
    if(humans.length && humans.every(p=>p.phase==='spectating'))this.end(now);
    s.updatedAt=now;
  },
  individualSnapshot(out,p,teacher,now,watchId) {
    const s=this.state;
    out.pacing='individual';out.worldElapsedMs=s.elapsedMs||0;
    out.finishedCount=this.active().filter(p=>p.phase==='spectating').length;
    if(s.ambient)out.story={...s.ambient,elapsed:Math.max(0,s.ambient.duration-(s.ambient.until-s.elapsedMs)),results:teacher?s.ambient.results:s.ambient.results.filter(r=>r.playerId===p?.id)};
    if(!p || teacher) {if(s.phase==='answer')out.question=null;return out;}
    if(['lobby','story'].includes(s.phase))return out;
    const phase=s.phase==='ended'?'ended':p.phase||'answer';
    out.phase=s.phase==='paused'?'paused':phase;
    out.round=p.round||0;out.deadline=p.deadline;out.remaining=p.personalRemaining??Math.max(0,(p.deadline||now)-now);
    const q=s.questions[out.round],answer=p.answers.find(a=>a.round===out.round);
    const revealed=phase!=='answer';
    out.question=q?{question:q.question,options:q.options,...(revealed?{correctIndex:q.correctIndex,explanation:q.explanation}:{})}:null;
    out.me={...out.me,choice:answer?.choice??null,upgraded:p.upgrades.some(u=>u.round===out.round),upgrades:out.phase==='upgrade'?this.options(p):[]};
    delete out.me.correct;
    if(revealed)out.me.correct=!!answer?.correct;
    if(p.phase==='spectating' && s.phase!=='ended') {
      out.spectators=this.active().filter(other=>other.id!==p.id).map(other=>({id:other.id,name:other.name,round:other.round||0,finished:other.phase==='spectating'}));
      const watched=this.active().find(other=>other.id===watchId && other.id!==p.id);
      if(watched) out.watching={id:watched.id,name:watched.name,colony:watched.colony,lastUpgrade:watched.upgrades.at(-1)||null,events:s.events.filter(e=>e.kind==='raid'&&(e.attacker===watched.id||e.target===watched.id)).slice(-4)};
    }
    return out;
  },
};
