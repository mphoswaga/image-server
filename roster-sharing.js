const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {DATA_DIR,writeJsonAtomic}=require('./storage');
function createSharing({roster,dir=path.join(DATA_DIR,'roster-invitations')}){
  const email=value=>String(value||'').trim().toLowerCase();
  const file=id=>{if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Invitation not found.');return path.join(dir,id+'.json');};
  function read(id){return JSON.parse(fs.readFileSync(file(id),'utf8'));}
  function list(){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>read(n.slice(0,-5)));}
  function create(user,{recipientEmail,rosterIds}){
    const recipient=email(recipientEmail);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||recipient.length>254)throw Error('Enter your colleague’s sign-up email.');
    if(recipient===email(user.email))throw Error('Choose a different teacher.');
    const ids=[...new Set(Array.isArray(rosterIds)?rosterIds:[])];
    if(!ids.length||ids.length>50)throw Error('Choose between 1 and 50 classes.');
    if(ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id)))throw Error('Choose a valid class.');
    const classes=ids.map(id=>{const r=roster.getRoster(user.id,id);if(!r)throw Error('You can only share your own rosters.');return {id:r.id,name:r.name,count:r.students.length};});
    const existing=list().find(i=>i.ownerId===user.id&&i.recipientEmail===recipient&&i.status==='pending'&&JSON.stringify(i.classes.map(c=>c.id).sort())===JSON.stringify([...ids].sort()));
    if(existing)return existing;
    const invitation={id:crypto.randomUUID(),ownerId:user.id,ownerName:user.name||'A teacher',recipientEmail:recipient,classes,status:'pending',createdAt:new Date().toISOString(),copies:{}};
    writeJsonAtomic(file(invitation.id),invitation);return invitation;
  }
  function visible(user){return list().filter(i=>i.ownerId===user.id||i.recipientEmail===email(user.email)).map(i=>({id:i.id,ownerName:i.ownerName,recipientEmail:i.recipientEmail,classes:i.classes,status:i.status,sent:i.ownerId===user.id}));}
  function accept(user,id){
    const i=read(id);if(i.recipientEmail!==email(user.email)||i.ownerId===user.id)throw Error('This invitation belongs to another teacher.');
    if(i.status==='revoked')throw Error('This invitation was withdrawn.');
    if(i.acceptedBy&&i.acceptedBy!==user.id)throw Error('This invitation was already accepted.');
    if(i.status==='accepted')return {rosterIds:Object.values(i.copies)};
    // Validate every source before copying. Only explicitly allowed roster fields travel.
    const sources=i.classes.map(c=>{const r=roster.getRoster(i.ownerId,c.id);if(!r)throw Error('A shared class was removed. Ask the sender for a new invitation.');return r;});
    i.acceptedBy=user.id;
    for(const source of sources){
      if(i.copies[source.id])continue;
      const copy=roster.saveRoster(user.id,{name:source.name,students:source.students.map(s=>({id:s.id,name:s.name,...(s.gender?{gender:s.gender}:{})})),organizationId:user.organizationId});
      i.copies[source.id]=copy.id;writeJsonAtomic(file(i.id),i);
    }
    i.status='accepted';i.acceptedAt=new Date().toISOString();writeJsonAtomic(file(i.id),i);return {rosterIds:Object.values(i.copies)};
  }
  function revoke(user,id){const i=read(id);if(i.ownerId!==user.id)throw Error('Only the sender can withdraw this invitation.');if(i.status==='accepted')throw Error('The teacher already accepted their independent roster copies.');i.status='revoked';writeJsonAtomic(file(id),i);}
  return {create,visible,accept,revoke};
}
module.exports={createSharing};
