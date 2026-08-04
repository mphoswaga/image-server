// Lesson-pack generators: from an approved lesson plan (+ objectives, topic,
// grade) produce the student-facing artifacts that surround a lesson. Phase 2a
// ships the worksheet and the exit ticket. Each is one OpenAI structured-output
// call, grade-calibrated the same way content.js calibrates the deck.
const { client: aiClient } = require('./ai-client');
const { ageFor } = require('./grade');
const { getTeachingModel, modelPromptBlock, artifactPromptBlock } = require('./teaching-models');

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

function ctxBlock({ subject, topic, grade, objectives, lessonPlanText, unitBlock, teachingModelId }) {
  const pretty = String(topic || '').replace(/-/g, ' ');
  const model = getTeachingModel(teachingModelId);
  const plan = lessonPlanText ? `\nApproved lesson plan (base the artifact on this):\n--- PLAN ---\n${String(lessonPlanText).slice(0, 5000)}\n--- END ---\n` : '';
  const unit = unitBlock ? `\n${String(unitBlock).slice(0, 1500)}\n` : '';
  return `Subject: ${subject}\nTopic: ${pretty}\nGrade: ${grade}\n${modelPromptBlock(model)}\nLesson objectives the artifact MUST assess/practise:\n${objectives}\n${unit}${plan}`;
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

function ctxKey(type, ctx) {
  return {
    type,
    subject: String(ctx.subject || '').toLowerCase().trim(),
    topic: String(ctx.topic || '').toLowerCase().trim(),
    grade: String(ctx.grade || 'middle school').trim(),
    objectives: String(ctx.objectives || '').trim(),
    lessonPlanText: String(ctx.lessonPlanText || '').slice(0, 5000).trim(),
    teachingModelId: String(ctx.teachingModelId || 'standard'),
    regenerate: !!ctx.regenerate,
  };
}

async function generateWorksheet(ctx) {
  if (!process.env.OPENAI_API_KEY) return placeholderWorksheet(ctx);
  const { wrap } = require('./cache');
  return wrap('worksheet', ctxKey('worksheet', ctx), async () => {
    const prompt = `You are an expert teacher creating a printable STUDENT WORKSHEET for this lesson.
${ctxBlock(ctx)}
${artifactPromptBlock(ctx.teachingModelId, 'worksheet')}
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
  });
}

async function generateExitTicket(ctx) {
  if (!process.env.OPENAI_API_KEY) return placeholderExitTicket(ctx);
  const { wrap } = require('./cache');
  return wrap('exit-ticket', ctxKey('exit-ticket', ctx), async () => {
    const prompt = `Create a short EXIT TICKET (a quick end-of-lesson check students complete in a few minutes) for this lesson.
${ctxBlock(ctx)}
${artifactPromptBlock(ctx.teachingModelId, 'exit ticket')}
Produce:
- title: a short title.
- questions: 2-3 short questions tied DIRECTLY to the lesson objectives, answerable quickly.
- answerKey: the expected answer to each question, in the same order.
${calibration(ctx.grade)}
Plain text only — no markdown symbols.`;
    return callModel(EXIT_TICKET_SCHEMA, 'exit_ticket', prompt, 1500);
  });
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

// ── Quiz: printable assessment (MCQ + short-answer, with marks) ────────────

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    instructions: { type: 'string' },
    mcq: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } }, // exactly 4
          correctIndex: { type: 'integer' },                     // 0-3
        },
        required: ['question', 'options', 'correctIndex'],
        additionalProperties: false,
      },
    },
    shortAnswer: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          marks: { type: 'integer' },
          answer: { type: 'string' },
        },
        required: ['question', 'marks', 'answer'],
        additionalProperties: false,
      },
    },
    totalMarks: { type: 'integer' },
  },
  required: ['title', 'instructions', 'mcq', 'shortAnswer', 'totalMarks'],
  additionalProperties: false,
};

async function generateQuiz(ctx) {
  if (!process.env.OPENAI_API_KEY) return placeholderQuiz(ctx);
  const { wrap } = require('./cache');
  return wrap('quiz', ctxKey('quiz', ctx), async () => {
    const prompt = `Create a printable QUIZ for this lesson — a mix of multiple-choice and short-answer questions the teacher can hand out and mark.
${ctxBlock(ctx)}
${artifactPromptBlock(ctx.teachingModelId, 'quiz')}
Produce:
- title: a clear quiz title.
- instructions: one sentence of instructions for the student (e.g. "Circle the correct letter for MCQ. Write your working for short-answer questions.").
- mcq: 5 multiple-choice questions tied to the lesson objectives. Each has "question", "options" (EXACTLY 4 choices), and "correctIndex" (0-based index of the correct one). Make wrong options plausible.
- shortAnswer: 3 short-answer questions that require working or reasoning, each with "marks" (1-4) and "answer" (teacher's expected response).
- totalMarks: sum of all marks (mcq = 1 each; short-answer as specified).
${calibration(ctx.grade)}
Plain text only — no markdown.`;
    return callModel(QUIZ_SCHEMA, 'quiz', prompt, 3000);
  });
}

function placeholderQuiz({ topic }) {
  const t = String(topic || 'the topic').replace(/-/g, ' ');
  return {
    title: `${t} — Quiz`,
    instructions: 'Circle the correct letter for MCQ. Show your working for short-answer questions.',
    mcq: Array.from({ length: 5 }, (_, i) => ({ question: `MCQ question ${i + 1} about ${t}.`, options: ['Option A', 'Option B', 'Option C', 'Option D'], correctIndex: 0 })),
    shortAnswer: [
      { question: `Explain one key concept about ${t}.`, marks: 2, answer: 'Student answers vary.' },
      { question: `Give an example of ${t}.`, marks: 2, answer: 'Student answers vary.' },
      { question: `How would you apply ${t} in real life?`, marks: 3, answer: 'Student answers vary.' },
    ],
    totalMarks: 12,
  };
}

// ── Student game: lesson summary + multiple-choice questions ────────────────
const GAME_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },                       // 2-3 sentence recap
    concepts: {
      type: 'array',
      items: { type: 'object', properties: { term: { type: 'string' }, explanation: { type: 'string' } }, required: ['term', 'explanation'], additionalProperties: false },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },  // exactly 4
          correctIndex: { type: 'integer' },                      // 0-3
          explanation: { type: 'string' },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'], additionalProperties: false,
      },
    },
  },
  required: ['overview', 'concepts', 'questions'], additionalProperties: false,
};

// Keep questions sane: exactly 4 options, correctIndex in range.
function normalizeGame(g) {
  g.questions = (g.questions || []).filter(q => q && q.question && Array.isArray(q.options)).map(q => {
    let opts = q.options.slice(0, 4);
    while (opts.length < 4) opts.push('—');
    let ci = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
    if (ci < 0 || ci > 3) ci = 0;
    return { question: q.question, options: opts, correctIndex: ci, explanation: q.explanation || '' };
  });
  g.concepts = (g.concepts || []).filter(c => c && c.term);
  return g;
}

async function generateGame(ctx) {
  if (!process.env.OPENAI_API_KEY) return placeholderGame(ctx);
  const { wrap } = require('./cache');
  const n = Math.min(20, Math.max(4, parseInt(ctx.questionCount, 10) || 6));
  return wrap('game', ctxKey('game', { ...ctx, questionCount: n }), async () => {
    const prompt = `Create a short REVISION GAME for students based on this lesson.
${ctxBlock(ctx)}
${artifactPromptBlock(ctx.teachingModelId, 'revision game')}
Produce:
- overview: 2-3 sentences recapping what the lesson was about.
- concepts: the 3-5 KEY ideas of the lesson, each with a short, clear explanation a student understands (so they can revise before playing).
- questions: exactly ${n} multiple-choice questions that check the lesson objectives. Each has: "question"; "options" = EXACTLY 4 answer choices; "correctIndex" = the 0-based index (0,1,2,3) of the correct option; and "explanation" = one sentence on why it is correct. Mix easier and harder questions, and make the wrong options plausible (not silly).
${calibration(ctx.grade)}
Plain text only — no markdown.`;
    return normalizeGame(await callModel(GAME_SCHEMA, 'lesson_game', prompt, Math.max(3500, n * 300)));
  });
}

function placeholderGame({ topic, questionCount }) {
  const t = String(topic || 'the topic').replace(/-/g, ' ');
  const n = Math.min(20, Math.max(4, parseInt(questionCount, 10) || 6));
  return normalizeGame({
    overview: `This lesson was about ${t}.`,
    concepts: [{ term: t, explanation: `Key ideas about ${t} (set OPENAI_API_KEY for real content).` }],
    questions: Array.from({ length: n }, (_, i) => ({ question: `Question ${i + 1} about ${t}?`, options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: 'Placeholder.' })),
  });
}

module.exports = { generateWorksheet, generateExitTicket, generateQuiz, generateGame };
