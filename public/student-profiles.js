(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const incorrect = evidence => evidence.score !== null && evidence.score !== undefined && evidence.score !== ''
    && Number.isFinite(Number(evidence.score)) && Number(evidence.score) === 0 && Number(evidence.total) > 0;
  const fold = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
  const search = document.getElementById('studentProfileSearch'), matches = document.getElementById('studentProfileMatches');
  if (!search) return;
  let students = [], loaded = false, request = 0, returnFocus;
  const dialog = document.createElement('dialog'); dialog.className='learner-profile-dialog'; dialog.setAttribute('aria-label','Student profile'); document.body.append(dialog);
  async function json(url) { const r=await fetch(url); const d=await r.json(); if(!r.ok)throw Error(d.error||'Could not load student records.'); return d; }
  function renderMatches() {
    const query=fold(search.value.trim());
    const found=students.filter(s=>!query||fold(s.name+' '+s.id+' '+s.classes.map(c=>c.name).join(' ')).includes(query));
    matches.innerHTML=found.length?found.map(s=>`<button type="button" class="learner-directory-row" data-student-profile="${esc(s.id)}"><strong>${esc(s.name)}</strong><span>${esc(s.id)} · ${esc(s.classes.map(c=>c.name).join(', '))}</span><span>View profile →</span></button>`).join(''):'<p>No students match your search.</p>';
  }
  async function load() { if(loaded)return; matches.textContent='Loading students…';try { students=(await json('/api/student-profiles')).students;loaded=true;renderMatches(); }catch(e){matches.textContent=e.message;} }
  document.getElementById('rostersBtn').addEventListener('click',load);
  search.addEventListener('focus',load);search.addEventListener('input',renderMatches);
  dialog.addEventListener('close',()=>{request++;returnFocus?.focus();});
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-student-profile]');if(!button)return;
    returnFocus=button;const token=++request;
    dialog.innerHTML='<button type="button" class="profile-close" aria-label="Close profile">×</button><p role="status">Loading student profile…</p>';
    if(!dialog.open)dialog.showModal();
    try {
      const student=await json('/api/student-profiles/'+encodeURIComponent(button.dataset.studentProfile));if(token!==request)return;
      const activities=student.activities||[];
      const scored=activities.filter(a=>a.score!==null&&a.score!==undefined&&Number(a.total)>0);
      const average=scored.length?Math.round(scored.reduce((sum,a)=>sum+Number(a.score)/Number(a.total)*100,0)/scored.length):null;
      const initials=student.name.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('');
      dialog.innerHTML=`<button type="button" class="profile-close" aria-label="Close profile">×</button><header class="learner-id-card"><div class="id-card-brand">LESSONSCOPE <span>STUDENT PROFILE</span></div><div class="id-card-person"><div class="id-card-avatar" aria-hidden="true">${esc(initials)}</div><div><h2>${esc(student.name)}</h2><p class="id-card-number">${esc(student.id)}</p><p>${esc(student.classes.map(c=>c.name).join(' · '))}</p>${student.gender?`<p>Gender: ${esc(student.gender)}</p>`:''}</div></div><div class="id-card-footer">Learning record · ${activities.length} activit${activities.length===1?'y':'ies'}</div></header><section class="profile-learning-summary" aria-label="Learning summary"><h3>Academic strengths &amp; next steps</h3><p>${esc(student.learningSummary?.text || 'There is not enough completed, positively scored work to describe strengths and next steps yet.')}</p><small>Suggested comment for teacher review · Based on completed work with positive marks. Zero-score, missing and unfinished tasks are excluded.</small></section><div class="profile-stats"><div><strong>${activities.filter(a=>['Completed','Marked'].includes(a.status)).length}</strong>Completed / marked</div><div><strong>${activities.filter(a=>a.status==='Not submitted').length}</strong>Not submitted</div><div><strong>${average===null?'—':average+'%'}</strong>Recorded activity average</div></div><p class="hint">Activity average is an overview, not a term grade. Unmarked work is excluded.</p><label for="profileActivitySearch">Find an activity</label><input id="profileActivitySearch" type="search" placeholder="Search title, subject or status"><div id="profileActivityList"></div>`;
      const list=dialog.querySelector('#profileActivityList');
      function renderActivities(){const query=fold(dialog.querySelector('#profileActivitySearch').value);const visible=activities.filter(a=>fold(a.title+' '+a.subject+' '+a.kind+' '+a.status).includes(query));list.innerHTML=visible.length?visible.map(a=>`<details class="profile-activity"><summary><span><strong>${esc(a.title)}</strong><small>${esc([a.subject,a.kind,a.className].filter(Boolean).join(' · '))}</small></span><span>${a.score==null?'—':esc(a.score)+' / '+esc(a.total)}<small>${esc(a.status)}</small></span></summary><p>${a.at?esc(new Date(a.at).toLocaleString()):'No activity date recorded'}</p>${a.evidence.length?a.evidence.map(e=>`<article class="profile-evidence${incorrect(e)?' profile-evidence-incorrect':''}"><h4>${esc(e.item)}</h4>${incorrect(e)?'<span class="profile-evidence-status">Incorrect</span>':''}<p><strong>Student response:</strong> ${esc(e.studentResponse||'No response recorded')}</p>${e.score==null?'':`<p>Mark: ${esc(e.score)} / ${esc(e.total)}</p>`}${e.expectedAnswer?`<p><strong>Expected answer:</strong> ${esc(e.expectedAnswer)}</p>`:''}${e.rationale?`<p><strong>Feedback:</strong> ${esc(e.rationale)}</p>`:''}</article>`).join(''):'<p>No individual responses are recorded for this activity. '+(a.status==='Not submitted'?'This learner has not submitted work.':'Only the available activity summary is shown.')+'</p>'}</details>`).join(''):'<p>No activities match. Assigned work and recorded results will appear here.</p>';}
      dialog.querySelector('#profileActivitySearch').addEventListener('input',renderActivities);renderActivities();dialog.querySelector('.profile-close').focus();
    }catch(e){if(token===request)dialog.innerHTML='<button type="button" class="profile-close" aria-label="Close profile">×</button><p role="alert">'+esc(e.message)+'</p>';}
  });
  dialog.addEventListener('click',e=>{if(e.target.closest('.profile-close'))dialog.close();});
})();
