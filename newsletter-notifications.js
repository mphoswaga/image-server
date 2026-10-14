// Durable staff notifications. Disabled until a coordinator configures a workspace.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = value => crypto.createHash('sha256').update(value).digest('hex');
function vietnamTime(now) {
  const d = new Date(now.getTime() + 7 * 3600000);
  return { date: d.toISOString().slice(0,10), day: d.getUTCDay(), time: d.toISOString().slice(11,16) };
}
function createNotifications({store, filename = path.join(DATA_DIR, 'newsletter-notifications.json'), getUser = id => require('./auth').getUserById(id), send = options => require('./email').sendEmail(options), configured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), now = () => new Date()} = {}) {
  const load = () => fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : { settings:{}, deliveries:[] };
  const save = state => writeJsonAtomic(filename,state);
  let busy = false;
  function authorised(user, id) { const w = store.read(id); store.coordinator(w,user); return w; }
  function schedules(config = {}) {
    return {
      teacher: config.teacher || {enabled:true,day:4,time:'15:00'},
      ta: config.ta || {enabled:true,time:'16:00'},
      coordinator: config.coordinator || {enabled:true,day:config.day ?? 5,time:config.time || '15:00'},
    };
  }
  function settings(user,id) {
    authorised(user,id); const s=load(), config=s.settings[id] || {mode:'off',day:5,time:'15:00'};
    return { settings:{...config,...schedules(config)}, configured:configured(), testEmail:user.email,
      usage:{sent:s.deliveries.filter(d=>d.sentAt && now()-new Date(d.sentAt)<86400000).length,limit:90},
      deliveries:s.deliveries.filter(d=>d.workspace===id).slice(-30).reverse() };
  }
  function configure(user,id,input) {
    const w=authorised(user,id), plan=schedules(input);
    if(!['off','test','live'].includes(input.mode)) throw Error('Choose a delivery mode.');
    for (const [role,schedule] of Object.entries(plan)) {
      if(typeof schedule.enabled!=='boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time||'') || (role!=='ta' && (!Number.isInteger(schedule.day)||schedule.day<0||schedule.day>6))) throw Error('Choose a valid weekday and time for each report.');
    }
    if(w.demo && input.mode==='live') throw Error('Demo workspaces support test notifications only.');
    const s=load(), old=s.settings[id];
    s.settings[id]={mode:input.mode,...plan,day:plan.coordinator.day,time:plan.coordinator.time,owner:user.id,enabledAt:old?.mode===input.mode ? old.enabledAt : now().toISOString()};
    save(s); return settings(user,id);
  }
  function messages(w,config,date,{preview=false}={}) {
    const plan=schedules(config), local=vietnamTime(date), result=new Map();
    const due=role=>plan[role].enabled && (preview || ((role==='ta'||local.day===plan[role].day) && local.time>=plan[role].time));
    const add=(member,role,title,body)=>{
      const slot=plan[role].time, id=member.userId+'|'+slot;
      if(!result.has(id)) result.set(id,{recipient:member.userId,kind:'digest',signature:local.date+'|'+slot,sections:[]});
      const sections=result.get(id).sections;
      if(!sections.some(s=>s.title===title)) sections.push({title,body});
    };
    const scoped=(member,report)=>!member.classes || member.classes.includes(report.className);
    const deadline=r=>r.deadline ? ' · Due '+new Date(r.deadline).toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh'})+' (Vietnam)' : '';
    const reports=[...w.reports].sort((a,b)=>(Date.parse(a.deadline)||Infinity)-(Date.parse(b.deadline)||Infinity));
    for(const m of w.members) {
      if(m.role==='teacher' && due('teacher')) {
        const lines=reports.filter(r=>scoped(m,r)).flatMap(r=>r.entries.filter(e=>!e.submitted && (m.subjects||[]).includes(e.subject)).map(e=>`${r.className} · ${r.week} · ${e.subject}${deadline(r)}`));
        if(lines.length) add(m,'teacher','Teacher submissions needed',lines.join('\n'));
      }
      if(m.role==='translator' && due('ta')) {
        const lines=reports.filter(r=>scoped(m,r)).flatMap(r=>r.entries.filter(e=>e.submitted&&!e.reviewed).map(e=>`${r.className} · ${r.week} · ${e.subject}${deadline(r)}`));
        if(lines.length) add(m,'ta','TA translation and review',lines.join('\n')+'\n\nTranslate and review these subjects, then prepare the parent link when the class newsletter is ready.');
      }
    }
    if(due('coordinator')) {
      const lines=reports.filter(r=>!r.publication || !r.approved || r.approved.at>r.publication.content.publishedAt).map(r=>{
        const missing=r.entries.filter(e=>!e.submitted).map(e=>e.subject);
        const translation=r.entries.filter(e=>e.submitted&&!e.reviewed).map(e=>e.subject);
        const owners=w.members.filter(m=>m.role==='teacher'&&scoped(m,r)&&(m.subjects||[]).some(subject=>missing.includes(subject))).map(m=>getUser(m.userId)?.name||getUser(m.userId)?.email||'Assigned teacher');
        return `${r.className} · ${r.week}${deadline(r)}${owners.length ? ' ('+owners.join(', ')+')' : ''}: ${missing.length ? 'Not submitted: '+missing.join(', ')+'. ' : ''}${translation.length ? 'Translation/review needed: '+translation.join(', ')+'. ' : ''}${!missing.length&&!translation.length ? 'Ready for TA approval/parent link.' : ''}`;
      });
      for(const m of w.members.filter(m=>m.role==='coordinator')) add(m,'coordinator','Coordinator weekly newsletter summary',lines.join('\n')||'All class newsletters are complete. There are no outstanding items.');
    }
    return [...result.values()].map(m=>({...m,subject:`${w.name}: ${m.sections.length>1?'newsletter reports':m.sections[0].title}`,body:m.sections.map(s=>s.title+'\n'+s.body).join('\n\n')}));
  }
  function preview(user,id) {
    const w=authorised(user,id), config=load().settings[id]||{day:5,time:'15:00'};
    return messages(w,config,now(),{preview:true}).map(m=>({...m,recipient:getUser(m.recipient)?.email||'Account email unavailable'}));
  }
  async function deliver(w,config,m,{test=false}={}) {
    const date=now(), s=load();
    const recipient=getUser(test||config.mode==='test' ? config.owner : m.recipient)?.email;
    if(!recipient) return;
    const id=key(`${w.id}:${config.mode}:${test?'manual-'+date.toISOString():m.kind}:${m.recipient}:${m.signature}`);
    let record=s.deliveries.find(d=>d.id===id);
    if(record?.status==='sent' || record?.status==='uncertain') return;
    if(record?.attemptedAt && date-new Date(record.attemptedAt)<60000) return;
    if(record?.firstAttempt && date-new Date(record.firstAttempt)>=23*3600000) { record.status='uncertain'; record.error='Delivery could not be confirmed. Check the provider before retrying.'; save(s); return; }
    if(!configured()) throw Error('Email delivery requires RESEND_API_KEY and a verified EMAIL_FROM in hosting.');
    // Conservative newsletter allowance leaves room for password-reset emails.
    if(s.deliveries.filter(d=>d.firstAttempt && date-new Date(d.firstAttempt)<86400000).length>=90 && !record?.firstAttempt) throw Error('Newsletter daily safety limit reached. Pending notifications will wait.');
    if(!record) { record={id,workspace:w.id,kind:m.kind,recipient:m.recipient,mode:config.mode,signature:m.signature,to:recipient,subject:m.subject,status:'pending'}; s.deliveries.push(record); }
    record.body ??= m.body; record.firstAttempt ||= date.toISOString(); record.attemptedAt=date.toISOString(); save(s);
    try {
      const response=await send({to:recipient,subject:(test||config.mode==='test'?'[TEST] ':'')+record.subject,html:`<p>${escape(record.body).replace(/\n/g,'<br>')}</p><p><a href="https://lesson.educscope.com/newsletters.html">Open school newsletters</a></p>`,idempotencyKey:id});
      if(response?.dev) throw Error('Email provider did not deliver this message.');
      const latest=load(), d=latest.deliveries.find(d=>d.id===id); d.status='sent';d.sentAt=now().toISOString();delete d.error; save(latest);
    } catch(error) { const latest=load(),d=latest.deliveries.find(d=>d.id===id);d.status='failed';d.error='Delivery failed. It will retry safely while still relevant.';save(latest); throw error; }
  }
  async function tick() {
    if(busy) return; busy=true;
    try {
      for(const w of store.all()) {
        const config=load().settings[w.id];
        if(!config || config.mode==='off' || !w.members.some(m=>m.userId===config.owner&&m.role==='coordinator')) continue;
        for(const m of messages(w,config,now())) {
          try { await deliver(w,config,m); } catch(_) { /* Status is available to the coordinator; no content or email addresses logged. */ }
        }
      }
    } finally {busy=false;}
  }
  async function test(user,id) {
    const w=authorised(user,id);
    if(busy) throw Error('Notification processing is busy. Please try again shortly.');
    busy=true;
    try { await deliver(w,{mode:'test',owner:user.id},{recipient:user.id,kind:'test',signature:'preview',subject:`${w.name}: notification delivery test`,body:messages(w,load().settings[id]||{},now(),{preview:true}).map(m=>m.subject+'\n'+m.body).join('\n\n')},{test:true}); return settings(user,id); } finally {busy=false;}
  }
  return {settings,configure,preview,tick,test};
}
module.exports={createNotifications,vietnamTime};
