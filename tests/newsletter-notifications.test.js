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
 const x=setup(t);x.mail.configure(x.user,'workspace',{mode:'test',day:5,time:'15:00'});
 x.advance();Object.assign(x.w.reports[0].entries[0],{submitted:true,submittedAt:x.options.now().toISOString()});
 await x.mail.tick();assert.equal(x.sent.length,1);assert.equal(x.sent[0].to,'c@test.school');assert.match(x.sent[0].subject,/TEST/);
 await createNotifications(x.options).tick();assert.equal(x.sent.length,1);
 x.w.reports[0].entries[0].reviewed=true;await x.mail.tick();assert.equal(x.sent.length,1);
 x.clock('2026-10-16T08:00:00Z');await x.mail.tick();assert.equal(x.sent.length,2);assert.match(x.sent[1].subject,/weekly/);
 await x.mail.tick();assert.equal(x.sent.length,2);
});
test('disabled is silent, preview sends nothing, live routes to assigned TA only',async t=>{
 const x=setup(t);await x.mail.tick();assert.equal(x.sent.length,0);x.mail.preview(x.user,'workspace');assert.equal(x.sent.length,0);
 assert.throws(()=>x.mail.configure({id:'ta'},'workspace',{mode:'live',day:5,time:'15:00'}),/coordinator/);
 x.mail.configure(x.user,'workspace',{mode:'live',day:5,time:'15:00'});x.advance();Object.assign(x.w.reports[0].entries[0],{submitted:true,submittedAt:x.options.now().toISOString()});
 await x.mail.tick();assert.equal(x.sent[0].to,'ta@test.school');assert.equal(x.sent.length,1);
});
test('provider failure retains idempotency key on retry and missing config never sends',async t=>{
 const x=setup(t);x.mail.configure(x.user,'workspace',{mode:'test',day:5,time:'15:00'});x.advance();Object.assign(x.w.reports[0].entries[0],{submitted:true,submittedAt:x.options.now().toISOString()});
 const attempts=[];const mail=createNotifications({...x.options,send:async m=>{attempts.push(m.idempotencyKey);if(attempts.length===1)throw Error('timeout');return {id:'sent'};}});
 await mail.tick();x.advance();await mail.tick();assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);
 await assert.rejects(createNotifications({...x.options,configured:()=>false}).test(x.user,'workspace'),/requires/);
});
test('Vietnam schedule crosses UTC dates correctly',()=>{assert.deepEqual(vietnamTime(new Date('2026-10-15T18:30:00Z')),{date:'2026-10-16',day:5,time:'01:30'});});
