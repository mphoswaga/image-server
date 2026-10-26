(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>v?new Date(v).toLocaleString():'Not recorded';
  const dialog=document.createElement('dialog');
  dialog.setAttribute('aria-label','Teacher account overview');
  dialog.style.cssText='width:min(850px,92vw);max-height:85vh;overflow:auto;border:1px solid #cad8e3;border-radius:16px;padding:24px;color:#19314d';
  document.body.append(dialog);
  let request=0,record=null,trigger=null;
  dialog.addEventListener('close',()=>{request++;record=null;trigger?.focus();});
  const list=(title,rows,format)=>`<details style="margin:16px 0;border-top:1px solid #ddd;padding-top:12px"><summary style="cursor:pointer;font-weight:700">${title} (${rows.length})</summary>${rows.length?rows.map(format).join(''):'<p>No stored records found.</p>'}</details>`;
  const resource=r=>`<details style="margin:10px 0"><summary>${esc(r.title||r.lessonTitle||r.name||r.topic||r.id)} ${esc(r.grade||'')}</summary><dl>${Object.entries(r).map(([key,value])=>`<dt><b>${esc(key.replace(/([A-Z])/g,' $1'))}</b></dt><dd>${esc(typeof value==='object'?JSON.stringify(value):value)}</dd>`).join('')}</dl></details>`;
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-admin-account]');if(!button)return;
    trigger=button;const token=++request;record=null;
    dialog.innerHTML='<button type="button" data-account-close style="float:right">Close</button><p role="status">Loading account…</p>';
    if(!dialog.open)dialog.showModal();
    try{
      const response=await fetch('/api/admin/accounts/'+encodeURIComponent(button.dataset.adminAccount)+'/overview');const data=await response.json();
      if(token!==request)return;if(!response.ok)throw new Error(data.error||'Could not load account.');
      record=data;const p=data.profile;
      dialog.innerHTML=`<button type="button" data-account-close style="float:right">Close</button><h2>${esc(p.name)}</h2><p>${esc(p.email)}</p><dl><dt>Account ID</dt><dd>${esc(p.id)}</dd><dt>Registered in LessonScope</dt><dd>${esc(date(p.createdAt))}</dd><dt>Role / access</dt><dd>${esc(p.role)} / ${esc(p.accessMode)}</dd><dt>Organisation ID</dt><dd>${esc(p.organizationId||'Not recorded')}</dd><dt>PIN-free game joining</dt><dd>${data.pinFreeGames?'Enabled':'Disabled'}</dd></dl><h3>Recorded AI usage</h3><p>${data.usage?`${esc(data.usage.calls)} calls · ${esc(data.usage.images)} images · estimated cost $${Number(data.usage.costUSD||0).toFixed(4)}`:'No recorded AI usage found.'}</p><button type="button" data-account-download>Download account overview (JSON)</button>${list('Lessons',data.lessons,resource)}${list('Games',data.games,resource)}${list('Assessments',data.assessments,resource)}${list('Classes',data.classes,resource)}${list('Recorded activity',data.activity,r=>`<p>${esc(date(r.time))} · ${esc(r.action)} · ${esc(r.outcome)}</p>`)}<h3>About this record</h3>${data.limitations.map(t=>`<p>${esc(t)}</p>`).join('')}`;
    }catch(error){if(token===request)dialog.innerHTML='<button type="button" data-account-close>Close</button><p role="alert">'+esc(error.message)+'</p>';}
  });
  dialog.addEventListener('click',e=>{
    if(e.target.closest('[data-account-close]'))dialog.close();
    if(e.target.closest('[data-account-download]')&&record){const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='teacher-account-overview.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  });
})();
