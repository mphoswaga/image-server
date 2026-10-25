const { integrateTeachingEvidence } = require('./lesson-observation');

// One bounded rescue after normal plan retries. Only the schedule is editable.
async function repairCheckpointTimings(client, plan, options, { model, settings } = {}) {
  const original = integrateTeachingEvidence(plan, options);
  if (!original.issues.some(issue => issue.startsWith('Allocate time to the activity containing the learning checkpoint'))
    || !Number.isInteger(Number(options.periodMinutes)) || Number(options.periodMinutes) < 1) return plan;
  const bindings = [];
  const properties = {};
  for (const [index, item] of (plan.teachingEvidence || []).entries()) {
    if (!item || !Array.isArray(item.timings)) return plan;
    const headings = [...new Set([...item.timings.map(t => t?.sectionHeading), item.sectionHeading])];
    for (const heading of headings) {
      if (!heading || /reflection|resources|objectives|overview|phonics/i.test(heading)) return plan;
      const key = `activity${bindings.length}`;
      bindings.push({ key, index, heading });
      properties[key] = { type: 'integer', minimum: 1, maximum: 180, description: `Lesson ${item.lesson}: ${heading}` };
    }
  }
  if (!bindings.length) return plan;
  try {
    const response = await client.chat.completions.create({ model, max_tokens: 2000,
      messages: [
        { role: 'system', content: 'Repair only this lesson timetable. Every required activity needs time, including the learning checkpoint. For EACH lesson the minutes must sum exactly to the requested period. Rebalance existing minutes; never add time beyond the period. Allow realistic time for the supplied activities and checkpoint, keep closing brief, and preserve any reserved game interval. Do not change content or invent activities.' },
        { role: 'user', content: JSON.stringify({ periodMinutes: Number(options.periodMinutes), settings, plan, activities: bindings, issues: original.issues }) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'checkpoint_timetable', strict: true,
        schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } },
    });
    const values = JSON.parse(response.choices?.[0]?.message?.content || 'null');
    if (!values || Object.keys(values).length !== bindings.length || bindings.some(b => !Number.isInteger(values[b.key]) || values[b.key] < 1 || values[b.key] > 180)) return plan;
    const candidate = { ...plan, teachingEvidence: plan.teachingEvidence.map((item, index) => ({ ...item,
      timings: bindings.filter(b => b.index === index).map(b => ({ sectionHeading: b.heading, minutes: values[b.key] })),
    })) };
    // Keep every timing/evidence check; caller still validates game intervals and objectives.
    return integrateTeachingEvidence(candidate, options).issues.length ? plan : candidate;
  } catch (_) {
    return plan;
  }
}
module.exports = { repairCheckpointTimings };
