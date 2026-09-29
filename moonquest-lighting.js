// A shared, reveal-only visual reward. Never changes marks or duel points.
const zones=['School entrance','West classrooms','East classrooms','Courtyard lanterns','Moonlit rooftops'];
function snapshot(session,right){
 const target=Math.max(1,session.game.questions.length)*.8;
 let earned=0,previous=0,sparks=0,lastGain=0;
 for(const round of session.rounds){
  if(!round.revealedAt)continue;
  previous=earned;
  const correct=round.expected.filter(id=>{const a=round.answers[id];return a&&right(round.question,a.final??a.first);}).length;
  lastGain=round.expected.length?correct/round.expected.length:0;
  earned+=lastGain;sparks+=correct;
 }
 const percent=Math.min(100,Math.floor(earned/target*100+1e-8));
 const before=Math.min(100,Math.floor(previous/target*100+1e-8));
 return {percent,previous:before,sparks,complete:percent===100,gain:percent-before,zones:zones.map((name,i)=>({name,percent:Math.max(0,Math.min(100,(percent-i*20)*5))})),restored:Math.floor(percent/20)};
}
module.exports={snapshot,zones};
