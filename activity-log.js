// Human-readable activity records only: never store request bodies or credentials.
const audit = require('./audit');
function actionFor(method, path) {
  if (/^\/api\/(?:login|student\/login|educscope\/token|webauthn\/login\/verify)$/.test(path)) return 'Signed in';
  if (/^\/api\/(?:signup|student\/signup)$/.test(path)) return 'Created account';
  if (/^\/api\/logout$/.test(path)) return 'Signed out';
  if (!['POST','PUT','PATCH','DELETE'].includes(method)) return null;
  if (/^\/api\/lesson-plan(?:\/|$)/.test(path)) return 'Generated lesson plan';
  if (/^\/api\/(?:generate|assessment-generate|assessment-mcq)$/.test(path)) return path.includes('assessment')?'Generated assessment':'Generated slides';
  if (/^\/api\/(?:game|assignment)\/[^/]+\/enter$/.test(path)) return 'Joined activity';
  if (/^\/api\/assignment\/[^/]+\/submit$/.test(path)) return 'Submitted assessment';
  if (/^\/api\/assignment\/[^/]+\/(?:grade(?:\/bulk)?|grades|grade-bulk|teacher-marked|release|unrelease|live-state)$/.test(path)) return 'Updated assessment or marking';
  if (/^\/api\/assessment$/.test(path)) return 'Published assessment';
  if (/^\/api\/game(?:\/|$)/.test(path)) return 'Updated game activity';
  if (/^\/api\/roster(?:\/|$)/.test(path)) return 'Updated class roster';
  if (/^\/api\/practice\/attempts(?:\/[^/]+\/checkpoints)?$/.test(path)) return 'Completed practice';
  return null;
}
function middleware(resolveActor) {
  return (req,res,next)=>{
    const action=actionFor(req.method,req.path);
    if(action)res.once('finish',()=>{
      try {
        const actor=resolveActor(req,res);if(!actor)return;
        audit.log('activity',{actorId:actor.id,actorName:actor.name,actorEmail:actor.email||'',actorRole:actor.role,
          action,outcome:res.statusCode<400?'success':'failed',status:res.statusCode});
      } catch (_) {} // Recording must never interrupt teaching.
    });
    next();
  };
}
function list(query={},users=[]) {
  const accounts=new Map(users.map(u=>[u.id,u]));
  const rows=audit.recent(5000).map(e=>{
    if(e.event==='activity')return {time:e.ts,name:e.actorName||e.actorId,id:e.actorId,email:e.actorEmail||'',role:e.actorRole,action:e.action,outcome:e.outcome};
    // Existing audit history contains useful sign-ins and teacher work, but is not complete.
    const user=accounts.get(e.userId||e.teacherId);
    const student=e.studentId&&!user;
    if(!user&&!student)return null;
    const id=student?e.studentId:user.id;
    return {time:e.ts,name:student?(e.name||id):user.name,id,email:student?'':user.email,role:student?'student':user.role==='admin'?'admin':'teacher',action:String(e.event).replace(/[._]/g,' '),outcome:'recorded'};
  }).filter(Boolean);
  const search=String(query.search||'').trim().toLowerCase();
  const filtered=rows.filter(r=>(!query.role||query.role==='all'||r.role===query.role)
    &&(!query.from||r.time.slice(0,10)>=query.from)&&(!query.to||r.time.slice(0,10)<=query.to)
    &&(!search||[r.name,r.email,r.id,r.action].join(' ').toLowerCase().includes(search)));
  const offset=Math.max(0,Math.min(5000,parseInt(query.offset,10)||0));
  return {events:filtered.slice(offset,offset+100),total:filtered.length,nextOffset:offset+100<filtered.length?offset+100:null};
}
module.exports={middleware,actionFor,list};
