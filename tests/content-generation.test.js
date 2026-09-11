const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('AI slide generation carries assessment settings through the cache and approved-plan prompt', async () => {
  const filename = path.join(__dirname, '..', 'content.js');
  const realRequire = createRequire(filename);
  const requests = [];
  const cacheInputs = [];
  const response = {
    titleSlide: { title: 'Document project' }, objectives: { items: ['Create a letter'] },
    slides: [{ title: 'Prepare your document', bullets: ['Open your document.'], stageId: 'launch' }],
    activity: { instructions: ['Save your work.'] }, recap: { points: ['Submit your work.'] },
  };
  const moduleObject = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: moduleObject,
    process: { env: { OPENAI_API_KEY: 'test-only' } },
    console,
    require: name => {
      if (name === './ai-client') return { client: () => ({ chat: { completions: {
        create: async request => {
          requests.push(request);
          return { choices: [{ message: { content: JSON.stringify(response) } }] };
        },
      } } }) };
      if (name === './cache') return { wrap: async (namespace, inputs, generate) => {
        assert.equal(namespace, 'content');
        cacheInputs.push(inputs);
        return generate();
      } };
      return realRequire(name);
    },
  }, { filename });

  for (const lessonPurpose of ['lesson', 'project', 'test']) {
    const slides = await moduleObject.exports.generateContent('ICT', 'documents', 1, 'Grade 2', 'clear', '', {
      lessonPurpose, lessonPlanText: 'Approved plan: students create and submit a letter.',
      assessmentTotalMarks: 80, assessmentQuestionTypes: ['mcq', 'practical'], assessmentMcqCount: 20,
    });
    assert.equal(slides.filter(slide => slide.type === 'content').length, 1);
    assert.equal(cacheInputs.at(-1).assessmentOptions.totalMarks, 80);
    assert.equal(cacheInputs.at(-1).assessmentOptions.mcqCount, 20);
    assert.match(requests.at(-1).messages[0].content, /Approved plan: students create and submit a letter/);
    if (lessonPurpose !== 'lesson') assert.match(requests.at(-1).messages[0].content, /20-item multiple-choice knowledge check/);
  }
  assert.equal(requests.length, 3);
});
