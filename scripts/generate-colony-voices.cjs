// Explicit build-time generation only. Gameplay serves bundled audio files.
require('dotenv').config({quiet:true});
const fs=require('node:fs');const OpenAI=require('openai');
(async()=>{
 const ai=new OpenAI({maxRetries:1});const root='public/assets/game-narration';
 const cues={raid:['Raiding!','onyx','Deep, strong male adventure announcer. A punchy, excited battle cry, clearly spoken, playful rather than frightening.'],spider:['Spiders incoming!','coral','Tiny mischievous cartoon spider voice, high and squeaky but clear. Playful suspense for young children.'],build:['Build!','ash','Energetic friendly builder calling the crew to work. Short, warm and confident.'],rain:['Rain incoming!','marin','Excited scout warning friends, clear and lively.'],birds:['Birds overhead!','marin','Alert playful scout voice.'],stomp:['Giant footsteps!','onyx','Deep dramatic adventure announcer, playful suspense.'],guard:['Guards ready!','onyx','Strong confident friendly guard captain.'],food:['Food collected!','coral','Small cheerful energetic ant.']};
 for(const [key,[text,voice,instructions]] of Object.entries(cues)){
  const file=`${root}/action-${key}.mp3`;
  if(!fs.existsSync(file)){const out=await ai.audio.speech.create({model:'gpt-4o-mini-tts',voice,input:text,instructions:instructions+' Say only the supplied words. No music.',response_format:'mp3'});fs.writeFileSync(file,Buffer.from(await out.arrayBuffer()));}
  console.log('Ready:',key);
 }
 const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));let timing={};
 const dest=`${root}/colony-timings.json`;if(fs.existsSync(dest))timing=JSON.parse(fs.readFileSync(dest));
 for(const [key,clip] of Object.entries(manifest.clips).filter(([k])=>k.startsWith('colony-'))){
  if(!timing[key]){const transcript=await ai.audio.transcriptions.create({model:'whisper-1',file:fs.createReadStream('public'+clip.src),response_format:'verbose_json',timestamp_granularities:['word'],prompt:clip.text});timing[key]=[];for(let i=0;i<transcript.words.length;i+=10){const words=transcript.words.slice(i,i+10);timing[key].push({start:words[0].start,end:words.at(-1).end,text:words.map(w=>w.word).join(' ')});}fs.writeFileSync(dest,JSON.stringify(timing,null,2));}
  console.log('Timed:',key);
 }
 require('node:child_process').execFileSync('python3',['scripts/align-colony-caption-text.py'],{stdio:'inherit'});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
