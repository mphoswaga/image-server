/* Sequential slide imports keep each source, plan and retry independent. */
(() => {
  'use strict';
  const MAX_BYTES = 150 * 1024 * 1024;
  class SlideUploadBatch {
    constructor({fileInput, panel, onOpen, onBusy}) {
      Object.assign(this, {fileInput,panel,onOpen,onBusy});
      this.rows=[];this.busy=false;this.stopRequested=false;
      fileInput.addEventListener('change',()=>{
        if(this.busy)return;
        this.started=false;this.withPlan=false;
        this.rows=Array.from(fileInput.files).map(file=>({file,key:crypto.randomUUID(),topic:file.name.replace(/\.pptx$/i,'').replace(/[_]+/g,' ').slice(0,80),objectives:'',status:'Ready',done:false}));
        this.render();
      });
      window.addEventListener('beforeunload',event=>{if(this.busy){event.preventDefault();event.returnValue='';}});
    }
    get hasProgress(){return this.rows.some(row=>row.imported||row.workspaceId);}
    render(){
      const panel=this.panel;panel.replaceChildren();panel.hidden=this.rows.length<2&&!this.hasProgress&&!this.started;
      if(panel.hidden)return;
      const hint=document.createElement('p');hint.className='hint';hint.textContent='One saved lesson or connected sequence per PowerPoint, in the order below. Plans use the normal credits per lesson. Keep this tab open while processing. Completed lessons stay in My lessons.';panel.append(hint);
      this.summary=document.createElement('p');this.summary.setAttribute('role','status');panel.append(this.summary);
      const list=document.createElement('ol');list.style.cssText='padding-left:24px;display:grid;gap:14px';panel.append(list);
      this.rows.forEach(row=>{
        const li=document.createElement('li');li.style.cssText='min-width:0;overflow-wrap:anywhere;padding:12px;border:1px solid #cbded5;border-radius:12px';
        const filename=document.createElement('strong');filename.textContent=`${row.file.name} (${row.file.size<1024*1024?`${Math.ceil(row.file.size/1024)} KB`:`${(row.file.size/1024/1024).toFixed(1)} MB`})`;li.append(filename);
        const label=document.createElement('label');label.textContent='Lesson topic';
        row.topicInput=document.createElement('input');row.topicInput.value=row.topic;row.topicInput.maxLength=80;row.topicInput.oninput=()=>{row.topic=row.topicInput.value;};label.append(row.topicInput);li.append(label);
        const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Learning objectives for this file (optional)';details.append(summary);
        row.objectivesInput=document.createElement('textarea');row.objectivesInput.rows=2;row.objectivesInput.maxLength=12000;row.objectivesInput.setAttribute('aria-label',`Learning objectives for ${row.file.name}`);row.objectivesInput.placeholder='Uses objectives from this file, or the shared objectives below.';row.objectivesInput.value=row.objectives;row.objectivesInput.oninput=()=>{row.objectives=row.objectivesInput.value;};details.append(row.objectivesInput);li.append(details);
        row.statusEl=document.createElement('p');row.statusEl.setAttribute('role','status');li.append(row.statusEl);
        row.openButton=document.createElement('button');row.openButton.type='button';row.openButton.className='btn ghost';row.openButton.textContent='Open saved lesson';row.openButton.onclick=()=>this.onOpen(row.workspaceId);li.append(row.openButton);list.append(li);
      });
      this.stopButton=document.createElement('button');this.stopButton.type='button';this.stopButton.className='btn ghost';this.stopButton.textContent='Stop after this file';this.stopButton.onclick=()=>{this.stopRequested=true;this.stopButton.disabled=true;this.summary.textContent='Finishing and saving the current file, then stopping.';};panel.append(this.stopButton);
      this.refresh();
    }
    refresh(){
      if(!this.summary)return;
      const complete=this.rows.filter(r=>r.done&&(!this.withPlan||r.plan)).length;
      this.summary.textContent=`${complete} of ${this.rows.length} lessons completed${this.busy?' · Processing one file at a time…':complete===this.rows.length?'. Open a lesson below or find it in My lessons.':this.started?'. Select Upload again to retry unfinished files.':'. Review the topics, then choose Upload below.'}`;
      for(const row of this.rows){
        row.statusEl.textContent=row.status;row.statusEl.style.color=row.error?'#b42318':'';
        row.topicInput.disabled=this.busy||!!row.plan||row.done;row.objectivesInput.disabled=this.busy||!!row.plan||row.done;
        row.openButton.style.display=row.workspaceId?'':'none';row.openButton.disabled=this.busy;
      }
      this.stopButton.style.display=this.busy?'':'none';this.stopButton.disabled=this.stopRequested;
    }
    async json(url,options){
      let response;
      try { response=await fetch(url,options); }
      catch { throw new Error('The connection was interrupted. Keep this page open and retry. Any completed uploads and saved lessons are kept.'); }
      const data=await response.json().catch(()=>null);
      if(!data)throw new Error(response.status===504||response.status===502?'The server did not return the result in time. Your saved slides are kept; please retry shortly.':'The server returned an unreadable response. Please retry; saved lessons are kept.');
      if(!response.ok){const error=new Error(data.error||`Request failed (${response.status}). Please retry this file.`);error.status=response.status;throw error;}
      return data;
    }
    post(url,body,method='POST'){return this.json(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
    async run(withPlan,settings){
      if(this.busy)return;
      this.started=true;this.render();
      if(!Number.isFinite(settings.lessonSettings.durationMinutes)||settings.lessonSettings.durationMinutes<5||settings.lessonSettings.durationMinutes>180){this.summary.textContent='Choose a lesson duration between 5 and 180 minutes.';return;}
      if(settings.sequenceLessonCount!=null&&(!Number.isInteger(settings.sequenceLessonCount)||settings.sequenceLessonCount<1||settings.sequenceLessonCount>10)){this.summary.textContent='Choose between 1 and 10 lessons from each PowerPoint.';return;}
      this.started=true;this.withPlan=withPlan;this.busy=true;this.stopRequested=false;this.fileInput.disabled=true;this.onBusy(true);this.refresh();
      try{
        for(const row of this.rows){
          if(this.stopRequested)break;
          if(row.done&&(!withPlan||row.plan))continue;
          row.done=false;
          row.error=false;row.status='Checking file…';
          try{
            if(!/\.pptx$/i.test(row.file.name))throw Error('Choose a PowerPoint (.pptx) file.');
            if(row.file.size>MAX_BYTES)throw Error('This PowerPoint exceeds 150 MB. Choose a smaller file.');
            if(!row.topic.trim())throw Error('Enter a lesson topic for this file.');
            if(!row.plan)row.settings=structuredClone(settings);
            const context={...row.settings,topic:row.topic.trim(),tone:'clear and engaging',lessonPurpose:'lesson',startMode:'haveSlides',deckImported:true,workspaceView:withPlan?'plan':'slides'};
            if(!row.imported){
              row.status='Uploading and reading slides…';this.refresh();
              const form=new FormData();form.append('file',row.file);form.append('subject',context.subject);form.append('topic',context.topic);form.append('grade',context.grade);form.append('durationMinutes',context.lessonSettings.durationMinutes);form.append('objectives',row.objectives.trim()||context.objectives||'');
              row.imported=await this.json('/api/import/slides',{method:'POST',body:form});
            }
            const source=row.imported;
            Object.assign(context,{objectives:row.objectives.trim()||row.settings.objectives||source.objectives||'',successCriteria:source.successCriteria||[],sourceMaterialText:source.sourceText||'',lessonPlanText:source.sourceText||'',slideCount:source.slideCount,slideImportKey:row.key});
            const payload={requestKey:row.key,title:`${context.subject} - ${context.topic}`,subject:context.subject,topic:context.topic,grade:context.grade,context,stage:'slides',deckRefs:[{deckId:source.deckId}],activeDeckId:source.deckId};
            // Save the source before generation; failed plans can be retried or
            // opened from My lessons without uploading the deck again.
            if(!row.workspaceId){
              row.status='Saving uploaded lesson…';this.refresh();
              const saved=await this.post('/api/lesson-workspaces',payload);row.workspaceId=saved.workspace.id;
            }
            if(withPlan){
              if(!context.objectives.trim())throw Error('Slides saved. Add this file’s learning objectives above, then retry.');
              if(!row.plan){
                row.status='Writing this lesson plan…';this.refresh();
                row.plan=await this.post('/api/lesson-plan',{...context,...(context.sequenceEnabled?{sequenceLessonNumber:1}:{})});
              }
              if(!Array.isArray(row.plan.sections)||!row.plan.sections.length){row.plan=null;throw Error('No lesson plan content was returned. Please retry this file.');}
              context.planTemplateId=row.plan.templateId||null;context.successCriteria=row.plan.successCriteria||context.successCriteria;context.addedSuccessCriteria=row.plan.addedSuccessCriteria||[];
              payload.plan=row.plan;payload.stage='plan';
              if(context.sequenceEnabled){payload.sequencePlans=[row.plan];payload.activeSequencePlanIndex=0;}
            }
            row.status='Saving finished lesson…';this.refresh();
            await this.post(`/api/lesson-workspaces/${encodeURIComponent(row.workspaceId)}`,payload,'PATCH');
            row.done=true;row.status=withPlan?(context.sequenceEnabled?`Lesson 1 of ${context.sequenceLessonCount} saved. Open the lesson to review it and generate the next period.`:'Lesson plan saved in My lessons.'):'Slides saved in My lessons.';
          }catch(error){row.error=true;row.status=`${row.status.replace(/…$/, '')} failed: ${error.message}`;if([401,402,429].includes(error.status))this.stopRequested=true;}
          this.refresh();
        }
      }finally{this.busy=false;this.fileInput.disabled=false;this.onBusy(false);this.refresh();}
    }
  }
  window.SlideUploadBatch=SlideUploadBatch;
})();
