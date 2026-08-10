// Generates a lesson plan that mirrors the teacher's uploaded template format,
// filled in from the pasted objectives. Output is a list of {heading, content}
// sections so it can be rendered, edited, and then drive slide creation.
const { client: aiClient } = require('./ai-client');
const { gradeProfile } = require('./grade');
const { getTeachingModel, normalizeTeachingModelId, modelPromptBlock } = require('./teaching-models');

// How much of an uploaded template reaches the prompt. Exported so the upload
// endpoint can warn when a template exceeds it instead of silently dropping the end.
const TEMPLATE_PROMPT_LIMIT = 6000;

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function planSchema(model, sequence = null, structuredSequence = false) {
  const lessonCount = Math.min(5, Math.max(2, parseInt(sequence && sequence.lessonCount, 10) || 3));
  const sectionProperties = {
    heading: { type: 'string' },
    content: { type: 'string' },
    stageId: { type: 'string', enum: model.stages.map(stage => stage.id) },
  };
  const sectionRequired = ['heading', 'content', 'stageId'];
  if (structuredSequence) {
    sectionProperties.lesson = { type: 'integer', enum: Array.from({ length: lessonCount }, (_, index) => index + 1) };
    sectionRequired.push('lesson');
  }
  return {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: sectionProperties,
          required: sectionRequired,
          additionalProperties: false,
        },
      },
    },
    required: ['sections'],
    additionalProperties: false,
  };
}

function sequencePromptBlock(sequence, hasTemplate, structuredSequence = false) {
  if (!sequence || !sequence.enabled) return '';
  const lessonCount = Math.min(5, Math.max(2, parseInt(sequence.lessonCount, 10) || 3));
  const periodMinutes = Math.min(180, Math.max(5, parseInt(sequence.periodMinutes, 10) || 35));
  if (structuredSequence) {
    return `\nWEEKLY LESSON SEQUENCE:
Create exactly ${lessonCount} connected lessons for the same week, each lasting exactly ${periodMinutes} minutes.
For EVERY school template heading, return one separate section for EACH lesson. Repeat the heading exactly and set its "lesson" property to the period number (1 through ${lessonCount}).
For example, a template with 8 authored fields must produce ${lessonCount * 8} sections: all 8 fields for lesson 1, all 8 for lesson 2, and so on.
Do not combine several lessons in one section. Do not write "continued" and do not put "Lesson N" markers inside content; the app adds those after validating the complete sequence.
Every lesson must include a timing breakdown totalling ${periodMinutes} minutes, teacher actions, student practice, a check for understanding, and useful resources or homework in the relevant school fields.
The lessons must build on each other and must not repeat the same lesson ${lessonCount} times.
Keep every school heading exactly as supplied, including punctuation and timing notes.\n`;
  }
  return `\nWEEKLY LESSON SEQUENCE:
This is not one isolated lesson. Create exactly ${lessonCount} connected lessons for the same week.
Each lesson is exactly ${periodMinutes} minutes.
Clearly label the content for each period as:
Lesson 1 of ${lessonCount} (${periodMinutes} minutes)
Lesson 2 of ${lessonCount} (${periodMinutes} minutes)
...up to Lesson ${lessonCount} of ${lessonCount} (${periodMinutes} minutes).
Every lesson must include: objective for that period, a minute-by-minute or stage-by-stage timing breakdown that totals ${periodMinutes} minutes, teacher actions, student practice/activity, check for understanding, and resources or homework where useful.
The lessons must build on each other across the week. Do not repeat the same lesson ${lessonCount} times.
${hasTemplate ? 'Keep the school template headings exactly as given, but inside the relevant content fields separate the work into Lesson 1, Lesson 2, and so on with timings.' : 'Use clear headings and subheadings so the teacher can see the separate lessons.'}\n`;
}

function buildPrompt({ subject, topic, grade, tone, objectives, templateText, unitBlock, sourceMaterialText, teachingModel, sequence, structuredSequence = false }) {
  const pretty = topic.replace(/-/g, ' ');
  const depth = gradeProfile(grade).content.depth;
  const model = getTeachingModel(teachingModel);
  const unitSection = unitBlock ? `\n${unitBlock}\n` : '';
  const templateBlock = templateText
    ? `The school's LESSON PLAN TEMPLATE is below. Reproduce its section headings and their order EXACTLY as they appear — same names, same sequence (e.g. Starter, Main Activity, Plenary, Exit Card, Resources, etc.). Fill each section with content written specifically for THIS lesson.

--- TEMPLATE START ---
${templateText.slice(0, TEMPLATE_PROMPT_LIMIT)}
--- TEMPLATE END ---`
    : model.id === 'standard'
      ? 'No template was provided. Use a standard, well-structured lesson plan with these sections in order: Lesson Overview, Learning Objectives, Starter / Hook, Main Teaching, Guided Practice / Activity, Plenary / Exit Card, Resources & Differentiation.'
      : `No template was provided. Use one section for each important stage of the selected teaching model, in this order: ${model.stages.map(stage => stage.label).join(', ')}. Include a short lesson overview and learning objectives where they fit naturally.`;
  const sourceBlock = sourceMaterialText
    ? `\nThe teacher uploaded OPTIONAL SOURCE MATERIALS below (textbook extract, notes, PDF text, spreadsheet data, or similar). Use these to make the lesson accurate to what students are supposed to learn. Prefer this material over generic examples when it is relevant, but do not copy long passages verbatim and do not mention uploaded files to students.\n\n--- SOURCE MATERIALS START ---\n${String(sourceMaterialText).slice(0, 5000)}\n--- SOURCE MATERIALS END ---\n`
    : '';
  const sequenceBlock = sequencePromptBlock(sequence, !!templateText, structuredSequence);
  const outputShapeRule = structuredSequence
    ? 'Output one section per template heading PER LESSON, in lesson order, each as {heading, content, stageId, lesson}. The lesson number must match the period the content belongs to.'
    : 'Output one section per template heading, in the same order, each as {heading, content, stageId}.';
  const templateRule = templateText
    ? (structuredSequence
      ? 'A school template is provided, so it decides the fields outright: for every lesson output every authored template heading exactly once and in template order. Do not add, rename, merge or omit fields.'
      : 'A school template is provided, so it decides the sections outright: output exactly its headings, exactly once each, in its order — no extras, no renames, nothing merged or split, even if the teaching method would suggest a different arrangement.')
    : 'There is no school template, so create clear headings that follow the selected model stages in order.';

  return `You are an experienced teacher writing a complete lesson plan.

Subject: ${subject}
Topic: ${pretty}
Grade level: ${grade}
Tone: ${tone}
${modelPromptBlock(model, { structureFromTemplate: !!templateText })}
${unitSection}
${sourceBlock}
${sequenceBlock}
Learning objectives provided by the teacher (the plan MUST address these):
${objectives}

${templateBlock}

Rules:
  - ${outputShapeRule}
  - stageId MUST be one of: ${model.stages.map(stage => stage.id).join(', ')}. This is only a tag saying which part of the method a section serves — mapping a heading to a stage must NEVER change that heading's name, wording or position.
  - ${templateRule}
  - "content": write as short bullet points, ONE idea per line, separated by newlines. Plain text ONLY — no markdown symbols (no **, no #, no backticks) and do NOT manually number the lines. Keep each line concise and classroom-ready.
- VOCABULARY: whenever you list key words or vocabulary, give each one a short, clear definition on the same line (e.g. "Cooperate: to work together to get something done") — never list a term without explaining what it means.
- GAMES & ACTIVITIES: whenever the plan includes a game or activity, spell it out so another teacher could run it without guessing — state the goal (how to "win" / what success looks like), the materials needed, and the step-by-step rules of how to play. Never just name an activity.
- ${depth}
  - Make the plan fully address the objectives above and be appropriate for ${grade}.
  - ${templateText
    ? `The teaching should feel like ${model.label} in HOW each section is written — the teacher actions, student actions, practice and checks. The section headings and their order come from the school's template ONLY; never add, rename or reorder a section to fit the method.`
    : `The lesson must visibly feel like ${model.label}; do not merely mention the model in a note. The activities, teacher actions, student actions, checks, and closing must follow its sequence.`}`;
}

function placeholderPlan(objectives, teachingModel) {
  const model = getTeachingModel(teachingModel);
  const contents = {
    launch: 'Connect to prior knowledge and introduce the lesson.',
    teach: 'Explain the new idea with a clear example.',
    practice: 'Guide students through practice, then let them try.',
    check: 'Check understanding and address misconceptions.',
    reflect: 'Summarise the learning and complete an exit check.',
  };
  if (model.id === 'standard') {
    return {
      sections: [
        { heading: 'Lesson Overview', stageId: 'launch', content: 'Placeholder overview (no OPENAI_API_KEY set).' },
        { heading: 'Learning Objectives', stageId: 'launch', content: objectives || 'Objectives go here.' },
        { heading: 'Starter', stageId: 'launch', content: 'Placeholder starter activity.' },
        { heading: 'Main Teaching', stageId: 'teach', content: 'Placeholder main teaching.' },
        { heading: 'Activity', stageId: 'practice', content: 'Placeholder activity.' },
        { heading: 'Plenary / Exit Card', stageId: 'reflect', content: 'Placeholder plenary.' },
      ],
    };
  }
  return {
    sections: model.stages.map((stage, index) => ({
      heading: stage.label,
      stageId: stage.id,
      content: index === 0 && objectives ? objectives : (contents[stage.id] || stage.purpose),
    })),
  };
}

async function generateLessonPlan({ subject, topic, grade = 'middle school', tone = 'clear and engaging', objectives, templateText, unitBlock = '', sourceMaterialText = '', teachingModel = 'standard', sequence = null, structuredSequence = false, regenerate = false }) {
  const teachingModelId = normalizeTeachingModelId(teachingModel);
  const model = getTeachingModel(teachingModelId);
  const cleanSequence = sequence && sequence.enabled ? {
    enabled: true,
    lessonCount: Math.min(5, Math.max(2, parseInt(sequence.lessonCount, 10) || 3)),
    periodMinutes: Math.min(180, Math.max(5, parseInt(sequence.periodMinutes, 10) || 35)),
  } : null;
  if (!process.env.OPENAI_API_KEY) {
    console.log('No OPENAI_API_KEY set — using placeholder lesson plan.');
    const placeholder = placeholderPlan(objectives, teachingModelId);
    if (cleanSequence && structuredSequence) {
      placeholder.sections = Array.from({ length: cleanSequence.lessonCount }, (_, lessonIndex) =>
        placeholder.sections.map(section => ({ ...section, lesson: lessonIndex + 1 }))
      ).flat();
    }
    return { ...placeholder, teachingModelId, sequence: cleanSequence };
  }
  const { wrap } = require('./cache');
  return wrap('lesson-plan', {
    subject: String(subject || '').toLowerCase().trim(),
    topic: String(topic || '').toLowerCase().trim(),
    grade: String(grade || 'middle school').trim(),
    tone: String(tone || 'clear and engaging').trim(),
    objectives: String(objectives || '').trim(),
    templateText: String(templateText || '').slice(0, TEMPLATE_PROMPT_LIMIT).trim(),
    unitBlock: String(unitBlock || '').slice(0, 2000).trim(),
    sourceMaterialText: String(sourceMaterialText || '').slice(0, 5000).trim(),
    teachingModelId,
    sequence: cleanSequence,
    structuredSequence: !!(cleanSequence && structuredSequence),
    regenerate,
  }, async () => {
    const client = aiClient();
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: cleanSequence && structuredSequence ? 12000 : 6000,
      messages: [{ role: 'user', content: buildPrompt({ subject, topic, grade, tone, objectives, templateText, unitBlock, sourceMaterialText, teachingModel: teachingModelId, sequence: cleanSequence, structuredSequence: !!(cleanSequence && structuredSequence) }) }],
      response_format: { type: 'json_schema', json_schema: { name: 'lesson_plan', strict: true, schema: planSchema(model, cleanSequence, !!(cleanSequence && structuredSequence)) } },
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error('No lesson plan returned from the model');
    return { ...JSON.parse(text), teachingModelId, sequence: cleanSequence };
  });
}

// Render an accepted plan to a compact text block to feed into slide generation.
function planToText(plan) {
  return (plan.sections || []).map(s => `## ${s.heading}${s.stageId ? ` [stage: ${s.stageId}]` : ''}\n${s.content}`).join('\n\n');
}

module.exports = { TEMPLATE_PROMPT_LIMIT, generateLessonPlan, planToText, planSchema, sequencePromptBlock };
