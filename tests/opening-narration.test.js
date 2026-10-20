const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const manifest=require('../public/assets/game-narration/manifest.json');
test('bundled narration matches displayed openings and fits scene timing',()=>{
 const board=fs.readFileSync('public/colonyquest.js','utf8').match(/intro: '([^\n]+)',/)[1];
 assert.equal(manifest.clips['colony-board'].text,board);
 const intro=require('../colonyquest-story').beats.intro;
 assert.deepEqual(Array.from({length:4},(_,i)=>manifest.clips['colony-'+i].text),intro.line.split('\n\n'));
 assert.equal(intro.seconds,Array.from({length:4},(_,i)=>manifest.clips['colony-'+i].seconds+1).reduce((a,b)=>a+b,0));
 const moon=fs.readFileSync('public/moonquest-story.js','utf8');
 for(let i=0;i<4;i++){assert.ok(moon.includes(manifest.clips['moon-'+i].text));assert.ok(manifest.clips['moon-'+i].seconds<6);}
 for(const clip of Object.values(manifest.clips))assert.ok(fs.statSync('public'+clip.src).size>1000);
 assert.ok(!fs.readFileSync('public/moonquest.js','utf8').includes('SpeechSynthesisUtterance'));
});
