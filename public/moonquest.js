/* MoonQuest: diagrams stay still; only the festival scene animates. */
(() => {
  'use strict';
  const root = document.getElementById('app'), notice = document.getElementById('notice');
  const base = '/api/games/moonquest';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const uid = () => crypto.randomUUID();
  const mascot = () => `<div class="mascot">${document.getElementById('mascot').innerHTML}</div>`;
  const button = (label, action, cls = '') => `<button class="${cls}" data-action="${action}">${label}</button>`;
  let library, draft, activeDiagram = 0, drawn = [], drawing = false, regionEditing = null, view = 'library', sessionId, role = 'teacher', state, lastRender = '', pollTimer, clockOffset = 0;
  let learnerToken = '', room, busyAnswer = false, polling = false, dirty = false, noticeTimer, soundEnabled = false, audio;
  let uploadingDiagram=false;
  let presenterAvailable=false, changingAnswer=false, pendingChoices=[], answerRound=-1;
  const selectedIds = value => value == null ? [] : Array.isArray(value) ? value : [value];
  const autoSuggestions = new Set();
  const queueEdits = {};
  const answerWord = count => Number(count) === 1 ? 'answer' : 'answers';
  const answerInstruction = question => {
    const count = Number(question?.selectionCount || 1);
    return count > 1 ? `Choose ${count} ${answerWord(count)}` : 'Choose ONE answer';
  };
  const answerProgress = (count, total) => `${count}/${total} selected`;
  let musicTimer, musicEnabled=false, musicStep=0;
  // Original pentatonic instrumental: soft zither-like plucks and a breathy flute.
  // No recordings, external streams, vocals or autoplay.
  const melody=[74,0,77,79,81,0,79,77,74,0,72,69,72,0,74,0,77,79,84,0,81,79,77,0,74,72,69,0,72,74,0,0];
  let musicBus;
  const musicVoices=new Set();
  function stopMusic(){clearInterval(musicTimer);for(const voice of musicVoices){try{voice.stop();}catch{}}musicVoices.clear();}
  function instrument(note,flute=false){
    const now=audio.currentTime, frequency=440*Math.pow(2,(note-69)/12), duration=flute?1.8:2.6;
    const envelope=audio.createGain();envelope.connect(musicBus);
    envelope.gain.setValueAtTime(0,now);envelope.gain.linearRampToValueAtTime(flute?.11:.15,now+(flute?.2:.012));envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);
    let remaining=3;
    [1,2,3].forEach((harmonic,i)=>{const oscillator=audio.createOscillator(),gain=audio.createGain();
      oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency*harmonic,now);
      gain.gain.value=(flute?[1,.12,.035]:[1,.32,.12])[i];oscillator.connect(gain);gain.connect(envelope);
      musicVoices.add(oscillator);oscillator.onended=()=>{musicVoices.delete(oscillator);oscillator.disconnect();gain.disconnect();if(!--remaining)envelope.disconnect();};oscillator.start(now);oscillator.stop(now+duration);
    });
  }
  function musicNote(){
    if(!musicEnabled||document.hidden)return;
    try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume();
      if(!musicBus){musicBus=audio.createGain();musicBus.connect(audio.destination);}
      musicBus.gain.setTargetAtTime(Number(document.getElementById('music-level').value)/100*.5,audio.currentTime,.05);
      const step=musicStep++%melody.length;if(melody[step])instrument(melody[step],true);
      if(step%2===0)instrument([50,57,62,57,53,60,65,60][Math.floor(step/2)%8]);
    }catch{}
  }
  document.getElementById('music-level').oninput=()=>{if(musicBus)musicBus.gain.setTargetAtTime(Number(document.getElementById('music-level').value)/100*.5,audio.currentTime,.05);};
  document.getElementById('music').onclick=()=>{musicEnabled=!musicEnabled;const b=document.getElementById('music');b.textContent=musicEnabled?'Music on':'Music off';b.setAttribute('aria-pressed',String(musicEnabled));stopMusic();if(musicEnabled){musicNote();musicTimer=setInterval(musicNote,850);}};
  document.addEventListener('visibilitychange',()=>{stopMusic();if(musicEnabled&&!document.hidden){musicNote();musicTimer=setInterval(musicNote,850);}});
  window.addEventListener('pagehide',stopMusic);
  function tell(message, error = false) { clearTimeout(noticeTimer); notice.textContent = message; notice.classList.toggle('error', error); noticeTimer = setTimeout(() => { notice.textContent = ''; }, error ? 15000 : 6500); }
  async function api(url, data, opts = {}) {
    const response = await fetch(base + url, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(learnerToken ? { Authorization: 'Bearer ' + learnerToken } : {}) }, ...(data === undefined ? {} : { body: data instanceof FormData ? data : JSON.stringify(data) }), signal: AbortSignal.timeout(opts.timeout || 12000) });
    const result = await response.json().catch(() => ({ error: 'LessonScope could not return this request. Please try again.' }));
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }
  function stopPoll() { clearTimeout(pollTimer);cancelAnimationFrame(storyFrame);window.speechSynthesis?.cancel(); }
  function chime() {
    if (!soundEnabled || role==='student') return;
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); [523.25,659.25,783.99].forEach((f,i) => { const o=audio.createOscillator(),g=audio.createGain(), t=audio.currentTime+i*.1; o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(Number(document.getElementById('effects-level').value)/100*.13,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.45);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.5); }); } catch {}
  }
  document.getElementById('sound').onclick = () => { soundEnabled = !soundEnabled; document.getElementById('sound').textContent = soundEnabled ? 'Sound on' : 'Sound off'; document.getElementById('sound').setAttribute('aria-pressed', String(soundEnabled)); chime(); };
  document.getElementById('full').onclick = async () => { try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { tell('Use your browser’s full-screen option.'); } };
  window.addEventListener('beforeunload', e => { if(view==='editor')checkpoint(); if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  function nav(url) { history.pushState({}, '', url); }
  window.addEventListener('popstate', () => location.reload());

  async function home() {
    document.body.dataset.view='library';
    stopPoll(); view = 'library'; state = null; sessionId = null; learnerToken = ''; dirty = false;
    library = await api('/library'); nav('/moonquest');
    const works=new Map((library.drafts||[]).map(d=>[d.id,d]));for(const d of localDrafts())works.set(d.id,{id:d.id,title:d.payload.title||'Untitled adventure'});
    root.innerHTML = `<section class="hero"><div><p class="eyebrow">An adventure in understanding</p><h1>Small thinkers.<br>One giant moon mission.</h1><p>A mischievous moon shadow has scattered Vinschool’s lantern light. Your class can restore them—one discovery, discussion and clever choice at a time.</p><div class="row">${button('＋ Create a diagram game','new','primary')}${button('Try the senses example','sample')}</div></div>${mascot()}</section>
      ${works.size?`<h2>Your drafts</h2><div class="cards">${[...works.values()].map(d=>`<article class="card"><span class="pill">DRAFT · not ready for learners</span><h3>${esc(d.title)}</h3><button data-resume-draft="${esc(d.id)}">Continue draft</button></article>`).join('')}</div>`:''}
      <div class="row spread"><h2>Your adventures</h2><a class="button" href="/">Back to LessonScope</a></div>
      <div class="cards">${library.games.map(g => `<article class="card"><span class="pill">MOON FESTIVAL · ${g.questions} questions</span><h3 style="margin-top:18px">${esc(g.title)}</h3><p>${esc(g.subject)} · ${esc(g.grade)}</p><div class="row"><button data-edit="${g.id}">Edit</button><button class="primary" data-host="${g.id}">Set up class</button><button data-test="${g.id}">Test game</button><button data-duel-test="${g.id}">Test team duels</button></div></article>`).join('') || '<div class="panel"><h3>Your first mission starts with a diagram</h3><p class="muted">Upload a picture, mark answer areas and prepare your questions. No lesson plan is required.</p></div>'}</div>
      <h2 style="margin-top:25px">Saved sessions and results</h2><p class="muted">Answers save automatically as learners submit them. Class results stay here after a game ends and are separate from Marks. Practice sessions are labelled.</p><div class="stack">${library.sessions.map(s => `<article class="panel row spread"><div><strong>${esc(s.title)}</strong><p class="muted">${esc(s.className)} · ${s.test?'Practice · ':''}${esc(s.phase)} · ${esc(new Date(s.createdAt).toLocaleString())}</p><p>${s.savedAnswers||0} saved answers · ${s.completedRounds||0} completed questions</p></div><div class="row"><button data-session="${s.id}">Open room</button><button data-report="${s.id}">View saved results</button></div></article>`).join('') || '<p class="muted">Your class reports will appear here. MoonQuest does not change class averages.</p>'}</div>`;
  }
  let draftTimer, draftQueue=Promise.resolve();
  const draftVersions=new Map();
  function draftKey(id){return 'moonquest-work:'+library.teacherId+':'+id;}
  function localDrafts(){try{return Object.keys(localStorage).filter(k=>k.startsWith('moonquest-work:'+library.teacherId+':')).map(k=>JSON.parse(localStorage.getItem(k))).filter(Boolean);}catch{return [];}}
  function draftStatus(message){const el=document.getElementById('draft-status');if(el)el.textContent=message;}
  function checkpoint(){
    if(view!=='editor'||!library?.teacherId)return null;
    captureEditor();draft.workId ||= uid();
    const record={id:draft.workId,version:draftVersions.get(draft.workId)||0,payload:structuredClone(draft),updatedAt:Date.now(),editor:{activeDiagram,regionEditing,drawn:structuredClone(drawn),label:document.getElementById('region-label')?.value||'',shape:document.getElementById('shape')?.value||'rectangle',objective:document.getElementById('objective')?.value||'',bounds:['x','y','w','h'].map(k=>document.getElementById('region-'+k)?.value)}};
    try{localStorage.setItem(draftKey(record.id),JSON.stringify(record));draftStatus('Draft kept on this device · saving to your account…');}catch{draftStatus('Browser recovery unavailable · use Save draft before leaving.');}
    history.replaceState({},'', '/moonquest?draft='+record.id);
    clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveWork(record).catch(()=>{}),900);return record;
  }
  function saveWork(record){
    if(!record)return Promise.resolve();clearTimeout(draftTimer);
    const task=draftQueue.catch(()=>{}).then(async()=>{
      try{
        const result=await api('/drafts',{...record,version:draftVersions.get(record.id)||record.version||0});
        draftVersions.set(record.id,result.draft.version);
        let newerChanges=false;
        try{const latest=JSON.parse(localStorage.getItem(draftKey(record.id)));if(latest){newerChanges=latest.updatedAt>record.updatedAt;latest.version=result.draft.version;localStorage.setItem(draftKey(record.id),JSON.stringify(latest));}}catch{}
        if(draft?.workId===record.id&&!newerChanges)draftStatus('Draft saved to your account');
      }catch(err){if(draft?.workId===record.id)draftStatus('Not saved to account: '+err.message+' Use Save draft to retry.');throw err;}
    });draftQueue=task;return task;
  }
  async function openDraft(id){
    let local;try{local=JSON.parse(localStorage.getItem(draftKey(id)));}catch{}
    let saved;try{saved=(await api('/drafts/'+id)).draft;}catch(err){if(!local)throw err;}
    const record=local && (!saved || local.updatedAt>saved.updatedAt)?local:saved;
    draftVersions.set(id,record.version||0);draft=record.payload;draft.workId=id;
    activeDiagram=record.editor?.activeDiagram||0;regionEditing=record.editor?.regionEditing||null;editor();
    const e=record.editor||{};drawn=e.drawn||[];
    if(document.getElementById('drawing'))document.getElementById('drawing').setAttribute('points',drawn.map(p=>p.join(',')).join(' '));
    if(document.getElementById('region-label'))document.getElementById('region-label').value=e.label||'';
    if(document.getElementById('shape'))document.getElementById('shape').value=e.shape||'rectangle';
    document.getElementById('objective').value=e.objective||'';
    ['x','y','w','h'].forEach((k,i)=>{const el=document.getElementById('region-'+k);if(el&&e.bounds?.[i]!=null)el.value=e.bounds[i];});
    checkpoint();tell('Draft restored. You can continue where you left off.');
  }
  function emptyDraft() { return { title: 'Save the Moon Festival', subject:'', grade:'Grade 3', diagrams:[], questions:[], timing:{automatic:true,choose:25,discuss:15,reconsider:5}, reviewed:false }; }
  function imageUrl(asset) { return base + '/assets/' + asset; }
  function diagramHtml(d, selection, accepted = [], edit = false) {
    if (!d) return '<div class="panel"><p>Upload a diagram to begin.</p></div>';
    const scale=edit?1:1000;
    return `<div class="diagram" id="diagram"><img src="${imageUrl(d.asset)}" alt="${esc(d.title || 'Lesson diagram')}" draggable="false"><svg viewBox="0 0 ${scale} ${scale}" preserveAspectRatio="none" aria-label="${edit?'Draw answer areas':'Choose an answer area'}">${d.regions.map((r, i) => `<polygon data-region="${esc(r.id)}" points="${r.points.map(p=>p.map(v=>v*scale).join(',')).join(' ')}" class="${selectedIds(selection).includes(r.id)?'selected ':''}${accepted.includes(r.id)?'correct':''}" tabindex="${edit?'-1':'0'}" role="button" aria-label="${esc(r.label)}" aria-pressed="${selectedIds(selection).includes(r.id)}"><title>${i+1}. ${esc(r.label)}</title></polygon>`).join('')}<polygon class="draft" id="drawing" points=""></polygon></svg></div>`;
  }
  function captureEditor() {
    if (view !== 'editor') return;
    for (const key of ['title','subject','grade']) draft[key] = document.getElementById('mq-'+key)?.value || '';
    draft.objective = document.getElementById('objective')?.value || '';
    draft.timing.automatic = document.getElementById('automatic').checked;
    ['choose','discuss','reconsider'].forEach(k => { draft.timing[k] = Number(document.getElementById('time-'+k)?.value || draft.timing[k]); });
    draft.reviewed = !!document.getElementById('reviewed')?.checked;
    document.querySelectorAll('[data-question]').forEach(el => {
      const q = draft.questions.find(q => q.id===el.dataset.question); if (!q) return;
      ['prompt','concept','explanation'].forEach(k => { q[k] = el.querySelector('[data-field='+k+']').value; });
      q.answerMode = el.querySelector('[data-field=answerMode]').value;
      q.accepted = [...el.querySelectorAll('input[data-accepted]:checked')].map(x=>x.value);
    });
  }
  function editor() {
    document.body.dataset.view='editor';
    stopPoll(); view='editor'; drawn=[];drawing=false;
    const d=draft.diagrams[activeDiagram];
    const selectedRegion=d?.regions.find(r=>r.id===regionEditing);
    const bounds=selectedRegion?regionBounds(selectedRegion):null;
    root.innerHTML=`<div class="row spread"><div><p class="eyebrow">Mission workshop</p><h1 style="font-size:38px">Build a discovery.</h1></div><div>${button('Save draft','save-draft')}${button('Back to adventures','home')}<p id="draft-status" role="status" class="muted">Draft recovery enabled</p></div></div>
      <section class="panel grid"><label>Game title<input id="mq-title" maxlength="120" value="${esc(draft.title)}"></label><div class="grid"><label>Subject<input id="mq-subject" value="${esc(draft.subject)}"></label><label>Learner level<input id="mq-grade" value="${esc(draft.grade)}"></label></div></section>
      <section class="panel"><h2>1. Make your diagram clickable</h2><p class="muted">Upload a clear PNG, JPEG or WebP (up to 8 MB). Give each area a label, then draw it. Areas and labels should identify locations, without giving away the answer.</p>
      <div class="row"><label class="button">＋ Add diagram<input id="upload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${draft.diagrams.length?`<label>Current diagram<select id="diagram-select">${draft.diagrams.map((x,i)=>`<option value="${i}" ${i===activeDiagram?'selected':''}>${esc(x.title)} · ${x.regions.length} saved areas</option>`).join('')}</select></label>${button('Remove diagram','remove-diagram','danger')}`:''}</div>
      <p id="upload-status" role="status" aria-live="polite"></p><img id="upload-preview" alt="Selected diagram preview — uploading" hidden style="max-width:280px;max-height:280px;border-radius:12px">
      ${d?`<div class="editor" style="margin-top:20px"><div>${diagramHtml(d,regionEditing,[],true)}<p class="muted">Drag to draw a rectangle. Drag an existing area to move it; drag its corner handles to resize. Ellipses use two taps; custom outlines use corners.</p></div><div class="stack"><label>Area label<input id="region-label" placeholder="e.g. Eyes" maxlength="100" value="${esc(selectedRegion?.label||'')}"></label>${bounds?`<div class="grid">${['x','y','w','h'].map(k=>`<label>${{x:'Left',y:'Top',w:'Width',h:'Height'}[k]} %<input id="region-${k}" type="number" min="0" max="100" step="0.1" value="${(bounds[k]*100).toFixed(1)}"></label>`).join('')}</div><div class="row">${button('Apply area changes','update-region','primary')}${button('New area','new-area')}</div><p class="muted">Drag this area or its corner handles on the picture. Its linked answers are preserved.</p>`:''}<label>Shape<select id="shape"><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon">Custom outline</option></select></label><div class="row">${button('Finish area','finish-area','primary')}${button('Undo corner','undo-corner')}</div><div>${d.regions.map(r=>`<div class="row spread" style="margin-bottom:8px"><span>${esc(r.label)}</span><div class="row"><button class="small" data-edit-region="${esc(r.id)}">Edit</button><button class="small danger" data-delete-region="${esc(r.id)}">Remove</button></div></div>`).join('')}</div><p class="muted">Avoid overlapping areas. Learners can also use the labelled answer buttons below the diagram.</p></div></div>`:''}</section>
      <section class="panel"><h2>2. Prepare the challenges</h2><p class="muted">Give each question a clear objective and explanation. Choose whether one of the ticked areas is enough, or learners must select all of them. The instruction is shown on every learner screen.</p><label>Objective for AI suggestions<textarea id="objective" placeholder="e.g. Identify the sense used to receive information from a device.">${esc(draft.objective||'')}</textarea></label><div class="row" style="margin:15px 0">${button('＋ Write a question','add-question')}${button('AI draft 5 questions · '+(library?.generationCost||0)+' credits','draft-ai')}</div><p class="muted">AI drafts need your review. During play, up to two AI attempts per flagged question are included.</p>
      <div id="questions">${draft.questions.map((q,i)=>`<article class="question-card" data-question="${q.id}"><div class="row spread"><h3>Challenge ${i+1} · ${esc(draft.diagrams.find(d=>d.id===q.diagramId)?.title)}</h3><button data-delete-question="${q.id}" class="small danger">Remove</button></div><div class="stack"><label>Question<textarea data-field="prompt" maxlength="600">${esc(q.prompt)}</textarea></label><label>Learning objective<input data-field="concept" maxlength="300" value="${esc(q.concept)}"></label><label>How many areas should learners select?<select data-field="answerMode"><option value="one" ${q.answerMode!=='all'?'selected':''}>ONE area — any ticked answer is acceptable</option><option value="all" ${q.answerMode==='all'?'selected':''}>ALL ticked areas — the complete set is required</option></select></label><div><span class="muted">Correct areas</span><div class="row">${(draft.diagrams.find(d=>d.id===q.diagramId)?.regions||[]).map(r=>`<label><input type="checkbox" data-accepted value="${esc(r.id)}" ${q.accepted.includes(r.id)?'checked':''}> ${esc(r.label)}</label>`).join('')}</div></div><label>Explanation after reveal<textarea data-field="explanation" maxlength="800">${esc(q.explanation)}</textarea></label></div></article>`).join('')}</div></section>
      <section class="panel"><h2>3. Set the pace</h2><label><input id="automatic" type="checkbox" ${draft.timing.automatic!==false?'checked':''}> Automatic classroom flow (recommended)</label><p>One 25-second timer (learners can add 10 seconds once for the whole class) to choose, discuss and, if needed, change an answer. You decide when partner talk begins. A short answer reveal follows without another countdown. More than 30% incorrect triggers a class meeting; continue when the discussion is finished.</p><details><summary>Timing preferences for teacher-paced play</summary><div class="grid">${['choose','discuss','reconsider'].map(k=>`<label>${{choose:'First choice',discuss:'Partner discussion',reconsider:'Reconsider'}[k]} · seconds<input id="time-${k}" type="number" min="5" max="${k==='choose'?180:k==='discuss'?120:60}" value="${draft.timing[k]}"></label>`).join('')}</div></details><p class="muted">Answers lock when saved. Learners confirm before changing them. Initial choices and final answers remain separate in the report.</p><label><input id="reviewed" type="checkbox" ${draft.reviewed?'checked':''}> I have checked the diagrams, questions, accepted answers and explanations.</label><div class="row" style="margin-top:18px">${button('Save adventure','save','primary')}</div></section>`;
    document.getElementById('upload').onchange = uploadDiagram;
    if(d){document.getElementById('diagram-select').onchange=e=>{captureEditor();activeDiagram=Number(e.target.value);regionEditing=null;editor();};wireDiagramEditor();}
    checkpoint();
  }
  async function prepareDiagram(file) {
    // Reduce transfer size without changing the teacher's original file.
    const image = new Image(), url = URL.createObjectURL(file);
    try {
      image.src = url; await image.decode();
      if (image.naturalWidth * image.naturalHeight > 20000000) throw Error('Choose a diagram smaller than 20 megapixels.');
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.92));
      return blob && blob.size < file.size ? new File([blob], 'diagram.webp', {type: blob.type}) : file;
    } finally { URL.revokeObjectURL(url); }
  }
  function sendDiagram(file, show) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(), form = new FormData(); form.append('file', file);
      xhr.open('POST', base + '/assets'); xhr.timeout = 60000;
      let sent = false;
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) show('Uploading diagram… ' + Math.round(e.loaded / e.total * 100) + '%');
      };
      xhr.upload.onload = () => { sent = true; show('Image sent. LessonScope is processing your diagram…'); };
      xhr.onload = () => {
        let data; try { data = JSON.parse(xhr.responseText); } catch { return reject(Error('The upload server returned an unexpected response. Your lesson details are kept. Please try again.')); }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(Error(data.error || 'The diagram could not be saved. Please try again.'));
      };
      xhr.onerror = () => reject(Error('The upload connection was interrupted. Your lesson details are kept. Please try again.'));
      xhr.ontimeout = () => reject(Error(sent ? 'The image was sent, but LessonScope did not finish processing it in time. Your lesson details are kept. Please try again.' : 'The image transfer did not finish in time. Your lesson details are kept. Please try again.'));
      xhr.send(form);
    });
  }
  async function uploadDiagram(e) {
    const input=e.target,file=input.files?.[0];
    if(!file||uploadingDiagram)return;
    const status=document.getElementById('upload-status'),preview=document.getElementById('upload-preview');
    const targetDraft=draft;let previewUrl;
    const show=(message,error=false)=>{status.textContent=message;status.classList.toggle('error',error);};
    try {
      if(file.size>8*1024*1024)throw Error('This image is larger than 8 MB. Choose a smaller PNG, JPEG or WebP image.');
      if(!/\.(png|jpe?g|webp)$/i.test(file.name)&&!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP image.');
      captureEditor();uploadingDiagram=true;input.disabled=true;
      show('Uploading '+file.name+'… Please wait. Your lesson details are kept.');
      previewUrl=URL.createObjectURL(file);preview.src=previewUrl;preview.hidden=false;
      const prepared=await prepareDiagram(file);
      const a=await sendDiagram(prepared,show);
      if(!a.asset)throw Error('The image was not saved. Please choose it again.');
      show('Upload received. Loading your diagram…');
      const image=new Image();image.src=imageUrl(a.asset);
      let imageTimer;
      try{await Promise.race([image.decode(),new Promise((_,reject)=>{imageTimer=setTimeout(()=>reject(Error('The diagram could not load. Please try again.')),15000);})]);}finally{clearTimeout(imageTimer);}
      if(view!=='editor'||draft!==targetDraft)return;
      captureEditor();draft.diagrams.push({id:uid(),title:file.name.replace(/\.[^.]+$/,''),asset:a.asset,regions:[]});activeDiagram=draft.diagrams.length-1;dirty=true;draft.reviewed=false;editor();
      document.getElementById('upload-status').textContent='Diagram added. Enter an area label, then mark that area on the picture.';
      document.getElementById('diagram').scrollIntoView({block:'center',behavior:'smooth'});
    } catch(err) {
      const message=['TimeoutError','AbortError'].includes(err.name)?'The upload took too long. Check your connection and choose the image again. Your lesson details are still here.':err.message||'The diagram could not upload. Please try again.';
      show(message,true);preview.hidden=true;tell(message,true);
    } finally {
      uploadingDiagram=false;input.disabled=false;input.value='';if(previewUrl)URL.revokeObjectURL(previewUrl);
    }
  }
  function wireDiagramEditor() {
    const svg=document.querySelector('#diagram svg'),regions=draft.diagrams[activeDiagram].regions;
    const clamp=n=>Math.max(0,Math.min(1,n));
    const point=e=>{const b=svg.getBoundingClientRect();return [clamp((e.clientX-b.left)/b.width),clamp((e.clientY-b.top)/b.height)];};
    const polygon=r=>Array.from(svg.querySelectorAll('[data-region]')).find(el=>el.dataset.region===r.id);
    function handles(){
      svg.querySelector('[data-handles]')?.remove();const r=regions.find(r=>r.id===regionEditing);if(!r)return;
      const b=regionBounds(r),ns='http://www.w3.org/2000/svg',g=document.createElementNS(ns,'g');g.setAttribute('data-handles','');
      const box=svg.getBoundingClientRect(),w=18/Math.max(1,box.width),h=18/Math.max(1,box.height);
      for(const [key,x,y] of [['nw',b.x,b.y],['ne',b.x+b.w,b.y],['sw',b.x,b.y+b.h],['se',b.x+b.w,b.y+b.h]]){const el=document.createElementNS(ns,'rect');for(const [k,v] of Object.entries({x:x-w/2,y:y-h/2,width:w,height:h,'data-resize':key,fill:'#fff',stroke:'#147d69','stroke-width':.003}))el.setAttribute(k,v);el.style.cursor=key==='nw'||key==='se'?'nwse-resize':'nesw-resize';g.append(el);}svg.append(g);
    }
    handles();svg.style.touchAction='none';
    svg.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      const handle=e.target.closest('[data-resize]'),hit=e.target.closest('[data-region]');
      let r=regions.find(r=>r.id===(hit?.dataset.region||regionEditing));
      if(!hit&&!handle&&document.getElementById('shape').value!=='rectangle'){drawPoint(e);return;}
      captureEditor();e.preventDefault();const start=point(e),original=r?.points.map(p=>p.slice()),old=r&&regionBounds(r),creating=!hit&&!handle;
      if(creating){r=null;drawn=[];regionEditing=null;}else{regionEditing=r.id;document.getElementById('region-label').value=r.label;handles();}
      svg.setPointerCapture(e.pointerId);let moved=false;
      const move=event=>{
        const [x,y]=point(event),dx=x-start[0],dy=y-start[1];if(Math.abs(dx)+Math.abs(dy)>.005)moved=true;
        if(creating){drawn=[[start[0],start[1]],[x,start[1]],[x,y],[start[0],y]];svg.querySelector('#drawing').setAttribute('points',drawn.map(p=>p.join(',')).join(' '));return;}
        let b={...old};
        if(handle){const key=handle.dataset.resize,right=old.x+old.w,bottom=old.y+old.h;
          if(key.includes('w')){b.x=Math.min(x,right-.01);b.w=right-b.x;}else b.w=Math.max(.01,x-old.x);
          if(key.includes('n')){b.y=Math.min(y,bottom-.01);b.h=bottom-b.y;}else b.h=Math.max(.01,y-old.y);
        }else{b.x=Math.max(0,Math.min(1-old.w,old.x+dx));b.y=Math.max(0,Math.min(1-old.h,old.y+dy));}
        r.points=original.map(([px,py])=>[clamp(b.x+(px-old.x)/Math.max(.00001,old.w)*b.w),clamp(b.y+(py-old.y)/Math.max(.00001,old.h)*b.h)]);
        polygon(r).setAttribute('points',r.points.map(p=>p.join(',')).join(' '));handles();
      };
      const end=event=>{
        svg.removeEventListener('pointermove',move);svg.removeEventListener('pointerup',end);svg.removeEventListener('pointercancel',end);
        if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
        if(event.type==='pointercancel'){if(r)r.points=original;editor();return;}
        if(creating){if(!moved){drawn=[];return;}const b=regionBounds({points:drawn});if(b.w<.01||b.h<.01){drawn=[];svg.querySelector('#drawing').setAttribute('points','');tell('Draw a slightly larger rectangle.',true);return;}finishArea();checkpoint();}
        else{if(moved){draft.reviewed=false;dirty=true;}editor();}
      };
      svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
    });
  }
  function drawPoint(e) {
    if(view!=='editor')return;
    const svg=e.currentTarget, rect=svg.getBoundingClientRect();
    const p=[Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))];
    drawn.push(p);drawing=true;
    const shape=document.getElementById('shape').value;
    if(shape!=='polygon'&&drawn.length===2){const [[x1,y1],[x2,y2]]=drawn;drawn=shape==='rectangle'?[[x1,y1],[x2,y1],[x2,y2],[x1,y2]]:Array.from({length:32},(_,i)=>[(x1+x2)/2+Math.abs(x2-x1)/2*Math.cos(i*Math.PI/16),(y1+y2)/2+Math.abs(y2-y1)/2*Math.sin(i*Math.PI/16)]);finishArea();return;}
    document.getElementById('drawing').setAttribute('points',drawn.map(p=>p.join(',')).join(' '));
    checkpoint();
    tell(`${drawn.length} corner${drawn.length===1?'':'s'} placed${shape==='polygon'?'. Finish when the outline is complete.':'. Tap the opposite corner.'}`);
  }
  function finishArea() {
    const label=document.getElementById('region-label').value.trim();
    if(!label){checkpoint();tell('Name this area first.',true);return;}
    if(drawn.length<3){tell('Place the corners of an area first.',true);return;}
    captureEditor();const regions=draft.diagrams[activeDiagram].regions,existing=regions.find(r=>r.id===regionEditing);
    if(existing){existing.label=label;existing.points=drawn;}else regions.push({id:uid(),label,points:drawn});
    regionEditing=existing?.id||regions[regions.length-1].id;draft.reviewed=false;dirty=true;editor();
  }
  function regionBounds(r){const xs=r.points.map(p=>p[0]),ys=r.points.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys);return{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};}
  function updateRegion(){
    captureEditor();const r=draft.diagrams[activeDiagram].regions.find(r=>r.id===regionEditing);if(!r)return;
    const label=document.getElementById('region-label').value.trim(),old=regionBounds(r),n={};
    for(const k of ['x','y','w','h'])n[k]=Number(document.getElementById('region-'+k).value)/100;
    if(!label||Object.values(n).some(v=>!Number.isFinite(v)||v<0)||n.w<.01||n.h<.01||n.x+n.w>1.001||n.y+n.h>1.001)throw new Error('Name the area and keep its position and size inside the diagram.');
    r.points=r.points.map(([x,y])=>[Math.min(1,n.x+(x-old.x)/old.w*n.w),Math.min(1,n.y+(y-old.y)/old.h*n.h)]);r.label=label;dirty=true;draft.reviewed=false;regionEditing=null;editor();
  }
  async function sample() {
    tell('Preparing the senses example…');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="750" viewBox="0 0 800 750"><rect width="800" height="750" rx="30" fill="#f0f5fa"/><circle cx="400" cy="205" r="115" fill="#e8b58d"/><path d="M291 180Q275 65 400 65Q525 65 509 180Q452 121 400 132Q335 119 291 180" fill="#443633"/><ellipse cx="287" cy="217" rx="21" ry="33" fill="#e8b58d"/><ellipse cx="513" cy="217" rx="21" ry="33" fill="#e8b58d"/><ellipse cx="355" cy="197" rx="13" ry="18" fill="#283849"/><ellipse cx="445" cy="197" rx="13" ry="18" fill="#283849"/><path d="M370 265Q400 292 430 265" stroke="#81493a" stroke-width="6" fill="none"/><path d="M393 209L382 237L405 237" stroke="#bd805d" stroke-width="5" fill="none"/><path d="M321 319L480 319L510 490L288 490Z" fill="#5393ab"/><path d="M321 337L238 421L209 481M479 337L562 421L591 481" stroke="#e8b58d" stroke-width="40" stroke-linecap="round" fill="none"/><ellipse cx="201" cy="498" rx="28" ry="35" fill="#e8b58d"/><ellipse cx="599" cy="498" rx="28" ry="35" fill="#e8b58d"/><path d="M340 486L327 642M459 486L472 642" stroke="#394862" stroke-width="60"/><path d="M327 652L289 665M472 652L510 665" stroke="#263244" stroke-width="42" stroke-linecap="round"/><text x="400" y="725" text-anchor="middle" fill="#385269" font-size="22" font-family="sans-serif">Explore how we sense the world</text></svg>`;
    const blob=new Blob([svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=800;canvas.height=750;canvas.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const form=new FormData();form.append('file',png,'senses.png');const uploaded=await api('/assets',form);
    draft=emptyDraft();draft.subject='Science / ICT';const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
    const d={id:uid(),title:'Human senses',asset:uploaded.asset,regions:[{id:'eyes',label:'Eyes',points:rect(.40,.225,.2,.065)},{id:'left-ear',label:'Left ear',points:rect(.33,.24,.058,.1)},{id:'right-ear',label:'Right ear',points:rect(.612,.24,.058,.1)},{id:'left-hand',label:'Left hand / skin',points:rect(.205,.61,.095,.11)},{id:'right-hand',label:'Right hand / skin',points:rect(.70,.61,.095,.11)}]};
    draft.diagrams=[d];
    draft.questions=[['A watch vibrates on your wrist. Which part senses the vibration?',['left-hand','right-hand'],'Touch detects vibration through the skin.'],['A lantern changes colour. Which part notices the change?',['eyes'],'Our eyes detect light and colour.'],['You hear music at the festival. Which part receives the sound?',['left-ear','right-ear'],'Our ears receive sound.'],['A phone buzzes in your hand without making a sound. Which part feels it?',['left-hand','right-hand'],'Skin detects the vibration even when there is no sound.'],['You read a message on a screen. Which part receives this information?',['eyes'],'Eyes receive the light from the screen so we can see the message.']].map(([prompt,accepted,explanation])=>({id:uid(),diagramId:d.id,prompt,accepted,explanation,concept:'Identify the sense used to receive information.'}));
    activeDiagram=0;dirty=true;editor();tell('Review this example, confirm the answers, then save and test it.');
  }
  async function setup(id) {
    const g=(await api('/games/'+id)).game;view='setup';
    root.innerHTML=`<section class="intro">${mascot()}<p class="eyebrow">Assemble your crew</p><h1>${esc(g.title)}</h1><p>Choose one class for this mission. Each learner selects their name and enters their usual PIN.</p><div class="panel stack"><label>How will your class play?<select id="host-mode"><option value="duels">Team Duels · everyone plays an opponent</option><option value="royale">Battle Royale · three lives, then spectate</option><option value="cooperative">Cooperative · restore the festival together</option></select></label><label>Class<select id="host-class">${library.rosters.map(r=>`<option value="${r.id}">${esc(r.name)} · ${r.count} learners</option>`).join('')}</select></label><button class="primary" data-start="${id}" ${library.rosters.length?'':'disabled'}>Create classroom room</button><button data-test="${id}">Test with practice learners</button></div>${button('Back','home')}</section>`;
  }
  async function launch(id,test=false) {
    const response=await api('/games/'+id+'/sessions',{test,mode:document.getElementById('host-mode')?.value||'cooperative',rosterId:document.getElementById('host-class')?.value});await openSession(response.id,'teacher');
  }
  async function openSession(id,audience) {
    stopPoll();view='live';sessionId=id;role=audience;state=null;lastRender='';presenterAvailable=false;
    if(role==='board'){try{const access=await api('/sessions/'+id+'/presenter');presenterAvailable=access.canControl===true;}catch{}}
    nav('/moonquest?session='+id+(role==='board'?'&board='+encodeURIComponent(new URLSearchParams(location.search).get('board')||''):''));await poll();
  }
  async function poll() {
    if(view!=='live'||polling)return;
    polling=true;
    const requestedSession=sessionId,requestedRole=role;
    try{
      const url='/sessions/'+sessionId+(role==='teacher'?'/teacher':presenterAvailable?'/presenter':'/state'+(role==='board'?'?board='+encodeURIComponent(new URLSearchParams(location.search).get('board')):''));
      const next=await api(url);if(view!=='live'||sessionId!==requestedSession||role!==requestedRole)return;clockOffset=next.serverNow-Date.now();
      if(state&&next.seq<state.seq)return;
      state=next;
      const key=role==='student'?JSON.stringify([state.round,state.phase,state.paused,state.deadline,state.mine,state.canAnswer,state.stats,state.story,state.reward,state.duels]):[state.seq,role,state.duels?.presentation].join(':');
      if(key!==lastRender){renderLive();lastRender=key;}const c=document.getElementById('connection');if(c){c.textContent='Connected';c.classList.remove('interrupted');}
      if(role==='teacher'&&!state.test){
        const queued=state.queue.find(q=>q.status==='needs-review'&&!q.suggestion&&!q.attempts&&!autoSuggestions.has(q.id));
        if(queued){autoSuggestions.add(queued.id);api('/sessions/'+sessionId+'/suggest',{queueId:queued.id},{timeout:25000}).then(()=>{lastRender='';}).catch(()=>tell('A later challenge needs your input. You can write it or retry AI while the class continues.'));}
      }
    }catch(e){lastRender='';const c=document.getElementById('connection');if(c){c.textContent='Reconnecting… Your saved answer is safe.';c.classList.add('interrupted');}else {root.innerHTML=`<section class="intro"><h1>Let’s reconnect.</h1><p>${esc(e.message)}</p><div class="row"><a class="button" href="/moonquest/join">Rejoin as a learner</a><a class="button" href="/">Teacher sign-in</a></div></section>`;}document.querySelectorAll('[data-region-answer]').forEach(b=>b.disabled=true);}
    finally{polling=false;if(view==='live')pollTimer=setTimeout(poll,1100);}
  }
  function presenterControls(s) {
    if(role==='student')return '';
    const owner=role==='teacher'||s.canControl;
    if(!owner)return s.paused?`<p class="board-signin">Paused for teaching. <a class="button" href="/moonquest?session=${s.id}">Open signed-in teacher controls</a></p>`:'';
    return `<div class="teacher-transport control presenter-controls" aria-label="Presentation controls">${s.phase==='lobby'&&s.joinOpen!==false?button('Begin mission','launch','primary'):''}${s.phase==='intro'&&!s.paused?button('Skip intro','skip-intro'):''}${s.phase==='story-action'&&!s.paused?button('Skip scene','skip-story'):''}${!['lobby','ended'].includes(s.phase)?button(s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'Continue after discussion':s.paused?'Resume':'Pause',s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'continue-meeting':'pause'):''}${s.deadline&&!s.singleTimer&&s.phase!=='intro'?button('+10 seconds','extend'):''}</div>`;
  }
  function storyScene(s) {
    return `${presenterControls(s)}<div class="tale-opening-wrap">${MoonStory.film(s,role,duelRabbit,'intro')}<p class="story-status">${s.paused?'Story paused':'Your mission begins when the story ends.'}</p><span id="timer" class="timer" role="timer"></span></div>`;
  }
  function liveControls() {
    const s=state;
    return `<aside class="teacher-private"><div class="panel"><span class="eyebrow">Teacher controls · private</span><div class="control" style="margin-top:12px">${s.joinOpen!==false&&!s.paused&&(s.phase==='lobby'||s.phase==='reveal')?button(s.phase==='lobby'?'Begin mission':'Next question',s.phase==='lobby'?'launch':'next','primary'):''}${s.phase==='read'?button('Open answers','open','primary'):''}${!s.automatic&&['choose','discuss','reconsider'].includes(s.phase)?button({choose:'Begin discussion',discuss:'Reconsider',reconsider:'Reveal answer'}[s.phase],'advance','primary'):''}${!['lobby','ended'].includes(s.phase)?button(s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'Continue after discussion':s.paused?'Resume':'Pause',s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'continue-meeting':'pause'):''}${s.deadline&&!s.singleTimer?button('+10 seconds','extend'):''}</div>
      ${s.teachingPause?`<p class="teaching-alert">${s.teachingPause==='misconception'?'Class meeting discussion. Ask learners to explain their reasoning, then continue when the class is ready.':s.teachingPause==='attendance'?'No learners are currently included. Include learners below before resuming.':'Some answers are missing. Check devices and understanding before continuing.'}</p>`:''}${s.automatic?'<p class="muted">One round timer. Invite partner discussion before it runs out. Continue after a class meeting when you are ready.</p>':''}${s.recovered?'<p class="error">Session recovered safely and paused. Resume when the class is ready.</p>':''}
      ${s.phase!=='ended'&&s.joinOpen!==false?`<div class="learner-invite"><label>${s.test?'Practice link':'Learner game link'}<input id="learner-link" readonly value="${esc(location.origin+'/moonquest/join?code='+s.code)}"></label>${button(s.test?'Copy practice link':'Copy learner link','copy-learner-link','primary')}<p class="muted">${s.test?'Practice only: opens without a name or PIN.':'Send this link to your class. Learners select their name and enter their usual PIN. No room code to type.'}</p></div>`:''}
      <div class="row"><a class="button small" target="_blank" rel="noopener noreferrer" href="/moonquest?session=${s.id}&board=${s.boardToken}">Open Smartboard</a>${button('Replace board link','rotate-board','small')}</div>
      <p class="muted">Keep this teacher view off the projector. The Smartboard shows names and response status, but keeps individual answers and private suggestions hidden.</p>
      ${s.test?`<p class="muted">Scan the QR to join as a practice learner—no name or PIN. Simulation fills only the remaining practice learners.</p><a class="button small" target="_blank" rel="noopener" href="/moonquest/join?code=${s.code}">Open practice learner</a>`:''}
      ${s.test&&['choose','reconsider'].includes(s.phase)?`<div class="stack">${button('Simulate learner answers','simulate')}${button('Simulate a misconception','simulate-misconception')}</div>`:''}
      <div class="row" style="margin-top:12px">${button('Share analysis report','observer-link','small')}${button('Withdraw report access','observer-revoke','small')}${button('View report','report','small')}${s.phase!=='ended'?button('Finish mission','end','small'):''}${button('Adventures','home','small')}</div></div>
      ${s.unansweredLearners?.length?`<section class="panel unanswered-private"><h3>No answer received · ${s.unansweredLearners.length}</h3><p class="muted">Private teacher list · question ${s.unansweredRound+1}</p><ul>${s.unansweredLearners.map(l=>`<li>${esc(l.name)}</li>`).join('')}</ul></section>`:''}
      <div class="panel"><h3>Crew check-in · ${s.joined}/${s.learners.filter(l=>!l.removed).length}</h3><p class="muted">${s.phase==='reconsider'?'✓ means confirmed during reconsideration. The first choice is kept otherwise.':'✓ means a first choice has been saved.'}</p><p class="muted">Remove learners from this mission only. Saved answers and class rosters are kept. Add them back for a later round.</p><div class="learners">${s.learners.map(l=>`<div class="learner ${l.answered?'has-answered':''}"><span>${s.phase==='reconsider'?l.confirmed?'✓':'○':l.answered?'✓':l.joined?'●':'○'} ${esc(l.name)} ${l.removed?'· removed':l.absent?'· away':''}</span><button data-remove-learner="${esc(l.id)}" data-removed="${!l.removed}">${l.removed?'Add back':'Remove'}</button>${!l.removed&&l.joined&&['lobby','reveal'].includes(s.phase)?`<button data-attendance="${esc(l.id)}" data-absent="${!l.absent}">${l.absent?'Include':'Away'}</button>`:''}</div>`).join('')}</div></div>
      <div id="queue-panel"></div></aside>`;
  }
  function duelRabbit(style='scarf',team=0){
    const coat=team===0?'#d1f2df':'#fff0c2',trim=team===0?'#53bda1':'#dba552';
    let accessory=style==='bow'?'<path d="M58 31Q28 10 31 43L57 36Q85 13 83 44Z" fill="#ef719e" stroke="#8e365c" stroke-width="2"/><circle cx="58" cy="34" r="6" fill="#ffc5d8"/>':style==='star'?'<path d="M92 57L96 65L106 66L99 73L101 82L92 77L84 82L85 73L78 66L88 65Z" fill="#ffcf54" stroke="#b97b2f" stroke-width="2"/>':'<path d="M35 104Q60 116 88 104L85 118L70 117L79 139L65 143L57 118L38 117Z" fill="#5faadc"/>';
    const costumes={
      blossom:'<g fill="#ff98bb" stroke="#bd527e" stroke-width="1.5"><circle cx="82" cy="48" r="9"/><circle cx="95" cy="47" r="9"/><circle cx="99" cy="60" r="9"/><circle cx="87" cy="67" r="9"/><circle cx="77" cy="59" r="9"/></g><circle cx="88" cy="56" r="6" fill="#ffeb8f"/><path d="M77 113Q61 122 40 112L37 121Q62 135 83 120Z" fill="#e686b0"/>',
      explorer:'<path d="M26 62Q26 34 62 38Q90 34 94 62Z" fill="#c99862" stroke="#755237" stroke-width="2"/><path d="M30 52H89V61H30Z" fill="#5b9f8a"/><ellipse cx="60" cy="63" rx="46" ry="6" fill="#e5ba7e" stroke="#755237" stroke-width="2"/><path d="M33 111L81 147" stroke="#a26a3f" stroke-width="7"/><rect x="70" y="132" width="24" height="20" rx="5" fill="#c99862" stroke="#755237" stroke-width="2"/>',
      astronomer:'<g fill="none" stroke="#7564b5" stroke-width="4"><circle cx="42" cy="79" r="13"/><circle cx="78" cy="79" r="13"/><path d="M55 78Q60 74 65 78M29 77L23 73M91 77L97 73"/></g><path d="M36 108Q60 119 86 108L80 122L61 117L39 123Z" fill="#7666bd"/><path d="M86 42A12 12 0 1 0 100 57A10 10 0 0 1 86 42" fill="#ffe58f"/>',
      headphones:'<path d="M23 80V70Q22 39 60 39Q99 39 98 71V81" fill="none" stroke="#6755bb" stroke-width="9"/><rect x="17" y="71" width="14" height="25" rx="7" fill="#ab99ef" stroke="#564398" stroke-width="2"/><rect x="90" y="71" width="14" height="25" rx="7" fill="#ab99ef" stroke="#564398" stroke-width="2"/><path d="M90 93Q92 111 73 105" fill="none" stroke="#6755bb" stroke-width="3"/><circle cx="72" cy="105" r="4" fill="#ffd57e"/>',
      crown:'<path d="M35 53L30 29L48 39L60 22L72 39L91 29L85 53Z" fill="#f5cb64" stroke="#a57732" stroke-width="2"/><path d="M36 49H85V57H36Z" fill="#efad65"/><circle cx="60" cy="42" r="5" fill="#8de1d0"/><circle cx="42" cy="44" r="3" fill="#e98eaf"/><circle cx="79" cy="44" r="3" fill="#e98eaf"/>',
      leaf:'<path d="M32 59Q26 38 52 35Q57 51 32 59M48 47Q44 25 72 26Q72 45 48 47M67 44Q76 22 96 36Q91 53 67 44" fill="#67b28c" stroke="#327961" stroke-width="2"/><path d="M32 60Q54 39 84 41" fill="none" stroke="#d5e9a1" stroke-width="3"/><path d="M37 111Q61 120 84 109L77 125L61 118L44 129Z" fill="#66ae80"/>'
    };
    accessory=costumes[style]||accessory;
    const characterNames={blossom:'Peach Blossom rabbit',explorer:'Trail Scout rabbit',astronomer:'Moon Scholar rabbit',headphones:'Festival DJ rabbit',crown:'Lantern Royal rabbit',leaf:'Bamboo Guardian rabbit'};
    const id='rabbit-'+uid();
    return `<svg class="duel-rabbit" viewBox="0 0 120 170" role="img" aria-label="${characterNames[style]||(style==='bow'?'Rabbit with a pink bow':style==='star'?'Rabbit with a golden star':'Rabbit with a blue scarf')}"><defs><radialGradient id="${id}-fur" cx="35%" cy="25%" r="85%"><stop stop-color="#ffffff"/><stop offset=".58" stop-color="${coat}"/><stop offset="1" stop-color="${trim}"/></radialGradient><linearGradient id="${id}-ear" x2="1" y2="1"><stop stop-color="#ffdee7"/><stop offset="1" stop-color="#d77f9f"/></linearGradient><radialGradient id="${id}-gem"><stop stop-color="#fff9d1"/><stop offset=".5" stop-color="#ffd86c"/><stop offset="1" stop-color="#e79b31"/></radialGradient></defs><ellipse class="rabbit-ground" cx="60" cy="158" rx="34" ry="6" fill="#04102366"/><g class="rabbit-body"><g class="rabbit-ears"><ellipse cx="43" cy="37" rx="13" ry="33" fill="url(#${id}-fur)" stroke="${trim}" stroke-width="1.2" transform="rotate(-13 43 37)"/><ellipse cx="78" cy="35" rx="12" ry="34" fill="url(#${id}-fur)" stroke="${trim}" stroke-width="1.2" transform="rotate(12 78 35)"/><ellipse cx="43" cy="35" rx="6" ry="23" fill="url(#${id}-ear)" transform="rotate(-13 43 37)"/><ellipse cx="78" cy="33" rx="5" ry="24" fill="url(#${id}-ear)" transform="rotate(12 78 35)"/></g><circle cx="91" cy="130" r="13" fill="#fff9eb"/><ellipse cx="60" cy="125" rx="29" ry="31" fill="url(#${id}-fur)" stroke="${trim}"/><ellipse cx="60" cy="128" rx="19" ry="23" fill="#fffef1cc"/><ellipse cx="37" cy="150" rx="18" ry="10" fill="url(#${id}-fur)"/><ellipse cx="81" cy="150" rx="18" ry="10" fill="url(#${id}-fur)"/><ellipse cx="36" cy="151" rx="9" ry="4" fill="#ecafbb88"/><ellipse cx="83" cy="151" rx="9" ry="4" fill="#ecafbb88"/><path d="M24 69Q24 36 58 42Q91 34 99 71Q109 106 66 112Q20 113 24 69" fill="url(#${id}-fur)" stroke="${trim}" stroke-width="1"/><path d="M46 46Q52 31 57 45Q64 31 67 44" fill="#fffef4"/><ellipse cx="60" cy="94" rx="22" ry="13" fill="#fffdf3"/><g class="rabbit-eyes"><ellipse cx="42" cy="78" rx="7" ry="10" fill="#182b42"/><ellipse cx="78" cy="78" rx="7" ry="10" fill="#182b42"/><circle cx="40" cy="74" r="3" fill="white"/><circle cx="76" cy="74" r="3" fill="white"/><circle cx="45" cy="81" r="1.5" fill="#aee5ec"/><circle cx="81" cy="81" r="1.5" fill="#aee5ec"/></g><ellipse cx="31" cy="92" rx="9" ry="5" fill="#eea2b277"/><ellipse cx="89" cy="92" rx="9" ry="5" fill="#eea2b277"/><path d="M55 91Q60 87 65 91L60 96Z" fill="#bb7993"/><path class="rabbit-smile" d="M60 96Q54 106 49 99M60 96Q66 106 72 99" fill="none" stroke="#805b72" stroke-width="2" stroke-linecap="round"/><ellipse class="rabbit-surprise" cx="60" cy="101" rx="3" ry="4" fill="#805b72"/>${accessory}<ellipse class="rabbit-arm-left" cx="37" cy="121" rx="10" ry="15" fill="url(#${id}-fur)" transform="rotate(-28 37 121)"/><ellipse class="rabbit-arm-right" cx="83" cy="121" rx="10" ry="15" fill="url(#${id}-fur)" transform="rotate(28 83 121)"/><circle class="rabbit-moon-gem" cx="60" cy="130" r="10" fill="url(#${id}-gem)" stroke="#fff2b5" stroke-width="2"/><path d="M60 122L62 128L68 130L62 132L60 138L58 132L52 130L58 128Z" fill="#fffbe0"/></g></svg>`;

  }
  function duelPanel(s){
    const d=s.duels;if(!d)return '';
    const me=d.me,ended=s.phase==='ended',result=d.result;
    if(role==='student'&&!ended){
      if(s.phase==='lobby')return `<section class="duel-lobby"><h2>${esc(d.teams[me.team].name)}</h2><p>Choose your rabbit</p>${s.test?'<p>Testing alone? Pip the computer rabbit will join your duel automatically.</p>':''}<div class="rabbit-picker">${(d.styles||[{id:'bow',name:'Pink bow'},{id:'scarf',name:'Blue scarf'},{id:'star',name:'Golden star'}]).map(({id:style,name})=>`<button data-avatar="${style}" aria-label="${esc(name)}" aria-pressed="${me.avatar===style}">${duelRabbit(style,me.team)}<span>${esc(name)}</span></button>`).join('')}</div><p>Correct: 100 points · Faster correct: +20 · Changing your answer removes the speed bonus.</p></section>`;
      return `<div class="duel-strip ${result?'duel-'+result.outcome:''}">${duelRabbit(me.avatar,me.team)}<div><strong>${result?({win:'You won this duel!',draw:'A shared victory!',close:'Correct! Your rival was quicker.',learn:'Your next discovery awaits.',practice:'Keep practising!'})[result.outcome]:'You vs '+esc(d.opponents.map(o=>o.name).join(' & ')||'the challenge')}</strong><small>${result?result.points+' points'+(result.bonus?' · +20 speed bonus included':'')+' for your crew':esc(d.teams[me.team].name)+' · '+((d.matchups?.[0]?.players||[]).filter(p=>p.team!==me.team).every(p=>p.answered)?'Opponent locked in':'Opponent thinking…')}</small></div>${duelRabbit(d.opponents[0]?.avatar||'star',1-me.team)}</div>`;
    }
    return `<section class="duel-race"><h2>${ended?(d.winner===null?'Both crews are Festival Champions!':esc(d.teams[d.winner].name)+' · Festival Champions!'):'Race to light the Moon Festival'}</h2><div class="race-crews">${d.teams.map((t,i)=>`<div class="race-crew crew-${i}"><strong>${esc(t.name)}</strong><span>${t.points} moon points</span><div class="race-track"><div class="race-glow" style="width:${t.progress}%"></div><div class="race-runner" style="left:${Math.min(88,t.progress)}%">${duelRabbit(i?'bow':'scarf',i)}</div><span class="race-finish">${festivalLantern(i)}</span></div></div>`).join('')}</div><p>Every answer counts · Team points averaged per participating learner each round.</p>${ended&&d.personal?`<p class="personal-contribution">You earned ${d.personal.points} points with ${d.personal.correct} correct answers. Thank you, festival hero!</p>`:''}${s.phase==='lobby'&&d.assignments?`${!s.test?`<p class="muted">${esc(s.teamSetup?.source||'Current mission teams')}. ${s.teamSetup?.needsReview?`${s.teamSetup.needsReview} learners need a team review. `:''}Review below, then save to reuse this membership in future games.</p>${button('Replace saved class teams','remember-teams','small')}`:''}<details><summary>Adjust teams before starting</summary><div class="team-assignments">${d.assignments.map(st=>`<label>${esc(st.name)}<select data-team-student="${esc(st.id)}"><option value="0" ${st.team===0?'selected':''}>Jade Rabbits</option><option value="1" ${st.team===1?'selected':''}>Golden Rabbits</option></select></label>`).join('')}</div></details>`:''}</section>`;
  }
  function matchupCards(s,large=false){
    return `<div class="matchup-arena ${large?'matchup-large':''}">${(s.duels.matchups||[]).map(g=>`<article class="matchup-card"><span class="eyebrow">${g.players.length===2?'MOON DUEL':g.players.length>2?g.players.length+' HERO SHOWDOWN':'SOLO CHALLENGE'}</span><div class="matchup-players">${g.players.map((p,i)=>`${i?'<b class="versus-mark">VS</b>':''}<div class="duel-hero team-${p.team} ${g.winners?.includes(p.id)?'duel-victor':''}">${duelRabbit(p.avatar,p.team)}<strong>${esc(p.name)}</strong><span>${g.winners?g.winners.includes(p.id)?'✦ '+p.points+' points':p.correct?'Correct · '+p.points+' points':'Keep discovering':s.phase==='matchup'?'Ready to shine':p.answered?'✓ Answer locked':'Thinking…'}</span></div>`).join('')}</div>${g.winners?`<h2 class="duel-verdict">${g.winners.length?g.players.filter(p=>g.winners.includes(p.id)).map(p=>esc(p.name)).join(' & ')+(g.winners.length>1?' share the victory!':' wins!'):'Learn together. Shine next round.'}</h2><p>${esc(g.reason)}</p>`:''}</article>`).join('')}</div>`;
  }
  function duelCinema(s){
    const stage=s.duels.presentation;
    if(stage==='result')return `${role!=='student'?presenterControls(s):''}<section class="victory-screen duel-cinema stage-result"><p class="eyebrow">ROUND ${s.round+1} · DUEL RESULTS</p><h1>${role==='student'&&s.duels.result?.outcome==='win'?'You won the duel!':'Our duel champions'}</h1>${matchupCards(s,role==='student')}<p class="duel-explanation">${esc(s.question.explanation)}</p>${rabbitTimer()}</section>`;
    return `${role!=='student'?presenterControls(s):''}<section class="duel-cinema ${role!=='student'?'duel-cinema-board':''} stage-${stage}"><p class="eyebrow">MOON FESTIVAL · ROUND ${s.round+1}</p><h1>${stage==='matchup'?'Meet your rival':stage==='result'?'The duel is decided!':'Your sparks light Vinschool'}</h1>${stage==='sparks'?schoolScene(s):matchupCards(s,role==='student')}${stage==='result'?`<p class="duel-explanation"><strong>${esc((s.diagram?.regions||[]).filter(r=>s.question.accepted?.includes(r.id)).map(r=>r.label).join(' + '))}</strong><br>${esc(s.question.explanation)}</p>`:''}${stage==='matchup'?'<p>Accuracy first. Then speed. Everyone plays.</p>':stage==='sparks'?duelPanel(s):lightingMeter(s)}${rabbitTimer()}</section>`;
  }
  function duelBoard(s){
    const reveal=s.phase==='reveal';
    return `<div class="duel-board-toolbar">${presenterControls(s)}<span>${s.test?'Practice mission':'Moon Festival Team Duels'} · ${s.answered}/${s.expected} answered</span><div class="duel-media"><button data-duel-media="sound">${soundEnabled?'Sound on':'Sound off'}</button><button data-duel-media="music">${musicEnabled?'Music on':'Music off'}</button><button data-duel-media="full">Full screen</button></div></div><section class="learner-question"><div class="question-focus"><span class="question-label">QUESTION ${s.round+1}</span><h1>${esc(s.question.prompt)}</h1></div>${rabbitTimer()}</section>${duelPanel(s)}<section class="duel-board-bottom">${reveal?` ${schoolScene(s)}<div class="duel-feedback"><div class="lighting-answer-diagram">${diagramHtml(s.diagram,null,s.question.accepted||[])}</div><h2>${s.paused?'Class meeting discussion':s.lighting?.gain?'The lanterns are lighting up!':'A discovery for our next try.'}</h2><p>${esc(s.question.explanation)}</p><strong>${s.stats.correct} correct · ${s.stats.wrong} incorrect · ${s.stats.unanswered} unanswered</strong></div>`:`${schoolScene(s)}<div class="duel-feedback"><h2>${s.paused?'Paused for discussion':s.answered+'/'+s.expected+' answered'}</h2><p>Choose carefully. Every correct answer helps your crew.</p></div>${matchupCards(s)}`}</section>`;
  }
  document.addEventListener('change',async e=>{if(e.target.dataset.teamStudent){try{await command('set-team',{studentId:e.target.dataset.teamStudent,team:Number(e.target.value)});}catch(err){tell(err.message,true);}}});
  function learnerQuestion(s,selected,answerOpen) {
    const reveal=s.phase==='reveal', locked=!!s.mine?.first&&!changingAnswer;
    return `<section class="learner-question"><div class="question-focus"><span class="question-label">QUESTION ${s.round+1}</span><h1>${esc(s.question.prompt)}</h1></div>${rabbitTimer()}${lightingMeter(s)}</section>
      ${s.duels?duelPanel(s):''}<p class="learner-prompt">${s.paused?'Class meeting discussion':reveal?(s.myCorrect?'You found it!':'Let’s discover the answer.'):answerInstruction(s.question)}</p>
      <section class="learner-workspace"><div class="learner-picture">${diagramHtml(s.diagram,selected,s.question.accepted||[])}</div><aside class="learner-answer-tools">
      <div class="region-list">${s.diagram.regions.map(r=>`<button data-region-answer="${esc(r.id)}" aria-pressed="${selectedIds(selected).includes(r.id)}" class="${selectedIds(selected).includes(r.id)?'selected ':''}${s.question.accepted?.includes(r.id)?'correct':''}" ${!answerOpen?'disabled':''}>${selectedIds(selected).includes(r.id)?'✓ ':''}${esc(r.label)}</button>`).join('')}</div>
      <div id="answer-status" class="answer-status" role="status">${reveal?esc(s.question.explanation):locked?(s.duels?'Answer locked in ✓ · Waiting for the duel reveal':'Answer locked in ✓'):pendingChoices.length?answerProgress(pendingChoices.length,s.question.selectionCount):changingAnswer?answerInstruction(s.question)+'.':'Tap the picture to choose.'}</div>
      ${!reveal&&!s.paused&&s.canAnswer?`<div class="answer-actions">${locked?button('Change my answer','change-answer'):s.question.selectionCount>1?`<button data-action="lock-answer" class="primary" ${pendingChoices.length!==s.question.selectionCount?'disabled':''}>Lock in my answers</button>`:''}${changingAnswer?button('Keep my saved answer','cancel-change'):''}${s.singleTimer&&s.phase==='choose'?`<button data-action="request-time" ${s.extraTimeUsed?'disabled':''}>${s.extraTimeUsed?'10 extra seconds added':'Need more time'}</button>`:''}</div>`:''}</aside></section>`;
  }
  function teamSetupChoices(s) {
    const setup=s.teamSetup||{}, saved=setup.savedGroups||[];
    return `<div class="panel"><h2>How would you like to make the two sides?</h2><p>${esc(setup.choice==='saved'?'Using saved class teams':setup.choice==='random'?'Using two random teams':'Choose a setup, then check the learner list below.')}</p>
      <h3>1. Use saved class teams</h3>${saved.length?`<p>Keep teammates together. Choose a MoonQuest side for each saved team.</p><div class="team-assignments">${saved.map(g=>`<label>${esc(g.name)} · ${g.count} learners<select data-saved-team="${esc(g.id)}"><option value="0" ${g.side===0?'selected':''}>Team 1 · Jade Rabbits</option><option value="1" ${g.side===1?'selected':''}>Team 2 · Golden Rabbits</option></select></label>`).join('')}</div>${button('Use saved class teams','use-saved-teams')}`:'<p>No saved teams for this class yet.</p>'}
      <h3>2. Create two random teams</h3><p>Make a balanced split for this game. You can move learners afterwards.</p>${button(setup.choice==='random'?'Shuffle random teams again':'Create two random teams','shuffle-teams')}
      <p>Your saved class teams will only change if you click “Replace saved class teams”.</p></div>`;
  }
  function teamLobby(s) {
    const teacher=role==='teacher', groups=[0,1].map(team=>(s.teamRoster||[]).filter(st=>st.team===team));
    const cell=st=>!st?'':`<div class="team-person ${st.removed?'is-absent':''}"><strong>${esc(st.name)}</strong><span>${st.removed?'Absent':st.joined?'Signed in ✓':'Not signed in'}</span>${teacher?`<button data-remove-learner="${esc(st.id)}" data-removed="${!st.removed}">${st.removed?'Mark present':'Mark absent'}</button><select aria-label="Team for ${esc(st.name)}" data-team-student="${esc(st.id)}"><option value="0" ${st.team===0?'selected':''}>Team 1</option><option value="1" ${st.team===1?'selected':''}>Team 2</option></select>`:''}</div>`;
    return `<section class="panel team-setup"><p class="eyebrow">${esc(s.className)} · MoonQuest duels</p><h1>${s.joinOpen?'Meet your teams':'Choose teams before sign-in'}</h1><p>${s.joinOpen?'Find your name below, then sign in using the link or QR code.':'Learner sign-in is closed while your teacher checks the teams and attendance.'}</p>${teacher?`<p>Absence applies to this game only. Your saved class teams and roster keep every learner.</p>${!s.joinOpen?teamSetupChoices(s)+(s.teamSetup?.requiresChoice&&!s.teamSetup.choice?'':button('Confirm teams & open sign-in','open-joining','primary')):button('Replace saved class teams','remember-teams','small')}`:''}<table class="team-plan"><thead><tr>${groups.map((g,i)=>`<th scope="col">Team ${i+1} · ${i?'Golden Rabbits':'Jade Rabbits'}<small>${g.filter(st=>!st.removed).length} present</small></th>`).join('')}</tr></thead><tbody>${Array.from({length:Math.max(...groups.map(g=>g.length))},(_,i)=>`<tr><td>${cell(groups[0][i])}</td><td>${cell(groups[1][i])}</td></tr>`).join('')}</tbody></table>${s.joinOpen&&s.code?`<p class="code">${esc(s.code)}</p><img class="qr" alt="Scan to join" src="${base}/sessions/${s.id}/${teacher?'qr':'board-qr?board='+encodeURIComponent(new URLSearchParams(location.search).get('board'))}">`:''}</section>${teacher?liveControls():presenterControls(s)}`;
  }
  let watchedPlayer='';
  function royalePanel(s){
    const r=s.royale,people=r.players.filter(p=>!p.absent),active=people.filter(p=>p.lives>0);
    if(!active.some(p=>p.id===watchedPlayer))watchedPlayer=active[0]?.id||'';
    const watched=people.find(p=>p.id===watchedPlayer);
    return `<section class="panel royale-panel"><p class="eyebrow">MOONQUEST BATTLE ROYALE</p><h2>${s.phase==='ended'?'Festival champions':`${active.length} rabbits remain`}</h2><p>Three lives · Incorrect or unanswered questions cost one life.</p>${r.me?`<p class="stat">Your lives: ${'♥'.repeat(r.me.lives)}${'♡'.repeat(3-r.me.lives)}</p>`:''}${s.phase==='ended'?`<div class="royale-roster">${people.filter(p=>r.winners.includes(p.id)).map(p=>`<article><span class="royale-rabbit">${duelRabbit('crown',0)}</span><h2>${esc(p.name)}</h2><p>${p.lives} lives remaining</p></article>`).join('')||'<p>No completed competition results yet.</p>'}</div>`:r.eliminated?`<h2>You are now a spectator</h2><p>Choose a player to cheer on. Answers appear only after the reveal.</p><label>Watch a player<select id="royale-watch">${active.map(p=>`<option value="${esc(p.id)}" ${p.id===watchedPlayer?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>${watched?`<div class="royale-watched"><span class="royale-rabbit">${duelRabbit('scarf',0)}</span><h2>${esc(watched.name)}</h2><p>${'♥'.repeat(watched.lives)} · ${watched.answered?'Answer locked':'Thinking…'}</p>${watched.selection?`<p>Selected: ${esc((Array.isArray(watched.selection)?watched.selection:[watched.selection]).map(id=>s.diagram?.regions.find(a=>a.id===id)?.label||id).join(', '))}</p>`:''}</div>`:'<p>Waiting for the final results.</p>'}`:''}<div class="royale-roster">${people.map(p=>`<span>${esc(p.name)} · ${p.lives?'♥'.repeat(p.lives):'Spectating'}</span>`).join('')}</div></section>`;
  }
  function bindRoyale(){const picker=document.getElementById('royale-watch');if(picker)picker.onchange=()=>{watchedPlayer=picker.value;renderLive();};}
  function renderLive() {
    const previousImage=root.querySelector('#diagram img');
    const racePositions=[...root.querySelectorAll('.race-runner')].map(el=>el.style.left);
    cancelAnimationFrame(storyFrame);if(!['intro','story-vote','story-action','ended'].includes(state.phase))window.speechSynthesis?.cancel();document.body.classList.remove('learner-round','duel-round','duel-board','tale-page');document.body.dataset.view='live'; document.body.dataset.audience=role; document.body.dataset.phase=state.phase;
    const s=state,teacher=role==='teacher';document.body.classList.toggle('mission-paused',!!s.paused);document.body.dataset.answerLocked=String(!!s.mine?.first);
    if(s.royale&&(s.phase==='ended'||(role==='student'&&s.royale.eliminated))){root.innerHTML=royalePanel(s)+(s.phase==='ended'?(teacher?button('View learning report','report','primary')+button('Back to games','home'):''):`<section class="panel"><h2>${esc(s.question?.prompt||'Watch the festival battle')}</h2>${rabbitTimer()}${s.diagram?`<img class="spectator-diagram" src="${imageUrl(s.diagram.asset)}" alt="${esc(s.diagram.title||'Lesson diagram')}">`:''}${s.question?.explanation?`<p>${esc(s.question.explanation)}</p>`:''}</section>`);bindRoyale();updateTimer();if(s.phase==='ended')revealFireworks(s);return;}
    if(s.phase==='ended'&&s.duels){document.body.classList.add('celebrate');root.innerHTML=victoryFinale(s);revealFireworks(s);return;}
    if(s.duels&&!s.test&&s.phase==='lobby'&&role!=='student'){root.innerHTML=teamLobby(s);return;}
    if(s.duels?.presentation){root.innerHTML=duelCinema(s);updateTimer();revealFireworks(s);return;}
    if(answerRound!==s.round){answerRound=s.round;changingAnswer=false;pendingChoices=[];}
    const selected=changingAnswer||pendingChoices.length?pendingChoices:s.mine?.final||s.mine?.first;
    const answerOpen=role==='student'&&s.canAnswer&&!s.paused&&['choose','reconsider'].includes(s.phase)&&!(s.automatic&&s.phase==='choose'&&s.mine?.first&&!changingAnswer);
    // Preserve edits in queued questions while answer counts update.
    const focus=document.activeElement, focusQueue=focus?.closest('[data-queue]')?.dataset.queue, focusField=focus?.hasAttribute('data-prompt')?'data-prompt':'data-explanation', focusStart=focus?.selectionStart, focusEnd=focus?.selectionEnd;
    const queued=queueEdits;
    const titles={lobby:'The moon needs your crew.',read:'A new challenge has arrived.',choose:'Choose your answer.',discuss:'Discuss your choice with your partner.',reconsider:'Are you sure about your answer?',reveal:'Let’s discover why.',ended:s.lighting?.complete?'You lit up Vinschool!':'Look how far our light has travelled!'};
    document.body.classList.toggle('celebrate',s.phase==='ended');
    if(s.phase==='intro'){document.body.classList.add('tale-page');root.innerHTML=storyScene(s);animateStory();updateTimer();return;}
    if(s.story&&['story-vote','story-action'].includes(s.phase)){document.body.classList.add('tale-page');root.innerHTML=storyChoiceScene(s);animateStory();updateTimer();return;}
    if(s.phase==='ended'&&s.narrative){document.body.classList.add('tale-page');root.innerHTML=storyFinale(s);animateStory();revealFireworks(s);return;}
    root.innerHTML=`${s.royale?royalePanel(s):''}${role==='board'?presenterControls(s):''}${s.test?'<div class="preview-note">Teacher test · Practice learners only · No class marks are saved</div>':''}<div class="row spread mission-meta"><span class="pill">${esc(s.title)}</span><span class="connection" id="connection">Connected</span><span class="pill">${s.lanterns} lantern sparks</span>${s.reward?`<span class="pill reward-progress">Your moon sparks: ${s.reward.sparks} · ${s.reward.available>=2?'Story vote ready':(2-s.reward.available)+' more to earn a vote'}</span>`:''}</div>
      <section class="stage" style="margin-top:24px"><p class="eyebrow">${s.phase==='lobby'?'MOON FESTIVAL RESCUE':s.phase==='ended'?'MISSION COMPLETE':'Challenge '+(s.round+1)}</p>${s.question&&s.phase!=='ended'?`<div class="question-focus"><span class="question-label">QUESTION ${s.round+1}</span><h1>${esc(s.question.prompt)}</h1></div><h2 class="stage-instruction">${s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'Class meeting discussion':s.paused?'Pause and talk together':s.singleTimer&&s.phase==='choose'?'Think, choose and share your reasons.':titles[s.phase]}</h2>`:`<h1>${titles[s.phase]}</h1>`}${rabbitTimer()}</section>
      ${role==='student'&&s.heroName&&['lobby','ended'].includes(s.phase)?`<p class="hero-welcome">${esc(s.heroName)}, you are a Vinschool hero.</p>`:''}${role==='board'&&!soundEnabled?button('Enable countdown sounds','enable-audio','small'):''}${role!=='student'?dashboard(s)+schoolScene(s):s.phase==='ended'?schoolScene(s):''}<div class="live-layout ${teacher?'':'solo'}"><div>${s.phase==='lobby'?`<section class="intro">${mascot()}<h2>${s.royale?'Three lives. One festival battle.':'Outsmart Pip. Restore the lanterns.'}</h2><p>${s.royale?'Answer correctly to protect your lives. At zero, choose a rabbit to watch. The last remaining player wins; if questions run out, the most lives remaining wins.':''}</p><p>Pip has scattered Vinschool’s festival light! Choose carefully, explain your thinking to a partner, then lock in your rescue plan. Every discovery adds light to our sky.</p>${role==='student'?'<p class="stat">You’re in the crew!</p><p>Wait for your teacher to begin.</p>':`<p>On learner devices, open <strong>${esc(location.host)}/moonquest/join</strong></p>${s.code?`<p class="code">${s.code}</p><img class="qr" alt="Scan to join this MoonQuest room" src="${base}/sessions/${s.id}/${teacher?'qr':'board-qr?board='+encodeURIComponent(new URLSearchParams(location.search).get('board'))}">`:''}`}<p class="muted">${s.joined} learners ready</p></section>`:
      s.phase==='ended'?`<section class="intro">${mascot()}<p class="stat">${s.lanterns} sparks of understanding</p><p>${s.lighting?.complete?'Vinschool is glowing! The rabbits can begin the Moon Festival parade.':`You restored ${s.lighting?.restored||0} of 5 areas. Celebrate your discoveries—the remaining lanterns are a mission for another day.`}</p>${teacher?button('Explore the learning report','report','primary'):''}</section>`:
      `<div class="diagram-wrap">${role==='student'&&s.phase==='choose'?`<div class="selection-rule">${answerInstruction(s.question)}${s.question.answerMode==='one'?' · One area is enough':' · Select the complete set'}</div>`:''}${diagramHtml(s.diagram,selected,s.question?.accepted||[])}<div class="region-list">${s.diagram.regions.map(r=>`<button data-region-answer="${esc(r.id)}" class="${selectedIds(selected).includes(r.id)?'selected ':''}${s.question?.accepted?.includes(r.id)?'correct':''}" ${!answerOpen?'disabled':''}>${esc(r.label)}</button>`).join('')}</div>
      ${role==='student'&&s.singleTimer&&s.phase==='choose'&&s.canAnswer?`<div class="answer-actions"><button data-action="request-time" ${s.extraTimeUsed||s.paused?'disabled':''}>${s.extraTimeUsed?'Extra 10 seconds added for everyone':'Need more time'}</button></div>`:''}
      <div class="answer-status" id="answer-status" role="status">${role==='student'?(!s.canAnswer?'Watch this round. You can answer from the next question.':s.mine?.first&&!changingAnswer?'Answer locked in ✓':changingAnswer?`${answerInstruction(s.question)}. Your saved answer stays until you lock in the replacement.`:pendingChoices.length?answerProgress(pendingChoices.length,s.question.selectionCount):'Select your answer on the diagram or use the buttons.'):`${s.answered} of ${s.expected} learners have chosen`}</div>
      ${role==='student'&&(s.singleTimer||s.question.selectionCount>1)&&['choose','reconsider'].includes(s.phase)&&!s.paused?`<div class="answer-actions">${s.singleTimer&&s.mine?.first&&!changingAnswer?button('Change my answer','change-answer'):s.question.selectionCount>1?`<button data-action="lock-answer" class="primary" ${pendingChoices.length!==s.question.selectionCount?'disabled':''}>Lock in my answers</button>`:''}${changingAnswer?button('Keep my saved answer','cancel-change'):''}</div>`:''}
      ${['discuss','reconsider'].includes(s.phase)?`<div class="discussion-cue"><strong>${s.phase==='discuss'?'I chose this because…':'Keep your choice or tap a new answer.'}</strong><p>${s.phase==='discuss'?'Take turns explaining. Ask your partner: Why?':'Your first choice stays saved if you keep it.'}</p></div>`:''}
      ${s.phase==='reveal'?`<div class="panel">${role==='student'&&s.automatic?`<p class="learner-result">${!selected?'Let’s discover the answer together.':s.myCorrect===true?'You found it! Explain why it fits.':'A new discovery! Look at the highlighted answer.'}</p>`:''}<div class="row spread"><span class="stat">${s.stats.correct} correct</span><span>${s.stats.wrong} incorrect</span><span>${s.stats.unanswered} unanswered</span></div><p class="reveal-explanation">${esc(s.question.explanation)}</p>${s.question.accepted.length>1?`<p class="answer-rule-reveal">${s.question.answerMode==='all'?`All ${s.question.selectionCount} highlighted areas were needed.`:'Any ONE of the highlighted areas is correct.'}</p>`:''}<p class="muted">${s.stats.improved} learners moved from an incorrect first choice to a correct answer after revising their answer.</p></div>`:''}</div>`}</div>${teacher?liveControls():''}</div>`;
    const learnerRound=role==='student'&&s.question&&!['lobby','ended'].includes(s.phase);
    document.body.classList.toggle('learner-round',!!learnerRound);document.body.classList.toggle('duel-round',!!learnerRound&&!!s.duels);
    if(learnerRound)root.innerHTML=learnerQuestion(s,selected,answerOpen);
    else if(s.duels&&role==='board'&&s.question&&!['lobby','ended'].includes(s.phase)){document.body.classList.add('duel-board');root.innerHTML=duelBoard(s);}
    else if(s.duels){const panel=document.createElement('div');panel.innerHTML=duelPanel(s)+(role==='teacher'&&s.phase==='choose'?matchupCards(s):'');root.prepend(panel);}
    const nextImage=root.querySelector('#diagram img');
    if(previousImage&&nextImage&&previousImage.getAttribute('src')===nextImage.getAttribute('src'))nextImage.replaceWith(previousImage);
    if(teacher){
      const missing=root.querySelector('.unanswered-private');if(missing)root.querySelector('.teacher-private').prepend(missing);
      const controls=root.querySelector('.control');
      if(controls){controls.classList.add('teacher-transport');root.prepend(controls);}
      renderQueue(queued);
    }
    if(role==='student'&&s.singleTimer&&s.phase==='choose'){
      const rule=root.querySelector('.selection-rule'),status=root.querySelector('#answer-status'),actions=root.querySelector('.answer-actions');
      if(rule&&status){rule.after(status);if(actions)status.after(actions);}
    }
    if(role==='student'&&['discuss','reconsider'].includes(s.phase)){
      const cue=root.querySelector('.discussion-cue'),wrap=root.querySelector('.diagram-wrap');if(cue&&wrap)wrap.prepend(cue);
    }
    if(focusQueue){const input=document.querySelector(`[data-queue="${focusQueue}"] [${focusField}]`);if(input){input.focus({preventScroll:true});input.setSelectionRange(focusStart,focusEnd);}}
    if(role==='student')document.querySelectorAll('#diagram polygon[data-region]').forEach(el=>{
      const send=()=>submitAnswer(el.dataset.region);el.onclick=send;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();send();}};
      el.setAttribute('aria-disabled',String(!answerOpen));
    });
    const img=document.querySelector('#diagram img');if(img){img.onload=fitDiagram;if(img.complete)fitDiagram();}
    root.querySelectorAll('.race-runner').forEach((el,i)=>{const target=el.style.left;if(racePositions[i]&&racePositions[i]!==target){el.style.left=racePositions[i];el.getBoundingClientRect();el.style.left=target;}});
    updateTimer();revealFireworks(s);
  }
  function fitDiagram(){
    if(view!=='live')return;const box=document.getElementById('diagram'),img=box?.querySelector('img');if(!img?.naturalWidth)return;
    if(document.body.classList.contains('learner-round')||document.body.classList.contains('duel-board')){
      const parent=box.parentElement,w=parent.clientWidth,h=parent.clientHeight;
      const width=Math.min(w,h*img.naturalWidth/img.naturalHeight);box.style.width=width+'px';box.style.height=width*img.naturalHeight/img.naturalWidth+'px';return;
    }
    const available=box.parentElement.clientWidth;
    box.style.width=Math.min(available,Math.max(180,window.innerHeight*(role==='student'&&['discuss','reconsider'].includes(state.phase)?.27:.40))*img.naturalWidth/img.naturalHeight)+'px';
  }
  window.addEventListener('resize',fitDiagram);
  function renderQueue(edits={}) {
    const el=document.getElementById('queue-panel');if(!el)return;
    el.innerHTML=state.queue.filter(q=>q.status!=='skipped'&&q.status!=='asked').map(q=>`<section class="queue" data-queue="${q.id}"><h3>A concept to revisit</h3><p>${esc(q.originalPrompt)}</p><p class="muted">Keep this answer: ${esc((q.acceptedLabels||[]).join(" / "))}</p><p class="muted">The class needs another opportunity with this concept. Approved questions join automatic play after two intervening rounds.${q.lowParticipation?' Participation was below 80%; check the class before using this suggestion.':''} ${state.round<q.eligibleAfter?'Available after '+(q.eligibleAfter-state.round)+' more rounds.':'Ready when you choose.'}</p>${q.status==='approved'?`<p>${esc(q.question.prompt)}</p><button data-challenge="${q.id}" ${state.round<q.eligibleAfter||state.phase!=='reveal'?'disabled':''}>Ask later challenge now</button>`:`<button data-suggest="${q.id}">AI suggest a different scenario</button><label>Rephrased question<textarea data-prompt>${esc(edits[q.id]?.prompt??q.suggestion?.prompt??'')}</textarea></label><label>Explanation<textarea data-explanation>${esc(edits[q.id]?.explanation??q.suggestion?.explanation??'')}</textarea></label><p class="muted">The original diagram and accepted answer stay fixed. Review that this new question still fits them.</p><button data-approve="${q.id}" class="primary">Approve for later</button>`}<button data-skip="${q.id}" class="small">Skip</button></section>`).join('');
  }
  let lastTick='', lastStageSound='';
  function countdownBeep(seconds) {
    if(!soundEnabled||role==='student'||document.hidden)return;
    try { audio ||= new (window.AudioContext||window.webkitAudioContext)();
      if(audio.state!=='running')return;
      const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;
      o.frequency.value=state?.phase==='matchup'?100+(4-seconds)*45:seconds<=5?740:440;
      if(state?.phase==='matchup')o.frequency.exponentialRampToValueAtTime(45,t+.09);
      const volume=Number(document.getElementById('effects-level').value)/100;
      g.gain.setValueAtTime(volume*(seconds<=5?.13:.045),t);g.gain.exponentialRampToValueAtTime(.001,t+.09);
      o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.1);
    }catch{}
  }
  let storyFrame,storyCueKey='',narrationEnabled=false;
  const narrator=document.getElementById('narration');
  if(!('speechSynthesis' in window)){narrator.disabled=true;narrator.title='Narration is not available in this browser.';}
  narrator.onclick=()=>{narrationEnabled=!narrationEnabled;narrator.textContent=narrationEnabled?'Narration on':'Narration off';narrator.setAttribute('aria-pressed',String(narrationEnabled));window.speechSynthesis?.cancel();storyCueKey='';};
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(storyFrame);window.speechSynthesis?.cancel();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)window.speechSynthesis?.cancel();});
  function animateStory(){
    if(view!=='live'||!root.querySelector('.tale-stage')){window.speechSynthesis?.cancel();return;}
    const cue=MoonStory.sync(state,Date.now()+clockOffset);
    if(state.paused||document.hidden){window.speechSynthesis?.cancel();}
    else if(cue&&cue.mode!=='vote'&&cue.key!==storyCueKey){
      storyCueKey=cue.key;
      // One narrator on the teacher/board device; learner devices remain quiet.
      if(role!=='student'){
        if(narrationEnabled&&window.speechSynthesis){window.speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(cue.voice||cue.text);speech.lang='en-GB';speech.rate=1;speech.volume=Number(document.getElementById('effects-level').value)/100;window.speechSynthesis.speak(speech);}
        storySound(cue);
      }
    }
    storyFrame=requestAnimationFrame(animateStory);
  }
  function storySound(cue){
    if(!soundEnabled||document.hidden)return;
    try{audio ||=new(window.AudioContext||window.webkitAudioContext)();audio.resume();const volume=Number(document.getElementById('effects-level').value)/100;
      const notes=cue.mode==='intro'&&cue.beat===1?[420,260,140]:cue.choice==='drums'?[100,140,100]:cue.choice==='kite'?[440,660,880]:cue.beat===1?[523,659,784]:[392,523];
      notes.forEach((frequency,i)=>{const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+i*.13;o.type=cue.choice==='drums'?'triangle':'sine';o.frequency.setValueAtTime(frequency,t);o.frequency.exponentialRampToValueAtTime(cue.choice==='drums'?50:frequency*.98,t+.25);g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(volume*.12,t+.015);g.gain.exponentialRampToValueAtTime(.001,t+.4);o.connect(g);g.connect(audio.destination);o.onended=()=>{o.disconnect();g.disconnect();};o.start(t);o.stop(t+.45);});
    }catch{}
  }
  function updateTimer(){
    const el=document.getElementById('timer');if(view!=='live'||!el||!state)return;
    const seconds=state.deadline?Math.max(0,Math.ceil((state.deadline-Date.now()-clockOffset)/1000)):null;
    const shown=state.automatic&&state.phase==='discuss'&&seconds!==null?seconds+5:seconds;
    el.textContent=state.paused?(role!=='student'&&state.singleTimer&&state.teachingPause==='misconception'?'Listen · explain · learn':'Paused'):state.phase==='intro'||state.phase==='story-action'||(state.singleTimer&&state.phase==='reveal')?'':shown!==null?shown+'s':'';
    el.classList.toggle('urgent',shown!==null&&shown<=5&&!state.paused);
    el.closest('.rabbit-timer')?.classList.toggle('rabbit-urgent',shown!==null&&shown<=5&&!state.paused);
    const stage=[sessionId,state.round,state.phase].join(':');
    if(lastStageSound&&lastStageSound!==stage&&!state.paused&&role!=='student')chime();
    lastStageSound=stage;
    const key=stage+':'+seconds;
    if(!state.paused&&seconds>0&&state.phase!=='intro'&&state.phase!=='story-action'&&!(state.singleTimer&&state.phase==='reveal')&&lastTick!==key){lastTick=key;countdownBeep(shown);}
  }
  function schoolScene(s) {
    const l=s.lighting||{percent:0,restored:0,zones:[]},elapsed=Math.max(0,(Date.now()+clockOffset-(s.revealedAt||0)-(s.duels?.presentation==='sparks'?5000:0))/1000);
    const celebrating=s.phase==='reveal'&&l.gain>0&&elapsed<4&&!s.paused;
    const masks=['ellipse 28% 33% at 50% 59%','ellipse 25% 35% at 13% 56%','ellipse 25% 35% at 87% 56%','ellipse 80% 24% at 50% 94%','ellipse 80% 40% at 50% 5%'];
    return `<section class="festival-school lighting-school ${l.complete?'school-complete':''} ${celebrating?'sparks-arriving':''}" style="--school-brightness:${.25+l.percent*.0025};--spark-elapsed:-${elapsed}s" aria-label="Vinschool festival · ${l.percent}% lit"><img src="/moonquest-art/vinschool-festival.webp" alt="Cartoon Vinschool, gradually lighting up for the Moon Festival">${l.zones.map((z,i)=>`<img class="lit-school-zone" style="mask-image:radial-gradient(${masks[i]},#000 55%,transparent 100%);-webkit-mask-image:radial-gradient(${masks[i]},#000 55%,transparent 100%);opacity:${z.percent/100};--zone-before:${Math.max(0,Math.min(100,((s.lighting?.previous||0)-i*20)*5))/100};--zone-after:${z.percent/100}" src="/moonquest-art/vinschool-festival.webp" alt="" aria-hidden="true">`).join('')}${festivalScenery(s)}${MoonStory.landmarks(s)}<div class="festival-caption"><span class="eyebrow">ONE SCHOOL · ${s.duels?'TWO CREWS':'ONE CREW'} · ONE FESTIVAL</span><strong>${s.paused?'Gather around the lantern. Let’s work it out together.':l.complete?'Vinschool is shining. You saved the festival!':l.percent?`${l.restored}/5 areas restored · Keep the sparks coming!`:'The moon shadow scattered our light. Your discoveries can bring it back.'}</strong>${lightingMeter(s)}</div><div class="school-spark-trails" aria-hidden="true">${Array.from({length:12},(_,i)=>`<i style="--sx:${8+i*7}%;--sd:${i*.09}s;--spark-colour:${i%2?'#ffe19b':'#a8f3d5'}">✦</i>`).join('')}</div><div class="festival-rabbit">${duelRabbit('star',0)}</div>${l.restored?`<div class="lighting-lanterns" aria-hidden="true">${Array.from({length:l.restored},(_,i)=>festivalLantern(i)).join('')}</div>`:''}${l.complete?`<div class="rabbit-parade" aria-hidden="true">${duelRabbit('scarf',0)}${duelRabbit('bow',1)}${duelRabbit('star',0)}</div>`:''}<div class="festival-heroes lighting-heroes">${(s.crew||[]).map(hero=>`<span class="hero-lantern">${esc(hero.name)}</span>`).join('')}</div><div class="lighting-zones">${l.zones.map(z=>`<span class="${z.percent===100?'restored':''}">${z.percent===100?'✦':'○'} ${esc(z.name)}</span>`).join('')}</div></section>`;
  }
  function festivalLantern(index=0){return `<svg class="game-lantern" viewBox="0 0 70 110" aria-hidden="true"><path d="M35 0V14M35 90V107" stroke="#f7d488" stroke-width="2"/><path d="M23 14H47L50 21H20Z" fill="#f4cb78"/><ellipse cx="35" cy="54" rx="29" ry="34" fill="${index%2?'#279e87':'#d6495f'}" stroke="#ffe4a4" stroke-width="2"/><ellipse cx="35" cy="54" rx="18" ry="34" fill="#ffd36a55" stroke="#ffe5ab99"/><ellipse cx="35" cy="54" rx="7" ry="34" fill="#fff4b277"/><path d="M20 87H50L46 94H24Z" fill="#f4cb78"/><path d="M28 100V109M35 100V110M42 100V109" stroke="#ffd482" stroke-width="3"/><path d="M35 37L39 49L50 54L39 58L35 70L31 58L20 54L31 49Z" fill="#fff0b5"/></svg>`;}
  function festivalScenery(s){return `<div class="festival-depth" aria-hidden="true"><div class="moon-halo"></div><div class="mist-layer"></div><div class="sky-lanterns">${Array.from({length:5},(_,i)=>`<span style="--lx:${8+i*19}%;--ly:${20+i%3*12}%;--drift:${i*.7}s">${festivalLantern(i)}</span>`).join('')}</div><div class="festival-fireflies">${Array.from({length:14},(_,i)=>`<i style="--fx:${(i*37)%97}%;--fy:${50+(i*13)%45}%;--fd:${i*.37}s"></i>`).join('')}</div><div class="scene-rabbit rabbit-jade">${duelRabbit('scarf',0)}</div><div class="scene-rabbit rabbit-gold">${duelRabbit('bow',1)}</div></div>`;}
  function lightingMeter(s){const l=s.lighting||{percent:0};return `<div class="school-light-meter" aria-label="Vinschool ${l.percent}% lit"><span>🏮 Vinschool · ${l.percent}% lit</span><div role="progressbar" aria-label="School illumination" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${l.percent}"><i style="width:${l.percent}%"></i></div></div>`;}

  function rabbitTimer(){return `<div class="rabbit-timer"><div class="rabbit-guide" aria-hidden="true">${mascot()}</div><div class="countdown-lantern"><span class="timer" id="timer" role="timer" aria-label="Seconds remaining"></span></div></div>`;}
  function storyIcon(id){return MoonStory.icon(id);}
  function storyChoiceScene(s){
    const c=s.story,teamResult=c.teamResults?.find(r=>r.team===s.duels?.me?.team),choice=c.options[teamResult?.winner??c.winner??0],action=s.phase==='story-action';
    const note=result=>result.tied?'A tied vote: the rabbit flipped a moon coin.':result.noVotes?'No votes this time. The rabbit chose a path.':'';
    return `${role!=='student'?presenterControls(s):''}<div class="story-workspace"><section class="story-chapter">${s.paused?'<p class="story-paused-label" role="status">Story paused · Listen to your teacher</p>':''}<p class="eyebrow">${action?'YOUR CHOICE COMES TO LIFE':'YOUR CREW CHOOSES THE ADVENTURE'}</p>${MoonStory.film(s,role,duelRabbit,action?'action':'vote')}
    ${action?(c.teamResults&&role!=='student'?`<div class="crew-story-results">${c.teamResults.map(t=>`<article class="crew-story"><h3>${esc(s.duels.teams[t.team].name)} · ${esc(c.options[t.winner].title)}</h3><p>${note(t)}</p></article>`).join('')}</div>`:`<div class="story-result"><h2>${esc(choice.title)}</h2><p>${note(teamResult||c)}</p></div>`):`<p class="story-status">${role==='student'?(c.myVote?'Your choice is locked. Watch your crew’s adventure!':c.canVote?'Choose what your rabbits do next.':'Cheer on your crew! Earn two sparks to make a story choice.'):'Each choice changes the path your rabbits will take.'}</p><div class="story-options">${c.options.map(o=>`<button data-story-choice="${o.id}" ${role!=='student'||!c.canVote||s.paused?'disabled':''} class="${c.myVote===o.id?'chosen':''}">${storyIcon(o.id)}<span>${esc(o.title)}</span></button>`).join('')}</div>${role!=='student'?`<p class="story-status">${c.voted}/${c.eligibleCount} story votes received</p>`:''}`}${rabbitTimer()}</section></div>`;
  }
  function storyFinale(s){
    return `<div class="tale-finale-wrap"><h1>${s.narrative?.complete?'The festival you created':'Your adventure so far'}</h1>${MoonStory.film(s,role,duelRabbit,'finale')}${lightingMeter(s)}${s.duels?duelPanel(s):''}${MoonStory.journey(s,role)}${role==='teacher'?`${button('Explore the learning report','report','primary')}${button('Adventures','home')}`:''}</div>`;
  }
  function victoryFinale(s){
    const d=s.duels,crews=d.celebration||[],hasResults=d.rounds>0;
    const hero=(h,podium=false)=>`<article class="festival-winner ${podium?'podium-place':''}" style="--place:${h.rank};--hop:${(h.name.length%7)*.13}s"><strong>${esc(h.name)}</strong>${duelRabbit(h.avatar,h.team)}${podium?`<div class="podium-block">${h.rank===1?'🥇':h.rank===2?'🥈':'🥉'}<b>${h.rank}</b><span>${h.points} points</span></div>`:''}</article>`;
    return `<section class="victory-screen final-victory"><p class="eyebrow">MOON FESTIVAL · CELEBRATION</p><h1>${!hasResults?'Thank you, festival heroes!':d.winner===null?'Both teams are champions!':esc(d.teams[d.winner].name)+' win!'}</h1><p>${hasResults?'Every answer helped your crew shine.':'No completed duels yet. Your next adventure awaits!'}</p>${crews.filter(c=>d.winner===null||c.team===d.winner).map(c=>`<section class="champion-crew"><h2>${esc(c.name)} · ${d.teams[c.team].points} moon points</h2><div class="winner-parade">${c.members.map(h=>hero(h)).join('')}</div></section>`).join('')}${crews.map(c=>`<section class="team-podium"><h2>${esc(c.name)} · Top scorers</h2><div class="podium-line">${c.podium.map(h=>hero(h,true)).join('')||'<p>Keep discovering in your next mission.</p>'}</div><p class="muted">Equal points share a place.</p></section>`).join('')}${role==='teacher'?button('Explore the learning report','report','primary')+button('Adventures','home'):''}<details><summary>Your festival story</summary>${s.narrative?storyFinale(s):schoolScene(s)}</details></section>`;
  }
  function revealFireworks(s){
    if(!['reveal','ended'].includes(s.phase)||(s.phase!=='ended'&&!s.revealedAt))return;
    const key='moonquest-fireworks:'+s.id+':'+s.round+':'+s.phase;
    if(Date.now()+clockOffset-s.revealedAt>4000&&s.phase!=='ended')return;
    try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');}catch{}
    const layer=document.createElement('div');layer.className='festival-fireworks';layer.setAttribute('aria-hidden','true');
    for(let burst=0;burst<3;burst++){const cloud=document.createElement('div');cloud.className='firework';cloud.style.cssText=`left:${18+burst*32}%;top:${12+burst%2*10}%;--delay:${burst*.4}s;--colour:${['#ffd778','#a7ead0','#ff8c9d'][burst]}`;for(let n=0;n<16;n++){const spark=document.createElement('i');spark.style.setProperty('--angle',n*22.5+'deg');cloud.append(spark);}layer.append(cloud);}
    const scene=root.querySelector('.festival-school');if(scene?.offsetParent){layer.style.position='absolute';scene.append(layer);}else document.body.append(layer);setTimeout(()=>layer.remove(),3200);
    if(!soundEnabled||role==='student'||document.hidden)return;
    try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume();
      const buffer=audio.createBuffer(1,audio.sampleRate*.5,audio.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);
      for(let i=0;i<3;i++){const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain(),t=audio.currentTime+i*.4;source.buffer=buffer;filter.type='lowpass';filter.frequency.value=900;gain.gain.setValueAtTime(Number(document.getElementById('effects-level').value)/100*.16,t);gain.gain.exponentialRampToValueAtTime(.001,t+.5);source.connect(filter);filter.connect(gain);gain.connect(audio.destination);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};source.start(t);}
    }catch{}
  }
  function dashboard(s) {
    if(!s.question||s.phase==='ended')return '';
    const score=s.stats;
    const percent=Math.round(100*s.answered/Math.max(1,s.expected));
    return `<section class="live-dashboard" aria-label="Live class progress"><div class="response-ring" style="--progress:${percent}%"><strong>${s.answered}/${s.expected}</strong><span>answered</span></div><div class="dashboard-detail"><p class="eyebrow">Our festival crew</p><h2>${s.answered}/${s.expected} learners answered</h2><p>${s.answered===s.expected?'Every voice is in!':'Waiting for our crew…'}</p><div class="lantern-trail" aria-hidden="true">${Array.from({length:10},(_,i)=>`<i class="${i<Math.round(percent/10)?'lit':''}">✦</i>`).join('')}</div><p class="muted">${esc(s.question.concept)}</p></div>${score?`<div class="evidence"><strong>${score.initialCorrect}/${s.expected} first choice → ${score.correct}/${s.expected} latest choice</strong><p>${score.wrong} incorrect · ${score.unanswered} unanswered</p>${s.diagram.regions.map(r=>`<div class="distribution"><span>${esc(r.label)}</span><meter min="0" max="${Math.max(1,s.expected)}" value="${score.distribution[r.id]||0}"></meter><b>${score.distribution[r.id]||0}</b></div>`).join('')}</div>`:''}</section>`;
  }
  setInterval(updateTimer,250);
  async function submitAnswer(regionId, lock=false) {
    if((state?.automatic&&state.phase==='choose'&&state.mine?.first&&!changingAnswer)||busyAnswer||role!=='student'||!state?.canAnswer||state.paused||!['choose','reconsider'].includes(state.phase))return;
    if(state.question.selectionCount>1&&!lock){
      if(pendingChoices.includes(regionId))pendingChoices=pendingChoices.filter(id=>id!==regionId);
      else if(pendingChoices.length<state.question.selectionCount)pendingChoices.push(regionId);
      else {tell('Unselect an area before choosing another.');return;}
      renderLive();return;
    }
    busyAnswer=true;const el=document.getElementById('answer-status');if(el)el.textContent='Locking in your answer…';
    try{
      const request={regionIds:state.question.selectionCount>1?[...pendingChoices]:[regionId],changeConfirmed:changingAnswer,round:state.round,phase:state.phase,eventId:uid()};
      let saved;
      try{saved=await api('/sessions/'+sessionId+'/answer',request);}
      catch(error){
        if(!['TypeError','TimeoutError'].includes(error.name))throw error;
        // A lost acknowledgement must reuse its receipt, not count as a second answer.
        saved=await api('/sessions/'+sessionId+'/answer',request);
      }
      if(!state||saved.seq>=state.seq)state=saved;
      pendingChoices=[];changingAnswer=false;lastRender='';renderLive();
    }catch(e){tell(e.message,true);if(el)el.textContent='Not saved yet. Check your connection and try again.';}finally{busyAnswer=false;}
  }
  async function command(action,extra={}){const s=await api('/sessions/'+sessionId+'/command',{action,presentation:role==='board',seq:state.seq,round:state.round,phase:state.phase,paused:state.paused,...extra});state=s;lastRender='';renderLive();}
  async function shareAnalysis(id){
        const grant=await api('/sessions/'+id+'/observer-link',{});
        const url=location.origin+'/moonquest/analysis?session='+encodeURIComponent(id)+'#'+grant.token;
        const dialog=document.createElement('dialog');
        dialog.innerHTML=`<h2>Live analysis report</h2><p>Read-only learning evidence. No login needed. Learner names, current assessment results and saved teaching reflections are included; individual assessment notes and edit history are not shared. This link does not expire. You can withdraw access at any time. Creating another link keeps previously shared links working. Withdraw access disables all links for this report.</p><label>Share this read-only report link<input readonly style="width:100%" value="${esc(url)}"></label><p><a target="_blank" rel="noopener noreferrer" href="${esc(url)}">Preview analysis report</a></p><button id="copy-observer">Copy link</button> <button id="close-observer">Close</button><p role="status" id="observer-copy-status"></p>`;
        document.body.append(dialog);dialog.showModal();
        dialog.querySelector('#copy-observer').onclick=async()=>{try{await navigator.clipboard.writeText(url);dialog.querySelector('#observer-copy-status').textContent='Link copied';}catch{dialog.querySelector('input').select();dialog.querySelector('#observer-copy-status').textContent='Select and copy the link above.';}};
        dialog.querySelector('#close-observer').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  }
  async function report(id) {
    stopPoll();view='report';const r=await api('/sessions/'+id+'/report');nav('/moonquest?report='+encodeURIComponent(id));
    stopMusic();musicEnabled=false;document.getElementById('music').textContent='Music off';document.getElementById('music').setAttribute('aria-pressed','false');
    document.body.dataset.view='report';document.body.dataset.audience='teacher';document.body.classList.remove('learner-round','duel-round','duel-board','mission-paused','celebrate');
    MoonQuestReport.render(root,r,{share:()=>shareAnalysis(id),back:()=>openSession(id,'teacher'),csv:current=>downloadReportCsv(current),adjust:input=>api('/sessions/'+id+'/assessment',input),save:input=>api('/sessions/'+id+'/reflection',input)});
  }
  function downloadReportCsv(r){
      const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
      const rows=[['Student ID','Learner','Question','Stage','Initial choice','Initial correct','Final choice','Game final correct','Confirmed','Teacher assessed correct','Assessment note','Assessment updated','Current correct']];r.students.forEach(st=>st.rounds.forEach((a,i)=>rows.push([st.id,st.name,r.rounds[i].prompt,r.rounds[i].followUp?'Later check':'Initial encounter',a.initial,a.initialCorrect??'',a.revised,a.gameFinalCorrect??'',a.confirmed,a.assessment?.correct??'',a.assessment?.reason||'',a.assessment?new Date(a.assessment.updatedAt).toISOString():'',a.revisedCorrect??''])));
      const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='moonquest-learning.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function joinPage(code='') {
    view='join';root.innerHTML=`<section class="intro">${mascot()}<p class="eyebrow">Join the rescue crew</p><h1>Your moon mission awaits.</h1><div class="panel stack"><label>Room code<input id="room-code" autocomplete="off" maxlength="10" value="${esc(code)}" placeholder="Teacher’s 10-character code"></label>${button('Find my crew','find-room','primary')}<div id="join-class"></div></div></section>`;
    if(code){await findRoom();const input=document.getElementById('room-code');if(input){input.closest('label').hidden=true;root.querySelector('[data-action=find-room]').hidden=room?.joinOpen!==false;}}
  }
  async function findRoom() {
    const code=document.getElementById('room-code').value.trim().toUpperCase();
    room=await api('/rooms/'+encodeURIComponent(code));
    if(room.joinOpen===false){document.getElementById('join-class').innerHTML='<h2>Your teacher is preparing the teams</h2><p>Wait for sign-in to open, then select Find my crew again.</p>';return;}
    if(room.test){
      const key='moonquest-test-device:'+room.id;
      let deviceKey=sessionStorage.getItem(key);if(!deviceKey){deviceKey=uid();sessionStorage.setItem(key,deviceKey);}
      const result=await api('/rooms/'+encodeURIComponent(code)+'/test-enter',{deviceKey});
      learnerToken=result.token;sessionStorage.setItem('moonquest:'+room.id,learnerToken);
      return openSession(room.id,'student');
    }
    document.getElementById('join-class').innerHTML=`<h2>${esc(room.title)}</h2><p>Choose your name, then enter your PIN.</p><input id="join-name" type="hidden"><div class="join-names" role="group" aria-label="Choose your name">${room.students.map(st=>`<button data-learner-handle="${esc(st.handle)}" aria-pressed="false">${esc(st.label)}</button>`).join('')}</div><div class="stack"><label>Your PIN<input id="join-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"></label><p class="muted">Use your usual four-digit PIN. If you have never set one, choose one now.</p>${button('Join the mission','join','primary')}</div>`;

  }
  root.addEventListener('input',e=>{
    const q=e.target.closest('[data-queue]');if(q)queueEdits[q.dataset.queue]={prompt:q.querySelector('[data-prompt]')?.value,explanation:q.querySelector('[data-explanation]')?.value};
    if(view==='editor'){dirty=true;if(e.target.id!=='reviewed'){const r=document.getElementById('reviewed');if(r)r.checked=false;}checkpoint();}
  });
  root.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(uploadingDiagram){tell('Please wait for your diagram to finish uploading.');return;}
    const action=b.dataset.action; b.disabled=true;
    try{
      if(action==='copy-learner-link'){const input=document.getElementById('learner-link');try{await navigator.clipboard.writeText(input.value);tell('Link copied. You can send it to your learners.');}catch{input.focus();input.select();tell('Select Copy to copy the highlighted link.');}}
      else if(b.dataset.learnerHandle){document.getElementById('join-name').value=b.dataset.learnerHandle;root.querySelectorAll('[data-learner-handle]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));document.getElementById('join-pin').focus();}
      else if(b.dataset.duelMedia){document.getElementById(b.dataset.duelMedia)?.click();if(b.dataset.duelMedia!=='full')renderLive();}
      else if(b.dataset.duelTest){const response=await api('/games/'+b.dataset.duelTest+'/sessions',{test:true,mode:'duels'});await openSession(response.id,'teacher');}
      else if(b.dataset.avatar){state=await api('/sessions/'+sessionId+'/avatar',{avatar:b.dataset.avatar});lastRender='';renderLive();}
      else if(action==='request-time'){state=await api('/sessions/'+sessionId+'/request-time',{round:state.round});lastRender='';renderLive();}
      else if(b.dataset.storyChoice){state=await api('/sessions/'+sessionId+'/story-vote',{checkpoint:state.story.id,choice:b.dataset.storyChoice});lastRender='';renderLive();}
      else if(action==='enable-audio'){document.getElementById('sound').click();renderLive();}
      else if(action==='change-answer'){if(confirm('Are you sure you want to change your locked answer?')){changingAnswer=true;pendingChoices=[];renderLive();}}
      else if(action==='cancel-change'){changingAnswer=false;pendingChoices=[];renderLive();}
      else if(action==='lock-answer')await submitAnswer(null,true);
      else if(action==='home'){if(view==='editor')await saveWork(checkpoint());await home();}
      else if(action==='save-draft'){await saveWork(checkpoint());tell('Draft saved. You can return to it from Your drafts.');}
      else if(b.dataset.resumeDraft){await openDraft(b.dataset.resumeDraft);}
      else if(action==='new'){draft=emptyDraft();activeDiagram=0;dirty=false;editor();}
      else if(action==='sample')await sample();
      else if(action==='finish-area')finishArea();
      else if(action==='update-region')updateRegion();
      else if(action==='new-area'){captureEditor();regionEditing=null;editor();}
      else if(action==='undo-corner'){drawn.pop();document.getElementById('drawing').setAttribute('points',drawn.map(p=>p.join(',')).join(' '));}
      else if(action==='add-question'){captureEditor();const d=draft.diagrams[activeDiagram];if(!d?.regions.length)throw new Error('Add answer areas first.');draft.questions.push({id:uid(),diagramId:d.id,prompt:'',concept:'',accepted:[],explanation:''});draft.reviewed=false;dirty=true;editor();}
      else if(action==='save'){captureEditor();
        if(drawn.length)throw new Error('An answer area is unfinished. Enter its label and click Finish area before saving.');
        const emptyIndex=draft.diagrams.findIndex(d=>!d.regions.length);
        if(emptyIndex!==-1){activeDiagram=emptyIndex;regionEditing=null;editor();document.getElementById('region-label').focus();throw new Error('“'+draft.diagrams[emptyIndex].title+'” has no saved answer areas. Enter a label, then drag a rectangle over that part of the picture.');}
        if(!draft.questions.length)throw new Error('Your diagram areas are ready. Add questions using Write a question or AI draft 5 questions before saving.');
        const result=await api('/games',draft);clearTimeout(draftTimer);await draftQueue.catch(()=>{});if(draft.workId){await api('/drafts/'+draft.workId+'/discard',{});try{localStorage.removeItem(draftKey(draft.workId));}catch{}}draft=result.game;dirty=false;tell('Adventure saved. You can now set up a class or test it.');await home();}
      else if(action==='draft-ai'){captureEditor();const objective=document.getElementById('objective').value;const d=await api('/draft',{...draft,objective},{timeout:25000});draft.questions.push(...d.questions);draft.reviewed=false;dirty=true;editor();tell('Questions added. Review the answer areas and explanations before saving.');}
      else if(b.dataset.edit){draft=(await api('/games/'+b.dataset.edit)).game;activeDiagram=0;editor();}
      else if(b.dataset.editRegion){captureEditor();regionEditing=b.dataset.editRegion;editor();}
      else if(b.dataset.host)await setup(b.dataset.host);
      else if(b.dataset.test)await launch(b.dataset.test,true);
      else if(b.dataset.start)await launch(b.dataset.start);
      else if(b.dataset.session)await openSession(b.dataset.session,'teacher');
      else if(b.dataset.report)await report(b.dataset.report);
      else if(action==='remove-diagram'){
        captureEditor();const diagram=draft.diagrams[activeDiagram];if(!diagram)return;
        const count=draft.questions.filter(q=>q.diagramId===diagram.id).length;
        const message='Remove “'+diagram.title+'” from this adventure? Its answer areas'+(count?' and '+count+' linked question'+(count===1?'':'s'):'')+' will also be removed.';
        if(!confirm(message))return;
        draft.diagrams=draft.diagrams.filter(d=>d.id!==diagram.id);
        draft.questions=draft.questions.filter(q=>q.diagramId!==diagram.id);
        activeDiagram=Math.max(0,Math.min(activeDiagram,draft.diagrams.length-1));regionEditing=null;drawn=[];drawing=false;draft.reviewed=false;dirty=true;
        editor();tell('Diagram removed from this draft. Save the adventure when your changes are ready.');
      }
      else if(b.dataset.deleteRegion){captureEditor();const id=b.dataset.deleteRegion;draft.diagrams[activeDiagram].regions=draft.diagrams[activeDiagram].regions.filter(r=>r.id!==id);draft.questions.forEach(q=>q.accepted=q.accepted.filter(a=>a!==id));draft.reviewed=false;dirty=true;editor();}
      else if(b.dataset.deleteQuestion){captureEditor();draft.questions=draft.questions.filter(q=>q.id!==b.dataset.deleteQuestion);draft.reviewed=false;dirty=true;editor();}
      else if(action==='use-saved-teams')await command(action,{groupSides:Object.fromEntries([...root.querySelectorAll('[data-saved-team]')].map(el=>[el.dataset.savedTeam,Number(el.value)]))});
      else if(['open-joining','shuffle-teams','remember-teams','continue-meeting','launch','skip-intro','skip-story','next','open','advance','pause','extend','rotate-board'].includes(action))await command(action);
      else if(action==='end'){if(confirm('Finish this mission? Learners will no longer be able to answer.'))await command('end');}
      else if(action==='simulate'||action==='simulate-misconception'){state=await api('/sessions/'+sessionId+'/simulate',{pattern:action==='simulate-misconception'?'misconception':'mixed'});renderLive();}
      else if(action==='observer-link') {
        await shareAnalysis(sessionId);
      }
      else if(action==='observer-revoke') {await api('/sessions/'+sessionId+'/observer-revoke',{});tell('Report access withdrawn.');}
      else if(action==='report')await report(sessionId);
      else if(b.dataset.removeLearner)await command('remove-learner',{studentId:b.dataset.removeLearner,removed:b.dataset.removed==='true'});
      else if(b.dataset.attendance)await command('absent',{studentId:b.dataset.attendance,absent:b.dataset.absent==='true'});
      else if(b.dataset.regionAnswer)await submitAnswer(b.dataset.regionAnswer);
      else if(b.dataset.challenge)await command('challenge',{queueId:b.dataset.challenge});
      else if(b.dataset.suggest){const id=b.dataset.suggest;tell('Preparing a different scenario. The class can keep playing.');const d=await api('/sessions/'+sessionId+'/suggest',{queueId:id},{timeout:25000});const el=document.querySelector(`[data-queue="${id}"]`);if(el){el.querySelector('[data-prompt]').value=d.prompt;el.querySelector('[data-explanation]').value=d.explanation;}tell('Suggestion ready. Review it before approving.');}
      else if(b.dataset.approve||b.dataset.skip){const id=b.dataset.approve||b.dataset.skip,el=document.querySelector(`[data-queue="${id}"]`);await api('/sessions/'+sessionId+'/review',{queueId:id,skip:!!b.dataset.skip,prompt:el.querySelector('[data-prompt]')?.value,explanation:el.querySelector('[data-explanation]')?.value});lastRender='';}
      else if(action==='find-room')await findRoom();
      else if(action==='join'){const result=await api('/sessions/'+room.id+'/join',{handle:document.getElementById('join-name').value,pin:document.getElementById('join-pin').value});learnerToken=result.token;sessionStorage.setItem('moonquest:'+room.id,learnerToken);await openSession(room.id,'student');}
    }catch(err){tell(err.message,true);}finally{if(b.isConnected)b.disabled=false;}
  });
  async function init(){
    fetch('/healthz',{cache:'no-store'}).then(r=>r.json()).then(d=>{document.getElementById('version').textContent='v '+d.commitShort;}).catch(()=>{});
    const params=new URLSearchParams(location.search),id=params.get('session');
    if(location.pathname.endsWith('/join'))return joinPage(params.get('code')||'');
    if(id){learnerToken=sessionStorage.getItem('moonquest:'+id)||'';return openSession(id,params.get('board')?'board':learnerToken?'student':'teacher');}
    await home();
    if(params.get('draft'))await openDraft(params.get('draft'));
    else if(params.get('game')){const id=params.get('game');if(params.get('action')==='test')await launch(id,true);else if(params.get('action')==='edit'){draft=(await api('/games/'+id)).game;editor();}else await setup(id);}
    else if(params.get('new')==='1'){draft=emptyDraft();draft.title=(params.get('title')||draft.title).slice(0,120);draft.subject=(params.get('subject')||'').slice(0,100);draft.grade=(params.get('grade')||draft.grade).slice(0,80);activeDiagram=0;editor();}
    else if(params.get('report'))await report(params.get('report'));
  }
  init().catch(e=>{root.innerHTML=`<section class="intro"><h1>Open your next adventure.</h1><p>${esc(e.message)}</p><a class="button primary" href="/">Sign in to LessonScope</a><a class="button" href="/moonquest/join">Join as a learner</a></section>`;});
})();
