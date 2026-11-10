(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function html(d,id){
  const s=(d.submissions||[]).find(s=>String(s.studentId)===String(id));
  if(!s||s.draftOnly)throw Error('This student must submit before printing a marked exam.');
  let earned=0,max=0,pending=0;
  const rows=(d.questions||[]).map((q,i)=>{
   const g=s.grades?.[q.id]||{},answer=s.answers?.[q.id];
   const marked=typeof g.marksAwarded==='number'&&Number.isFinite(g.marksAwarded)&&!['teacher-required'].includes(g.source);
   const confirmed=marked&&['auto','teacher','ai-confirmed'].includes(g.source);
   max+=Number(q.marks)||0;if(marked)earned+=g.marksAwarded;if(!confirmed)pending++;
   const text=q.kind==='practical'?'Teacher observation':q.kind==='mcq'?(q.options?.[answer]??'No answer provided'):(answer===null||answer===undefined||answer===''?'No answer provided':answer);
   return `<article>${q.sectionTitle?`<p class="section">${esc(q.sectionTitle)}</p>`:''}<h2>${i+1}. ${esc(q.question)}</h2>${q.kind==='mcq'?`<ol type="A" class="options">${(q.options||[]).map(o=>`<li>${esc(o)}</li>`).join('')}</ol>`:''}<p class="mark">Mark: ${marked?esc(g.marksAwarded):'—'} / ${esc(q.marks)}${!marked?' · Awaiting marking':!confirmed?' · Provisional':''}</p><h3>Student answer</h3><div class="answer">${esc(typeof text==='object'?JSON.stringify(text):text)}</div>${g.rationale?`<h3>Feedback</h3><div class="feedback">${esc(g.rationale)}</div>`:''}</article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(s.name)} — ${esc(d.title||'Marked exam')}</title><style>
  *{box-sizing:border-box}body{font:12pt Arial,sans-serif;color:#182c39;margin:28px auto;max-width:800px;padding:0 20px;line-height:1.5}h1{font-size:22pt;margin-bottom:12px}h2{font-size:13pt;white-space:pre-wrap;overflow-wrap:anywhere}h3{font-size:10pt;margin:12px 0 4px}.meta{border-bottom:2px solid #213d52;padding-bottom:16px}.score{font-size:17pt;font-weight:bold}.section{font-weight:bold;color:#425665}article{border-bottom:1px solid #b9c3c9;padding:14px 0;break-inside:auto}h2,h3,.section,.mark{break-after:avoid}.answer,.feedback{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:#f4f6f8}.mark{font-weight:bold}.toolbar{padding:14px;background:#e9f2fa}button{padding:10px 18px;font:inherit;cursor:pointer}.options{font-size:11pt}@page{size:A4;margin:16mm}@media print{body{margin:0;padding:0;max-width:none;font-size:11pt}.toolbar{display:none}.answer,.feedback{background:none;border-left:2px solid #c1c9ce}h1{margin-top:0}}
  </style></head><body><div class="toolbar"><button id="printExam">Print / Save as PDF</button><p>Choose “Save as PDF” in the print window. Turn off browser headers and footers for a clean copy.</p></div><header class="meta"><h1>${esc(d.title||'Marked exam')}</h1><p><strong>Student:</strong> ${esc(s.name)}<br><strong>Student ID:</strong> ${esc(s.studentId)}${d.rosterName?`<br><strong>Class:</strong> ${esc(d.rosterName)}`:''}${d.subject?`<br><strong>Subject:</strong> ${esc(d.subject)}`:''}${d.grade?`<br><strong>Grade:</strong> ${esc(d.grade)}`:''}</p><div class="score">${pending?'Provisional total':'Total'}: ${earned} / ${max}</div>${pending?`<p>${pending} question${pending===1?'':'s'} awaiting final marking.</p>`:''}</header>${rows}</body></html>`;
 }
 async function open(assignId,studentId){
  const popup=window.open('','_blank');if(!popup)throw Error('Allow pop-ups to open the printable exam.');
  popup.opener=null;popup.document.body.textContent='Preparing the latest saved marks…';
  try{const r=await fetch('/api/assignment/'+encodeURIComponent(assignId)+'/results',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'Could not load the marked exam.');popup.document.open();popup.document.write(html(d,studentId));popup.document.close();popup.document.getElementById('printExam').addEventListener('click',()=>popup.print());popup.focus();}
  catch(e){popup.close();throw e;}
 }
 const api={html,open};if(typeof module==='object'&&module.exports)module.exports=api;else root.MarkedExamPrint=api;
})(typeof window==='undefined'?globalThis:window);
