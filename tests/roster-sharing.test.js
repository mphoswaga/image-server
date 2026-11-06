const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {createSharing}=require('../roster-sharing');
test('roster invitations restrict recipients and copy only class identity fields once',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roster-share-'));const copies=[];
 const source={id:'class1',name:'3B4',students:[{id:'S1',name:'Learner',gender:'male',marks:[100],comment:'private'}],marks:{S1:100},teams:['secret']};
 const roster={getRoster:(owner,id)=>owner==='owner'&&id==='class1'?source:null,saveRoster:(owner,data)=>{copies.push({owner,...data});return {id:'copy1'};}};
 const sharing=createSharing({roster,dir});const owner={id:'owner',email:'owner@school.edu',name:'Owner'},recipient={id:'new',email:'new@school.edu'};
 try{
 const i=sharing.create(owner,{recipientEmail:'NEW@school.edu',rosterIds:['class1']});
 assert.equal(sharing.visible(recipient).length,1);assert.equal(sharing.visible({id:'other',email:'other@school.edu'}).length,0);
 assert.throws(()=>sharing.accept({id:'other',email:'other@school.edu'},i.id),/another teacher/);
 assert.throws(()=>sharing.create(recipient,{recipientEmail:'else@school.edu',rosterIds:['class1']}),/own rosters/);
 sharing.accept(recipient,i.id);sharing.accept(recipient,i.id);assert.equal(copies.length,1);
 assert.deepEqual(copies[0].students,[{id:'S1',name:'Learner',gender:'male'}]);assert.equal(copies[0].marks,undefined);assert.equal(copies[0].teams,undefined);
 assert.throws(()=>sharing.revoke(owner,i.id),/already accepted/);
 const j=sharing.create(owner,{recipientEmail:'next@school.edu',rosterIds:['class1']});sharing.revoke(owner,j.id);assert.throws(()=>sharing.accept({id:'next',email:'next@school.edu'},j.id),/withdrawn/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('an accepted roster copy exports newly recorded gender only for its shared learners', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-share-gender-'));
  const source = { id: 'class1', name: '2B2', students: [{ id: 'S1', name: 'Learner' }, { id: 'S2', name: 'Other' }] };
  let copy;
  const roster = {
    getRoster: (owner, id) => owner === 'owner' && id === source.id ? source : null,
    getRosterOrMerged: (owner, id) => owner === 'owner' && id === source.id ? source : null,
    normalizeStudentId: id => id.toUpperCase(),
    saveRoster: (owner, data) => (copy = { ...data, id: 'copy1' })
  };
  const sharing = createSharing({ roster, dir });
  const owner = { id: 'owner', email: 'owner@school.edu' };
  const recipient = { id: 'recipient', email: 'recipient@school.edu' };
  try {
    const invite = sharing.create(owner, { recipientEmail: recipient.email, rosterIds: [source.id] });
    sharing.accept(recipient, invite.id);
    copy.mergedRosterIds = [copy.id];
    copy.id = 'merged';
    source.students[0].gender = 'female';
    source.students[0].marks = [10];
    source.students[1].gender = 'male';
    copy.students[0].id = 's1';
    copy.students[1].gender = 'female';
    copy.students.push({ id: 'S3', name: 'New learner' });
    assert.deepEqual(sharing.studentsWithSharedGender(recipient.id, copy), [
      { id: 's1', name: 'Learner', gender: 'female' },
      { id: 'S2', name: 'Other', gender: 'female' },
      { id: 'S3', name: 'New learner' }
    ]);
    assert.equal(copy.students[0].gender, undefined);
    assert.deepEqual(sharing.studentsWithSharedGender('another-teacher', copy), copy.students);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
