const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'game-joining-'));
process.env.DATA_DIR=dir;
const policy=require('../game-join-policy');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('PIN-free game joining defaults off, persists per teacher, and can be revoked',()=>{
 assert.equal(policy.enabled('one'),false);
 policy.set('one',true,'admin');
 assert.equal(policy.enabled('one'),true);
 assert.equal(policy.enabled('two'),false);
 delete require.cache[require.resolve('../game-join-policy')];
 assert.equal(require('../game-join-policy').enabled('one'),true);
 assert.throws(()=>policy.set('one','false','admin'));
 assert.equal(policy.enabled('one'),true);
 policy.set('one',false,'admin');assert.equal(policy.enabled('one'),false);
});
