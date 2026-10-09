/* Original Moon Festival score: no network requests or audio-file loading during play. */
(function(root){
  const tracks={
    waiting:{label:'Moonlit gathering',beat:720,notes:[74,0,77,81,79,0,77,0],bass:[50,57,53,60],drums:false},
    matchup:{label:'Face your rival',beat:300,notes:[62,69,74,77,62,69,79,81],bass:[38,38,41,45],drums:true},
    answering:{label:'Lantern battle',beat:440,notes:[74,0,77,0,79,77,72,0],bass:[38,45,41,48],drums:true},
    urgent:{label:'Final seconds',beat:240,notes:[74,77,79,81,79,77,74,72],bass:[38,45,38,45],drums:true},
    reveal:{label:'The duel is decided',beat:480,notes:[74,78,81,86,0,81,78,0],bass:[50,57,54,57],drums:true},
    paused:{label:'A moment to think',beat:1050,notes:[74,0,0,81,0,0,77,0],bass:[50,57,53,60],drums:false},
    finale:{label:'Festival champions',beat:850,notes:[],bass:[],drums:false}
  };
  function phase(state,now){
    if(state?.phase==='ended')return 'finale';
    if(state?.paused)return 'paused';
    if(state?.phase==='matchup')return 'matchup';
    if(state?.phase==='reveal')return 'reveal';
    if(['choose','reconsider'].includes(state?.phase))return state.deadline&&state.deadline-now<=5000?'urgent':'answering';
    return 'waiting';
  }
  const api={tracks,phase};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MoonBattleScore=api;
})(typeof window!=='undefined'?window:globalThis);
