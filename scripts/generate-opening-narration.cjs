// Run explicitly to regenerate the bundled AI narration; never called during gameplay.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const OpenAI=require('openai');
const board=fs.readFileSync('public/colonyquest.js','utf8').match(/intro: '([^\n]+)',/)[1];
const multi=require('../colonyquest-story').beats.intro.line.split('\n\n');
const moon=['Tonight, Vinschool is ready for the Moon Festival.','Whoosh! A playful moon spirit scatters the lantern light.','One tiny spark remains. The rabbit heroes catch it!','Your discoveries make magic. Help the rabbits bring the festival home.'];
const scripts=[['colony-board',board],...multi.map((text,i)=>['colony-'+i,text]),...moon.map((text,i)=>['moon-'+i,text])];
(async()=>{
 const ai=new OpenAI({maxRetries:1}), manifest={model:'gpt-4o-mini-tts',voice:'marin',clips:{}};
 for(const [id,text] of scripts){
  const file=path.join('public/assets/game-narration',id+'.mp3');
  if(!fs.existsSync(file)){
   const response=await ai.audio.speech.create({model:manifest.model,voice:manifest.voice,input:text,response_format:'mp3',speed:id.startsWith('moon')?1.12:1,instructions:'Warm, expressive storybook narrator for primary-school children. Natural conversational rhythm, clear friendly British English, playful suspense and gentle character expression. No music, sound effects or added words. Read only the supplied text.'});
   fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
  }
  const info=execFileSync('/usr/bin/afinfo',[file],{encoding:'utf8'});
  const seconds=Number(info.match(/estimated duration:\s*([\d.]+)/i)?.[1]);
  if(!seconds)throw Error('Could not verify duration for '+id);
  manifest.clips[id]={src:'/assets/game-narration/'+id+'.mp3',seconds,text};
  console.log(id,seconds+' seconds');
 }
 fs.writeFileSync('public/assets/game-narration/manifest.json',JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync('public/opening-narration-data.js','window.OpeningNarrationData='+JSON.stringify(manifest)+';\n');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
