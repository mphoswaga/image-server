const test = require('node:test');
const assert = require('node:assert/strict');
const { newsletterSource, generateNewsletter } = require('../newsletter');
const { planToText } = require('../lesson-plan');

const plan = { sections: [{ heading: 'Learning', content: 'Match animals to their habitats.' }] };
test('newsletter draws on complete plans and excludes unrelated saved content', () => {
  const workspace = { subject: 'Global Perspectives', topic: 'Planet Earth', grade: 'Grade 2', plan, newsletter: { text: 'Old newsletter' }, packs: { homework: 'other material' } };
  assert.deepEqual(newsletterSource(workspace).lessons, [{ lesson: 1, sections: plan.sections }]);
  assert.ok(!JSON.stringify(newsletterSource(workspace)).includes('Old newsletter'));
  assert.throws(() => newsletterSource({ ...workspace, context: { sequenceEnabled: true, sequenceLessonCount: 2 }, sequencePlans: [plan] }), /Finish all/);
  assert.equal(newsletterSource({ ...workspace, context: { sequenceEnabled: true, sequenceLessonCount: 2 }, sequencePlans: [plan, plan] }).lessons.length, 2);
  assert.throws(() => newsletterSource({}), /lesson plan first/);
});
test('generated newsletter has subject-specific LMS homework and correct weekly prompt', async () => {
  let request;
  const ai = { chat: { completions: { create: async args => { request = args; return { choices: [{ message: { content: JSON.stringify({ learning: 'This week, students will explore habitats.', homeSupport: 'Ask your child where a bird lives.', vocabulary: [{ term: 'Habitat', meaning: 'The place where an animal or plant lives.' }] }) } }] }; } } } };
  const result = await generateNewsletter(newsletterSource({ subject: 'Global Perspectives', plan }), 'this', ai);
  assert.match(request.messages[0].content, /this week/);
  assert.match(result.text, /How can you help at home\?/);
  assert.match(result.text, /Homework\nPlease make sure your child completes the Global Perspectives homework on LMS/);
  assert.match(result.text, /Key vocabulary\nHabitat: The place where an animal or plant lives\./);
  assert.ok(request.response_format.json_schema.schema.required.includes('vocabulary'));
  assert.equal(result.timing, 'this');
  assert.ok(!planToText({ ...plan, newsletter: result }).includes('LMS'));
});
test('incomplete AI response fails without inventing a newsletter', async () => {
  const ai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }] }) } } };
  await assert.rejects(generateNewsletter({ subject: 'ICT' }, 'next', ai), /incomplete/);
});

test('missing or empty vocabulary is rejected rather than saved as a complete newsletter', async () => {
  for (const vocabulary of [undefined, [], [{ term: 'Habitat', meaning: ' ' }], [null]]) {
    const ai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ learning: 'Learning about habitats.', homeSupport: 'Talk about animals.', vocabulary }) } }] }) } } };
    await assert.rejects(generateNewsletter({ subject: 'Science' }, 'next', ai), /incomplete/);
  }
});
