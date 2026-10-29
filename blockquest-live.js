const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DATA_DIR,writeJsonAtomic}=require('./storage'),engine=require('./blockquest-duels');
function register({app,games,roster,requireGameAccess,gameSessionCanAccess}){
 const matches=new Map(),dirty=new Set(),dir=path.join(DATA_DIR,'blockquest-live'),profiles=require('./class-game-teams').createTeamProfiles(),narrate=require('./assessment-narration').createNarration();
 const file=key=>path.join(dir,crypto.createHash('sha256').update(key).digest('hex')+'.json');
 function scope(req){const game=games.getGame(req.params.id);if(!game)throw Error('Game not found.');const teacher=!!req.userId;
  if(teacher&&game.teacherId!==req.userId)throw Error('This is another teacher’s game.');
  if(!teacher&&(!req.gameSession||!gameSessionCanAccess(game,req.gameSession)))throw Error('Join your teacher’s game first.');
  const preview=req.query.test==='1';if(preview&&!teacher)throw Error('Only teachers can open a sample competition.');
  const as=req.query.as;if(as&&(!preview||!teacher||as!=='demo-1'))throw Error('This sample learner is unavailable.');
  if(!teacher&&game.cutoffAt&&Date.now()>Date.parse(game.cutoffAt))throw Error('This activity is closed.');
  return {game,teacher:teacher&&!as,owner:teacher,preview,id:as||req.gameSession?.studentId,key:game.id+(preview?':preview':':class')};
 }
 function get(ctx){if(matches.has(ctx.key))return matches.get(ctx.key);let s;try{s=JSON.parse(fs.readFileSync(file(ctx.key),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(['running','matchup'].includes(s.phase)){engine.pause(s,s.savedAt||Date.now());dirty.add(ctx.key);}matches.set(ctx.key,s);return s;
 }
 function flush(key){const s=matches.get(key);if(!s)return;s.savedAt=Date.now();writeJsonAtomic(file(key),s);dirty.delete(key);}
 function saveGrades(s,game){if(s.phase!=='ended'||s.preview||s.saved)return;
  for(const p of Object.values(s.players)){if(!p.answers.length||p.isBot)continue;const first=new Map();for(const a of p.answers)if(!first.has(a.questionIndex))first.set(a.questionIndex,a);
   games.recordResult(game.id,{studentId:p.id,name:p.name,rosterId:p.rosterId,score:[...first.values()].filter(a=>a.correct).length,total:first.size,answers:Object.fromEntries([...first].map(([i,a])=>[i,a.choice])),arcadeScore:p.score,gameType:'blockquest-duels',resultId:s.id+':'+p.id});
  }s.saved=true;
 }
 function current(ctx){const s=get(ctx);if(s){if(engine.tick(s))dirty.add(ctx.key);if(s.phase==='ended'&&!s.saved&&!s.preview){saveGrades(s,ctx.game);dirty.add(ctx.key);}}return s;}
 function classes(ctx){return ctx.preview?[{id:'sample',name:'Sample class',count:10}]:games.getRosterIds(ctx.game).map(id=>roster.getRoster(ctx.game.teacherId,id)).filter(Boolean).map(r=>({id:r.id,name:r.name,count:r.students.length}));}
 function selectedRoster(ctx,id){if(ctx.preview)return {id:'sample',name:'Sample class',students:['Mia','Leo','Ava','Noah','Lily','Ben','Ella','Max','Zoe','Kai'].map((name,i)=>({id:'demo-'+(i+1),name,gender:i%2?'male':'female'}))};
  if(!games.getRosterIds(ctx.game).map(String).includes(String(id)))throw Error('Choose a class assigned to this question set.');const r=roster.getRoster(ctx.game.teacherId,id);if(!r)throw Error('Class not found.');return r;
 }
 const result=(ctx,s)=>({teacher:ctx.teacher,preview:ctx.preview,title:ctx.game.lessonTitle,roomCode:ctx.game.roomCode,classes:ctx.teacher?classes(ctx):undefined,state:s&&(ctx.teacher||s.players[ctx.id])?engine.view(s,ctx.id,ctx.teacher):null,unavailable:!!s&&!ctx.teacher&&!s.players[ctx.id]});
 const guard=(handler)=>(req,res)=>{try{res.set('Cache-Control','no-store');handler(req,res,scope(req));}catch(error){res.status(400).json({error:error.message});}};
 app.get('/api/game/:id/blockquest-live/setup',requireGameAccess,guard((req,res,ctx)=>{if(!ctx.teacher)throw Error('Teacher setup only.');const r=selectedRoster(ctx,req.query.roster);res.json({roster:{id:r.id,name:r.name,students:r.students.map(p=>({id:p.id,name:p.name,gender:p.gender}))},profile:ctx.preview?null:profiles.load(ctx.game.teacherId,r)});}));
 app.get('/api/game/:id/blockquest-live/voice',requireGameAccess,async(req,res)=>{try{const ctx=scope(req),s=current(ctx),run=s?.players[ctx.id]?.run;if(!run||s.phase!=='running'||run.id!==req.query.run||String(run.turn)!==req.query.turn||run.phase!=='answer')return res.status(409).json({error:'Question closed.'});const text=run.questions[run.turn].question;if(!text||text.length>4000)throw Error('Question unavailable.');const audio=await narrate(ctx.game.teacherId,text);res.set('Cache-Control','private, no-store').type('audio/mpeg').send(audio);}catch{res.status(503).json({error:'Question voice unavailable.'});}});
 app.get('/api/game/:id/blockquest-live',requireGameAccess,guard((req,res,ctx)=>{const s=current(ctx);if(s&&!ctx.teacher&&s.players[ctx.id])s.players[ctx.id].lastSeen=Date.now();res.json(result(ctx,s));}));
 app.post('/api/game/:id/blockquest-live',requireGameAccess,guard((req,res,ctx)=>{
  const b=req.body||{};let s=current(ctx);const now=Date.now();
  if(b.action==='create'){
   if(!ctx.teacher)throw Error('Teacher setup only.');if(s&&!['lobby','ended'].includes(s.phase))throw Error('Finish the current competition first.');
   const r=selectedRoster(ctx,b.rosterId);if(!Array.isArray(b.teams))throw Error('Set up your teams first.');s=engine.create(ctx.game,{students:r.students,teams:b.teams,minutes:b.minutes,rounds:b.rounds,rosterId:r.id,preview:ctx.preview},now);matches.set(ctx.key,s);if(b.remember&&!ctx.preview)profiles.save(ctx.game.teacherId,r,s.teams.map(t=>({name:t.name,members:t.members.map(id=>({id}))})));
  }else{
   if(!s)throw Error('Your teacher has not opened the duels yet.');if(b.session&&b.session!==s.id)throw Error('The competition changed. Refresh to continue.');
   if(ctx.teacher){
    if(b.action==='start'&&s.phase==='lobby')engine.pairRound(s,now);
    else if(b.action==='pause')engine.pause(s,now);
    else if(b.action==='finish'){
     if(s.phase==='running'||s.phase==='paused'&&s.beforePause==='running')engine.finishRound(s,now,true);else{s.phase='ended';s.updatedAt=now;}
    }else throw Error('That control is unavailable.');
   }else{
    const p=s.players[ctx.id];if(!p)throw Error('You are not in this class competition.');
    if(b.action==='join'){if(s.phase==='ended')throw Error('This competition has ended.');p.joined=true;p.lastSeen=now;}
    else engine.action(s,ctx.id,b,now);
   }
  }
  saveGrades(s,ctx.game);dirty.add(ctx.key);if(ctx.teacher)flush(ctx.key);res.json(result(ctx,s));
 }));
 const timer=setInterval(()=>{for(const [key,s]of matches){if(engine.tick(s))dirty.add(key);const game=games.getGame(s.gameId);if(game&&s.phase==='ended'&&!s.saved&&!s.preview){try{saveGrades(s,game);dirty.add(key);}catch(error){console.error('BlockQuest results:',error.message);}}
   if(dirty.has(key)){try{flush(key);}catch(error){console.error('BlockQuest save:',error.message);}}
  }},1000);timer.unref?.();
 return {close(){clearInterval(timer);for(const key of dirty)flush(key);}};
}
module.exports={register};
