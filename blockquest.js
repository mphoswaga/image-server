const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DATA_DIR,writeJsonAtomic}=require('./storage');const core=require('./public/blockquest-core');
function register({app,games,roster,requireGameAccess,gameSessionCanAccess}){
 function scope(req){
  const game=games.getGame(req.params.id);if(!game)throw Error('Game not found.');
  const teacher=!!req.userId;if(teacher&&game.teacherId!==req.userId)throw Error('Not your question set.');
  if(!teacher&&(!req.gameSession||!gameSessionCanAccess(game,req.gameSession)))throw Error('Join this game with your learner account first.');
  if(!teacher&&game.cutoffAt&&Date.now()>Date.parse(game.cutoffAt))throw Error('This activity has closed.');
  const board=teacher&&req.query.mode!=='solo';
  const identity=teacher?'teacher:'+req.userId+':'+(board?'board':'solo'):'student:'+req.gameSession.studentId;
  const file=path.join(DATA_DIR,'blockquest',crypto.createHash('sha256').update(game.id+':'+identity).digest('hex')+'.json');
  return {game,teacher,board,file};
 }
 function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 function members(game){return games.getRosterIds(game).flatMap(id=>(roster.getRoster(game.teacherId,id)?.students||[]).map(s=>({...s,rosterId:id}))).filter((s,i,a)=>a.findIndex(t=>t.id===s.id)===i);}
 function view(s,ctx){
  const out={...s,total:s.questions.length,teams:s.teams.map(t=>({...t,names:t.members.map(p=>p.name),members:undefined})),questions:undefined};
  const q=s.questions[s.turn];out.question=q?{question:q.question,options:q.options}:null;
  if(s.phase==='feedback')out.feedback={correct:s.answers.at(-1)?.correct,answer:q?.options[q.correctIndex],explanation:q?.explanation||''};
  if(s.phase==='choose'||s.phase==='placing')out.question=null;
  if(ctx.teacher)out.classSize=members(ctx.game).length;
  return out;
 }
 function saveResults(s,ctx){
  if(s.phase!=='ended'||s.preview||s.saved)return;
  const ids=[...new Set(s.answers.map(a=>a.studentId).filter(Boolean))];
  for(const studentId of ids){const rows=s.answers.filter(a=>a.studentId===studentId);const learner=s.teams.flatMap(t=>t.members).find(p=>p.id===studentId);if(!learner)continue;
   games.recordResult(ctx.game.id,{studentId,name:learner.name,rosterId:learner.rosterId||null,score:rows.filter(a=>a.correct).length,total:rows.length,answers:Object.fromEntries(rows.map(a=>[a.questionIndex,a.choice])),arcadeScore:s.teams.find(t=>t.members.some(p=>p.id===studentId)).points,gameType:s.mode==='board'?'blockquest-board':'blockquest-solo',resultId:s.id+':'+studentId});
  }s.saved=true;
 }
 function advance(s){s.turn++;if(s.turn>=s.questions.length||(s.mode==='solo'&&s.teams[0].lines>=3))s.phase='ended';else{s.phase='answer';s.active=s.turn%s.teams.length;const team=s.teams[s.active];if(team.picks>0&&team.picks%team.members.length===0){for(let i=team.members.length-1;i>0;i--){const j=crypto.randomInt(i+1);[team.members[i],team.members[j]]=[team.members[j],team.members[i]];}}s.learner=team.members[team.picks%team.members.length].name;team.picks++;}s.choices=[];}
 app.get('/api/game/:id/blockquest',requireGameAccess,(req,res)=>{
  try{const ctx=scope(req),s=read(ctx.file);if(s?.phase==='ended'&&!s.saved&&!s.preview){saveResults(s,ctx);writeJsonAtomic(ctx.file,s);}res.json({title:ctx.game.lessonTitle,teacher:ctx.teacher,board:ctx.board,learners:ctx.teacher?members(ctx.game).map(s=>({id:s.id,name:s.name})):undefined,state:s?view(s,ctx):null});}catch(e){res.status(403).json({error:e.message});}
 });
 app.post('/api/game/:id/blockquest',requireGameAccess,(req,res)=>{
  try{
   const ctx=scope(req),b=req.body||{};let s=read(ctx.file);
   if(b.action==='start'){
    if(s?.phase==='ended'&&!s.saved&&!s.preview){saveResults(s,ctx);writeJsonAtomic(ctx.file,s);}
    if(s&&s.phase!=='ended')throw Error('A game is already in progress. Resume it or finish it first.');
    let people=ctx.teacher?members(ctx.game):[{id:req.gameSession.studentId,name:req.gameSession.name||'Explorer',rosterId:req.gameSession.rosterId}];
    if(ctx.board&&Array.isArray(b.studentIds)&&people.length){people=people.filter(p=>b.studentIds.includes(p.id));if(!people.length)throw Error('Select at least one learner.');}
    people=people.slice();for(let i=people.length-1;i>0;i--){const j=crypto.randomInt(i+1);[people[i],people[j]]=[people[j],people[i]];}
    if(!people.length)people=[{id:null,name:'Player 1'},{id:null,name:'Player 2'}];
    if(!ctx.board)people=people.slice(0,1);
    const count=ctx.board?2:1,teams=Array.from({length:count},(_,i)=>({name:ctx.board?['Sun Builders','Moon Builders'][i]:'My tower',board:core.empty(),points:0,lines:0,picks:0,members:people.filter((_,j)=>j%count===i)}));
    teams.forEach((t,i)=>{if(!t.members.length)t.members=[{id:null,name:'Team '+(i+1)}];});
    s={id:crypto.randomUUID(),revision:0,mode:ctx.board?'board':'solo',phase:'answer',turn:0,active:0,teams,answers:[],choices:[],questions:ctx.game.questions.map((q,sourceIndex)=>({...q,sourceIndex})).filter(q=>q.options?.length>=2),preview:ctx.teacher&&!ctx.board,saved:false};
    if(!s.questions.length)throw Error('Add multiple-choice questions to this question set first.');s.learner=teams[0].members[0].name;teams[0].picks++;
   }else{
    if(!s||b.revision!==s.revision)throw Error('This turn has changed. Refresh to continue.');
    const team=s.teams[s.active],q=s.questions[s.turn];
    if(b.action==='pause'&&ctx.teacher&&s.phase!=='ended'){if(s.phase==='paused'){s.phase=s.beforePause;}else{s.beforePause=s.phase;s.phase='paused';}}
    else if(b.action==='finish'&&ctx.teacher){s.phase='ended';}
    else if(b.action==='answer'&&s.phase==='answer'){
     if(!Number.isInteger(b.choice)||b.choice<0||b.choice>=q.options.length)throw Error('Choose an answer.');
     const person=team.members[(team.picks-1)%team.members.length];s.answers.push({studentId:person.id,questionIndex:q.sourceIndex,choice:b.choice,correct:b.choice===q.correctIndex});s.phase='feedback';
    }else if(b.action==='next'&&s.phase==='feedback'){
     if(s.answers.at(-1).correct){s.choices=core.choices();s.rescued=!core.hasRoom(team.board,s.choices);if(s.rescued)team.board=core.rescue(team.board);s.phase='choose';}else advance(s);
    }else if(b.action==='place'&&s.phase==='choose'){
     if(!s.choices.includes(b.shape)||!Number.isInteger(b.rotation)||b.rotation<0||b.rotation>3)throw Error('Choose one of your blocks.');
     s.lastBefore=team.board;s.lastDrop={...core.landing(team.board,b.shape,b.rotation,b.column),shape:b.shape};const result=core.place(team.board,b.shape,b.rotation,b.column);team.board=result.board;team.points+=result.points;team.lines+=result.cleared.length;s.lastPlacement=result.cleared;s.phase='placing';s.readyAt=Date.now()+1000;
    }else if(b.action==='next'&&s.phase==='placing'&&Date.now()>=s.readyAt){advance(s);}else throw Error('Wait for the current action to finish.');
   }
   s.revision++;writeJsonAtomic(ctx.file,s);if(s.phase==='ended'){saveResults(s,ctx);writeJsonAtomic(ctx.file,s);}res.json(view(s,ctx));
  }catch(e){res.status(400).json({error:e.message});}
 });
}
module.exports={register};
