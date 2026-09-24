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
  const autoSuggestions = new Set();
  const queueEdits = {};
  let musicTimer, musicEnabled=false, musicStep=0;
  const tones=[261.63,329.63,392,440,392,329.63,293.66,329.63,220,293.66,329.63,392,329.63,293.66,261.63,196];
  function musicNote(){
    if(!musicEnabled||document.hidden)return;
    try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain(),now=audio.currentTime,volume=Number(document.getElementById('music-level').value)/100;o.type='sine';o.frequency.value=tones[musicStep++%tones.length];g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(volume*.09,now+.06);g.gain.exponentialRampToValueAtTime(.001,now+1.1);o.connect(g);g.connect(audio.destination);o.start();o.stop(now+1.2);}catch{}
  }
  document.getElementById('music').onclick=()=>{musicEnabled=!musicEnabled;const b=document.getElementById('music');b.textContent=musicEnabled?'Music on':'Music off';b.setAttribute('aria-pressed',String(musicEnabled));clearInterval(musicTimer);if(musicEnabled){musicNote();musicTimer=setInterval(musicNote,560);}};
  function tell(message, error = false) { clearTimeout(noticeTimer); notice.textContent = message; notice.classList.toggle('error', error); noticeTimer = setTimeout(() => { notice.textContent = ''; }, error ? 15000 : 6500); }
  async function api(url, data, opts = {}) {
    const response = await fetch(base + url, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(learnerToken ? { Authorization: 'Bearer ' + learnerToken } : {}) }, ...(data === undefined ? {} : { body: data instanceof FormData ? data : JSON.stringify(data) }), signal: AbortSignal.timeout(opts.timeout || 12000) });
    const result = await response.json().catch(() => ({ error: 'LessonScope could not return this request. Please try again.' }));
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }
  function stopPoll() { clearTimeout(pollTimer); }
  function chime() {
    if (!soundEnabled) return;
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); [523.25,659.25,783.99].forEach((f,i) => { const o=audio.createOscillator(),g=audio.createGain(), t=audio.currentTime+i*.1; o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(Number(document.getElementById('effects-level').value)/100*.13,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.45);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.5); }); } catch {}
  }
  document.getElementById('sound').onclick = () => { soundEnabled = !soundEnabled; document.getElementById('sound').textContent = soundEnabled ? 'Sound on' : 'Sound off'; document.getElementById('sound').setAttribute('aria-pressed', String(soundEnabled)); chime(); };
  document.getElementById('full').onclick = async () => { try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { tell('Use your browser’s full-screen option.'); } };
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  function nav(url) { history.pushState({}, '', url); }
  window.addEventListener('popstate', () => location.reload());

  async function home() {
    document.body.dataset.view='library';
    stopPoll(); view = 'library'; state = null; sessionId = null; learnerToken = ''; dirty = false;
    library = await api('/library'); nav('/moonquest');
    root.innerHTML = `<section class="hero"><div><p class="eyebrow">An adventure in understanding</p><h1>Small thinkers.<br>One giant moon mission.</h1><p>A mischievous alien has scrambled the festival lanterns. Your class can restore them—one discovery, discussion and clever choice at a time.</p><div class="row">${button('＋ Create a diagram game','new','primary')}${button('Try the senses example','sample')}</div></div>${mascot()}</section>
      <div class="row spread"><h2>Your adventures</h2><a class="button" href="/">Back to LessonScope</a></div>
      <div class="cards">${library.games.map(g => `<article class="card"><span class="pill">MOON FESTIVAL · ${g.questions} questions</span><h3 style="margin-top:18px">${esc(g.title)}</h3><p>${esc(g.subject)} · ${esc(g.grade)}</p><div class="row"><button data-edit="${g.id}">Edit</button><button class="primary" data-host="${g.id}">Set up class</button><button data-test="${g.id}">Test game</button></div></article>`).join('') || '<div class="panel"><h3>Your first mission starts with a diagram</h3><p class="muted">Upload a picture, mark answer areas and prepare your questions. No lesson plan is required.</p></div>'}</div>
      <h2 style="margin-top:25px">Recent missions</h2><div class="stack">${library.sessions.map(s => `<article class="panel row spread"><div><strong>${esc(s.title)}</strong><p class="muted">${esc(s.className)} · ${s.test?'Practice · ':''}${esc(s.phase)}</p></div><div class="row"><button data-session="${s.id}">Open room</button><button data-report="${s.id}">View learning</button></div></article>`).join('') || '<p class="muted">Your class reports will appear here. MoonQuest does not change class averages.</p>'}</div>`;
  }
  function emptyDraft() { return { title: 'Save the Moon Festival', subject:'', grade:'Grade 3', diagrams:[], questions:[], timing:{choose:30,discuss:20,reconsider:8}, reviewed:false }; }
  function imageUrl(asset) { return base + '/assets/' + asset; }
  function diagramHtml(d, selection, accepted = [], edit = false) {
    if (!d) return '<div class="panel"><p>Upload a diagram to begin.</p></div>';
    return `<div class="diagram" id="diagram"><img src="${imageUrl(d.asset)}" alt="${esc(d.title || 'Lesson diagram')}" draggable="false"><svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="${edit?'Draw answer areas':'Choose an answer area'}">${d.regions.map((r, i) => `<polygon data-region="${esc(r.id)}" points="${r.points.map(p=>p.join(',')).join(' ')}" class="${selection===r.id?'selected ':''}${accepted.includes(r.id)?'correct':''}" tabindex="${edit?'-1':'0'}" role="button" aria-label="${esc(r.label)}" aria-pressed="${selection===r.id}"><title>${i+1}. ${esc(r.label)}</title></polygon>`).join('')}<polygon class="draft" id="drawing" points=""></polygon></svg></div>`;
  }
  function captureEditor() {
    if (view !== 'editor') return;
    for (const key of ['title','subject','grade']) draft[key] = document.getElementById('mq-'+key)?.value || '';
    ['choose','discuss','reconsider'].forEach(k => { draft.timing[k] = Number(document.getElementById('time-'+k)?.value || draft.timing[k]); });
    draft.reviewed = !!document.getElementById('reviewed')?.checked;
    document.querySelectorAll('[data-question]').forEach(el => {
      const q = draft.questions.find(q => q.id===el.dataset.question); if (!q) return;
      ['prompt','concept','explanation'].forEach(k => { q[k] = el.querySelector('[data-field='+k+']').value; });
      q.accepted = [...el.querySelectorAll('input[data-accepted]:checked')].map(x=>x.value);
    });
  }
  function editor() {
    document.body.dataset.view='editor';
    stopPoll(); view='editor'; drawn=[];drawing=false;
    const d=draft.diagrams[activeDiagram];
    const selectedRegion=d?.regions.find(r=>r.id===regionEditing);
    const bounds=selectedRegion?regionBounds(selectedRegion):null;
    root.innerHTML=`<div class="row spread"><div><p class="eyebrow">Mission workshop</p><h1 style="font-size:38px">Build a discovery.</h1></div>${button('Back to adventures','home')}</div>
      <section class="panel grid"><label>Game title<input id="mq-title" maxlength="120" value="${esc(draft.title)}"></label><div class="grid"><label>Subject<input id="mq-subject" value="${esc(draft.subject)}"></label><label>Learner level<input id="mq-grade" value="${esc(draft.grade)}"></label></div></section>
      <section class="panel"><h2>1. Make your diagram clickable</h2><p class="muted">Upload a clear PNG, JPEG or WebP (up to 8 MB). Give each area a label, then draw it. Areas and labels should identify locations, without giving away the answer.</p>
      <div class="row"><label class="button">＋ Add diagram<input id="upload" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>${draft.diagrams.length?`<label>Current diagram<select id="diagram-select">${draft.diagrams.map((x,i)=>`<option value="${i}" ${i===activeDiagram?'selected':''}>${esc(x.title)}</option>`).join('')}</select></label>`:''}</div>
      ${d?`<div class="editor" style="margin-top:20px"><div>${diagramHtml(d,null,[],true)}<p class="muted">Rectangles and ellipses: tap two opposite corners. Polygon: tap each corner, then Finish area.</p></div><div class="stack"><label>Area label<input id="region-label" placeholder="e.g. Eyes" maxlength="100" value="${esc(selectedRegion?.label||'')}"></label>${bounds?`<div class="grid">${['x','y','w','h'].map(k=>`<label>${{x:'Left',y:'Top',w:'Width',h:'Height'}[k]} %<input id="region-${k}" type="number" min="0" max="100" step="0.1" value="${(bounds[k]*100).toFixed(1)}"></label>`).join('')}</div><div class="row">${button('Apply area changes','update-region','primary')}${button('New area','new-area')}</div><p class="muted">Or redraw this area below. Its linked answers will be preserved.</p>`:''}<label>Shape<select id="shape"><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon">Custom outline</option></select></label><div class="row">${button('Finish area','finish-area','primary')}${button('Undo corner','undo-corner')}</div><div>${d.regions.map(r=>`<div class="row spread" style="margin-bottom:8px"><span>${esc(r.label)}</span><div class="row"><button class="small" data-edit-region="${esc(r.id)}">Edit</button><button class="small danger" data-delete-region="${esc(r.id)}">Remove</button></div></div>`).join('')}</div><p class="muted">Avoid overlapping areas. Learners can also use the labelled answer buttons below the diagram.</p></div></div>`:''}</section>
      <section class="panel"><h2>2. Prepare the challenges</h2><p class="muted">Give each question a clear objective and explanation. Select all acceptable regions; learners choose one.</p><label>Objective for AI suggestions<textarea id="objective" placeholder="e.g. Identify the sense used to receive information from a device."></textarea></label><div class="row" style="margin:15px 0">${button('＋ Write a question','add-question')}${button('AI draft 5 questions · '+(library?.generationCost||0)+' credits','draft-ai')}</div><p class="muted">AI drafts need your review. During play, up to two AI attempts per flagged question are included.</p>
      <div id="questions">${draft.questions.map((q,i)=>`<article class="question-card" data-question="${q.id}"><div class="row spread"><h3>Challenge ${i+1} · ${esc(draft.diagrams.find(d=>d.id===q.diagramId)?.title)}</h3><button data-delete-question="${q.id}" class="small danger">Remove</button></div><div class="stack"><label>Question<textarea data-field="prompt" maxlength="600">${esc(q.prompt)}</textarea></label><label>Learning objective<input data-field="concept" maxlength="300" value="${esc(q.concept)}"></label><div><span class="muted">Acceptable answers</span><div class="row">${(draft.diagrams.find(d=>d.id===q.diagramId)?.regions||[]).map(r=>`<label><input type="checkbox" data-accepted value="${esc(r.id)}" ${q.accepted.includes(r.id)?'checked':''}> ${esc(r.label)}</label>`).join('')}</div></div><label>Explanation after reveal<textarea data-field="explanation" maxlength="800">${esc(q.explanation)}</textarea></label></div></article>`).join('')}</div></section>
      <section class="panel"><h2>3. Set the pace</h2><div class="grid">${['choose','discuss','reconsider'].map(k=>`<label>${{choose:'First choice',discuss:'Partner discussion',reconsider:'Reconsider'}[k]} · seconds<input id="time-${k}" type="number" min="5" max="${k==='choose'?180:k==='discuss'?120:60}" value="${draft.timing[k]}"></label>`).join('')}</div><p class="muted">You open each question, control the reveal and can pause or add time. First choices, revised choices and later checks remain separate.</p><label><input id="reviewed" type="checkbox" ${draft.reviewed?'checked':''}> I have checked the diagrams, questions, accepted answers and explanations.</label><div class="row" style="margin-top:18px">${button('Save adventure','save','primary')}</div></section>`;
    document.getElementById('upload').onchange = async e => { const file=e.target.files[0];if(!file)return;captureEditor();try{ const form=new FormData();form.append('file',file);const a=await api('/assets',form);draft.diagrams.push({id:uid(),title:file.name.replace(/\.[^.]+$/,''),asset:a.asset,regions:[]});activeDiagram=draft.diagrams.length-1;dirty=true;draft.reviewed=false;editor(); }catch(err){tell(err.message,true);} };
    if(d){document.getElementById('diagram-select').onchange=e=>{captureEditor();activeDiagram=Number(e.target.value);regionEditing=null;editor();};document.querySelector('#diagram svg').addEventListener('pointerdown',drawPoint);}
  }
  function drawPoint(e) {
    if(view!=='editor')return;
    const svg=e.currentTarget, rect=svg.getBoundingClientRect();
    const p=[Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))];
    drawn.push(p);drawing=true;
    const shape=document.getElementById('shape').value;
    if(shape!=='polygon'&&drawn.length===2){const [[x1,y1],[x2,y2]]=drawn;drawn=shape==='rectangle'?[[x1,y1],[x2,y1],[x2,y2],[x1,y2]]:Array.from({length:32},(_,i)=>[(x1+x2)/2+Math.abs(x2-x1)/2*Math.cos(i*Math.PI/16),(y1+y2)/2+Math.abs(y2-y1)/2*Math.sin(i*Math.PI/16)]);finishArea();return;}
    document.getElementById('drawing').setAttribute('points',drawn.map(p=>p.join(',')).join(' '));
    tell(`${drawn.length} corner${drawn.length===1?'':'s'} placed${shape==='polygon'?'. Finish when the outline is complete.':'. Tap the opposite corner.'}`);
  }
  function finishArea() {
    const label=document.getElementById('region-label').value.trim();
    if(!label){tell('Name this area first.',true);return;}
    if(drawn.length<3){tell('Place the corners of an area first.',true);return;}
    captureEditor();const regions=draft.diagrams[activeDiagram].regions,existing=regions.find(r=>r.id===regionEditing);
    if(existing){existing.label=label;existing.points=drawn;}else regions.push({id:uid(),label,points:drawn});
    regionEditing=null;draft.reviewed=false;dirty=true;editor();
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
    stopPoll();view='live';sessionId=id;role=audience;state=null;lastRender='';nav('/moonquest?session='+id+(role==='board'?'&board='+encodeURIComponent(new URLSearchParams(location.search).get('board')||''):''));await poll();
  }
  async function poll() {
    if(view!=='live'||polling)return;
    polling=true;
    const requestedSession=sessionId,requestedRole=role;
    try{
      const url='/sessions/'+sessionId+(role==='teacher'?'/teacher':'/state'+(role==='board'?'?board='+encodeURIComponent(new URLSearchParams(location.search).get('board')):''));
      const next=await api(url);if(view!=='live'||sessionId!==requestedSession||role!==requestedRole)return;clockOffset=next.serverNow-Date.now();
      if(state&&next.seq<state.seq)return;
      if(state&&next.phase!==state.phase)chime();state=next;
      const key=role==='student'?JSON.stringify([state.round,state.phase,state.paused,state.deadline,state.mine,state.canAnswer,state.stats]):[state.seq,role].join(':');
      if(key!==lastRender){renderLive();lastRender=key;}const c=document.getElementById('connection');if(c)c.textContent='Connected · answers saved to LessonScope';
      if(role==='teacher'&&!state.test){
        const queued=state.queue.find(q=>q.status==='needs-review'&&!q.suggestion&&!q.attempts&&!autoSuggestions.has(q.id));
        if(queued){autoSuggestions.add(queued.id);api('/sessions/'+sessionId+'/suggest',{queueId:queued.id},{timeout:25000}).then(()=>{lastRender='';}).catch(()=>tell('A later challenge needs your input. You can write it or retry AI while the class continues.'));}
      }
    }catch(e){lastRender='';const c=document.getElementById('connection');if(c)c.textContent='Connection interrupted · reconnecting. Wait for confirmation before leaving.';else {root.innerHTML=`<section class="intro"><h1>Let’s reconnect.</h1><p>${esc(e.message)}</p><div class="row"><a class="button" href="/moonquest/join">Rejoin as a learner</a><a class="button" href="/">Teacher sign-in</a></div></section>`;}document.querySelectorAll('[data-region-answer]').forEach(b=>b.disabled=true);}
    finally{polling=false;if(view==='live')pollTimer=setTimeout(poll,1100);}
  }
  function liveControls() {
    const s=state;
    return `<aside class="teacher-private"><div class="panel"><span class="eyebrow">Teacher controls · private</span><div class="control" style="margin-top:12px">${s.phase==='lobby'||s.phase==='reveal'?button(s.phase==='lobby'?'Begin mission':'Next question','next','primary'):''}${s.phase==='read'?button('Open answers','open','primary'):''}${['choose','discuss','reconsider'].includes(s.phase)?button({choose:'Begin discussion',discuss:'Reconsider',reconsider:'Reveal answer'}[s.phase],'advance','primary'):''}${!['lobby','ended'].includes(s.phase)?button(s.paused?'Resume':'Pause','pause'):''}${s.deadline?button('+10 seconds','extend'):''}</div>
      ${s.recovered?'<p class="error">Session recovered safely and paused. Resume when the class is ready.</p>':''}
      <div class="row"><a class="button small" target="_blank" rel="noopener noreferrer" href="/moonquest?session=${s.id}&board=${s.boardToken}">Open Smartboard</a>${button('Replace board link','rotate-board','small')}</div>
      <p class="muted">Keep this teacher view off the projector. The Smartboard view hides learner names and queued answers.</p>
      ${s.test?`<p class="muted">Scan the QR to join as a practice learner—no name or PIN. Simulation fills only the remaining practice learners.</p><a class="button small" target="_blank" rel="noopener" href="/moonquest/join?code=${s.code}">Open practice learner</a>`:''}
      ${s.test&&['choose','reconsider'].includes(s.phase)?`<div class="stack">${button('Simulate learner answers','simulate')}${button('Simulate a misconception','simulate-misconception')}</div>`:''}
      <div class="row" style="margin-top:12px">${button('View report','report','small')}${s.phase!=='ended'?button('Finish mission','end','small'):''}${button('Adventures','home','small')}</div></div>
      <div class="panel"><h3>Crew check-in · ${s.joined}/${s.learners.length}</h3><p class="muted">${s.phase==='reconsider'?'✓ means confirmed during reconsideration. The first choice is kept otherwise.':'✓ means a first choice has been saved.'}</p><div class="learners">${s.learners.map(l=>`<div class="learner"><span>${s.phase==='reconsider'?l.confirmed?'✓':'○':l.answered?'✓':l.joined?'●':'○'} ${esc(l.name)} ${l.absent?'· away':''}</span>${l.joined&&['lobby','reveal'].includes(s.phase)?`<button data-attendance="${esc(l.id)}" data-absent="${!l.absent}">${l.absent?'Include':'Away'}</button>`:''}</div>`).join('')}</div></div>
      <div id="queue-panel"></div></aside>`;
  }
  function renderLive() {
    document.body.dataset.view='live';
    const s=state,teacher=role==='teacher',selected=s.mine?.final||s.mine?.first;
    // Preserve edits in queued questions while answer counts update.
    const focus=document.activeElement, focusQueue=focus?.closest('[data-queue]')?.dataset.queue, focusField=focus?.hasAttribute('data-prompt')?'data-prompt':'data-explanation', focusStart=focus?.selectionStart, focusEnd=focus?.selectionEnd;
    const queued=queueEdits;
    const titles={lobby:'The moon needs your crew.',read:'A new challenge has arrived.',choose:'Choose your answer.',discuss:'Discuss your choice with your partner.',reconsider:'Are you sure about your answer?',reveal:'Let’s discover why.',ended:'You brought light to the festival!'};
    document.body.classList.toggle('celebrate',s.phase==='ended');
    root.innerHTML=`${s.test?'<div class="preview-note">Teacher test · Practice learners only · No class marks are saved</div>':''}<div class="row spread"><span class="pill">${esc(s.title)}</span><span class="connection" id="connection">Connected</span><span class="pill">${s.lanterns} lantern sparks</span></div>
      <section class="stage" style="margin-top:24px"><p class="eyebrow">${s.phase==='lobby'?'MOON FESTIVAL RESCUE':s.phase==='ended'?'MISSION COMPLETE':'Challenge '+(s.round+1)}</p><h1>${s.paused?'Mission paused':titles[s.phase]}</h1><div class="timer" id="timer"></div>${s.question?`<h2>${esc(s.question.prompt)}</h2>`:''}</section>
      <div class="live-layout ${teacher?'':'solo'}"><div>${s.phase==='lobby'?`<section class="intro">${mascot()}<h2>Outsmart Pip. Restore the lanterns.</h2><p>Pip has scrambled the festival signals! Choose carefully, explain your thinking to a partner, then lock in your rescue plan. Every discovery adds light to our sky.</p>${role==='student'?'<p class="stat">You’re in the crew!</p><p>Wait for your teacher to begin.</p>':`<p>On learner devices, open <strong>${esc(location.host)}/moonquest/join</strong></p>${s.code?`<p class="code">${s.code}</p><img class="qr" alt="Scan to join this MoonQuest room" src="${base}/sessions/${s.id}/${teacher?'qr':'board-qr?board='+encodeURIComponent(new URLSearchParams(location.search).get('board'))}">`:''}`}<p class="muted">${s.joined} learners ready</p></section>`:
      s.phase==='ended'?`<section class="intro">${mascot()}<p class="stat">${s.lanterns} sparks of understanding</p><p>The lanterns shine again, and the moon rabbit can find the way home. Your careful choices and conversations made the difference.</p>${teacher?button('Explore the learning report','report','primary'):''}</section>`:
      `<div class="diagram-wrap">${diagramHtml(s.diagram,selected,s.question?.accepted||[])}<div class="region-list">${s.diagram.regions.map(r=>`<button data-region-answer="${esc(r.id)}" class="${r.id===selected?'selected ':''}${s.question?.accepted?.includes(r.id)?'correct':''}" ${role!=='student'||!s.canAnswer||s.paused||!['choose','reconsider'].includes(s.phase)?'disabled':''}>${esc(r.label)}</button>`).join('')}</div>
      <div class="answer-status" id="answer-status">${role==='student'?(!s.canAnswer?'Watch this round. You can answer from the next question.':s.mine?.confirmed?'Final choice saved ✓':selected?'Your choice is saved ✓':s.phase==='read'?'Listen to the question. Your teacher will open the answers.':s.phase==='discuss'?'Tell your partner why you chose that area.':'Select an area when answers are open.'):`${s.answered} of ${s.expected} learners have chosen`}</div>
      ${s.phase==='discuss'?'<div class="panel"><h3>“I chose this because…”</h3><p>Take turns. Listen to your partner’s reason before deciding whether to change your mind.</p></div>':''}
      ${s.phase==='reveal'?`<div class="panel"><div class="row spread"><span class="stat">${s.stats.correct} correct</span><span>${s.stats.wrong} incorrect</span><span>${s.stats.unanswered} unanswered</span></div><p>${esc(s.question.explanation)}</p><p class="muted">${s.stats.improved} learners moved from an incorrect first choice to a correct answer after discussion.</p></div>`:''}</div>`}</div>${teacher?liveControls():''}</div>`;
    if(teacher)renderQueue(queued);
    if(focusQueue){const input=document.querySelector(`[data-queue="${focusQueue}"] [${focusField}]`);if(input){input.focus({preventScroll:true});input.setSelectionRange(focusStart,focusEnd);}}
    if(role==='student')document.querySelectorAll('#diagram polygon[data-region]').forEach(el=>{
      const send=()=>submitAnswer(el.dataset.region);el.onclick=send;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();send();}};
      el.setAttribute('aria-disabled',String(!s.canAnswer||s.paused||!['choose','reconsider'].includes(s.phase)));
    });
    const img=document.querySelector('#diagram img');if(img){img.onload=fitDiagram;if(img.complete)fitDiagram();}
    updateTimer();
  }
  function fitDiagram(){
    if(view!=='live')return;const box=document.getElementById('diagram'),img=box?.querySelector('img');if(!img?.naturalWidth)return;
    const available=box.parentElement.clientWidth;
    box.style.width=Math.min(available,Math.max(230,window.innerHeight*.45)*img.naturalWidth/img.naturalHeight)+'px';
  }
  window.addEventListener('resize',fitDiagram);
  function renderQueue(edits={}) {
    const el=document.getElementById('queue-panel');if(!el)return;
    el.innerHTML=state.queue.filter(q=>q.status!=='skipped'&&q.status!=='asked').map(q=>`<section class="queue" data-queue="${q.id}"><h3>A concept to revisit</h3><p>${esc(q.originalPrompt)}</p><p class="muted">Keep this answer: ${esc((q.acceptedLabels||[]).join(" / "))}</p><p class="muted">More than 70% of responses were incorrect.${q.lowParticipation?' Participation was below 80%; check the class before using this suggestion.':''} ${state.round<q.eligibleAfter?'Available after '+(q.eligibleAfter-state.round)+' more rounds.':'Ready when you choose.'}</p>${q.status==='approved'?`<p>${esc(q.question.prompt)}</p><button data-challenge="${q.id}" ${state.round<q.eligibleAfter||state.phase!=='reveal'?'disabled':''}>Ask later challenge now</button>`:`<button data-suggest="${q.id}">AI suggest a different scenario</button><label>Rephrased question<textarea data-prompt>${esc(edits[q.id]?.prompt??q.suggestion?.prompt??'')}</textarea></label><label>Explanation<textarea data-explanation>${esc(edits[q.id]?.explanation??q.suggestion?.explanation??'')}</textarea></label><p class="muted">The original diagram and accepted answer stay fixed. Review that this new question still fits them.</p><button data-approve="${q.id}" class="primary">Approve for later</button>`}<button data-skip="${q.id}" class="small">Skip</button></section>`).join('');
  }
  function updateTimer(){const el=document.getElementById('timer');if(!el||!state)return;el.textContent=state.paused?'Ⅱ':state.deadline?Math.max(0,Math.ceil((state.deadline-Date.now()-clockOffset)/1000))+'s':'';}
  setInterval(updateTimer,250);
  async function submitAnswer(regionId) {
    if(busyAnswer||role!=='student'||!state?.canAnswer||state.paused||!['choose','reconsider'].includes(state.phase))return;
    busyAnswer=true;const el=document.getElementById('answer-status');if(el)el.textContent='Saving your choice…';
    try{state=await api('/sessions/'+sessionId+'/answer',{regionId,round:state.round,phase:state.phase,eventId:uid()});lastRender='';renderLive();}catch(e){tell(e.message,true);if(el)el.textContent='Not confirmed. Check your connection and select again.';}finally{busyAnswer=false;}
  }
  async function command(action,extra={}){const s=await api('/sessions/'+sessionId+'/command',{action,seq:state.seq,round:state.round,phase:state.phase,paused:state.paused,...extra});state=s;lastRender='';renderLive();}
  async function report(id) {
    stopPoll();view='report';const r=await api('/sessions/'+id+'/report');
    root.innerHTML=`<div class="row spread"><div><p class="eyebrow">Learning, made visible</p><h1 style="font-size:38px">${esc(r.title)}</h1><p>${esc(r.className)}${r.test?' · Practice only':''}</p></div><div class="row"><button data-session="${id}">Back to room</button>${button('Adventures','home')}</div></div><div class="panel"><h3>First thinking → discussion → later application</h3><p class="muted">These are formative results and do not change class averages. Later checks follow feedback, so they are shown separately from independent first attempts.</p>${button('Download CSV','csv')}</div><div class="report-wrap"><table><thead><tr><th>Learner</th>${r.rounds.map(q=>`<th>${q.followUp?'Later check':'First encounter'} · ${q.number}<p>${esc(q.prompt)}</p>${q.completed?'':'(not completed)'}</th>`).join('')}</tr></thead><tbody>${r.students.map(st=>`<tr><th>${esc(st.name)}</th>${st.rounds.map(a=>`<td>${!a.expected?'Not in this round':`${esc(a.initial||'Unanswered')} ${a.initialCorrect===true?'✓':a.initialCorrect===false?'✗':''}<br>→ ${esc(a.revised||'Unanswered')} ${a.revisedCorrect===true?'✓':a.revisedCorrect===false?'✗':''}<br><small>${a.confirmed?'Confirmed':'First choice retained if present'}</small>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    root.querySelector('[data-action="csv"]').onclick=()=>{
      const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
      const rows=[['Student ID','Learner','Question','Stage','Initial choice','Initial correct','Final choice','Final correct','Confirmed']];r.students.forEach(st=>st.rounds.forEach((a,i)=>rows.push([st.id,st.name,r.rounds[i].prompt,r.rounds[i].followUp?'Later check':'Initial encounter',a.initial,a.initialCorrect??'',a.revised,a.revisedCorrect??'',a.confirmed])));
      const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='moonquest-learning.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  }
  async function joinPage(code='') {
    view='join';root.innerHTML=`<section class="intro">${mascot()}<p class="eyebrow">Join the rescue crew</p><h1>Your moon mission awaits.</h1><div class="panel stack"><label>Room code<input id="room-code" autocomplete="off" maxlength="10" value="${esc(code)}" placeholder="Teacher’s 10-character code"></label>${button('Find my crew','find-room','primary')}<div id="join-class"></div></div></section>`;
    if(code)await findRoom();
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
    document.getElementById('join-class').innerHTML=`<h2>${esc(room.title)}</h2><div class="stack"><label>Your name<select id="join-name"><option value="">Choose your name</option>${room.students.map(st=>`<option value="${st.handle}">${esc(st.label)}</option>`).join('')}</select></label><label>Your PIN<input id="join-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"></label><p class="muted">Use your usual four-digit PIN. If you have never set one, choose one now.</p>${button('Join the mission','join','primary')}</div>`;
  }
  root.addEventListener('input',e=>{
    const q=e.target.closest('[data-queue]');if(q)queueEdits[q.dataset.queue]={prompt:q.querySelector('[data-prompt]')?.value,explanation:q.querySelector('[data-explanation]')?.value};
    if(view==='editor'){dirty=true;if(e.target.id!=='reviewed'){const r=document.getElementById('reviewed');if(r)r.checked=false;}}
  });
  root.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b||b.disabled)return;
    const action=b.dataset.action; b.disabled=true;
    try{
      if(action==='home'){if(dirty&&!confirm('Leave without saving your changes?'))return;await home();}
      else if(action==='new'){draft=emptyDraft();activeDiagram=0;dirty=false;editor();}
      else if(action==='sample')await sample();
      else if(action==='finish-area')finishArea();
      else if(action==='update-region')updateRegion();
      else if(action==='new-area'){captureEditor();regionEditing=null;editor();}
      else if(action==='undo-corner'){drawn.pop();document.getElementById('drawing').setAttribute('points',drawn.map(p=>p.join(',')).join(' '));}
      else if(action==='add-question'){captureEditor();const d=draft.diagrams[activeDiagram];if(!d?.regions.length)throw new Error('Add answer areas first.');draft.questions.push({id:uid(),diagramId:d.id,prompt:'',concept:'',accepted:[],explanation:''});draft.reviewed=false;dirty=true;editor();}
      else if(action==='save'){captureEditor();const result=await api('/games',draft);draft=result.game;dirty=false;tell('Adventure saved. You can now set up a class or test it.');await home();}
      else if(action==='draft-ai'){captureEditor();const objective=document.getElementById('objective').value;const d=await api('/draft',{...draft,objective},{timeout:25000});draft.questions.push(...d.questions);draft.reviewed=false;dirty=true;editor();tell('Questions added. Review the answer areas and explanations before saving.');}
      else if(b.dataset.edit){draft=(await api('/games/'+b.dataset.edit)).game;activeDiagram=0;editor();}
      else if(b.dataset.editRegion){captureEditor();regionEditing=b.dataset.editRegion;editor();}
      else if(b.dataset.host)await setup(b.dataset.host);
      else if(b.dataset.test)await launch(b.dataset.test,true);
      else if(b.dataset.start)await launch(b.dataset.start);
      else if(b.dataset.session)await openSession(b.dataset.session,'teacher');
      else if(b.dataset.report)await report(b.dataset.report);
      else if(b.dataset.deleteRegion){captureEditor();const id=b.dataset.deleteRegion;draft.diagrams[activeDiagram].regions=draft.diagrams[activeDiagram].regions.filter(r=>r.id!==id);draft.questions.forEach(q=>q.accepted=q.accepted.filter(a=>a!==id));draft.reviewed=false;dirty=true;editor();}
      else if(b.dataset.deleteQuestion){captureEditor();draft.questions=draft.questions.filter(q=>q.id!==b.dataset.deleteQuestion);draft.reviewed=false;dirty=true;editor();}
      else if(['next','open','advance','pause','extend','rotate-board'].includes(action))await command(action);
      else if(action==='end'){if(confirm('Finish this mission? Learners will no longer be able to answer.'))await command('end');}
      else if(action==='simulate'||action==='simulate-misconception'){state=await api('/sessions/'+sessionId+'/simulate',{pattern:action==='simulate-misconception'?'misconception':'mixed'});renderLive();}
      else if(action==='report')await report(sessionId);
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
  }
  init().catch(e=>{root.innerHTML=`<section class="intro"><h1>Open your next adventure.</h1><p>${esc(e.message)}</p><a class="button primary" href="/">Sign in to LessonScope</a><a class="button" href="/moonquest/join">Join as a learner</a></section>`;});
})();
