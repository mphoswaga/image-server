// Shared authoritative turn rules for board, solo and class duels.
const crypto=require('node:crypto'),core=require('./public/blockquest-core');
 function questionClock(s,now){if(s.timed&&s.phase==='answer'){s.phaseStartedAt=now;s.deadline=now+core.ANSWER_MS;if(s.mode==='board')core.offer(s);}}
 function prepareBlock(s,now){
  const team=s.teams[s.active];s.choices=core.offer(s);s.rescued=!core.hasRoom(team.board,s.choices);if(s.rescued)team.board=core.rescue(team.board);
  s.phase='choose';s.phaseStartedAt=now;s.deadline=now+core.BUILD_MS;
  for(const shape of s.choices)for(let rotation=0;rotation<4;rotation++)for(const column of [2,0,1,3,4,5,6,7])if(core.landing(team.board,shape,rotation,column)){
   s.falling={shape,rotation,column,y:0,lastStepAt:now};return;
  }
  throw Error('No placement is available.');
 }
 function answerTimed(s,choice,now){
  const team=s.teams[s.active],q=s.questions[s.turn],person=team.members[(team.picks-1)%team.members.length],correct=choice===q.correctIndex;
  s.answers.push({studentId:person.id,team:s.active,questionIndex:q.sourceIndex,choice,correct});s.lastAnswer={correct,timedOut:choice<0};
  if(correct){team.correctCount=(team.correctCount||0)+1;team.points+=100;prepareBlock(s,now);}
  else{s.phase='feedback';s.readyAt=now+2500;s.deadline=s.readyAt;s.phaseStartedAt=now;}
 }
 function lockBlock(s,now){
  const team=s.teams[s.active],f=s.falling;
  if(!f)throw Error('No block is falling.');
  if(s.mode==='board'){s.pieceRounds ||= {};s.pieceRounds[Math.floor(s.turn/s.teams.length)] ||= s.choices.slice();}
  const drop=core.landing(team.board,f.shape,f.rotation,f.column,f.y);if(!drop)throw Error('This block cannot be placed.');
  const result=core.place(team.board,f.shape,f.rotation,f.column,f.y);
  s.lastLinesBefore=team.lines;s.lastBefore=team.board;s.lastDrop={...drop,shape:f.shape,fromY:f.y};
  team.board=result.board;team.points+=result.points;team.lines+=result.cleared.length;
  s.lastPlacement=result.cleared;s.lastAward={points:result.points,bonus:result.bonus||0};s.phase='placing';s.placementStartedAt=now;s.readyAt=now+core.sceneTiming(result.cleared.length).duration;s.deadline=s.readyAt;
 }
 function tick(s,now=Date.now()){
  if(!s?.timed||['paused','ended'].includes(s.phase))return false;
  const phase=s.phase,turn=s.turn;let changed=false;
  if(s.phase==='answer'&&now>=s.deadline){answerTimed(s,-1,now);changed=true;}
  else if(s.phase==='choose'){
   if(now>=s.deadline){lockBlock(s,now);changed=true;}
   else{const f=s.falling;let steps=Math.min(10,Math.floor((now-f.lastStepAt)/1500));
    while(steps-->0&&s.phase==='choose'){
     if(core.fits(s.teams[s.active].board,core.cells(f.shape,f.rotation),f.column,f.y+1)){f.y++;f.lastStepAt+=1500;changed=true;}
     else{lockBlock(s,now);changed=true;}
    }
   }
  }else if(['feedback','placing'].includes(s.phase)&&now>=s.readyAt){advance(s,now);changed=true;}
  if(phase!==s.phase||turn!==s.turn)s.revision++;
  return changed;
 }
 function advance(s,now=Date.now()){s.turn++;if(s.loopQuestions&&s.turn>=s.questions.length)s.turn=0;if(s.turn>=s.questions.length||(s.mode==='solo'&&s.teams[0].lines>=3))s.phase='ended';else{s.phase='answer';s.active=s.turn%s.teams.length;const team=s.teams[s.active];if(team.picks>0&&team.picks%team.members.length===0){for(let i=team.members.length-1;i>0;i--){const j=crypto.randomInt(i+1);[team.members[i],team.members[j]]=[team.members[j],team.members[i]];}}s.learner=team.members[team.picks%team.members.length].name;team.picks++;}s.choices=[];delete s.falling;questionClock(s,now);}

module.exports={questionClock,prepareBlock,answerTimed,lockBlock,tick,advance};
