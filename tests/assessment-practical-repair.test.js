const test = require('node:test');
const assert = require('node:assert/strict');
const { objectiveAssessmentContext } = require('../assessment-objective-generator');
const { normalizeAssessmentDraft, assessmentDraftIssues } = require('../assessment-draft');
const { repairAssessmentDraft } = require('../lesson-plan');
function context(count) { return objectiveAssessmentContext({ subject: 'ICT', grade: 'Grade 3', objectives: 'Compare file sizes and organise files.', kind: 'test', totalMarks: 50, format: 'mixed', mcqCount: count, practicalMarks: 50-count, practicalCount: 5 }); }
function mcqs(count) { return { title: 'File sizes', instructions: 'Work independently.', sections: [{ title: 'Multiple choice', type: 'mcq', instructions: 'Choose one.', objectiveIndexes: [0], items: Array.from({ length: count }, (_, i) => ({ prompt: `Which file is larger: ${i+1} KB or ${i+2} KB?`, options: [`${i+1} KB`, `${i+2} KB`], correctIndex: 1, marks: 1, answerKey: '' })) }] }; }
test('missing practical section never absorbs its marks into the MCQ section', () => {
  const draft=normalizeAssessmentDraft(mcqs(30),context(30));
  assert.equal(draft.sections[0].items.reduce((s,i)=>s+i.marks,0),30);
  assert.ok(draft.sections[0].items.every(i=>i.marks===1));
  assert.ok(assessmentDraftIssues(draft,context(30)).includes('practical section is missing'));
});
for (const count of [25,30]) test(`${count} MCQs plus five missing practical tasks are repaired with exact marks`, async () => {
  const options=context(count); let calls=0;
  const client={chat:{completions:{create:async request=>{
    calls++;
    let data=mcqs(count);
    if(request.response_format.json_schema.name==='assessment_practical_completion') {
      assert.equal(request.response_format.json_schema.schema.required.length,5);
      data=Object.fromEntries(Array.from({length:5},(_,i)=>[`task_${i+1}`,{prompt:`Create folder ${i+1} and place the supplied file set ${i+1} in ascending size order.`,marks:(50-count)/5,options:[],correctIndex:0,answerKey:''}]));
    }
    return {choices:[{message:{content:JSON.stringify(data)}}]};
  }}}};
  const draft=await repairAssessmentDraft(client,null,options,options);
  assert.equal(calls,2);
  assert.deepEqual(assessmentDraftIssues(draft,options),[]);
  assert.deepEqual(draft.sections.map(s=>s.type),['mcq','practical']);
  assert.equal(draft.sections[0].items.length,count);
  assert.equal(draft.sections[1].items.length,5);
  assert.equal(draft.sections[1].items.reduce((s,i)=>s+i.marks,0),50-count);
});
test('incomplete practical completion still fails closed',async()=>{
  const options=context(30);
  const client={chat:{completions:{create:async request=>({choices:[{message:{content:JSON.stringify(request.response_format.json_schema.name==='assessment_practical_completion'?{}:mcqs(30))}}]})}}};
  await assert.rejects(repairAssessmentDraft(client,null,options,options),/practical section is missing/);
});
