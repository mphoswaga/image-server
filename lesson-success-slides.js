'use strict';
const isCriteriaTitle=title=>/^(?:success criteria|success criteria \(continued\)|i can statements|SC)$/i.test(String(title||'').trim());
function lines(value){return (Array.isArray(value)?value:String(value||'').replace(/\r/g,'').split('\n')).filter(v=>typeof v==='string').map(v=>v.replace(/^\s*(?:[-*•]|\d+[.)])\s*/,'').trim().replace(/^"|"$/g,'').trim()).filter(Boolean);}
function criteriaFromPlan(text){
 const source=String(text||'').split(/--- OPTIONAL TEACHER SOURCE MATERIALS ---/i)[0];
 const sections=source.split(/(?=^##\s)/m);
 for(const section of sections){const [heading,...body]=section.split('\n');if(/^##\s*(?:success criteria|SC)(?:\s*[:(].*)?\s*$/i.test(heading.trim()))return lines(body.join('\n'));}
 const match=source.match(/(?:^|\n)\s*(?:success criteria|SC)(?:[ \t]*[:\t][ \t]*|[ \t]*\n)([\s\S]*?)(?=\n\s*(?:key vocabulary|resources|phonics|intro(?:duction)?|activities|assessment|plenary|differentiation|post lesson|learning objectives|LO)(?:[ \t]*[:\t]|[ \t]*\n)|$)/i);
 return match?lines(match[1]):[];
}
function objectivesFromPlan(text){
 const sections=String(text||'').split(/--- OPTIONAL TEACHER SOURCE MATERIALS ---/i)[0].split(/(?=^##\s)/m);
 for(const section of sections){const [heading,...body]=section.split('\n');if(/^##\s*(?:learning objectives?|objectives?|LO)\s*:?$/i.test(heading.trim()))return body.join('\n');}
 const match=String(text||'').match(/(?:^|\n)[ \t]*(?:learning objectives?|objectives?|LO)(?:[ \t]*[:\t][ \t]*|[ \t]*\n)([\s\S]*?)(?=\n[ \t]*(?:success criteria|SC|key vocabulary|resources|intro(?:duction)?|activities)(?:[ \t]*[:\t]|[ \t]*\n)|$)/i);return match?match[1]:'';
}
function addSuccessCriteriaSlides(slides,extras={},purpose='lesson'){
 if(purpose!=='lesson'||!Array.isArray(slides))return slides;
 const supplied=lines(extras.successCriteria),fromPlan=criteriaFromPlan(extras.lessonPlanText);
 const existing=slides.filter(s=>isCriteriaTitle(s.title)).flatMap(s=>lines(s.bullets));
 const objectives=extras.objectives||objectivesFromPlan(extras.lessonPlanText)||slides.find(s=>s.type==='objectives'&&/objectives/i.test(s.title||''))?.bullets?.join('\n')||'';
 // Reuse the same objective-to-criterion rules as lesson planning. No extra
 // skills or generic "I understand" placeholders are invented by the deck.
 const selected=supplied.length?supplied:fromPlan.length?fromPlan:existing.length?existing:require('./lesson-plan').deriveSuccessCriteria(objectives,100);
 const seen=new Set(),criteria=selected.filter(v=>{const key=v.toLowerCase().replace(/[.!?]+$/,'');if(seen.has(key))return false;seen.add(key);return true;});
 if(!criteria.length)return slides;
 const result=slides.filter(s=>!isCriteriaTitle(s.title));
 let anchor=result.findIndex(s=>s.modelStage==='outcome'||s.title==='Lesson outcome');
 if(anchor<0)anchor=result.findIndex(s=>s.type==='objectives');
 if(anchor<0)anchor=result.findIndex(s=>s.type==='title');
 const pages=[];for(let i=0;i<criteria.length;i+=3)pages.push({type:'objectives',title:i?'Success criteria (continued)':'Success criteria',bullets:criteria.slice(i,i+3),imageQuery:'',modelStage:'success_criteria',criteriaSource:supplied.length||fromPlan.length||existing.length?'plan':'objectives',speakerNotes:'Share these observable success criteria near the lesson outcome. Return to them during practice and the final self-check. '+(supplied.length||fromPlan.length||existing.length?'Preserved from the planning material.':'Derived from this lesson’s learning objectives; review for your class.')});
 result.splice(Math.max(0,anchor+1),0,...pages);return result;
}
module.exports={lines,criteriaFromPlan,objectivesFromPlan,addSuccessCriteriaSlides};
