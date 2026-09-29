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
  function stopPoll() { clearTimeout(pollTimer); }
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
    root.innerHTML = `<section class="hero"><div><p class="eyebrow">An adventure in understanding</p><h1>Small thinkers.<br>One giant moon mission.</h1><p>A mischievous alien has scrambled the festival lanterns. Your class can restore them—one discovery, discussion and clever choice at a time.</p><div class="row">${button('＋ Create a diagram game','new','primary')}${button('Try the senses example','sample')}</div></div>${mascot()}</section>
      ${works.size?`<h2>Your drafts</h2><div class="cards">${[...works.values()].map(d=>`<article class="card"><span class="pill">DRAFT · not ready for learners</span><h3>${esc(d.title)}</h3><button data-resume-draft="${esc(d.id)}">Continue draft</button></article>`).join('')}</div>`:''}
      <div class="row spread"><h2>Your adventures</h2><a class="button" href="/">Back to LessonScope</a></div>
      <div class="cards">${library.games.map(g => `<article class="card"><span class="pill">MOON FESTIVAL · ${g.questions} questions</span><h3 style="margin-top:18px">${esc(g.title)}</h3><p>${esc(g.subject)} · ${esc(g.grade)}</p><div class="row"><button data-edit="${g.id}">Edit</button><button class="primary" data-host="${g.id}">Set up class</button><button data-test="${g.id}">Test game</button></div></article>`).join('') || '<div class="panel"><h3>Your first mission starts with a diagram</h3><p class="muted">Upload a picture, mark answer areas and prepare your questions. No lesson plan is required.</p></div>'}</div>
      <h2 style="margin-top:25px">Recent missions</h2><div class="stack">${library.sessions.map(s => `<article class="panel row spread"><div><strong>${esc(s.title)}</strong><p class="muted">${esc(s.className)} · ${s.test?'Practice · ':''}${esc(s.phase)}</p></div><div class="row"><button data-session="${s.id}">Open room</button><button data-report="${s.id}">View learning</button></div></article>`).join('') || '<p class="muted">Your class reports will appear here. MoonQuest does not change class averages.</p>'}</div>`;
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
    root.innerHTML=`<section class="intro">${mascot()}<p class="eyebrow">Assemble your crew</p><h1>${esc(g.title)}</h1><p>Choose one class for this mission. Each learner selects their name and enters their usual PIN.</p><div class="panel stack"><label>Class<select id="host-class">${library.rosters.map(r=>`<option value="${r.id}">${esc(r.name)} · ${r.count} learners</option>`).join('')}</select></label><button class="primary" data-start="${id}" ${library.rosters.length?'':'disabled'}>Create classroom room</button><button data-test="${id}">Test with practice learners</button></div>${button('Back','home')}</section>`;
  }
  async function launch(id,test=false) {
    const response=await api('/games/'+id+'/sessions',{test,rosterId:document.getElementById('host-class')?.value});await openSession(response.id,'teacher');
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
      const key=role==='student'?JSON.stringify([state.round,state.phase,state.paused,state.deadline,state.mine,state.canAnswer,state.stats,state.story,state.reward]):[state.seq,role].join(':');
      if(key!==lastRender){renderLive();lastRender=key;}const c=document.getElementById('connection');if(c){c.textContent='Connected';c.classList.remove('interrupted');}
      if(role==='teacher'&&!state.test){
        const queued=state.queue.find(q=>q.status==='needs-review'&&!q.suggestion&&!q.attempts&&!autoSuggestions.has(q.id));
        if(queued){autoSuggestions.add(queued.id);api('/sessions/'+sessionId+'/suggest',{queueId:queued.id},{timeout:25000}).then(()=>{lastRender='';}).catch(()=>tell('A later challenge needs your input. You can write it or retry AI while the class continues.'));}
      }
    }catch(e){lastRender='';const c=document.getElementById('connection');if(c){c.textContent='Reconnecting… Your saved answer is safe.';c.classList.add('interrupted');}else {root.innerHTML=`<section class="intro"><h1>Let’s reconnect.</h1><p>${esc(e.message)}</p><div class="row"><a class="button" href="/moonquest/join">Rejoin as a learner</a><a class="button" href="/">Teacher sign-in</a></div></section>`;}document.querySelectorAll('[data-region-answer]').forEach(b=>b.disabled=true);}
    finally{polling=false;if(view==='live')pollTimer=setTimeout(poll,1100);}
  }
  function presenterControls(s) {
    const owner=role==='teacher'||s.canControl;
    if(!owner)return s.paused?`<p class="board-signin">Paused for teaching. <a class="button" href="/moonquest?session=${s.id}">Open signed-in teacher controls</a></p>`:'';
    return `<div class="teacher-transport control presenter-controls" aria-label="Presentation controls">${s.phase==='lobby'?button('Begin mission','launch','primary'):''}${s.phase==='intro'&&!s.paused?button('Skip intro','skip-intro'):''}${!['lobby','ended'].includes(s.phase)?button(s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'Continue after discussion':s.paused?'Resume':'Pause',s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'continue-meeting':'pause'):''}${s.deadline&&!s.singleTimer&&s.phase!=='intro'?button('+10 seconds','extend'):''}</div>`;
  }
  function storyScene(s) {
    const elapsed=Math.min(24,Math.max(0,(s.introElapsedMs||0)/1000));
    return `${presenterControls(s)}<section class="opening-scene" aria-label="MoonQuest opening story"><div class="opening-brand">MOONQUEST<span>SAVE THE FESTIVAL</span></div><div class="crawl-window"><div class="story-crawl" style="--elapsed:-${elapsed}s;animation-play-state:${s.paused?'paused':'running'}"><p class="episode">MISSION ONE</p><h1>THE VANISHING LIGHT</h1><p>Above our world, the Moon Festival is growing dark.</p><p>Pip has mixed up the signals that guide the lanterns home.</p><p>The moon rabbit needs your help.</p><p>The heroes of Vinschool are ready.<br>That means YOU.</p><p>Look carefully. Choose wisely.<br>Share your reasons.</p><p>Protect your school.<br>Together, bring the light back.</p></div></div><div class="launch-status"><span>${s.paused?'Story paused':'Your mission begins soon'}</span><div id="timer" class="timer" role="timer"></div></div></section>`;
  }
  function liveControls() {
    const s=state;
    return `<aside class="teacher-private"><div class="panel"><span class="eyebrow">Teacher controls · private</span><div class="control" style="margin-top:12px">${!s.paused&&(s.phase==='lobby'||s.phase==='reveal')?button(s.phase==='lobby'?'Begin mission':'Next question',s.phase==='lobby'?'launch':'next','primary'):''}${s.phase==='read'?button('Open answers','open','primary'):''}${!s.automatic&&['choose','discuss','reconsider'].includes(s.phase)?button({choose:'Begin discussion',discuss:'Reconsider',reconsider:'Reveal answer'}[s.phase],'advance','primary'):''}${!['lobby','ended'].includes(s.phase)?button(s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'Continue after discussion':s.paused?'Resume':'Pause',s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'continue-meeting':'pause'):''}${s.deadline&&!s.singleTimer?button('+10 seconds','extend'):''}</div>
      ${s.teachingPause?`<p class="teaching-alert">${s.teachingPause==='misconception'?'Class meeting discussion. Ask learners to explain their reasoning, then continue when the class is ready.':s.teachingPause==='attendance'?'No learners are currently included. Include learners below before resuming.':'Some answers are missing. Check devices and understanding before continuing.'}</p>`:''}${s.automatic?'<p class="muted">One round timer. Invite partner discussion before it runs out. Continue after a class meeting when you are ready.</p>':''}${s.recovered?'<p class="error">Session recovered safely and paused. Resume when the class is ready.</p>':''}
      ${s.phase!=='ended'?`<div class="learner-invite"><label>${s.test?'Practice link':'Learner game link'}<input id="learner-link" readonly value="${esc(location.origin+'/moonquest/join?code='+s.code)}"></label>${button(s.test?'Copy practice link':'Copy learner link','copy-learner-link','primary')}<p class="muted">${s.test?'Practice only: opens without a name or PIN.':'Send this link to your class. Learners select their name and enter their usual PIN. No room code to type.'}</p></div>`:''}
      <div class="row"><a class="button small" target="_blank" rel="noopener noreferrer" href="/moonquest?session=${s.id}&board=${s.boardToken}">Open Smartboard</a>${button('Replace board link','rotate-board','small')}</div>
      <p class="muted">Keep this teacher view off the projector. The Smartboard shows names and response status, but keeps individual answers and private suggestions hidden.</p>
      ${s.test?`<p class="muted">Scan the QR to join as a practice learner—no name or PIN. Simulation fills only the remaining practice learners.</p><a class="button small" target="_blank" rel="noopener" href="/moonquest/join?code=${s.code}">Open practice learner</a>`:''}
      ${s.test&&['choose','reconsider'].includes(s.phase)?`<div class="stack">${button('Simulate learner answers','simulate')}${button('Simulate a misconception','simulate-misconception')}</div>`:''}
      <div class="row" style="margin-top:12px">${button('View report','report','small')}${s.phase!=='ended'?button('Finish mission','end','small'):''}${button('Adventures','home','small')}</div></div>
      ${s.unansweredLearners?.length?`<section class="panel unanswered-private"><h3>No answer received · ${s.unansweredLearners.length}</h3><p class="muted">Private teacher list · question ${s.unansweredRound+1}</p><ul>${s.unansweredLearners.map(l=>`<li>${esc(l.name)}</li>`).join('')}</ul></section>`:''}
      <div class="panel"><h3>Crew check-in · ${s.joined}/${s.learners.filter(l=>!l.removed).length}</h3><p class="muted">${s.phase==='reconsider'?'✓ means confirmed during reconsideration. The first choice is kept otherwise.':'✓ means a first choice has been saved.'}</p><p class="muted">Remove learners from this mission only. Saved answers and class rosters are kept. Add them back for a later round.</p><div class="learners">${s.learners.map(l=>`<div class="learner ${l.answered?'has-answered':''}"><span>${s.phase==='reconsider'?l.confirmed?'✓':'○':l.answered?'✓':l.joined?'●':'○'} ${esc(l.name)} ${l.removed?'· removed':l.absent?'· away':''}</span><button data-remove-learner="${esc(l.id)}" data-removed="${!l.removed}">${l.removed?'Add back':'Remove'}</button>${!l.removed&&l.joined&&['lobby','reveal'].includes(s.phase)?`<button data-attendance="${esc(l.id)}" data-absent="${!l.absent}">${l.absent?'Include':'Away'}</button>`:''}</div>`).join('')}</div></div>
      <div id="queue-panel"></div></aside>`;
  }
  function learnerQuestion(s,selected,answerOpen) {
    const reveal=s.phase==='reveal', locked=!!s.mine?.first&&!changingAnswer;
    return `<section class="learner-question"><div class="question-focus"><span class="question-label">QUESTION ${s.round+1}</span><h1>${esc(s.question.prompt)}</h1></div>${rabbitTimer()}</section>
      <p class="learner-prompt">${s.paused?'Class meeting discussion':reveal?(s.myCorrect?'You found it!':'Let’s discover the answer.'):`Choose ${s.question.selectionCount>1?s.question.selectionCount+' answers':'ONE answer'}`}</p>
      <section class="learner-workspace"><div class="learner-picture">${diagramHtml(s.diagram,selected,s.question.accepted||[])}</div><aside class="learner-answer-tools">
      <div class="region-list">${s.diagram.regions.map(r=>`<button data-region-answer="${esc(r.id)}" aria-pressed="${selectedIds(selected).includes(r.id)}" class="${selectedIds(selected).includes(r.id)?'selected ':''}${s.question.accepted?.includes(r.id)?'correct':''}" ${!answerOpen?'disabled':''}>${selectedIds(selected).includes(r.id)?'✓ ':''}${esc(r.label)}</button>`).join('')}</div>
      <div id="answer-status" class="answer-status" role="status">${reveal?esc(s.question.explanation):locked?'Answer locked in ✓':pendingChoices.length?pendingChoices.length+' selected':changingAnswer?'Choose your new answer.':'Tap the picture to choose.'}</div>
      ${!reveal&&!s.paused&&s.canAnswer?`<div class="answer-actions">${locked?button('Change my answer','change-answer'):s.question.selectionCount>1?`<button data-action="lock-answer" class="primary" ${pendingChoices.length!==s.question.selectionCount?'disabled':''}>Lock in my answers</button>`:''}${changingAnswer?button('Keep my saved answer','cancel-change'):''}${s.singleTimer&&s.phase==='choose'?`<button data-action="request-time" ${s.extraTimeUsed?'disabled':''}>${s.extraTimeUsed?'10 extra seconds added':'Need more time'}</button>`:''}</div>`:''}</aside></section>`;
  }
  function renderLive() {
    const previousImage=root.querySelector('#diagram img');
    document.body.classList.remove('learner-round');document.body.dataset.view='live'; document.body.dataset.audience=role; document.body.dataset.phase=state.phase;
    const s=state,teacher=role==='teacher';document.body.classList.toggle('mission-paused',!!s.paused);document.body.dataset.answerLocked=String(!!s.mine?.first);
    if(answerRound!==s.round){answerRound=s.round;changingAnswer=false;pendingChoices=[];}
    const selected=changingAnswer||pendingChoices.length?pendingChoices:s.mine?.final||s.mine?.first;
    const answerOpen=role==='student'&&s.canAnswer&&!s.paused&&['choose','reconsider'].includes(s.phase)&&!(s.automatic&&s.phase==='choose'&&s.mine?.first&&!changingAnswer);
    // Preserve edits in queued questions while answer counts update.
    const focus=document.activeElement, focusQueue=focus?.closest('[data-queue]')?.dataset.queue, focusField=focus?.hasAttribute('data-prompt')?'data-prompt':'data-explanation', focusStart=focus?.selectionStart, focusEnd=focus?.selectionEnd;
    const queued=queueEdits;
    const titles={lobby:'The moon needs your crew.',read:'A new challenge has arrived.',choose:'Choose your answer.',discuss:'Discuss your choice with your partner.',reconsider:'Are you sure about your answer?',reveal:'Let’s discover why.',ended:'You brought light to the festival!'};
    document.body.classList.toggle('celebrate',s.phase==='ended');
    if(s.phase==='intro'){root.innerHTML=storyScene(s);updateTimer();return;}
    if(s.story&&['story-vote','story-action'].includes(s.phase)){root.innerHTML=storyChoiceScene(s);const missing=root.querySelector('.unanswered-private');if(missing)root.querySelector('.teacher-private').prepend(missing);updateTimer();return;}
    root.innerHTML=`${role==='board'?presenterControls(s):''}${s.test?'<div class="preview-note">Teacher test · Practice learners only · No class marks are saved</div>':''}<div class="row spread mission-meta"><span class="pill">${esc(s.title)}</span><span class="connection" id="connection">Connected</span><span class="pill">${s.lanterns} lantern sparks</span>${s.reward?`<span class="pill reward-progress">Your moon sparks: ${s.reward.sparks} · ${s.reward.available>=2?'Story vote ready':(2-s.reward.available)+' more to earn a vote'}</span>`:''}</div>
      <section class="stage" style="margin-top:24px"><p class="eyebrow">${s.phase==='lobby'?'MOON FESTIVAL RESCUE':s.phase==='ended'?'MISSION COMPLETE':'Challenge '+(s.round+1)}</p>${s.question&&s.phase!=='ended'?`<div class="question-focus"><span class="question-label">QUESTION ${s.round+1}</span><h1>${esc(s.question.prompt)}</h1></div><h2 class="stage-instruction">${s.paused&&s.teachingPause==='misconception'&&s.singleTimer?'Class meeting discussion':s.paused?'Pause and talk together':s.singleTimer&&s.phase==='choose'?'Think, choose and share your reasons.':titles[s.phase]}</h2>`:`<h1>${titles[s.phase]}</h1>`}${rabbitTimer()}</section>
      ${role==='student'&&s.heroName&&['lobby','ended'].includes(s.phase)?`<p class="hero-welcome">${esc(s.heroName)}, you are a Vinschool hero.</p>`:''}${role==='board'&&!soundEnabled?button('Enable countdown sounds','enable-audio','small'):''}${role!=='student'?dashboard(s)+schoolScene(s):''}<div class="live-layout ${teacher?'':'solo'}"><div>${s.phase==='lobby'?`<section class="intro">${mascot()}<h2>Outsmart Pip. Restore the lanterns.</h2><p>Pip has scrambled the festival signals! Choose carefully, explain your thinking to a partner, then lock in your rescue plan. Every discovery adds light to our sky.</p>${role==='student'?'<p class="stat">You’re in the crew!</p><p>Wait for your teacher to begin.</p>':`<p>On learner devices, open <strong>${esc(location.host)}/moonquest/join</strong></p>${s.code?`<p class="code">${s.code}</p><img class="qr" alt="Scan to join this MoonQuest room" src="${base}/sessions/${s.id}/${teacher?'qr':'board-qr?board='+encodeURIComponent(new URLSearchParams(location.search).get('board'))}">`:''}`}<p class="muted">${s.joined} learners ready</p></section>`:
      s.phase==='ended'?`<section class="intro">${mascot()}<p class="stat">${s.lanterns} sparks of understanding</p><p>The lanterns shine again, and the moon rabbit can find the way home. Your careful choices and conversations made the difference.</p>${teacher?button('Explore the learning report','report','primary'):''}</section>`:
      `<div class="diagram-wrap">${role==='student'&&s.phase==='choose'?`<div class="selection-rule">${s.question.selectionCount>1?`Choose ${s.question.selectionCount} answers`:"Choose ONE answer"}${s.question.answerMode==='one'?' · One area is enough':' · Select the complete set'}</div>`:''}${diagramHtml(s.diagram,selected,s.question?.accepted||[])}<div class="region-list">${s.diagram.regions.map(r=>`<button data-region-answer="${esc(r.id)}" class="${selectedIds(selected).includes(r.id)?'selected ':''}${s.question?.accepted?.includes(r.id)?'correct':''}" ${!answerOpen?'disabled':''}>${esc(r.label)}</button>`).join('')}</div>
      ${role==='student'&&s.singleTimer&&s.phase==='choose'&&s.canAnswer?`<div class="answer-actions"><button data-action="request-time" ${s.extraTimeUsed||s.paused?'disabled':''}>${s.extraTimeUsed?'Extra 10 seconds added for everyone':'Need more time'}</button></div>`:''}
      <div class="answer-status" id="answer-status" role="status">${role==='student'?(!s.canAnswer?'Watch this round. You can answer from the next question.':s.mine?.first&&!changingAnswer?'Answer locked in ✓':changingAnswer?'Choose your new answer. Your saved answer stays until you lock in the replacement.':pendingChoices.length?`${pendingChoices.length}/${s.question.selectionCount} selected`:'Select your answer on the diagram or use the buttons.'):`${s.answered} of ${s.expected} learners have chosen`}</div>
      ${role==='student'&&(s.singleTimer||s.question.selectionCount>1)&&['choose','reconsider'].includes(s.phase)&&!s.paused?`<div class="answer-actions">${s.singleTimer&&s.mine?.first&&!changingAnswer?button('Change my answer','change-answer'):s.question.selectionCount>1?`<button data-action="lock-answer" class="primary" ${pendingChoices.length!==s.question.selectionCount?'disabled':''}>Lock in my answers</button>`:''}${changingAnswer?button('Keep my saved answer','cancel-change'):''}</div>`:''}
      ${['discuss','reconsider'].includes(s.phase)?`<div class="discussion-cue"><strong>${s.phase==='discuss'?'I chose this because…':'Keep your choice or tap a new answer.'}</strong><p>${s.phase==='discuss'?'Take turns explaining. Ask your partner: Why?':'Your first choice stays saved if you keep it.'}</p></div>`:''}
      ${s.phase==='reveal'?`<div class="panel">${role==='student'&&s.automatic?`<p class="learner-result">${!selected?'Let’s discover the answer together.':s.myCorrect===true?'You found it! Explain why it fits.':'A new discovery! Look at the highlighted answer.'}</p>`:''}<div class="row spread"><span class="stat">${s.stats.correct} correct</span><span>${s.stats.wrong} incorrect</span><span>${s.stats.unanswered} unanswered</span></div><p class="reveal-explanation">${esc(s.question.explanation)}</p>${s.question.accepted.length>1?`<p class="answer-rule-reveal">${s.question.answerMode==='all'?`All ${s.question.selectionCount} highlighted areas were needed.`:'Any ONE of the highlighted areas is correct.'}</p>`:''}<p class="muted">${s.stats.improved} learners moved from an incorrect first choice to a correct answer after revising their answer.</p></div>`:''}</div>`}</div>${teacher?liveControls():''}</div>`;
    const learnerRound=role==='student'&&s.question&&!['lobby','ended'].includes(s.phase);
    document.body.classList.toggle('learner-round',!!learnerRound);
    if(learnerRound)root.innerHTML=learnerQuestion(s,selected,answerOpen);
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
    updateTimer();revealFireworks(s);
  }
  function fitDiagram(){
    if(view!=='live')return;const box=document.getElementById('diagram'),img=box?.querySelector('img');if(!img?.naturalWidth)return;
    if(document.body.classList.contains('learner-round')){
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
      o.frequency.value=seconds<=5?740:440;
      const volume=Number(document.getElementById('effects-level').value)/100;
      g.gain.setValueAtTime(volume*(seconds<=5?.13:.045),t);g.gain.exponentialRampToValueAtTime(.001,t+.09);
      o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.1);
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
    const progress=s.phase==='ended'?3:Math.min(3,s.storyProgress||0);
    return `<section class="festival-school chapter-${progress}" aria-label="Vinschool Moon Festival courtyard"><img src="/moonquest-art/vinschool-festival.webp" alt="Cartoon Vinschool courtyard decorated for the Moon Festival"><div class="festival-caption"><span class="eyebrow">${['THE LIGHT IS WAITING','ENTRANCE RESTORED','COURTYARD GLOWING','FESTIVAL OF DISCOVERY'][progress]}</span><strong>${s.phase==='ended'?'Together, you brought the light back.':'Every discovery brings us closer.'}</strong></div><div class="festival-rabbit">${mascot()}</div><div class="restored-lights" aria-hidden="true">${'🏮 '.repeat(progress+1)}</div><div class="festival-heroes">${(s.crew||[]).map(l=>`<span class="hero-lantern ${l.answered&&s.phase==='choose'?'lit':''}">${l.answered&&s.phase==='choose'?'✦ ':''}${esc(l.name)}</span>`).join('')}</div></section>`;
  }
  function rabbitTimer(){return `<div class="rabbit-timer"><div class="rabbit-guide" aria-hidden="true">${mascot()}</div><div class="countdown-lantern"><span class="timer" id="timer" role="timer" aria-label="Seconds remaining"></span></div></div>`;}
  function storyIcon(id){
    const shapes={
      bridge:'<path d="M15 91Q60 62 105 91" fill="none" stroke="#e7c782" stroke-width="7"/><path d="M60 14V30M60 83V106" stroke="#f6d384" stroke-width="4"/><rect x="32" y="28" width="56" height="57" rx="23" fill="#ce5960" stroke="#ffdda0" stroke-width="3"/><path d="M48 30Q36 56 48 83M72 30Q84 56 72 83M60 29V84" fill="none" stroke="#ffdb96" stroke-width="2"/>',
      stars:'<path d="M60 12L72 43L105 45L79 67L87 100L60 83L32 100L40 67L15 45L48 43Z" fill="#ffe09b" stroke="#d8a853" stroke-width="3"/><path d="M22 106Q56 93 62 70" fill="none" stroke="#b5e8cf" stroke-width="4" stroke-dasharray="3 7"/>',
      mooncakes:'<circle cx="60" cy="61" r="40" fill="#d59049" stroke="#ffdc8b" stroke-width="9" stroke-dasharray="6 5"/><circle cx="60" cy="61" r="30" fill="#eab66a" stroke="#ad6b39" stroke-width="2"/><path d="M60 35Q82 41 69 61Q82 82 60 88Q38 82 51 61Q38 41 60 35Z" fill="none" stroke="#ad6b39" stroke-width="3"/>',
      garden:'<path d="M60 108V65M60 95Q25 99 21 74Q48 68 60 95M60 83Q93 85 101 58Q75 55 60 83" fill="#8ed3b4" stroke="#589b88" stroke-width="2"/><path d="M60 70Q21 61 26 33Q52 32 60 52Q68 30 94 33Q99 63 60 70M60 68Q37 35 60 12Q83 35 60 68" fill="#ed9299" stroke="#ffdbad" stroke-width="3"/>',
      kite:'<path d="M60 12L98 49L60 83L22 49Z" fill="#91d8cc" stroke="#f9d88d" stroke-width="3"/><path d="M60 12V83M22 49H98M60 83Q91 97 50 110" fill="none" stroke="#fff0bc" stroke-width="3"/>'
    };
    return `<svg viewBox="0 0 120 120" aria-hidden="true" class="story-illustration">${shapes[id]||shapes.bridge}</svg>`;
  }
  function storyChoiceScene(s){
    const c=s.story,choice=c.options[c.winner||0],action=s.phase==='story-action';
    return `${role==='board'?presenterControls(s):''}<div class="story-workspace"><section class="story-chapter ${action?'playing-'+esc(choice.id):''}"><p class="eyebrow">YOUR CREW CHOOSES THE ADVENTURE</p><h1>${esc(c.title)}</h1>${schoolScene(s)}${action?`<div class="story-result action-${esc(choice.id)}"><span class="story-object" aria-hidden="true">${storyIcon(choice.id)}</span><h2>${esc(choice.title)}</h2><p>${esc(choice.result)}</p>${c.tied?'<p class="coin-flip">✦ Rabbit coin flip · a tie decided our route!</p>':c.noVotes?'<p>The rabbit picked a path to keep our adventure moving.</p>':''}</div>`:`<p>${role==='student'?(c.myVote?'Your story vote is locked. Watch what happens next!':c.canVote?'You earned a choice! What should the rabbit do?':'Cheer on the crew! Two correct answers earn your next story vote.'):'Learners with two moon sparks choose the next action.'}</p><div class="story-options">${c.options.map(o=>`<button data-story-choice="${o.id}" ${role!=='student'||!c.canVote||s.paused?'disabled':''} class="${c.myVote===o.id?'chosen':''}"><span aria-hidden="true">${storyIcon(o.id)}</span>${esc(o.title)}</button>`).join('')}</div><p>${c.voted}/${c.eligibleCount} story votes received</p>`}${rabbitTimer()}</section>${role==='teacher'?liveControls():''}</div>`;
  }
  function revealFireworks(s){
    if(!['reveal','ended'].includes(s.phase)||!s.revealedAt)return;
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
      state=await api('/sessions/'+sessionId+'/answer',{regionIds:state.question.selectionCount>1?pendingChoices:[regionId],changeConfirmed:changingAnswer,round:state.round,phase:state.phase,eventId:uid()});
      pendingChoices=[];changingAnswer=false;lastRender='';renderLive();
    }catch(e){tell(e.message,true);if(el)el.textContent='Not saved yet. Check your connection and try again.';}finally{busyAnswer=false;}
  }
  async function command(action,extra={}){const s=await api('/sessions/'+sessionId+'/command',{action,presentation:role==='board',seq:state.seq,round:state.round,phase:state.phase,paused:state.paused,...extra});state=s;lastRender='';renderLive();}
  async function report(id) {
    stopPoll();view='report';const r=await api('/sessions/'+id+'/report');
    root.innerHTML=`<div class="row spread"><div><p class="eyebrow">Learning, made visible</p><h1 style="font-size:38px">${esc(r.title)}</h1><p>${esc(r.className)}${r.test?' · Practice only':''}</p></div><div class="row"><button data-session="${id}">Back to room</button>${button('Adventures','home')}</div></div><div class="panel"><h3>First choice → final choice → later application</h3><p class="muted">These are formative results and do not change class averages. Later checks follow feedback, so they are shown separately from independent first attempts.</p>${button('Download CSV','csv')}</div><div class="report-wrap"><table><thead><tr><th>Learner</th>${r.rounds.map(q=>`<th>${q.followUp?'Later check':'First encounter'} · ${q.number}<p>${esc(q.prompt)}</p>${q.completed?'':'(not completed)'}</th>`).join('')}</tr></thead><tbody>${r.students.map(st=>`<tr><th>${esc(st.name)}</th>${st.rounds.map(a=>`<td>${!a.expected?'Not in this round':`${esc(a.initial||'Unanswered')} ${a.initialCorrect===true?'✓':a.initialCorrect===false?'✗':''}<br>→ ${esc(a.revised||'Unanswered')} ${a.revisedCorrect===true?'✓':a.revisedCorrect===false?'✗':''}<br><small>${a.confirmed?'Confirmed':'First choice retained if present'}</small>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    root.querySelector('[data-action="csv"]').onclick=()=>{
      const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
      const rows=[['Student ID','Learner','Question','Stage','Initial choice','Initial correct','Final choice','Final correct','Confirmed']];r.students.forEach(st=>st.rounds.forEach((a,i)=>rows.push([st.id,st.name,r.rounds[i].prompt,r.rounds[i].followUp?'Later check':'Initial encounter',a.initial,a.initialCorrect??'',a.revised,a.revisedCorrect??'',a.confirmed])));
      const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='moonquest-learning.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  }
  async function joinPage(code='') {
    view='join';root.innerHTML=`<section class="intro">${mascot()}<p class="eyebrow">Join the rescue crew</p><h1>Your moon mission awaits.</h1><div class="panel stack"><label>Room code<input id="room-code" autocomplete="off" maxlength="10" value="${esc(code)}" placeholder="Teacher’s 10-character code"></label>${button('Find my crew','find-room','primary')}<div id="join-class"></div></div></section>`;
    if(code){await findRoom();const input=document.getElementById('room-code');if(input){input.closest('label').hidden=true;root.querySelector('[data-action=find-room]').hidden=true;}}
  }
  async function findRoom() {
    const code=document.getElementById('room-code').value.trim().toUpperCase();
    room=await api('/rooms/'+encodeURIComponent(code));
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
      else if(['continue-meeting','launch','skip-intro','next','open','advance','pause','extend','rotate-board'].includes(action))await command(action);
      else if(action==='end'){if(confirm('Finish this mission? Learners will no longer be able to answer.'))await command('end');}
      else if(action==='simulate'||action==='simulate-misconception'){state=await api('/sessions/'+sessionId+'/simulate',{pattern:action==='simulate-misconception'?'misconception':'mixed'});renderLive();}
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
