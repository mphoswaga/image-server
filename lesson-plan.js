// Generates a lesson plan that mirrors the teacher's uploaded template format,
// filled in from the pasted objectives. Output is a list of {heading, content}
// sections so it can be rendered, edited, and then drive slide creation.
const { client: aiClient } = require('./ai-client');
const { gradeProfile } = require('./grade');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, content: { type: 'string' } },
        required: ['heading', 'content'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
};

function buildPrompt({ subject, topic, grade, tone, objectives, templateText, unitBlock }) {
  const pretty = topic.replace(/-/g, ' ');
  const depth = gradeProfile(grade).content.depth;
  const unitSection = unitBlock ? `\n${unitBlock}\n` : '';
  const templateBlock = templateText
    ? `The school's LESSON PLAN TEMPLATE is below. Reproduce its section headings and their order EXACTLY as they appear — same names, same sequence (e.g. Starter, Main Activity, Plenary, Exit Card, Resources, etc.). Fill each section with content written specifically for THIS lesson.

--- TEMPLATE START ---
${templateText.slice(0, 6000)}
--- TEMPLATE END ---`
    : `No template was provided. Use a standard, well-structured lesson plan with these sections in order: Lesson Overview, Learning Objectives, Starter / Hook, Main Teaching, Guided Practice / Activity, Plenary / Exit Card, Resources & Differentiation.`;

  return `You are an experienced teacher writing a complete lesson plan.

Subject: ${subject}
Topic: ${pretty}
Grade level: ${grade}
Tone: ${tone}
${unitSection}
Learning objectives provided by the teacher (the plan MUST address these):
${objectives}

${templateBlock}

Rules:
- Output one section per template heading, in the same order, each as {heading, content}.
- "content": write as short bullet points, ONE idea per line, separated by newlines. Plain text ONLY — no markdown symbols (no **, no #, no backticks) and do NOT manually number the lines. Keep each line concise and classroom-ready.
- VOCABULARY: whenever you list key words or vocabulary, give each one a short, clear definition on the same line (e.g. "Cooperate: to work together to get something done") — never list a term without explaining what it means.
- GAMES & ACTIVITIES: whenever the plan includes a game or activity, spell it out so another teacher could run it without guessing — state the goal (how to "win" / what success looks like), the materials needed, and the step-by-step rules of how to play. Never just name an activity.
- ${depth}
- Make the plan fully address the objectives above and be appropriate for ${grade}.`;
}

function placeholderPlan(objectives) {
  return {
    sections: [
      { heading: 'Lesson Overview', content: 'Placeholder overview (no OPENAI_API_KEY set).' },
      { heading: 'Learning Objectives', content: objectives || 'Objectives go here.' },
      { heading: 'Starter', content: 'Placeholder starter activity.' },
      { heading: 'Main Teaching', content: 'Placeholder main teaching.' },
      { heading: 'Activity', content: 'Placeholder activity.' },
      { heading: 'Plenary / Exit Card', content: 'Placeholder plenary.' },
    ],
  };
}

async function generateLessonPlan({ subject, topic, grade = 'middle school', tone = 'clear and engaging', objectives, templateText, unitBlock = '', regenerate = false }) {
  if (!process.env.OPENAI_API_KEY) {
    console.log('No OPENAI_API_KEY set — using placeholder lesson plan.');
    return placeholderPlan(objectives);
  }
  const { wrap } = require('./cache');
  return wrap('lesson-plan', {
    subject: String(subject || '').toLowerCase().trim(),
    topic: String(topic || '').toLowerCase().trim(),
    grade: String(grade || 'middle school').trim(),
    tone: String(tone || 'clear and engaging').trim(),
    objectives: String(objectives || '').trim(),
    templateText: String(templateText || '').slice(0, 6000).trim(),
    unitBlock: String(unitBlock || '').slice(0, 2000).trim(),
    regenerate,
  }, async () => {
    const client = aiClient();
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 6000,
      messages: [{ role: 'user', content: buildPrompt({ subject, topic, grade, tone, objectives, templateText, unitBlock }) }],
      response_format: { type: 'json_schema', json_schema: { name: 'lesson_plan', strict: true, schema: PLAN_SCHEMA } },
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error('No lesson plan returned from the model');
    return JSON.parse(text);
  });
}

// Render an accepted plan to a compact text block to feed into slide generation.
function planToText(plan) {
  return (plan.sections || []).map(s => `## ${s.heading}\n${s.content}`).join('\n\n');
}

module.exports = { generateLessonPlan, planToText };
