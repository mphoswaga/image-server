const auth = require('./auth');
const pick=(record,fields)=>Object.fromEntries(fields.map(key=>[key,record[key]??null]));
function overview(id){
  const user=auth.getUserById(id);
  if(!user||user.role==='student')return null;
  const events=require('./audit').recent(5000).filter(e=>e.actorId===id||e.userId===id||e.teacherId===id||(!e.studentId&&e.email===user.email));
  return {
    generatedAt:new Date().toISOString(),profile:user,
    pinFreeGames:require('./game-join-policy').enabled(id),
    usage:require('./usage').summary().byUser?.[id]||null,
    lessons:require('./lesson-workspaces').list(id,{includeArchived:true}),
    games:require('./games').listTeacherGames(id).map(r=>pick(r,['id','title','lessonTitle','topic','subject','grade','createdAt','mode','rosterId'])),
    assessments:require('./assignments').listTeacherAssignments(id).map(r=>pick(r,['id','title','subject','grade','type','assessmentType','status','totalMarks','createdAt','submissions','resultsReleased','teacherMarked'])),
    classes:require('./roster').listRosters(id),
    activity:events.map(e=>({time:e.ts,action:e.action||String(e.event).replace(/[._]/g,' '),outcome:e.outcome||'recorded'})),
    limitations:['LessonScope records only. EducScope billing/subscription and TeacherScope records are not included.','Recent activity is limited to retained audit history; it is not a complete click history.','Resource lists include summaries, not learner answers, marks, passwords or authentication credentials.'],
  };
}
module.exports={overview};
