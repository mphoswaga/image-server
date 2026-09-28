(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FishBoardAdventure=factory()})(this,()=>{
 const chapters=[['current',.2],['shark',.45],['rescue',.7],['net',1]];
 function start(state){
  state.story={version:2,completed:[],history:[],energy:Array(state.teamCount).fill(3),scouts:Array(state.teamCount).fill(false),guardians:Array(state.teamCount).fill(false),suppliedTurns:[],milestones:chapters.map(([kind,fraction])=>({kind,at:Math.max(1,Math.ceil(state.rounds*fraction))}))};
  state.phase='intro';return state;
 }
 function afterTurn(state){
  const story=state.story,milestone=story.milestones.find(m=>m.at<=state.turn&&!story.completed.includes(m.kind));
  if(milestone){story.event={kind:milestone.kind,teams:[...new Set(state.players.map(p=>p.team))].sort((a,b)=>a-b),teamIndex:0,result:null};state.phase='event_warning'}
  else state.phase=state.turn>=state.rounds?'ended':'question';
  return true;
 }
 function current(state){
  const event=state.story.event;if(!event)return null;
  const team=event.teams[event.teamIndex],players=state.players.filter(p=>p.team===team);
  const last=[...state.answers].reverse().find(a=>state.players[a.player]?.team===team);
  return {kind:event.kind,team,players,captain:last?state.players[last.player]:players[0],result:event.result};
 }
 function choices(state){
  const e=current(state);if(!e)return [];
  const food=state.food[e.team],energy=state.story.energy[e.team],scouted=state.story.scouts[e.team];
  const option=(id,title,detail,cost,effort,motion,extra={})=>({id,title,detail,cost,effort,motion,safe:true,enabled:food>=cost&&energy>=effort,...extra});
  let options;
  if(e.kind==='current')options=[
   option('rocks','Shelter behind the rocks','Rest in calm water. Gain 1 energy; leave 10% of your food behind.',Math.ceil(food*.1),0,'hide',{gain:1,text:'The rocks break the current. Your school rests in calm water.'}),
   option('ride','Swim across together','Use 2 energy to keep the whole school and all its food together.',0,2,'sprint',{text:'A powerful swimming burst carries everyone across!'}),
   option('detour','Follow the sheltered route','Take a gentle detour. Leave 20% of your food behind.',Math.ceil(food*.2),0,'route',{text:'You follow the reef wall into quieter water.'})
  ];
  else if(e.kind==='shark')options=[
   option('hide','Hide among the coral','Everyone stays safe. Leave 25% of your food behind.',Math.ceil(food*.25),0,'hide',{text:'The shark swims past. Every fish is safe in the coral!'}),
   option('distract','Send food downstream','Share 5 food to draw the shark away from the school.',5,0,'distract',{text:'The shark follows the food. Your school slips away.'}),
   option('escape','Escape as one school','Use 3 energy for a coordinated escape. Keep all your food.',0,3,'sprint',{text:'Together, your school sweeps safely beyond the shark.'})
  ];
  else if(e.kind==='rescue')options=[
   option('clear','Clear a passage together','Use 2 energy to move loose litter and help the turtle. Earn Reef Guardian.',0,2,'rescue',{guardian:true,text:'A clear passage! The turtle swims free. You are Reef Guardians.'}),
   option('helpers','Ask the reef crabs to help','Share 3 food with the crabs. Together you clear the passage. Earn Reef Guardian.',3,0,'rescue',{guardian:true,text:'The reef crabs help clear the litter. You are Reef Guardians!'}),
   option('detour','Take a safe detour','Keep your food and energy. The turtle guide calls the rescue crew.',0,0,'route',{text:'Your school takes a safe route while the guide calls for help.'})
  ];
  else options=[
   option('shelter','Dive below the ledge','Every fish escapes. Leave 20% of your food behind.',Math.ceil(food*.2),0,'hide',{text:'The net passes overhead. Every fish escapes beneath the ledge!'}),
   option('sprint','Make a swimming burst','Use 4 energy to reach open water before the net falls.',0,4,'sprint',{text:'Your school reaches open water just in time!'}),
   option('gap','Follow the narrow gap','Leave 30% of your food behind as the school follows a safe gap.',Math.ceil(food*.3),0,'route',{text:'One by one, your fish pass through the clear gap.'})
  ];
  if(scouted)options.push(option('scouted','Use your scouted passage','Your scout found a safe route. Keep all your food and energy.',0,0,'route',{guardian:e.kind==='rescue',text:e.kind==='rescue'?'Your scout guides the turtle and school through a clear passage. Reef Guardians!':'Your scout leads everyone through the hidden passage. All supplies are safe!'}));
  return options.map(o=>({...o,detail:o.detail+(!o.enabled?' Need '+(food<o.cost?o.cost+' food':o.effort+' energy')+'.':'')}));
 }
 function choose(state,id){
  if(state.paused||state.phase!=='event_choice')return false;
  const option=choices(state).find(o=>o.id===id&&o.enabled);if(!option)return false;
  const e=current(state),story=state.story;
  state.food[e.team]-=option.cost;story.energy[e.team]=Math.min(12,story.energy[e.team]-option.effort+(option.gain||0));
  story.guardians[e.team]||=!!option.guardian;story.scouts[e.team]=false;
  const result={kind:e.kind,team:e.team,choice:id,lost:option.cost,energy:option.effort,gain:option.gain||0,guardian:!!option.guardian,safe:true,motion:option.motion,text:option.text};
  story.event.result=result;story.history.push(result);state.phase='event_result';return true;
 }
 function beforeNext(state){
  if(state.phase!=='reveal'||!state.answers.at(-1)?.correct||state.story.suppliedTurns.includes(state.turn))return false;
  const team=state.players[state.turn%state.players.length].team;
  if(state.answers.filter(a=>a.correct&&state.players[a.player].team===team).length%3!==0)return false;
  state.phase='supply_choice';return true;
 }
 function supply(state,id){
  if(state.paused||state.phase!=='supply_choice'||!['feed','energy','scout'].includes(id)||state.story.suppliedTurns.includes(state.turn))return false;
  const team=state.players[state.turn%state.players.length].team,story=state.story;
  if(id==='feed'){state.food[team]+=3;const school=state.players.filter(p=>p.team===team);school.forEach(p=>{p.mass=Math.min(1000,p.mass+30/school.length)})}
  if(id==='energy')story.energy[team]=Math.min(12,story.energy[team]+3);
  if(id==='scout')story.scouts[team]=true;
  story.suppliedTurns.push(state.turn);state.turn++;state.remainingMs=(state.questionSeconds||30)*1000;return afterTurn(state);
 }
 function advance(state){
  if(state.paused)return false;
  if(state.phase==='intro'){state.phase='question';return true}
  if(state.phase==='event_warning'){state.phase='event_choice';return true}
  if(state.phase!=='event_result')return false;
  const event=state.story.event;
  if(++event.teamIndex<event.teams.length){event.result=null;state.phase='event_choice';return true}
  state.story.completed.push(event.kind);state.story.event=null;return afterTurn(state);
 }
 function awards(state){
  const teams=[...new Set(state.players.map(p=>p.team))];
  const bestFood=Math.max(...teams.map(t=>state.food[t])),bestEnergy=Math.max(...teams.map(t=>state.story.energy[t]));
  return teams.map(team=>({team,food:state.food[team]===bestFood,prepared:state.story.energy[team]===bestEnergy,guardian:state.story.guardians[team]}));
 }
 return {start,afterTurn,current,choices,choose,advance,beforeNext,supply,awards};
});
