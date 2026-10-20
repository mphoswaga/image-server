const {test}=require('node:test');const assert=require('node:assert/strict');
let prompt='',response;
require.cache[require.resolve('../ai-client')]={exports:{client:()=>({chat:{completions:{create:async request=>{prompt=request.messages[0].content;return {choices:[{message:{content:JSON.stringify(response)}}]};}}}})}};
const {generateTopicMcq,topicMcqGradeGuidance}=require('../lesson-pack');
test('topic MCQs use teacher scope and automatic count policy, reject invalid choices',async()=>{
 const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';
 try{
 response={title:'Sizes',instructions:'Choose one',mcq:[{question:'Largest unit?',options:['B','KB','GB','TB'],correctIndex:3}],shortAnswer:[],totalMarks:99};
 const result=await generateTopicMcq({subject:'ICT',grade:'3',topic:'File sizes',instructions:'Include bytes through TB and audio files.'});
 assert.equal(result.totalMarks,1);assert.match(prompt,/Include bytes through TB/);assert.match(prompt,/choose 8–20/);assert.match(prompt,/illustrative rather than universal/);
 response.mcq[0].correctIndex=8;
 await assert.rejects(generateTopicMcq({}),/correction/);
 }finally{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}
});

test('grade guidance distinguishes early primary, upper primary and secondary',()=>{
 assert.match(topicMcqGradeGuidance('Grade 3'),/Early primary/);
 assert.match(topicMcqGradeGuidance('Grade 3'),/do not require binary conversions/);
 assert.match(topicMcqGradeGuidance('Grade 6'),/Upper primary/);
 assert.match(topicMcqGradeGuidance('Grade 9'),/selected year group's curriculum depth/);
 assert.doesNotMatch(topicMcqGradeGuidance('Grade 9'),/Early primary/);
});
