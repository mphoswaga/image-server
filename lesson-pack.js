// Lesson-pack generators: from an approved lesson plan (+ objectives, topic,
// grade) produce the student-facing artifacts that surround a lesson. Phase 2a
// ships the worksheet and the exit ticket. Each is one OpenAI structured-output
// call, grade-calibrated the same way content.js calibrates the deck.
const { client: aiClient } = require('./ai-client');
const { ageFor } = require('./grade');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const WORKSHEET_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    focus: { type: 'string' },                       // one line: what the student will practise
    warmup: { type: 'array', items: { type: 'string' } },   // 1-2 quick recall prompts
    example: {
      type: 'object',
      properties: { problem: { type: 'string' }, solution: { type: 'string' } },
      required: ['problem', 'solution'], additionalProperties: false,
    },
    questions: { type: 'array', items: { type: 'string' } }, // graduated practice, easiest first
    challenge: { type: 'string' },                   // one stretch question
    answerKey: { type: 'array', items: { type: 'string' } }, // answers to questions in order, then challenge last
  },
  required: ['title', 'focus', 'warmup', 'example', 'questions', 'challenge', 'answerKey'],
  additionalProperties: false,
};

const EXIT_TICKET_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } }, // 2-3 tied to objectives
    answerKey: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'questions', 'answerKey'],
  additionalProperties: false,
};

function calibration(grade) {
  const age = ageFor(grade);
  return `Pitch everything precisely at ${grade} (students about ${age} years old): vocabulary, reading level, and difficulty must suit ${grade} — assume they mastered the previous grade, and do NOT drift easier or harder.`;
}

function ctxBlock({ subject, topic, grade, objectives, lessonPlanText }) {
  const pretty = String(topic || '').replace(/-/g, ' ');
  const plan = lessonPlanText ? `\nApproved lesson plan (base the artifact on this):\n--- PLAN ---\n${String(lessonPlanText).slice(0, 5000)}\n--- END ---\n` : '';
  return `Subject: ${subject}\nTopic: ${pretty}\nGrade: ${grade}\nLesson objectives the artifact MUST assess/practise:\n${objectives}\n${plan}`;
}

async function callModel(schema, name, prompt, max_tokens = 3500) {
  const client = aiClient();
  const res = await client.chat.completions.create({
    model: MODEL, max_tokens,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error('No content returned from the model');
  return JSON.parse(text);
}

async function generateWorksheet(ctx) {
  if (!process.env.OPENAI_API_KEY) return placeholderWorksheet(ctx);
  const prompt = `You are an expert teacher creating a printable STUDENT WORKSHEET for this lesson.
${ctxBlock(ctx)}
Produce:
- title: a clear worksheet title.
- focus: ONE sentence telling the student what they will practise.
- warmup: 1-2 quick recall prompts to get started.
- example: ONE fully worked example — "problem" plus a clear, step-by-step "solution" the student can follow.
- questions: 6-8 practice questions of GRADUATED difficulty (easiest first, building up), all answerable on paper and tied to the objectives.
- challenge: one harder "stretch" question for fast finishers.
- answerKey: the correct answer to each practice question IN THE SAME ORDER, then the challenge's answer LAST.
${calibration(ctx.grade)}
Plain text only — no markdown symbols.`;
  return callModel(WORKSHEET_SCHEMA, 'worksheet', prompt, 4000);
}

async function generateExitTicket(ctx) {
  if (!process.env.OPENAI_API_KEY) return placeholderExitTicket(ctx);
  const prompt = `Create a short EXIT TICKET (a quick end-of-lesson check students complete in a few minutes) for this lesson.
${ctxBlock(ctx)}
Produce:
- title: a short title.
- questions: 2-3 short questions tied DIRECTLY to the lesson objectives, answerable quickly.
- answerKey: the expected answer to each question, in the same order.
${calibration(ctx.grade)}
Plain text only — no markdown symbols.`;
  return callModel(EXIT_TICKET_SCHEMA, 'exit_ticket', prompt, 1500);
}

function placeholderWorksheet({ topic }) {
  const t = String(topic || 'the topic').replace(/-/g, ' ');
  return {
    title: `${t} — Practice Worksheet`, focus: `Practise ${t}.`,
    warmup: [`What do you already know about ${t}?`],
    example: { problem: `Example problem about ${t}.`, solution: `Worked solution (set OPENAI_API_KEY for real content).` },
    questions: Array.from({ length: 6 }, (_, i) => `Practice question ${i + 1} about ${t}.`),
    challenge: `Challenge question about ${t}.`,
    answerKey: Array.from({ length: 7 }, (_, i) => `Answer ${i + 1}.`),
  };
}
function placeholderExitTicket({ topic }) {
  const t = String(topic || 'the topic').replace(/-/g, ' ');
  return { title: `${t} — Exit Ticket`, questions: [`What is one thing you learned about ${t}?`, `Give an example of ${t}.`], answerKey: ['Student answers vary.', 'Student answers vary.'] };
}

module.exports = { generateWorksheet, generateExitTicket };
