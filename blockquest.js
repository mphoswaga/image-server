const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DATA_DIR,writeJsonAtomic}=require('./storage');const core=require('./public/blockquest-core');
function register({app,games,roster,requireGameAccess,gameSessionCanAccess}){
 const narration=require('./assessment-narration').createNarration();
 function scope(req){
  const game=games.getGame(req.params.id);if(!game)throw Error('Game not found.');
  const teacher=!!req.userId;if(teacher&&game.teacherId!==req.userId)throw Error('Not your question set.');
  if(!teacher&&(!req.gameSession||!gameSessionCanAccess(game,req.gameSession)))throw Error('Join this game with your learner account first.');
  if(!teacher&&game.cutoffAt&&Date.now()>Date.parse(game.cutoffAt))throw Error('This activity has closed.');
  const board=teacher&&req.query.mode!=='solo',test=req.query.test==='1';
  if(test&&!teacher)throw Error('Only teachers can open test games.');
  const identity=teacher?'teacher:'+req.userId+':'+(board?'board':'solo')+(test?':test':''):'student:'+req.gameSession.studentId;
  const file=path.join(DATA_DIR,'blockquest',crypto.createHash('sha256').update(game.id+':'+identity).digest('hex')+'.json');
  return {game,teacher,board,test,file};
 }
 function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 function members(game){return games.getRosterIds(game).flatMap(id=>(roster.getRoster(game.teacherId,id)?.students||[]).map(s=>({...s,rosterId:id}))).filter((s,i,a)=>a.findIndex(t=>t.id===s.id)===i);}
 function view(s,ctx){
  const out={...s,total:s.questions.length,teams:s.teams.map(t=>({...t,names:t.members.map(p=>p.name),members:undefined})),questions:undefined,pieceRounds:undefined,serverNow:Date.now()};
  const q=s.questions[s.turn];out.question=q?{question:q.question,options:q.options}:null;
  if(s.phase==='feedback')out.feedback={correct:s.answers.at(-1)?.correct,answer:q?.options[q.correctIndex],explanation:q?.explanation||''};
  if(s.phase==='choose'||s.phase==='placing')out.question=null;
  if(ctx.teacher)out.classSize=ctx.test?0:members(ctx.game).length;
  return out;
 }
 function saveResults(s,ctx){
  if(s.phase!=='ended'||s.preview||s.saved)return;
  const ids=[...new Set(s.answers.map(a=>a.studentId).filter(Boolean))];
  for(const studentId of ids){const rows=s.answers.filter(a=>a.studentId===studentId);const learner=s.teams.flatMap(t=>t.members).find(p=>p.id===studentId);if(!learner)continue;
   games.recordResult(ctx.game.id,{studentId,name:learner.name,rosterId:learner.rosterId||null,score:rows.filter(a=>a.correct).length,total:rows.length,answers:Object.fromEntries(rows.map(a=>[a.questionIndex,a.choice])),arcadeScore:s.teams.find(t=>t.members.some(p=>p.id===studentId)).points,gameType:s.mode==='board'?'blockquest-board':'blockquest-solo',resultId:s.id+':'+studentId});
  }s.saved=true;
 }
 function questionClock(s,now){if(s.timed&&s.phase==='answer'){s.phaseStartedAt=now;s.deadline=now+core.ANSWER_MS;s.answerPreview=core.offer(s)[0];}}
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
 function advance(s,now=Date.now()){s.turn++;if(s.turn>=s.questions.length||(s.mode==='solo'&&s.teams[0].lines>=3))s.phase='ended';else{s.phase='answer';s.active=s.turn%s.teams.length;const team=s.teams[s.active];if(team.picks>0&&team.picks%team.members.length===0){for(let i=team.members.length-1;i>0;i--){const j=crypto.randomInt(i+1);[team.members[i],team.members[j]]=[team.members[j],team.members[i]];}}s.learner=team.members[team.picks%team.members.length].name;team.picks++;}s.choices=[];delete s.falling;questionClock(s,now);}
 app.get('/api/game/:id/blockquest/voice',requireGameAccess,async(req,res)=>{
  try{const ctx=scope(req),s=read(ctx.file);if(!s||s.id!==req.query.run||String(s.turn)!==req.query.turn||s.phase!=='answer')return res.status(409).json({error:'This question is no longer open.'});
   const prompt=s.questions[s.turn]?.question;if(!prompt||prompt.length>4000)return res.status(400).json({error:'This question cannot be read aloud.'});
   const buffer=await narration(ctx.game.teacherId,prompt);res.set('Cache-Control','private, no-store').type('audio/mpeg').send(buffer);
  }catch(error){res.status(503).json({error:'Question voice is unavailable. You can still answer on screen.'});}
 });
 app.get('/api/game/:id/blockquest',requireGameAccess,(req,res)=>{
  try{const ctx=scope(req),s=read(ctx.file);if(tick(s))writeJsonAtomic(ctx.file,s);if(s?.phase==='ended'&&!s.saved&&!s.preview){saveResults(s,ctx);writeJsonAtomic(ctx.file,s);}res.json({title:ctx.game.lessonTitle,teacher:ctx.teacher,board:ctx.board,test:ctx.test,learners:ctx.teacher&&!ctx.test?members(ctx.game).map(s=>({id:s.id,name:s.name})):undefined,state:s?view(s,ctx):null});}catch(e){res.status(403).json({error:e.message});}
 });
 app.post('/api/game/:id/blockquest',requireGameAccess,(req,res)=>{
  try{
   const ctx=scope(req),b=req.body||{};let s=read(ctx.file);if(tick(s))writeJsonAtomic(ctx.file,s);
   if(b.action==='start'||b.action==='restart'){
    const restarting=b.action==='restart';
    if(restarting&&(!ctx.teacher||!s||b.run!==s.id))throw Error('Only the teacher can restart the current saved game.');
    if(s?.phase==='ended'&&!s.saved&&!s.preview){saveResults(s,ctx);writeJsonAtomic(ctx.file,s);}
    if(s&&s.phase!=='ended'&&!restarting)throw Error('A game is already in progress. Resume it or finish it first.');
    let people=ctx.test?['Ava','Leo','Mia','Noah','Lily','Ben'].map(name=>({id:null,name:name+' (demo)'})):ctx.teacher?members(ctx.game):[{id:req.gameSession.studentId,name:req.gameSession.name||'Explorer',rosterId:req.gameSession.rosterId}];
    if(ctx.board&&!ctx.test&&Array.isArray(b.studentIds)&&people.length){people=people.filter(p=>b.studentIds.includes(p.id));if(!people.length)throw Error('Select at least one learner.');}
    people=people.slice();for(let i=people.length-1;i>0;i--){const j=crypto.randomInt(i+1);[people[i],people[j]]=[people[j],people[i]];}
    if(!people.length)people=[{id:null,name:'Player 1'},{id:null,name:'Player 2'}];
    if(!ctx.board)people=people.slice(0,1);
    const count=ctx.board?2:1,teams=Array.from({length:count},(_,i)=>({name:ctx.board?['Sun Builders','Moon Builders'][i]:'My tower',board:core.empty(),points:0,lines:0,picks:0,members:people.filter((_,j)=>j%count===i)}));
    teams.forEach((t,i)=>{if(!t.members.length)t.members=[{id:null,name:'Team '+(i+1)}];});
    s={id:crypto.randomUUID(),revision:0,timed:true,mode:ctx.board?'board':'solo',phase:'answer',turn:0,active:0,teams,answers:[],choices:[],questions:ctx.game.questions.map((q,sourceIndex)=>({...q,sourceIndex})).filter(q=>q.options?.length>=2),preview:ctx.teacher&&(!ctx.board||ctx.test),saved:false};
    if(!s.questions.length)throw Error('Add multiple-choice questions to this question set first.');s.learner=teams[0].members[0].name;teams[0].picks++;questionClock(s,Date.now());
   }else{
    if(!s||b.revision!==s.revision)throw Error('This turn has changed. Refresh to continue.');
    const team=s.teams[s.active],q=s.questions[s.turn];
    if(b.action==='pause'&&ctx.teacher&&s.phase!=='ended'){if(s.phase==='paused'){const pauseLength=Math.max(0,Date.now()-(s.pausedAt||Date.now()));for(const field of ['deadline','readyAt','placementStartedAt','phaseStartedAt'])if(Number.isFinite(s[field]))s[field]+=pauseLength;if(s.falling)s.falling.lastStepAt+=pauseLength;s.phase=s.beforePause;delete s.pausedAt;}else{s.beforePause=s.phase;s.pausedAt=Date.now();s.phase='paused';}}
    else if(b.action==='finish'&&ctx.teacher){s.phase='ended';}
    else if(s.timed&&b.action==='move'&&s.phase==='choose'){
     const f={...s.falling,...Object.fromEntries(['shape','rotation','column'].filter(k=>Object.hasOwn(b,k)).map(k=>[k,b[k]]))};
     if(!s.choices.includes(f.shape)||!Number.isInteger(f.rotation)||f.rotation<0||f.rotation>3||!Number.isInteger(f.column)||!core.fits(team.board,core.cells(f.shape,f.rotation),f.column,f.y))throw Error('That move is blocked.');
     s.falling=f;
    }else if(s.timed&&b.action==='place'&&s.phase==='choose'){lockBlock(s,Date.now());}
    else if(b.action==='answer'&&s.phase==='answer'){
     if(!Number.isInteger(b.choice)||b.choice<0||b.choice>=q.options.length)throw Error('Choose an answer.');
     if(s.timed){answerTimed(s,b.choice,Date.now());}else{const person=team.members[(team.picks-1)%team.members.length];s.answers.push({studentId:person.id,questionIndex:q.sourceIndex,choice:b.choice,correct:b.choice===q.correctIndex});s.phase='feedback';}
    }else if(b.action==='next'&&!s.timed&&s.phase==='feedback'){
     if(s.answers.at(-1).correct){s.choices=core.offer(s);s.rescued=!core.hasRoom(team.board,s.choices);if(s.rescued)team.board=core.rescue(team.board);s.phase='choose';}else advance(s);
    }else if(b.action==='place'&&s.phase==='choose'){
     if(!s.choices.includes(b.shape)||!Number.isInteger(b.rotation)||b.rotation<0||b.rotation>3)throw Error('Choose one of your blocks.');
     if(s.mode==='board'){s.pieceRounds ||= {};s.pieceRounds[Math.floor(s.turn/s.teams.length)] ||= s.choices.slice();}
     s.lastLinesBefore=team.lines;s.lastBefore=team.board;s.lastDrop={...core.landing(team.board,b.shape,b.rotation,b.column),shape:b.shape};const result=core.place(team.board,b.shape,b.rotation,b.column);team.board=result.board;team.points+=result.points;team.lines+=result.cleared.length;s.lastPlacement=result.cleared;s.lastAward={points:result.points,bonus:result.bonus||0};s.phase='placing';s.placementStartedAt=Date.now();s.readyAt=s.placementStartedAt+core.sceneTiming(result.cleared.length).duration;
    }else if(b.action==='next'&&!s.timed&&s.phase==='placing'&&Date.now()>=s.readyAt){advance(s);}else throw Error('Wait for the current action to finish.');
   }
   s.revision++;writeJsonAtomic(ctx.file,s);if(s.phase==='ended'){saveResults(s,ctx);writeJsonAtomic(ctx.file,s);}res.json(view(s,ctx));
  }catch(e){res.status(400).json({error:e.message});}
 });
}
module.exports={register};
