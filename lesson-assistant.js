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

const EDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    edits: {
      type: 'array',
      maxItems: 18,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          heading: { type: 'string' },
          content: { type: 'string' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          bullets: { type: 'array', maxItems: 6, items: { type: 'string' } },
          example: { type: 'string' },
        },
        required: ['index', 'heading', 'content', 'title', 'subtitle', 'bullets', 'example'],
      },
    },
  },
  required: ['summary', 'edits'],
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

function cleanTarget(value) {
  if (!value || typeof value !== 'object') throw new Error('Select a plan section or slide first.');
  const type = ['plan-section', 'slide', 'deck'].includes(value.type) ? value.type : '';
  if (!type) throw new Error('That part of the lesson cannot be edited yet.');
  const items = Array.isArray(value.items) ? value.items : [value];
  return {
    type,
    items: items.slice(0, 18).map((item, position) => ({
      index: Number.isInteger(Number(item.index)) ? Number(item.index) : position,
      heading: cleanText(item.heading, 180),
      content: cleanText(item.content, 4000),
      title: cleanText(item.title, 240),
      subtitle: cleanText(item.subtitle, 400),
      bullets: (Array.isArray(item.bullets) ? item.bullets : []).slice(0, 8).map(bullet => cleanText(bullet, 500)),
      example: cleanText(item.example, 900),
    })),
  };
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

async function proposeEdit({ instruction, target, context }) {
  const request = cleanText(instruction);
  if (!request) throw new Error('Choose how you want this content improved.');
  const safeTarget = cleanTarget(target);
  const safeContext = cleanContext(context);
  const response = await client().chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `You are LessonScope Agent, an expert curriculum editor working directly on a teacher's lesson.

Return replacement text for the supplied target. Make the requested change, preserve factual accuracy, align with the lesson objectives and grade, and retain the teacher's intended meaning.

RULES:
- plan-section: edit content only; preserve heading exactly.
- slide or deck: keep every supplied index. Improve only editable text fields.
- Keep slide titles concise, use no more than 5 bullets, and keep each bullet short enough for a projected 16:9 slide.
- If content cannot fit comfortably, condense it rather than returning long paragraphs.
- Leave a field as an empty string or empty array only when that field did not exist and should remain absent.
- Do not add citations, unsupported facts, media, student data, markdown, or commentary inside fields.
- The summary must briefly say what changed.`,
      },
      { role: 'system', content: `Lesson context: ${JSON.stringify(safeContext).slice(0, MAX_CONTEXT)}` },
      { role: 'user', content: `Instruction: ${request}\n\nTarget (${safeTarget.type}):\n${JSON.stringify(safeTarget.items)}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'lessonscope_agent_edit', strict: true, schema: EDIT_SCHEMA },
    },
  });
  const parsed = JSON.parse(response.choices[0].message.content);
  const allowed = new Set(safeTarget.items.map(item => item.index));
  return {
    targetType: safeTarget.type,
    summary: cleanAnswer(parsed.summary),
    edits: (parsed.edits || []).filter(edit => allowed.has(edit.index)).map(edit => ({
      index: edit.index,
      heading: cleanText(edit.heading, 180),
      content: cleanAnswer(edit.content).slice(0, 4000),
      title: cleanText(edit.title, 240),
      subtitle: cleanText(edit.subtitle, 400),
      bullets: (edit.bullets || []).map(bullet => cleanText(bullet, 500)).filter(Boolean).slice(0, 6),
      example: cleanText(edit.example, 900),
    })),
  };
}

module.exports = { answer, proposeEdit, cleanContext, cleanTarget };
