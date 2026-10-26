const {test}=require('node:test');
const assert=require('node:assert/strict');
const audit=require('../audit');
const {list}=require('../activity-log');
test('older student logins resolve current names and all classes without exposing roster data',()=>{
  const original=audit.recent;
  audit.recent=()=>[{ts:'2026-10-17T12:00:00Z',event:'student.social.login',studentId:'VS070904'}];
  const rosters={normalizeStudentId:v=>String(v).toUpperCase(),listRosters:()=>[{id:'one',name:'Grade 2B1'},{id:'two',name:'ICT club'}],getRoster:()=>({students:[{id:'VS070904',name:'Sample Learner',pin:'secret'}]})};
  try{
    const data=list({search:'Grade 2B1'},[{id:'teacher'}],rosters);
    assert.equal(data.total,1);
    assert.equal(data.events[0].name,'Sample Learner');
    assert.deepEqual(data.events[0].classes,['Grade 2B1','ICT club']);
    assert.ok(!JSON.stringify(data).includes('secret'));
    const unmatched=list({},[],rosters);
    assert.deepEqual(unmatched.events[0].classes,[]);
  }finally{audit.recent=original;}
});
