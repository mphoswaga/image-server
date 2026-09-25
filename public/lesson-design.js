(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LessonDesign=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const games={moonquest:'MoonQuest',colonyquest:'ColonyQuest',fishquest:'FishQuest',arcade:'Arcade quiz'};
  function number(v,name,min,max){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${name} must be between ${min} and ${max} minutes.`);return n;}
  function normalize(input={},options={}){
    const duration=number(input.durationMinutes??options.periodMinutes??35,'Lesson duration',5,180);
    const result={durationMinutes:duration,observation:null,game:null,slideCountMode:input.slideCountMode==='manual'?'manual':'auto'};
    if(input.observation){const start=number(input.observation.startMinute??0,'Observation start',0,duration-1),minutes=number(input.observation.durationMinutes,'Observation duration',1,duration);if(start+minutes>duration)throw new Error('The observation must fit inside the lesson.');result.observation={startMinute:start,durationMinutes:minutes};}
    if(input.game){if(options.lessonPurpose&&options.lessonPurpose!=='lesson')throw new Error('Game tasks are available in taught lessons, not assessed tests or projects.');const g=input.game;if(g.existingId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(g.existingId))throw new Error('Choose a valid saved game.');if(!games[g.mode])throw new Error('Choose a supported game.');const minutes=number(g.durationMinutes??15,'Game duration',3,duration);const start=g.startMinute==null?Math.min(15,Math.floor(duration/3),duration-minutes):number(g.startMinute,'Game start',0,duration-1);if(start+minutes>duration)throw new Error('The game finishes after the lesson. Move its start earlier or shorten it.');const lesson=number(g.lesson??1,'Game lesson',1,options.lessonCount||5);result.game={mode:g.mode,purpose:['introduce','practise','check','review'].includes(g.purpose)?g.purpose:'check',startMinute:start,durationMinutes:minutes,lesson,existingId:/^[a-zA-Z0-9_-]{1,100}$/.test(g.existingId||'')?g.existingId:null};}
    return result;
  }
  function recommendation(design,sections=[],lesson=1){
    const d=normalize(design),g=d.game&&d.game.lesson===lesson?d.game:null;
    let nonSlide=g?g.durationMinutes:0,cursor=0;
    for(const s of sections){
      const m=String(s.content||'').match(/Time:\s*(\d+)\s*minutes/i);if(!m)continue;
      const minutes=Number(m[1]),end=cursor+minutes;
      if(/independent|you do alone|practical/i.test(s.heading||'')){
        const overlap=g?Math.max(0,Math.min(end,g.startMinute+g.durationMinutes)-Math.max(cursor,g.startMinute)):0;
        nonSlide+=Math.max(0,minutes-overlap);
      }
      cursor=end;
    }
    return Math.max(3,Math.min(20,Math.round(Math.max(5,d.durationMinutes-nonSlide)/5)));
  }
  function prompt(design,lesson=1,forSlides=false){if(!design)return '';const d=normalize(design);const g=d.game&&d.game.lesson===lesson?d.game:null;return `\nLESSON TIMING AND CHOSEN TASK:\nThe whole lesson lasts exactly ${d.durationMinutes} minutes. Allocate activity timings to that total, including transitions. ${d.observation?`The observer attends from minute ${d.observation.startMinute} to ${d.observation.startMinute+d.observation.durationMinutes}. Plan meaningful student thinking and checks in that window without claiming a guaranteed rating.`:''}\n${g?`The teacher selected ${games[g.mode]} to ${g.purpose} learning. Include it as a concrete task from minute ${g.startMinute} to ${g.startMinute+g.durationMinutes}, including joining, discussion and feedback. Keep school headings; place it within the activity covering that interval. Explain the objective, learner actions, teacher evidence and responsive follow-up. ${g.mode==='moonquest'?'MoonQuest uses a teacher-provided diagram and selectable answer areas. Prepare and review the diagram and questions; learners select their own name from the class roster and enter their usual PIN. Each question has a 35-second answering period; the teacher can invite partner discussion. More than 30% incorrect triggers a class meeting which the teacher resumes. Budget time for discussion rather than promising a fixed number of questions.':'Use the selected game’s existing classroom setup and questions; do not invent features or scoring rules.'} Include a brief no-device alternative. Selecting this task does not create a playable game.\n${forSlides?'Include a content slide titled '+games[g.mode]+' with concise pupil instructions and teacher notes showing the start time, duration, discussion and follow-up check. Do not invent a room code or a game URL.':'Return gamePlacement containing sectionHeading (exact existing activity heading), startMinute='+g.startMinute+', durationMinutes='+g.durationMinutes+', preparation, studentTask, teacherResponse and followUp. Do not repeat this task in the section text because it will be inserted there.'}`:'No game task is selected for this period. Do not invent a LessonScope game task.'}\nFor slides: follow the approved sequence, include a brief game instruction and post-game check when selected, and do not fill game/practice time with extra lecture slides. Respect the teacher’s chosen content slide count.\n`;}
  return {games,normalize,recommendation,prompt};
});
