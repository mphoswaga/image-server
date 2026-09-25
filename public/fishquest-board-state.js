(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./fishquest-growth'));else root.FishBoard=factory(root.FishQuestGrowth)})(this,Growth=>{
  const MAX_MASS=1000, PERSONAL_GROWTH=90, SHARED_GROWTH=135;
  function feed(players,index){
    const player=players[index];if(!player)return;
    player.mass=Math.min(MAX_MASS,player.mass+PERSONAL_GROWTH);
    const friends=players.filter((p,i)=>p.team===player.team&&i!==index);
    // The three shared bites are distributed across teammates, not multiplied by team size.
    const recipients=friends.length?friends:[player];
    for(const p of recipients)p.mass=Math.min(MAX_MASS,p.mass+SHARED_GROWTH/recipients.length);
  }
  function upgrade(state){
    if(state.growthVersion===1)return state;
    state.players.forEach((p,i)=>{p.variant=i%30;p.mass=100});
    for(const a of state.answers||[])if(a.correct)feed(state.players,a.player);
    state.growthVersion=1;
    return state;
  }
  function create(students,questions,teamCount,turns=1){
    if(!students.length||!questions.length)throw Error('Choose a class with learners and at least one question.');
    if(!Number.isInteger(teamCount)||teamCount<2||teamCount>4)throw Error('Choose 2–4 teams.');
    if(!Number.isInteger(turns)||turns<1||turns>4)throw Error('Choose 1–4 turns per learner.');
    if(students.some(s=>!Number.isInteger(s.team)||s.team<0||s.team>=teamCount))throw Error('Assign each learner to a team.');
    return {growthVersion:1,players:students.map((s,i)=>({...s,food:0,mass:100,variant:i%30})),questions,teamCount,turn:0,phase:'question',paused:false,food:Array(teamCount).fill(0),answers:[],rounds:Math.max(turns,Math.ceil(questions.length/students.length))*students.length};
  }
  function answer(state,choice){
    if(state.paused||state.phase!=='question')return false;
    const q=state.questions[state.turn%state.questions.length];
    if(!Number.isInteger(choice)||choice<0||choice>=q.options.length)return false;
    upgrade(state);
    const index=state.turn%state.players.length,p=state.players[index],correct=choice===q.correctIndex;
    state.answers.push({turn:state.turn,player:index,choice,correct});
    state.lastGrowth=null;
    if(correct){
      const before=state.players.map(p=>p.mass);
      p.food+=2;state.food[p.team]+=5;feed(state.players,index);
      state.lastGrowth={turn:state.turn,before,evolved:Growth.evolution(before[index])!==Growth.evolution(p.mass)};
    }
    state.phase='reveal';return true;
  }
  function next(state){if(state.paused||state.phase!=='reveal')return false;state.turn++;state.phase=state.turn>=state.rounds?'ended':'question';return true;}
  return {create,answer,next,upgrade};
});
