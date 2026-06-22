// The "brain" — turns a topic into a structured, grade-appropriate lesson.
//
// generateContent() returns a flat ordered array of slides, each tagged with a
// `type` the assembler renders differently:
//   title | objectives | content | activity | recap
// Content slides carry a concrete `example` and `speakerNotes`. Everything
// downstream (matcher, assembler) reads `imageQuery` + `type`.
//
// If OPENAI_API_KEY is missing, falls back to placeholder text.
const OpenAI = require('openai');
const { gradeProfile, ageFor } = require('./grade');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Full-deck schema (structured outputs → guaranteed valid JSON).
const DECK_SCHEMA = {
  type: 'object',
  properties: {
    titleSlide: {
      type: 'object',
      properties: { title: { type: 'string' }, subtitle: { type: 'string' }, imageQuery: { type: 'string' } },
      required: ['title', 'subtitle', 'imageQuery'],
      additionalProperties: false,
    },
    objectives: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } }, imageQuery: { type: 'string' } },
      required: ['items', 'imageQuery'],
      additionalProperties: false,
    },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          example: { type: 'string' },
          speakerNotes: { type: 'string' },
          imageQuery: { type: 'string' },
          visual: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['steps', 'cycle', 'numberline', 'none'] },
              items: { type: 'array', items: { type: 'string' } },
            },
            required: ['type', 'items'],
            additionalProperties: false,
          },
        },
        required: ['title', 'bullets', 'example', 'speakerNotes', 'imageQuery', 'visual'],
        additionalProperties: false,
      },
    },
    check: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        answer: { type: 'array', items: { type: 'string' } },
        imageQuery: { type: 'string' },
      },
      required: ['question', 'answer', 'imageQuery'],
      additionalProperties: false,
    },
    activity: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        instructions: { type: 'array', items: { type: 'string' } },
        speakerNotes: { type: 'string' },
        imageQuery: { type: 'string' },
      },
      required: ['title', 'instructions', 'speakerNotes', 'imageQuery'],
      additionalProperties: false,
    },
    recap: {
      type: 'object',
      properties: { points: { type: 'array', items: { type: 'string' } }, imageQuery: { type: 'string' } },
      required: ['points', 'imageQuery'],
      additionalProperties: false,
    },
    differentiation: {
      type: 'object',
      properties: { support: { type: 'string' }, stretch: { type: 'string' } },
      required: ['support', 'stretch'],
      additionalProperties: false,
    },
  },
  required: ['titleSlide', 'objectives', 'slides', 'check', 'activity', 'recap', 'differentiation'],
  additionalProperties: false,
};

// Single content slide (for regeneration in the editable preview).
const ONE_SLIDE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    example: { type: 'string' },
    speakerNotes: { type: 'string' },
    imageQuery: { type: 'string' },
  },
  required: ['title', 'bullets', 'example', 'speakerNotes', 'imageQuery'],
  additionalProperties: false,
};

function buildPrompt(subject, topic, grade, slideCount, tone, focus, extras = {}) {
  const pretty = topic.replace(/-/g, ' ');
  const focusLine = focus ? `\nSpecial focus / angle: ${focus}` : '';
  const p = gradeProfile(grade).content;
  const objectivesLine = extras.objectives
    ? `\nThe objectives slide MUST use these teacher-provided objectives:\n${extras.objectives}`
    : '';
  const planBlock = extras.lessonPlanText
    ? `\nIMPORTANT: Base this slide deck on the APPROVED LESSON PLAN below. Turn its flow and steps into slides, in order, so the slides match the plan the teacher accepted:\n--- LESSON PLAN ---\n${String(extras.lessonPlanText).slice(0, 6000)}\n--- END ---\n`
    : '';
  const age = ageFor(grade);
  return `You are an expert teacher creating a complete, classroom-ready lesson deck.

Subject: ${subject}
Topic: ${pretty}
Grade level: ${grade}
Tone: ${tone}${focusLine}${objectivesLine}${planBlock}

CALIBRATE THE DIFFICULTY CAREFULLY: pitch the content precisely at ${grade} (students are about ${age} years old). Use the vocabulary, examples, sentence length and concepts a typical ${grade} student is ready for. Do NOT oversimplify to a younger grade (e.g. Reception / Grade R / Kindergarten), and do NOT use content beyond ${grade}. Assume the student already mastered the previous grade's work and build on it — this lesson should feel right for ${grade}, neither too easy nor too hard.

Produce a full lesson with this structure:
- titleSlide: a punchy lesson title + one-line subtitle.
- objectives: 3-4 short "students will be able to…" learning objectives.
- slides: EXACTLY ${slideCount} content slides (this array MUST have exactly ${slideCount} items — count them). Each has a clear title, ${p.bullets} bullet points (${p.wordsPerBullet}), a concrete real-world "example" (one short sentence a student would relate to), and speaker notes (${p.notes}).
  Each content slide also has a "visual":
    • "steps" — a process/sequence (an algorithm, the writing process, the scientific method, "how to…", a sequence of events): give 3-5 very short stage labels (2-4 words each) in visual.items.
    • "cycle" — a repeating cycle (life cycle, water cycle): 3-5 short stage labels in visual.items.
    • "numberline" — counting, a number range, or measuring on a scale: visual.items = exactly [start, end, step, value-to-mark] as numbers in quotes, e.g. ["0","100","10","40"].
    • "none" — a normal photo illustrates it better: visual.items = [].
  Prefer a diagram whenever it genuinely helps students follow the idea.
- check: ONE quick "check for understanding" question about the lesson, plus an "answer" of 2-3 short lines (the answer first, then a one-line why) — the teacher reveals these after students try. Include an imageQuery.
- activity: a hands-on "Your Turn" task students physically DO. Where it fits the topic, have them ESTIMATE or predict first, then check/measure/try. Give a title, 2-4 clear step instructions, and speaker notes for the teacher.
- recap: 3-4 key takeaways that summarise the lesson.
- differentiation: a "support" tip (1 sentence) to help students who find it difficult (scaffold, simpler version, concrete aid), and a "stretch" challenge (1 sentence) to extend fast finishers — both still on this exact grade's topic.

Rules:
- ${p.depth}
- Every section needs an imageQuery: 2-4 concrete keywords for the ideal photo (e.g. "pizza slices fractions", not "math concept").
- Pitch vocabulary and depth at the ${grade} level. Keep a ${tone} tone throughout.
- Make the content build logically from objectives → ideas → practice → recap.`;
}

// Flatten the structured deck into the ordered slide array the pipeline renders.
function flattenDeck(data) {
  const slides = [];
  slides.push({ type: 'title', layout: 'title', title: data.titleSlide.title, subtitle: data.titleSlide.subtitle, imageQuery: data.titleSlide.imageQuery });
  slides.push({ type: 'objectives', title: 'Learning Objectives', bullets: data.objectives.items, imageQuery: data.objectives.imageQuery });
  data.slides.forEach((s, i) => slides.push({
    type: 'content', title: s.title, bullets: s.bullets, example: s.example,
    speakerNotes: s.speakerNotes, imageQuery: s.imageQuery, visual: s.visual,
    side: i % 2 === 0 ? 'right' : 'left', // alternate image side for visual rhythm
  }));
  if (data.check) slides.push({ type: 'check', title: data.check.question, bullets: data.check.answer, imageQuery: data.check.imageQuery });
  const diff = data.differentiation;
  const actNotes = (data.activity.speakerNotes || '') + (diff ? `\n\nSupport (students who find it hard): ${diff.support}\nChallenge (fast finishers): ${diff.stretch}` : '');
  slides.push({ type: 'activity', title: data.activity.title || 'Your Turn', bullets: data.activity.instructions, speakerNotes: actNotes, imageQuery: data.activity.imageQuery, differentiation: diff });
  slides.push({ type: 'recap', title: 'Recap', bullets: data.recap.points, imageQuery: data.recap.imageQuery });
  return slides;
}

function placeholderDeck(subject, topic, slideCount) {
  const pretty = topic.replace(/-/g, ' ');
  const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const q = `${subject} ${pretty}`;
  return flattenDeck({
    titleSlide: { title: cap(pretty), subtitle: `${cap(subject)} • a lesson deck`, imageQuery: q },
    objectives: { items: [`Understand ${pretty}`, `Apply ${pretty}`, `Practise ${pretty}`], imageQuery: q },
    slides: Array.from({ length: slideCount }, (_, i) => ({
      title: `${cap(pretty)} — Key Idea ${i + 1}`,
      bullets: [`Placeholder point ${i + 1}.1`, `Placeholder point ${i + 1}.2`, `Placeholder point ${i + 1}.3`],
      example: `Example for ${pretty} idea ${i + 1}.`,
      speakerNotes: `Placeholder notes for ${pretty}, idea ${i + 1}.`,
      imageQuery: q,
      visual: { type: 'none', items: [] },
    })),
    check: { question: `What did we learn about ${pretty}?`, answer: ['Placeholder answer.', 'Because… (placeholder reason).'], imageQuery: q },
    activity: { title: 'Your Turn', instructions: [`Estimate first, then try a ${pretty} exercise`, 'Share with a partner'], speakerNotes: 'Placeholder activity notes.', imageQuery: q },
    recap: { points: [`${cap(pretty)} recap point 1`, 'recap point 2', 'recap point 3'], imageQuery: q },
    differentiation: { support: `Give a worked example of ${pretty}.`, stretch: `Try a harder ${pretty} problem.` },
  });
}

async function callModel(schema, name, messages, max_tokens = 9000) {
  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens,
    messages,
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('No content returned from the model');
  return JSON.parse(text);
}

async function generateContent(subject, topic, slideCount, grade = 'middle school', tone = 'clear and engaging', focus = '', extras = {}) {
  if (!process.env.OPENAI_API_KEY) {
    console.log('No OPENAI_API_KEY set — using placeholder text. Add a key to .env for AI-written slides.');
    return placeholderDeck(subject, topic, slideCount);
  }
  const prompt = buildPrompt(subject, topic, grade, slideCount, tone, focus, extras);

  // Structured outputs can't enforce array length; retry until we get the count.
  let best = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const data = await callModel(DECK_SCHEMA, 'lesson_deck', [{ role: 'user', content: prompt }]);
    if (!best || data.slides.length > best.slides.length) best = data;
    if (data.slides.length >= slideCount) break;
    console.log(`Model returned ${data.slides.length}/${slideCount} content slides, retrying (${attempt}/3)…`);
  }
  best.slides = best.slides.slice(0, slideCount);
  return flattenDeck(best);
}

// Regenerate a single content slide (for the editable preview's "regenerate").
async function generateOneSlide({ subject, topic, grade, tone = 'clear and engaging', focus = '', avoidTitles = [] }) {
  if (!process.env.OPENAI_API_KEY) {
    const pretty = topic.replace(/-/g, ' ');
    return { type: 'content', title: `${pretty} — new idea`, bullets: ['Placeholder A', 'Placeholder B'], example: 'Placeholder example.', speakerNotes: 'Placeholder notes.', imageQuery: `${subject} ${pretty}` };
  }
  const p = gradeProfile(grade).content;
  const pretty = topic.replace(/-/g, ' ');
  const avoid = avoidTitles.length ? `\nDo NOT repeat these existing slide titles: ${avoidTitles.join('; ')}.` : '';
  const prompt = `Write ONE fresh content slide for a ${grade} lesson on "${pretty}" (${subject}). ${tone} tone.${focus ? ' Focus: ' + focus + '.' : ''}
Give a clear title, ${p.bullets} bullets (${p.wordsPerBullet}), a concrete real-world example sentence, speaker notes (${p.notes}), and a 2-4 keyword imageQuery. ${p.depth}${avoid}`;
  const s = await callModel(ONE_SLIDE_SCHEMA, 'one_slide', [{ role: 'user', content: prompt }], 1500);
  return { type: 'content', ...s };
}

module.exports = { generateContent, generateOneSlide };
