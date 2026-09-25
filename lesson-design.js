const design = require('./public/lesson-design');
function placementSchema(){return {type:'object',additionalProperties:false,properties:{sectionHeading:{type:'string'},startMinute:{type:'integer'},durationMinutes:{type:'integer'},preparation:{type:'string'},studentTask:{type:'string'},teacherResponse:{type:'string'},followUp:{type:'string'}},required:['sectionHeading','startMinute','durationMinutes','preparation','studentTask','teacherResponse','followUp']};}
// The teacher's reserved game interval is authoritative. Allocate the model's
// proposed activity budgets around it, retaining their order and total duration.
function alignGameTimings(plan,settings,lesson=1,structured=false){
  const g=settings?.game,p=plan.gamePlacement;
  if(!g||!p||(!structured&&g.lesson!==lesson))return plan;
  const evidence=(plan.teachingEvidence||[]).map(e=>({...e,timings:(e.timings||[]).map(t=>({...t}))}));
  const e=evidence.find(e=>e.lesson===(structured?g.lesson:1));if(!e)return plan;
  const sections=(plan.sections||[]).filter(s=>!structured||s.lesson===g.lesson);
  e.timings.sort((a,b)=>sections.findIndex(s=>s.heading===a.sectionHeading)-sections.findIndex(s=>s.heading===b.sectionHeading));
  const i=e.timings.findIndex(t=>t.sectionHeading===p.sectionHeading);if(i<0)return plan;
  const before=e.timings.slice(0,i),after=e.timings.slice(i+1);
  function allocate(items,budget){if(!items.length)return budget===0;if(budget<items.length)return false;const total=items.reduce((n,t)=>n+Math.max(1,t.minutes),0);let left=budget;items.forEach((t,index)=>{const remaining=items.length-index-1;const amount=index===items.length-1?left:Math.max(1,Math.min(left-remaining,Math.round(budget*Math.max(1,t.minutes)/total)));t.minutes=amount;left-=amount;});return true;}
  if(!allocate(before,g.startMinute))return plan;
  const remaining=settings.durationMinutes-g.startMinute-g.durationMinutes;
  e.timings[i].minutes=g.durationMinutes+(after.length?0:remaining);
  if(after.length&&!allocate(after,remaining))return plan;
  return {...plan,teachingEvidence:evidence};
}
function integrateGame(plan,settings,lesson=1,structured=false){
  const g=settings?.game; if(!g||(!structured&&g.lesson!==lesson))return {plan,issues:[]};
  const p=plan.gamePlacement,sections=plan.sections||[];
  if(!p||p.startMinute!==g.startMinute||p.durationMinutes!==g.durationMinutes)return {plan,issues:['Return gamePlacement with the exact requested game start and duration.']};
  const index=sections.findIndex(s=>s.heading===p.sectionHeading&&(!structured||s.lesson===g.lesson));
  if(index<0||/reflection|resources|objectives|overview/i.test(p.sectionHeading)||['preparation','studentTask','teacherResponse','followUp'].some(k=>!String(p[k]||'').trim()))return {plan,issues:['Place the complete game task inside an existing activity, not metadata or reflection.']};
  let cursor=0,found=false;
  for(let i=0;i<sections.length;i++){const s=sections[i];if(structured&&s.lesson!==g.lesson)continue;const m=String(s.content).match(/Time:\s*(\d+) minutes/);if(!m)continue;const end=cursor+Number(m[1]);if(i===index)found=cursor<=g.startMinute&&end>=g.startMinute+g.durationMinutes;cursor=end;}
  if(!found)return {plan,issues:['The chosen activity timing must contain the entire game interval. Adjust timings while retaining the full lesson total.']};
  const updated=sections.map(s=>({...s}));
  if(g.mode==='moonquest') updated[index].content=updated[index].content.replace(/(?:select|enter|use) (?:their|your|the) class name/gi,'select their own name from the class roster');
  updated[index].content+=`\n${design.games[g.mode]} task: minutes ${g.startMinute}–${g.startMinute+g.durationMinutes}.\nPrepare: ${p.preparation}\nLearners: ${p.studentTask}\nTeacher checks and responds: ${p.teacherResponse}\nAfter the game: ${p.followUp}`;
  const {gamePlacement,...rest}=plan;return {plan:{...rest,sections:updated},issues:[]};
}
function applyGameSlide(slides,settings){
  const g=settings?.game;if(!g||!slides?.length)return slides;
  const name=design.games[g.mode];let index=slides.findIndex(s=>String(s.title||'').toLowerCase().includes(name.toLowerCase()));
  if(index<0)index=slides.findIndex(s=>s.stageId==='practice'||s.stageId==='guided_practice');
  if(index<0)index=Math.min(slides.length-1,Math.round(slides.length*g.startMinute/settings.durationMinutes));
  const result=slides.map(s=>({...s}));
  const instructions=g.mode==='moonquest'?['Open the teacher’s learner link.','Choose your own name and enter your PIN.','Select the diagram area that answers the question.','Explain your choice when your teacher invites discussion.']:['Open the game using your teacher’s instructions.','Use what you have learned to answer the questions.','Be ready to explain your reasoning.'];
  result[index]={...result[index],title:name+' learning task',bullets:instructions,example:'Be ready to explain why your answer fits the question.',speakerNotes:`Start at minute ${g.startMinute}; allow ${g.durationMinutes} minutes including joining and discussion. Prepare and open the reviewed game before teaching. ${g.mode==='moonquest'?'Use the teacher-provided diagram. MoonQuest allows 35 seconds for each answer; invite discussion during that time. More than 30% incorrect triggers a class meeting; resume after discussing the misconception. ':''}Use the response evidence to address misconceptions. Follow the game with the independent check in the approved lesson plan.`};
  return result;
}
module.exports={...design,placementSchema,integrateGame,alignGameTimings,applyGameSlide};
