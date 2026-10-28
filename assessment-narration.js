const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DATA_DIR,writeFileAtomic}=require('./storage');
const settings={model:'gpt-4o-mini-tts',voice:'marin',response_format:'mp3',speed:1,instructions:'Warm, natural conversational voice with clear friendly British English for primary-school children. Read this assessment text calmly at a steady pace. Neutral emphasis for all answer choices. Read only the supplied text exactly. Do not explain, solve, hint, add words or identify a correct answer. No music or sound effects.'};
function narrationText(record,questionId,choice,slideIndex,bulletIndex){
 if(slideIndex!==undefined){
  if(!/^\d+$/.test(String(slideIndex)))throw Error('Stage not found.');
  const slide=require('./assignments').presentationSlides(record)[Number(slideIndex)];
  if(slide?.kind!=='section')throw Error('Stage not found.');
  const text=bulletIndex===undefined?slide.title:/^\d+$/.test(String(bulletIndex))?slide.bullets?.[Number(bulletIndex)]:null;
  if(!text||text.length>4000)throw Error('Stage text not found.');return text;
 }

 const q=record.content?.questions?.find(q=>q.id===questionId);
 if(!q)throw Error('Question not found.');
 let text=q.question;
 if(choice!==undefined){
  if(!/^\d+$/.test(String(choice)) || !Number.isSafeInteger(Number(choice)) || !q.options?.[Number(choice)])throw Error('Answer choice not found.');
  text=q.options[Number(choice)];
 }
 text=String(text||'').trim();if(!text || text.length>4000)throw Error('This text cannot be read aloud.');
 return text;
}
function createNarration({directory=path.join(DATA_DIR,'assessment-narration'),synthesize}={}){
 const pending=new Map(),active=new Map();
 return async function audio(teacherId,text){
  const hash=crypto.createHash('sha256').update(JSON.stringify(settings)+text).digest('hex');
  const file=path.join(directory,crypto.createHash('sha256').update(teacherId).digest('hex'),hash+'.mp3');
  if(fs.existsSync(file))return fs.readFileSync(file);
  if(pending.has(file))return pending.get(file);
  if((active.get(teacherId)||0)>=2)throw Error('Another reading is being prepared. Please try again shortly.');
  active.set(teacherId,(active.get(teacherId)||0)+1);
  const task=(async()=>{
   const make=synthesize|| (async input=>{
    const OpenAI=require('openai');const ai=new OpenAI({maxRetries:1,timeout:45000});
    return Buffer.from(await(await ai.audio.speech.create({...settings,input})).arrayBuffer());
   });
   const buffer=await make(text);if(!buffer?.length)throw Error('Audio was empty.');
   writeFileAtomic(file,buffer);return buffer;
  })();
  pending.set(file,task);
  try{return await task;}finally{pending.delete(file);active.set(teacherId,active.get(teacherId)-1);}
 };
}
module.exports={createNarration,narrationText};
