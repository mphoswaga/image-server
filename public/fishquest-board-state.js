(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FishBoard=factory()})(this,()=>{
  function create(students, questions, teamCount){
    if(!students.length||!questions.length)throw Error('Choose a class with learners and at least one question.');
    if(!Number.isInteger(teamCount)||teamCount<2||teamCount>4)throw Error('Choose 2–4 teams.');
    if(students.some(s=>!Number.isInteger(s.team)||s.team<0||s.team>=teamCount))throw Error('Assign each learner to a team.');
    return {players:students.map(s=>({...s,food:0})),questions,teamCount,turn:0,phase:'question',paused:false,food:Array(teamCount).fill(0),answers:[],rounds:Math.ceil(Math.max(students.length,questions.length)/students.length)*students.length};
  }
  function answer(state, choice){
    if(state.paused||state.phase!=='question')return false;
    const q=state.questions[state.turn%state.questions.length];
    if(!Number.isInteger(choice)||choice<0||choice>=q.options.length)return false;
    const p=state.players[state.turn%state.players.length],correct=choice===q.correctIndex;
    state.answers.push({turn:state.turn,player:state.turn%state.players.length,choice,correct});
    if(correct){p.food+=2;state.food[p.team]+=5;}
    state.phase='reveal';return true;
  }
  function next(state){if(state.paused||state.phase!=='reveal')return false;state.turn++;state.phase=state.turn>=state.rounds?'ended':'question';return true;}
  return {create,answer,next};
});
