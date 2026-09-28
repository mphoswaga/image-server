(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./fishquest-board-adventure'));else root.FishBoardStory=factory(root.FishBoardAdventure)})(this,(Adventure)=>{
  function start(state){
    state.rounds=Math.max(state.rounds,2*state.players.length);
    const rounds=state.rounds/state.players.length;
    state.story={version:1,sharkAt:Math.ceil(rounds/2)*state.players.length,netAt:state.rounds,completed:[],history:[]};
    state.phase='intro';return state;
  }
  function afterTurn(state){
    const story=state.story;if(!story)return false;
    const kind=state.turn===story.sharkAt&&!story.completed.includes('shark')?'shark':
      state.turn===story.netAt&&!story.completed.includes('net')?'net':null;
    if(kind){
      const teams=[...new Set(state.players.map(p=>p.team))].sort((a,b)=>a-b);
      story.event={kind,teams,teamIndex:0,result:null};
      state.phase='event_warning';return true;
    }
    state.phase=state.turn>=state.rounds?'ended':'question';return true;
  }
  function current(state){
    const event=state.story?.event;if(!event)return null;
    const team=event.teams[event.teamIndex],players=state.players.filter(p=>p.team===team);
    const last=[...state.answers].reverse().find(a=>state.players[a.player]?.team===team);
    return {kind:event.kind,team,players,captain:last?state.players[last.player]:players[0],result:event.result};
  }
  function choices(state){
    const e=current(state);if(!e)return [];
    const food=state.food[e.team],strong=e.players.every(p=>p.mass>=450);
    if(e.kind==='shark')return [
      {id:'hide',title:'Hide in the coral',detail:'Everyone escapes. Leave '+Math.ceil(food*.25)+' food behind.',cost:Math.ceil(food*.25),safe:true,motion:'hide',enabled:true},
      {id:'distract',title:'Distract the shark',detail:'Spend 5 food to draw it away. Everyone escapes.',cost:5,safe:true,motion:'distract',enabled:food>=5},
      {id:'stand',title:'Face the shark together',detail:strong?'Your whole school is shark size or bigger. Protect all your food.':'Some fish are still small. The school scatters and loses 40% of its food.',cost:strong?0:Math.ceil(food*.4),safe:strong,motion:strong?'defend':'scatter',enabled:true}
    ];
    return [
      {id:'shelter',title:'Shelter under the reef',detail:'Everyone escapes the net. Leave '+Math.ceil(food*.2)+' food behind.',cost:Math.ceil(food*.2),safe:true,motion:'hide',enabled:true},
      {id:'sprint',title:'Burst of speed',detail:'Spend 5 food to swim beyond the net together.',cost:5,safe:true,motion:'sprint',enabled:food>=5},
      {id:'push',title:'Push through the net',detail:'Even big fish can get tangled. Regroup safely, but lose 40% of your food.',cost:Math.ceil(food*.4),safe:false,motion:'scatter',enabled:true}
    ];
  }
  function choose(state,id){
    if(state.paused||state.phase!=='event_choice')return false;
    const option=choices(state).find(o=>o.id===id&&o.enabled);if(!option)return false;
    const e=current(state),lost=Math.min(state.food[e.team],option.cost);
    state.food[e.team]-=lost;
    const result={kind:e.kind,team:e.team,choice:id,lost,safe:option.safe,motion:option.motion,
      text:option.safe?(e.kind==='shark'?'The shark passes. Your whole school is safe!':'Your whole school escapes the net!'):'Your school scatters, then regroups. Every fish makes it back.'};
    state.story.event.result=result;state.story.history.push(result);state.phase='event_result';return true;
  }
  function advance(state){
    if(state.paused)return false;
    if(state.phase==='intro'){state.phase='question';return true;}
    if(state.phase==='event_warning'){state.phase='event_choice';return true;}
    if(state.phase!=='event_result')return false;
    const event=state.story.event;
    if(++event.teamIndex<event.teams.length){event.result=null;state.phase='event_choice';return true;}
    state.story.completed.push(event.kind);state.story.event=null;
    state.phase=state.turn>=state.rounds?'ended':'question';return true;
  }
  return {start:Adventure.start,startLegacy:start,afterTurn:s=>s.story?.version===2?Adventure.afterTurn(s):afterTurn(s),current:s=>s.story?.version===2?Adventure.current(s):current(s),choices:s=>s.story?.version===2?Adventure.choices(s):choices(s),choose:(s,id)=>s.story?.version===2?Adventure.choose(s,id):choose(s,id),advance:s=>s.story?.version===2?Adventure.advance(s):advance(s),beforeNext:s=>s.story?.version===2&&Adventure.beforeNext(s),supply:Adventure.supply,awards:Adventure.awards};
});
