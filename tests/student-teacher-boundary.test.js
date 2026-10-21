const {test, after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'student-boundary-'));
process.env.DATA_DIR=dir;
const auth=require('../auth');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('student school email cannot become first administrator or social teacher',async()=>{
 const student=await auth.signup('MINH070904@STU.VINSCHOOL.EDU.VN','test-password','Minh');
 assert.equal(student.role,'student');
 assert.equal(student.accessMode,'student');
 for(const provider of ['google','educscope']) {
  const user=await auth.findOrCreateSocialUser({provider,providerUserId:provider,email:'another@stu.vinschool.edu.vn',name:'Learner'});
  assert.equal(user.role,'student');
 }
 const teacher=await auth.signup('teacher@vinschool.edu.vn','test-password','Teacher');
 assert.equal(teacher.role,'teacher');
});
test('existing teacher sessions lose teacher permission without deleting records',()=>{
 const file=path.join(dir,'users.json');
 const users=JSON.parse(fs.readFileSync(file));
 users.legacy={id:'legacy',email:'legacy@stu.vinschool.edu.vn',role:'teacher'};
 users.linked={id:'linked',email:'personal@example.com',role:'teacher',identities:{'google:old':{email:'linked@stu.vinschool.edu.vn'}}};
 fs.writeFileSync(file,JSON.stringify(users));
 for(const id of ['legacy','linked']) {
  const token=auth.issueToken(id);
  let called=false,status,body;
  auth.requireAuth({cookies:{[auth.COOKIE_NAME]:token},originalUrl:'/api/lesson-plan'}, {status(n){status=n;return this;},json(value){body=value;}},()=>{called=true;});
  assert.equal(called,false);assert.equal(status,403);assert.equal(body.loginUrl,'/start');
 }
 assert.equal(JSON.parse(fs.readFileSync(file)).legacy.role,'teacher');
});
test('teacher session remains authorised',async()=>{
 const user=await auth.login('teacher@vinschool.edu.vn','test-password');
 let called=false;
 auth.requireAuth({cookies:{[auth.COOKIE_NAME]:auth.issueToken(user.id)},originalUrl:'/api/lesson-plan'}, {status(){throw Error('unexpected rejection');}},()=>{called=true;});
 assert.equal(called,true);
});

test('student sessions cannot host multiplayer or start teacher-only computer practice', async()=>{
 const user=await auth.login('minh070904@stu.vinschool.edu.vn','test-password');
 for(const url of ['/api/game/example/colonyquest-live/open','/api/game/example/colonyquest','/api/game/example/fishquest-live/open','/api/moonquest/sessions']) {
  let status,body,called=false;
  auth.requireAuth({cookies:{[auth.COOKIE_NAME]:auth.issueToken(user.id)},originalUrl:url}, {status(n){status=n;return this;},json(value){body=value;}},()=>{called=true;});
  assert.equal(status,403,url); assert.equal(called,false,url); assert.equal(body.studentOnly,true);
 }
});
