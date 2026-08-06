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

function planSchema(model) {
  return {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            content: { type: 'string' },
            stageId: { type: 'string', enum: model.stages.map(stage => stage.id) },
          },
          required: ['heading', 'content', 'stageId'],
          additionalProperties: false,
        },
      },
    },
    required: ['sections'],
    additionalProperties: false,
  };
}

function buildPrompt({ subject, topic, grade, tone, objectives, templateText, unitBlock, sourceMaterialText, teachingModel }) {
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

  return `You are an experienced teacher writing a complete lesson plan.

Subject: ${subject}
Topic: ${pretty}
Grade level: ${grade}
Tone: ${tone}
${modelPromptBlock(model)}
${unitSection}
${sourceBlock}
Learning objectives provided by the teacher (the plan MUST address these):
${objectives}

${templateBlock}

Rules:
  - Output one section per template heading, in the same order, each as {heading, content, stageId}.
  - stageId MUST be one of: ${model.stages.map(stage => stage.id).join(', ')}. Map each school-template heading to the closest teaching-model stage. Do not change the school's heading names or order.
  - If there is no school template, create clear headings that follow the selected model stages in order.
  - "content": write as short bullet points, ONE idea per line, separated by newlines. Plain text ONLY — no markdown symbols (no **, no #, no backticks) and do NOT manually number the lines. Keep each line concise and classroom-ready.
- VOCABULARY: whenever you list key words or vocabulary, give each one a short, clear definition on the same line (e.g. "Cooperate: to work together to get something done") — never list a term without explaining what it means.
- GAMES & ACTIVITIES: whenever the plan includes a game or activity, spell it out so another teacher could run it without guessing — state the goal (how to "win" / what success looks like), the materials needed, and the step-by-step rules of how to play. Never just name an activity.
- ${depth}
  - Make the plan fully address the objectives above and be appropriate for ${grade}.
  - The lesson must visibly feel like ${model.label}; do not merely mention the model in a note. The activities, teacher actions, student actions, checks, and closing must follow its sequence.`;
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

async function generateLessonPlan({ subject, topic, grade = 'middle school', tone = 'clear and engaging', objectives, templateText, unitBlock = '', sourceMaterialText = '', teachingModel = 'standard', regenerate = false }) {
  const teachingModelId = normalizeTeachingModelId(teachingModel);
  const model = getTeachingModel(teachingModelId);
  if (!process.env.OPENAI_API_KEY) {
    console.log('No OPENAI_API_KEY set — using placeholder lesson plan.');
    return { ...placeholderPlan(objectives, teachingModelId), teachingModelId };
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
    regenerate,
  }, async () => {
    const client = aiClient();
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 6000,
      messages: [{ role: 'user', content: buildPrompt({ subject, topic, grade, tone, objectives, templateText, unitBlock, sourceMaterialText, teachingModel: teachingModelId }) }],
      response_format: { type: 'json_schema', json_schema: { name: 'lesson_plan', strict: true, schema: planSchema(model) } },
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error('No lesson plan returned from the model');
    return { ...JSON.parse(text), teachingModelId };
  });
}

// Render an accepted plan to a compact text block to feed into slide generation.
function planToText(plan) {
  return (plan.sections || []).map(s => `## ${s.heading}${s.stageId ? ` [stage: ${s.stageId}]` : ''}\n${s.content}`).join('\n\n');
}

module.exports = { TEMPLATE_PROMPT_LIMIT, generateLessonPlan, planToText };
