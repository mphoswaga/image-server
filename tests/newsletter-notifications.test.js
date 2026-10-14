const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {createNotifications,vietnamTime}=require('../newsletter-notifications');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'newsletter-mail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=new Date('2026-10-16T07:00:00Z');
 const w={id:'workspace',name:'School',members:[{userId:'c',role:'coordinator'},{userId:'ta',role:'translator',classes:['3B2']},{userId:'other',role:'translator',classes:['3B1']}],reports:[{id:'r',className:'3B2',week:'Week 9',entries:[{subject:'ICT',submitted:false,reviewed:false}]}]};
 const store={read:()=>w,all:()=>[w],coordinator:(_,user)=>{if(user.id!=='c')throw Error('Only coordinator');}};
 const sent=[],filename=path.join(dir,'mail.json');
 const options={store,filename,getUser:id=>({email:id+'@test.school'}),configured:()=>true,now:()=>clock,send:async m=>{sent.push(m);return {id:'ok'};}};
 return {w,sent,options,mail:createNotifications(options),user:{id:'c',email:'c@test.school'},advance:()=>clock=new Date(clock.getTime()+120000),clock:value=>clock=new Date(value)};
}
test('test routing, scoped notices, review does not resend and restart deduplicates',async t=>{
 const x=setup(t);x.mail.configure(x.user,'workspace',{mode:'test',day:5,time:'17:00'});
 x.advance();Object.assign(x.w.reports[0].entries[0],{submitted:true,submittedAt:x.options.now().toISOString()});
 x.clock('2026-10-16T09:00:00Z');await x.mail.tick();assert.equal(x.sent.length,1);assert.equal(x.sent[0].to,'c@test.school');assert.match(x.sent[0].subject,/TEST/);
 await createNotifications(x.options).tick();assert.equal(x.sent.length,1);
 x.w.reports[0].entries[0].reviewed=true;await x.mail.tick();assert.equal(x.sent.length,1);
 x.clock('2026-10-16T10:00:00Z');await x.mail.tick();assert.equal(x.sent.length,2);assert.match(x.sent[1].subject,/weekly/);
 await x.mail.tick();assert.equal(x.sent.length,2);
});
test('disabled is silent, preview sends nothing, live routes to assigned TA only',async t=>{
 const x=setup(t);await x.mail.tick();assert.equal(x.sent.length,0);x.mail.preview(x.user,'workspace');assert.equal(x.sent.length,0);
 assert.throws(()=>x.mail.configure({id:'ta'},'workspace',{mode:'live',day:5,time:'17:00'}),/coordinator/);
 x.mail.configure(x.user,'workspace',{mode:'live',day:5,time:'17:00'});x.advance();Object.assign(x.w.reports[0].entries[0],{submitted:true,submittedAt:x.options.now().toISOString()});
 x.clock('2026-10-16T09:00:00Z');await x.mail.tick();assert.equal(x.sent[0].to,'ta@test.school');assert.equal(x.sent.length,1);
});
test('provider failure retains idempotency key on retry and missing config never sends',async t=>{
 const x=setup(t);x.mail.configure(x.user,'workspace',{mode:'test',day:5,time:'17:00'});x.advance();Object.assign(x.w.reports[0].entries[0],{submitted:true,submittedAt:x.options.now().toISOString()});
 const attempts=[];const mail=createNotifications({...x.options,send:async m=>{attempts.push(m.idempotencyKey);if(attempts.length===1)throw Error('timeout');return {id:'sent'};}});
 x.clock('2026-10-16T09:00:00Z');await mail.tick();x.advance();await mail.tick();assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);
 await assert.rejects(createNotifications({...x.options,configured:()=>false}).test(x.user,'workspace'),/requires/);
});
test('Vietnam schedule crosses UTC dates correctly',()=>{assert.deepEqual(vietnamTime(new Date('2026-10-15T18:30:00Z')),{date:'2026-10-16',day:5,time:'01:30'});});

test('daily TA digest waits for 4pm, includes old pending work and sends once per day',async t=>{
 const x=setup(t);x.mail.configure(x.user,'workspace',{mode:'live',day:5,time:'17:00'});
 Object.assign(x.w.reports[0].entries[0],{submitted:true,submittedAt:'2026-10-01T00:00:00Z'});
 await x.mail.tick();assert.equal(x.sent.length,0);
 x.clock('2026-10-16T09:00:00Z');await x.mail.tick();assert.equal(x.sent.length,1);
 x.w.reports[0].entries.push({subject:'Math',submitted:true,submittedAt:x.options.now().toISOString()});
 await createNotifications(x.options).tick();assert.equal(x.sent.length,1);
 x.clock('2026-10-17T09:00:00Z');await x.mail.tick();assert.equal(x.sent.length,2);assert.match(x.sent[1].html,/Math/);
 x.w.reports[0].entries.forEach(e=>e.reviewed=true);
 x.clock('2026-10-18T09:00:00Z');await x.mail.tick();assert.equal(x.sent.length,2);
});
test('teacher weekly reminders respect class and subject and combine same-time roles',async t=>{
 const x=setup(t);x.w.members.push({userId:'ta',role:'teacher',classes:['3B2'],subjects:['Math']});
 x.w.reports[0].entries.push({subject:'Math',submitted:false},{subject:'Art',submitted:false});
 Object.assign(x.w.reports[0].entries[0],{submitted:true});
 x.mail.configure(x.user,'workspace',{mode:'live',teacher:{enabled:true,day:5,time:'16:00'},ta:{enabled:true,time:'16:00'},coordinator:{enabled:false,day:5,time:'16:00'}});
 x.clock('2026-10-16T09:00:00Z');await x.mail.tick();assert.equal(x.sent.length,1);
 assert.equal(x.sent[0].to,'ta@test.school');assert.match(x.sent[0].html,/Teacher submissions needed/);assert.match(x.sent[0].html,/TA translation and review/);assert.doesNotMatch(x.sent[0].html,/Art/);
 await x.mail.tick();assert.equal(x.sent.length,1);
 x.clock('2026-10-17T09:00:00Z');await x.mail.tick();assert.equal(x.sent.length,2);assert.doesNotMatch(x.sent[1].html,/Teacher submissions/);
});
test('individual schedules can be disabled and invalid settings are rejected',async t=>{
 const x=setup(t),disabled={enabled:false,day:5,time:'16:00'};
 x.mail.configure(x.user,'workspace',{mode:'live',teacher:disabled,ta:disabled,coordinator:disabled});
 x.clock('2026-10-16T09:00:00Z');await x.mail.tick();assert.equal(x.sent.length,0);assert.deepEqual(x.mail.preview(x.user,'workspace'),[]);
 assert.throws(()=>x.mail.configure(x.user,'workspace',{mode:'live',ta:{enabled:true,time:'99:00'}}),/valid/);
});

test('newsletter cap defers delivery without losing the next eligible digest',async t=>{
 const x=setup(t);x.mail.configure(x.user,'workspace',{mode:'live',day:5,time:'17:00'});
 Object.assign(x.w.reports[0].entries[0],{submitted:true});
 x.clock('2026-10-16T09:00:00Z');
 const saved=JSON.parse(fs.readFileSync(x.options.filename));
 saved.deliveries=Array.from({length:90},(_,i)=>({id:String(i),firstAttempt:x.options.now().toISOString(),sentAt:x.options.now().toISOString(),status:'sent'}));
 fs.writeFileSync(x.options.filename,JSON.stringify(saved));
 await x.mail.tick();assert.equal(x.sent.length,0);
 assert.equal(x.mail.settings(x.user,'workspace').usage.sent,90);
 x.clock('2026-10-17T09:01:00Z');await x.mail.tick();assert.equal(x.sent.length,1);
});
test('retry uses identical email content even if outstanding work changes',async t=>{
 const x=setup(t);x.mail.configure(x.user,'workspace',{mode:'live',day:5,time:'17:00'});
 Object.assign(x.w.reports[0].entries[0],{submitted:true});x.clock('2026-10-16T09:00:00Z');
 const attempts=[],mail=createNotifications({...x.options,send:async m=>{attempts.push(m);if(attempts.length===1)throw Error('timeout');return {id:'ok'};}});
 await mail.tick();x.w.reports[0].entries.push({subject:'Math',submitted:true});x.advance();await mail.tick();
 assert.equal(attempts.length,2);assert.deepEqual(attempts[1],attempts[0]);
});
