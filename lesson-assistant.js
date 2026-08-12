const { client } = require('./ai-client');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_MESSAGE = 700;
const MAX_CONTEXT = 9000;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string' },
    outOfScope: { type: 'boolean' },
    followUps: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string' },
    },
  },
  required: ['answer', 'outOfScope', 'followUps'],
};

function cleanText(value, max = MAX_MESSAGE) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanAnswer(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1800);
}

function cleanContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = [
    'stage', 'step', 'subject', 'topic', 'grade', 'objectives', 'focus',
    'teachingModel', 'lessonCount', 'periodMinutes', 'sourceSummary',
    'planText', 'slideText',
  ];
  const result = {};
  for (const key of allowed) {
    if (value[key] == null || value[key] === '') continue;
    result[key] = cleanText(value[key], key === 'planText' || key === 'slideText' ? 4500 : 1400);
  }
  return result;
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-6).map(item => ({
    role: item && item.role === 'assistant' ? 'assistant' : 'user',
    content: cleanText(item && item.content, 900),
  })).filter(item => item.content);
}

async function answer({ message, context, history }) {
  const question = cleanText(message);
  if (!question) throw new Error('Choose a question or type one about this lesson.');

  const safeContext = cleanContext(context);
  const contextText = JSON.stringify(safeContext).slice(0, MAX_CONTEXT);
  const response = await client().chat.completions.create({
    model: MODEL,
    temperature: 0.35,
    messages: [
      {
        role: 'system',
        content: `You are LessonScope Assistant, a concise curriculum-planning coach for teachers.

SCOPE: Only help with the current lesson or closely related curriculum planning, teaching models, objectives, success criteria, pacing, differentiation, classroom activities, assessment, lesson resources, lesson plans, and slide design. Do not answer general trivia, personal requests, coding, business, politics, entertainment, or unrelated questions.

If the request is outside scope, set outOfScope=true and say: "I can help with this lesson, its slides, activities, assessment, or teaching approach." Then offer curriculum-focused follow-ups.

SAFETY AND CONTROL:
- Never claim to have edited, generated, downloaded, published, or charged anything.
- Give advice or a draft only. The teacher must review and apply changes in LessonScope.
- Never request or infer student names, IDs, marks, medical information, or other personal data.
- Base advice on the supplied lesson context. If essential context is missing, ask one short teaching-related question.
- Keep the answer practical, warm, and under 180 words. Use short bullets when helpful.
- Follow-ups must be short actions that remain in curriculum-planning scope.`,
      },
      { role: 'system', content: `Current LessonScope context: ${contextText || '{}'}` },
      ...cleanHistory(history),
      { role: 'user', content: question },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'lessonscope_assistant_reply', strict: true, schema: RESPONSE_SCHEMA },
    },
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  return {
    answer: cleanAnswer(parsed.answer),
    outOfScope: !!parsed.outOfScope,
    followUps: (parsed.followUps || []).map(item => cleanText(item, 100)).filter(Boolean).slice(0, 3),
  };
}

module.exports = { answer, cleanContext };
