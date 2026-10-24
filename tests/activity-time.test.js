const test=require('node:test'),assert=require('node:assert/strict');
const {newestActivityFirst,activityTime}=require('../activity-time');
test('mixed MoonQuest numeric dates and ISO assessment dates sort chronologically without crashing',()=>{const rows=[{id:'old',at:'2026-01-01T00:00:00Z'},{id:'new',at:Date.parse('2026-03-01T00:00:00Z')},{id:'middle',at:'2026-02-01T00:00:00Z'},{id:'missing',at:null}];assert.deepEqual(rows.sort(newestActivityFirst).map(r=>r.id),['new','middle','old','missing']);assert.equal(activityTime('invalid'),0);});
