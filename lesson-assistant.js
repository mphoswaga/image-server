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
    'lessonPurpose', 'assessmentTotalMarks', 'assessmentStructure',
    'assessmentDeliveryMode', 'assessmentBrief', 'assessmentQuestionTypes',
    'assessmentMcqCount', 'assessmentSummary', 'planText', 'slideText',
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
      slideType: cleanText(item.slideType, 40),
      assessmentPhaseType: cleanText(item.assessmentPhaseType, 40),
      fieldKey: cleanText(item.fieldKey, 120),
      protected: item.protected === true || item.protected === 'true',
      heading: cleanText(item.heading, 180),
      content: cleanText(item.content, 4000),
      title: cleanText(item.title, 240),
      subtitle: cleanText(item.subtitle, 400),
      bullets: (Array.isArray(item.bullets) ? item.bullets : []).slice(0, 8).map(bullet => cleanText(bullet, 500)),
      example: cleanText(item.example, 900),
    })),
  };
}

function normalizedLessonPurpose(context) {
  const purpose = cleanText(context && context.lessonPurpose, 20).toLowerCase();
  return purpose === 'project' || purpose === 'test' ? purpose : 'lesson';
}

function targetContainsAssessmentContract(item) {
  return !!item.assessmentPhaseType
    || /assessment|evaluat|marking|assessment\s+(?:flow|phase)/i.test([item.heading, item.fieldKey, item.content].filter(Boolean).join(' '));
}

function isProjectLaunchTarget(item) {
  if (item.slideType === 'title' || item.slideType === 'objectives') return true;
  if (item.slideType === 'content' && item.index <= 2) return true;
  const label = [item.heading, item.fieldKey, item.title].filter(Boolean).join(' ');
  return /\b(?:intro(?:duction)?|starter|hook|launch)\b|\b(?:project|task|assessment)\s+(?:overview|brief)\b/i.test(label);
}

function isProjectActivityTarget(item) {
  if (item.slideType === 'activity') return true;
  const label = [item.heading, item.fieldKey, item.title].filter(Boolean).join(' ');
  return /\b(?:activit(?:y|ies)|main task|project work|work time|independent work|create(?:\s+and\s+revise)?)\b/i.test(label);
}

function containsGenericLessonLaunch(text) {
  return /\b(?:brief(?:ly)?\s+(?:class\s+)?discussion|prior[-\s]+knowledge|introduc(?:e|es|ed|ing)\s+(?:the\s+)?(?:(?:lesson|learning)\s+)?objectives?|shar(?:e|es|ed|ing)[^.!?]{0,80}\b(?:experience|experiences|what\s+(?:students?|learners?|pupils?|they)\s+(?:already\s+)?know)|what\s+[^.!?]{0,60}\bis\s+and\s+why)\b/i.test(text);
}

function describesProjectStudentWork(edit) {
  const action = '(?:create|produce|design|build|draft|investigate|complete|prepare|compose|construct|make|revise|present|submit|write|edit|solve|perform|apply|assemble|program|calculate|draw|record|research|test|evaluate|refine|upload|answer|respond|work|check|save|read|select|choose)';
  return [edit.content, edit.title, edit.subtitle, ...(edit.bullets || []), edit.example]
    .filter(Boolean)
    .some(part => new RegExp(`\\b(?:students?|learners?|pupils?|candidates?)\\b[^.!?]{0,100}\\b${action}\\b|^\\s*(?:goal:\\s*)?${action}\\b`, 'i').test(part));
}

function assertPurposeTargetIsEditable(target, context) {
  const purpose = normalizedLessonPurpose(context);
  if (purpose === 'lesson') return;
  if (purpose === 'test') {
    throw new Error('Test administration and assessment content stays locked to the approved test setup. Edit the setup instead.');
  }
  if (target.items.some(item => item.protected || targetContainsAssessmentContract(item))) {
    throw new Error('Assessment phase content stays linked to the approved project setup. Edit the assessment instead.');
  }
}

function validatePurposeEdits(target, context, edits) {
  const purpose = normalizedLessonPurpose(context);
  if (purpose === 'lesson') return [];
  const issues = [];
  if (purpose === 'test') {
    issues.push('test administration and assessment content cannot be rewritten by the Assistant');
    return issues;
  }
  const targetByIndex = new Map(target.items.map(item => [item.index, item]));
  for (const edit of edits) {
    const original = targetByIndex.get(edit.index) || {};
    if (original.protected || targetContainsAssessmentContract(original)) {
      issues.push(`item ${edit.index + 1} is linked to the approved assessment`);
      continue;
    }
    const text = [edit.heading, edit.content, edit.title, edit.subtitle, ...(edit.bullets || []), edit.example].filter(Boolean).join(' ');
    if (/\bteacher\b[^.!?]{0,100}\b(?:teach(?:es|ing)?|model(?:s|led|ing)?|demonstrat(?:e|es|ed|ing))\b/i.test(text)
      || /\bteacher\b[^.!?]{0,100}\b(?:explain(?:s|ed|ing)?|show(?:s|ed|ing)?)\b[^.!?]{0,80}\b(?:answer|solution|method|procedure|assessed skill|content)\b/i.test(text)) {
      issues.push(`item ${edit.index + 1} turns the project into teacher-led instruction`);
    }
    if (/\b(?:answer key|correct answer|model answer|worked solution|marking (?:guide|guidance|scheme|criteria)|assessment rubric|finished (?:answer|response|product))\b/i.test(text)) {
      issues.push(`item ${edit.index + 1} exposes private assessment guidance or a finished answer`);
    }
    if (/\b(?:ctrl|control|cmd|command)(?:\s*\+\s*|\s*-\s*|\s+)(?:[a-z0-9]|enter|return|tab|space|backspace|delete|escape|esc|arrow(?:up|down|left|right))\b|⌘\s*(?:\+|-)?\s*(?:[a-z0-9]|enter|return|tab|space|backspace|delete|escape|esc|arrow(?:up|down|left|right))\b/i.test(text)) {
      issues.push(`item ${edit.index + 1} exposes an exact keyboard shortcut`);
    }
    if (isProjectLaunchTarget(original) && containsGenericLessonLaunch(text)) {
      issues.push(`item ${edit.index + 1} replaces the project launch with a generic lesson introduction`);
    }
    if (isProjectActivityTarget(original) && !describesProjectStudentWork(edit)) {
      issues.push(`item ${edit.index + 1} no longer describes the work students must complete`);
    }
    if (['content', 'activity', 'check'].includes(original.slideType)
      && !edit.bullets.some(bullet => /\?\s*$/.test(bullet))) {
      issues.push(`item ${edit.index + 1} removes the project progress question`);
    }
    if (target.type === 'plan-section' && /plenary|close|share\s+and\s+reflect|submission/i.test(original.heading || '')) {
      const confirmsSubmission = /\b(?:submit|submits|submitted|submission)\b/i.test(edit.content)
        && /\b(?:teacher|educator)\b/i.test(edit.content)
        && /\b(?:check(?:s|ed|ing)?|confirm(?:s|ed|ing)?|verif(?:y|ies|ied|ying))\b/i.test(edit.content)
        && /\b(?:all|every|each)\s+(?:student|learner)|\beveryone\b/i.test(edit.content);
      if (!confirmsSubmission) issues.push(`item ${edit.index + 1} must keep the teacher's final all-student submission check`);
    }
  }
  return [...new Set(issues)];
}

function purposeEditRule(context) {
  return normalizedLessonPurpose(context) === 'project'
    ? `\nPROJECT SAFETY: Keep students doing the assessed work. The teacher may launch instructions, show public progress stages, supervise and record evidence, but must not teach, model or demonstrate the assessed skill. A project launch must explain the assessed outcome or task brief, phases, conditions and success criteria; do not replace it with a generic discussion, prior-knowledge or experience sharing, or an introduction to lesson objectives. Every activity must say what students produce or do. Keep marking guidance, finished answers/products and exact keyboard shortcuts private. Every project content/activity/check slide must retain a useful progress question. A plenary/closing plan row must say the teacher checks or confirms that every student has submitted.`
    : '';
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
  assertPurposeTargetIsEditable(safeTarget, safeContext);
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
      { role: 'system', content: `Lesson context: ${JSON.stringify(safeContext).slice(0, MAX_CONTEXT)}${purposeEditRule(safeContext)}` },
      { role: 'user', content: `Instruction: ${request}\n\nTarget (${safeTarget.type}):\n${JSON.stringify(safeTarget.items)}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'lessonscope_agent_edit', strict: true, schema: EDIT_SCHEMA },
    },
  });
  const parsed = JSON.parse(response.choices[0].message.content);
  const allowed = new Set(safeTarget.items.map(item => item.index));
  const edits = (parsed.edits || []).filter(edit => allowed.has(edit.index)).map(edit => ({
    index: edit.index,
    heading: cleanText(edit.heading, 180),
    content: cleanAnswer(edit.content).slice(0, 4000),
    title: cleanText(edit.title, 240),
    subtitle: cleanText(edit.subtitle, 400),
    bullets: (edit.bullets || []).map(bullet => cleanText(bullet, 500)).filter(Boolean).slice(0, 6),
    example: cleanText(edit.example, 900),
  }));
  const issues = validatePurposeEdits(safeTarget, safeContext, edits);
  if (issues.length) throw new Error(`The Assistant edit would break the approved project/test flow: ${issues.join('; ')}.`);
  return {
    targetType: safeTarget.type,
    summary: cleanAnswer(parsed.summary),
    edits,
  };
}

module.exports = { answer, proposeEdit, cleanContext, cleanTarget, assertPurposeTargetIsEditable, validatePurposeEdits };
