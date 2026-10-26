const { normalizeAssessmentDraft, ASSESSMENT_DRAFT_SCHEMA } = require('./assessment-draft');

// Generate the missing phase separately so a long MCQ section cannot crowd it out.
async function completePracticalPhase(client, draft, context, options, model) {
  if (!draft || !options.questionTypes.includes('practical') || !Number.isInteger(options.practicalCount)) return draft;
  const phases = options.phaseRequirements.filter(phase => phase.type === 'practical');
  const existing = draft.sections.filter(section => section.type === 'practical');
  if (phases.length !== 1 || existing.length > 1 || existing[0]?.items.length === options.practicalCount) return draft;
  const keys = Array.from({ length: options.practicalCount }, (_, i) => `task_${i + 1}`);
  const itemSchema = ASSESSMENT_DRAFT_SCHEMA.properties.sections.items.properties.items.items;
  const response = await client.chat.completions.create({ model, max_tokens: Math.min(12000, 1000 + keys.length * 350),
    messages: [{ role: 'user', content: `Create the practical section ONLY for this ${context.lessonPurpose}. Return exactly ${keys.length} distinct hands-on tasks in the required task properties, worth ${phases[0].marks} marks altogether. Each task must describe concrete student actions and observable evidence that a teacher can mark, with positive integer marks. Do not write multiple-choice questions or written knowledge questions disguised as practical work. Keep options and answerKey empty, correctIndex 0. Pitch reading, difficulty and independence to the exact grade. Do not reveal solutions in the task wording.\nSubject: ${context.subject}\nGrade: ${context.grade}\nObjectives: ${context.objectives}\nTeacher requirements: ${context.brief || ''}\nExisting assessment for context: ${JSON.stringify(draft)}` }],
    response_format: { type: 'json_schema', json_schema: { name: 'assessment_practical_completion', strict: true,
      schema: { type: 'object', additionalProperties: false, properties: Object.fromEntries(keys.map(key => [key, itemSchema])), required: keys } } },
  });
  const raw = JSON.parse(response.choices?.[0]?.message?.content || 'null');
  const items = keys.map(key => raw?.[key]);
  if (items.some(item => !item || !String(item.prompt || '').trim() || !Number.isInteger(item.marks) || item.marks < 1)) throw new Error('Practical task generation returned incomplete tasks.');
  const sections = draft.sections.filter(section => section.type !== 'practical');
  const phaseIndex = options.phaseRequirements.findIndex(phase => phase.type === 'practical');
  sections.splice(Math.min(phaseIndex, sections.length), 0, {
    title: phases[0].title || 'Practical tasks', type: 'practical', instructions: 'Complete each task independently. Your teacher will assess your work.',
    objectiveIndexes: draft.objectives.map((_, i) => i), items,
  });
  return normalizeAssessmentDraft({ ...draft, sections }, context);
}
module.exports = { completePracticalPhase };
