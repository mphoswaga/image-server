const test = require('node:test');
const assert = require('node:assert/strict');
const { repairCheckpointTimings } = require('../lesson-timing-repair');
const { integrateTeachingEvidence } = require('../lesson-observation');
const fixture = () => ({ sections: [{ heading: 'Main Teaching', content: 'Model sorting.' }, { heading: 'Guided Practice', content: 'Sort materials.' }], teachingEvidence: [{ lesson: 1, sectionHeading: 'Guided Practice', question: 'Why?', expectedReasoning: 'Properties', allLearnerCheck: 'Show sorts', ifThenResponse: 'Model again', recheck: 'Sort a new item', studentReview: 'Revise sort', timings: [{ sectionHeading: 'Main Teaching', minutes: 35 }] }] });
const client = values => ({ chat: { completions: { create: async request => {
  assert.deepEqual(request.response_format.json_schema.schema.required, ['activity0', 'activity1']);
  return { choices: [{ message: { content: JSON.stringify(values) } }] };
} } } });
test('missing checkpoint gets its own required time without changing content or total', async () => {
  const plan = fixture(); const before = JSON.stringify(plan);
  const repaired = await repairCheckpointTimings(client({ activity0: 15, activity1: 20 }), plan, { periodMinutes: 35 });
  assert.deepEqual(integrateTeachingEvidence(repaired, { periodMinutes: 35 }).issues, []);
  assert.deepEqual(repaired.sections, plan.sections);
  assert.equal(JSON.stringify(plan), before);
  assert.equal(repaired.teachingEvidence[0].question, plan.teachingEvidence[0].question);
});
test('invalid totals, omitted activities and fractional minutes cannot bypass validation', async () => {
  for (const values of [{ activity0: 35, activity1: 20 }, { activity0: 35 }, { activity0: 14.5, activity1: 20.5 }]) {
    const plan = fixture();
    assert.equal(await repairCheckpointTimings(client(values), plan, { periodMinutes: 35 }), plan);
  }
});
test('valid schedules do not make another AI call', async () => {
  const plan = fixture(); plan.teachingEvidence[0].timings = [{ sectionHeading: 'Guided Practice', minutes: 35 }];
  assert.equal(await repairCheckpointTimings(null, plan, { periodMinutes: 35 }), plan);
});
test('staged second lesson uses its local headings', async () => {
  const plan = fixture(); plan.teachingEvidence[0].lesson = 2;
  const options = { periodMinutes: 35, sequenceLessonNumber: 2 };
  const repaired = await repairCheckpointTimings(client({ activity0: 15, activity1: 20 }), plan, options);
  assert.deepEqual(integrateTeachingEvidence(repaired, options).issues, []);
});
test('failed repair preserves original validation failure', async () => {
  const plan = fixture();
  assert.equal(await repairCheckpointTimings(null, plan, { periodMinutes: 35 }), plan);
  assert.ok(integrateTeachingEvidence(plan, { periodMinutes: 35 }).issues.length);
});
