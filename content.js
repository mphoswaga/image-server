// The "brain" — turns a topic into a structured, grade-appropriate lesson.
//
// generateContent() returns a flat ordered array of slides, each tagged with a
// `type` the assembler renders differently:
//   title | objectives | content | activity | recap
// Content slides carry a concrete `example` and `speakerNotes`. Everything
// downstream (matcher, assembler) reads `imageQuery` + `type`.
//
// If OPENAI_API_KEY is missing, falls back to placeholder text.
const { client: aiClient } = require('./ai-client');
const { gradeProfile, ageFor } = require('./grade');
const { getTeachingModel, normalizeTeachingModelId, modelPromptBlock, stageSchedule, stageLabel } = require('./teaching-models');

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
          stageId: { type: 'string' },
          // Senior grade profile asks for up to 6 bullets — cap matches that, not
          // the lower grades' target (which the prompt still asks for directly).
          bullets: { type: 'array', items: { type: 'string' }, maxItems: 6 },
          // 'TEXT_HEAVY' when the slide's content stands on its own without a
          // supporting photo (e.g. a dense list, vocabulary, or facts where a
          // stock image would just be filler); 'STANDARD' otherwise. Only the
          // 'classic' preset layout currently reacts to this hint.
          layoutHint: { type: 'string', enum: ['STANDARD', 'TEXT_HEAVY'] },
          example: { type: 'string' },
          speakerNotes: { type: 'string' },
          imageQuery: { type: 'string' },
          visual: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['steps', 'cycle', 'numberline', 'diagram', 'none'] },
              items: { type: 'array', items: { type: 'string' } },
            },
            required: ['type', 'items'],
            additionalProperties: false,
          },
          // When the slide introduces vocabulary / key terms, each gets a clear
          // grade-appropriate definition so the teacher can actually explain it.
          // Empty array on non-vocabulary slides.
          vocab: {
            type: 'array',
            items: {
              type: 'object',
              properties: { term: { type: 'string' }, definition: { type: 'string' } },
              required: ['term', 'definition'],
              additionalProperties: false,
            },
          },
          // When the lesson teaches a keyboard shortcut / tool button / specific
          // key combo or menu command, give the EXACT keys so students can DO it
          // (e.g. {action:'Undo', keys:'Ctrl + Z'}). Empty array otherwise.
          shortcuts: {
            type: 'array',
            items: {
              type: 'object',
              properties: { action: { type: 'string' }, keys: { type: 'string' } },
              required: ['action', 'keys'],
              additionalProperties: false,
            },
          },
          // For ANY "how to do / perform X" slide (a method, calculation,
          // technique, rule…): the actual ordered steps with real values, so a
          // student could follow them. {task:'',steps:[]} when not applicable.
          worked: {
            type: 'object',
            properties: { task: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } },
            required: ['task', 'steps'],
            additionalProperties: false,
          },
        },
        required: ['title', 'stageId', 'bullets', 'layoutHint', 'example', 'speakerNotes', 'imageQuery', 'visual', 'vocab', 'shortcuts', 'worked'],
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
        goal: { type: 'string' },                                   // what students are trying to do / how to "win"
        materials: { type: 'array', items: { type: 'string' } },     // what the teacher needs to run it ([] if none)
        instructions: { type: 'array', items: { type: 'string' } },  // the actual rules / how-to-play steps, in order
        speakerNotes: { type: 'string' },
        imageQuery: { type: 'string' },
      },
      required: ['title', 'goal', 'materials', 'instructions', 'speakerNotes', 'imageQuery'],
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
    stageId: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    example: { type: 'string' },
    speakerNotes: { type: 'string' },
    imageQuery: { type: 'string' },
    vocab: {
      type: 'array',
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, definition: { type: 'string' } },
        required: ['term', 'definition'],
        additionalProperties: false,
      },
    },
    shortcuts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { action: { type: 'string' }, keys: { type: 'string' } },
        required: ['action', 'keys'],
        additionalProperties: false,
      },
    },
    worked: {
      type: 'object',
      properties: { task: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } },
      required: ['task', 'steps'],
      additionalProperties: false,
    },
  },
  required: ['title', 'stageId', 'bullets', 'example', 'speakerNotes', 'imageQuery', 'vocab', 'shortcuts', 'worked'],
  additionalProperties: false,
};

function buildPrompt(subject, topic, grade, slideCount, tone, focus, extras = {}) {
  const pretty = topic.replace(/-/g, ' ');
  const focusLine = focus ? `\nSpecial focus / angle: ${focus}` : '';
  const p = gradeProfile(grade).content;
  const teachingModel = getTeachingModel(extras.teachingModelId);
  const schedule = stageSchedule(teachingModel, slideCount);
  const scheduleLine = schedule.map((stageId, index) => `${index + 1}. ${stageLabel(teachingModel, stageId)}`).join('\n');
  const objectivesLine = extras.objectives
    ? `\nThe objectives slide MUST use these teacher-provided objectives:\n${extras.objectives}`
    : '';
  const planBlock = extras.lessonPlanText
    ? `\nIMPORTANT: Base this slide deck on the APPROVED LESSON PLAN below. Turn its flow and steps into slides, in order, so the slides match the plan the teacher accepted:\n--- LESSON PLAN ---\n${String(extras.lessonPlanText).slice(0, 6000)}\n--- END ---\n`
    : '';
  const sourceBlock = extras.sourceMaterialText
    ? `\nThe teacher also uploaded OPTIONAL SOURCE MATERIALS (for example textbook pages, notes, PDFs, spreadsheets, or reference extracts). Use these to make the explanations, vocabulary, examples and scope more accurate. Do not mention "the uploaded material" to students; just teach the content correctly. If the material conflicts with generic knowledge, prefer the teacher's material.\n--- SOURCE MATERIALS ---\n${String(extras.sourceMaterialText).slice(0, 5000)}\n--- END SOURCE MATERIALS ---\n`
    : '';
  const age = ageFor(grade);
  return `You are an expert teacher creating a complete, classroom-ready lesson deck.

Subject: ${subject}
Topic: ${pretty}
Grade level: ${grade}
Tone: ${tone}${focusLine}${objectivesLine}${planBlock}${sourceBlock}
${modelPromptBlock(teachingModel)}

CALIBRATE THE DIFFICULTY CAREFULLY: pitch the content precisely at ${grade} (students are about ${age} years old). Use the vocabulary, examples, sentence length and concepts a typical ${grade} student is ready for. Do NOT oversimplify to a younger grade (e.g. Reception / Grade R / Kindergarten), and do NOT use content beyond ${grade}. Assume the student already mastered the previous grade's work and build on it — this lesson should feel right for ${grade}, neither too easy nor too hard.

Produce a full lesson with this structure:
- titleSlide: a punchy lesson title + one-line subtitle.
- objectives: 3-4 short "students will be able to…" learning objectives.
- slides: EXACTLY ${slideCount} content slides (this array MUST have exactly ${slideCount} items — count them). Each has a clear title, a stageId from the selected model, ${p.bullets} bullet points (${p.wordsPerBullet}), a concrete real-world "example" (one short sentence a student would relate to), and speaker notes (${p.notes}). Use this exact content-slide stage schedule:
${scheduleLine}
The application will enforce this order after generation, so write each slide's content for its scheduled stage.
  VOCABULARY: if a slide introduces vocabulary, key words or terms, you MUST fill "vocab" with each term AND a short, clear definition written so a ${grade} student understands it (one simple sentence, plain words — actually explain what it means, e.g. {"term":"Cooperate","definition":"to work together with others to get something done"}). Never list a word without defining it. On non-vocabulary slides, "vocab" is an empty array []. Use the speaker notes to tell the teacher how to explain each term with an example.
  GAMES & ACTIVITIES: if a content slide presents a game or hands-on activity, do NOT write a vague teaser (e.g. "build a tower / work together"). Its bullets MUST contain the actual instructions: the GOAL (what students try to do / how to "win"), what's NEEDED, and the clear ordered RULES of how to play, so a teacher could run it without inventing anything. Put the same detail in the speaker notes. Do not name a game on one slide and leave its rules unstated.
  SHOW, DON'T JUST DESCRIBE — applies to EVERY subject, especially technical and practical ones. A student must be able to actually DO the task from the slide, not just understand it in the abstract. Never be vague about how to do something:
    • If the slide teaches a METHOD, CALCULATION, PROCEDURE, TECHNIQUE or RULE (solving an equation, a science method/experiment, a grammar rule, drawing/constructing something, a recipe, an algorithm, a process), fill "worked" with a specific "task" and the ACTUAL ordered "steps" to perform it, using real values/actions a student would use — e.g. task "Add 1/4 + 2/4", steps ["The denominators are the same (4)","Add the numerators: 1 + 2 = 3","Keep the denominator: 3/4"]. Show the real working, not "then solve it".
    • If it teaches keyboard shortcuts / tool buttons / key combos, fill "shortcuts" with each action and its EXACT keys, e.g. {"action":"Undo","keys":"Ctrl + Z"}. Use "+" between keys.
    • Put real FORMULAS, notation, code, commands or menu paths directly in the bullets — exact, not described (e.g. "Area = length × width", not "there is a formula for area").
    On slides where these don't apply, "worked" is {"task":"","steps":[]} and "shortcuts" is []. Whenever it would help students perform the task, prefer filling "worked".
  Each content slide also has a "visual":
    • "steps" — a process/sequence (an algorithm, the writing process, the scientific method, "how to…", a sequence of events): give 3-5 very short stage labels (2-4 words each) in visual.items.
    • "cycle" — a repeating cycle (life cycle, water cycle): 3-5 short stage labels in visual.items.
    • "numberline" — counting, a number range, or measuring on a scale: visual.items = exactly [start, end, step, value-to-mark] as numbers in quotes, e.g. ["0","100","10","40"].
    • "diagram" — ONLY for a single CONCRETE structure, object or system whose parts sit in clear physical positions and benefit from a labelled drawing (the water cycle, a cell, the heart, an electric circuit, the layers of the Earth, a flower, a food web, a labelled tool/object…). For abstract topics, overviews, or lists of ideas, do NOT use "diagram" — use "steps" or "none". Set visual.items = [one short description of exactly what to draw AND the key parts to label], e.g. ["the human heart showing the four chambers and the main blood vessels"].
    • "none" — a normal photo illustrates it better: visual.items = [].
  Prefer a diagram whenever it genuinely helps students follow the idea.
  Each content slide also has a "layoutHint": "TEXT_HEAVY" when the slide's bullets are self-explanatory (a dense list, vocabulary, or facts) and a stock photo next to them would add no teaching value; "STANDARD" whenever a supporting photo genuinely helps (most slides). Default to "STANDARD" unless there's a clear reason the image would just be filler.
- check: ONE quick "check for understanding" question about the lesson, plus an "answer" of 2-3 short lines (the answer first, then a one-line why) — the teacher reveals these after students try. Include an imageQuery.
- activity: a hands-on "Your Turn" task students physically DO. It MUST be fully runnable, not vague — give: a title; "goal" (one sentence: what students are trying to achieve or how to "win"); "materials" (a list of what's needed, or [] if nothing); "instructions" (3-6 clear, ordered RULES / steps of exactly how to do or play it, including rough timing where useful, so a teacher could run it as-is); and speaker notes. Where it fits the topic, have students ESTIMATE or predict first, then check/try. If it is a game, the instructions ARE the rules of the game.
- recap: 3-4 key takeaways that summarise the lesson.
- differentiation: a "support" tip (1 sentence) to help students who find it difficult (scaffold, simpler version, concrete aid), and a "stretch" challenge (1 sentence) to extend fast finishers — both still on this exact grade's topic.

Rules:
- ${p.depth}
- Every section needs an imageQuery: 2-4 concrete keywords for the ideal photo (e.g. "pizza slices fractions", not "math concept").
- Pitch vocabulary and depth at the ${grade} level. Keep a ${tone} tone throughout.
- Make the content build logically from objectives → ideas → practice → recap.`;
}

// Safety net only — the schema can't enforce string length (OpenAI's strict
// json_schema mode doesn't support maxLength), so this catches the rare
// runaway bullet after the fact rather than relying on the prompt alone.
// Cuts at the last word boundary; never fires on normal-length output.
function truncateBullet(b, maxChars = 160) {
  const s = String(b == null ? '' : b);
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

// Flatten the structured deck into the ordered slide array the pipeline renders.
function flattenDeck(data, teachingModelId = 'standard') {
  const teachingModel = getTeachingModel(teachingModelId);
  const schedule = stageSchedule(teachingModel, data.slides.length);
  const slides = [];
  slides.push({ type: 'title', layout: 'title', title: data.titleSlide.title, subtitle: data.titleSlide.subtitle, imageQuery: data.titleSlide.imageQuery, modelLabel: teachingModel.label });
  slides.push({ type: 'objectives', title: 'Learning Objectives', bullets: data.objectives.items, imageQuery: data.objectives.imageQuery, modelLabel: teachingModel.label });
  data.slides.forEach((s, i) => {
    const vocab = Array.isArray(s.vocab) ? s.vocab.filter(v => v && v.term) : [];
    // On a vocabulary slide, the term–definition lines ARE the teaching content,
    // so they become the bullets (rendered by the existing layout). The example
    // and speaker notes still carry extra explanation for the teacher.
    const bullets = (vocab.length ? vocab.map(v => `${v.term} — ${v.definition}`) : s.bullets).map(b => truncateBullet(b));
    const shortcuts = Array.isArray(s.shortcuts) ? s.shortcuts.filter(x => x && x.action && x.keys) : [];
    const worked = (s.worked && s.worked.task && Array.isArray(s.worked.steps) && s.worked.steps.length) ? s.worked : null;
    slides.push({
      type: 'content', title: s.title, bullets, example: s.example,
      speakerNotes: s.speakerNotes, imageQuery: s.imageQuery, visual: s.visual, vocab, shortcuts, worked,
      modelLabel: teachingModel.label,
      modelStage: schedule[i] || teachingModel.stages[0].id,
      modelStageLabel: stageLabel(teachingModel, schedule[i] || teachingModel.stages[0].id),
      side: i % 2 === 0 ? 'right' : 'left', // alternate image side for visual rhythm
      // Missing/unrecognised value (placeholder deck, older cached slide) falls
      // back to 'STANDARD' — today's behaviour, unchanged.
      layoutHint: s.layoutHint === 'TEXT_HEAVY' ? 'TEXT_HEAVY' : 'STANDARD',
    });
  });
  if (data.check) slides.push({ type: 'check', title: data.check.question, bullets: data.check.answer, imageQuery: data.check.imageQuery, modelLabel: teachingModel.label });
  const diff = data.differentiation;
  const act = data.activity;
  // Build a fully runnable task: goal + what's needed + the actual rules/steps.
  const actBullets = [];
  if (act.goal) actBullets.push(`Goal: ${act.goal}`);
  if (Array.isArray(act.materials) && act.materials.length) actBullets.push(`You'll need: ${act.materials.join(', ')}`);
  actBullets.push(...(act.instructions || []));
  const matLine = (Array.isArray(act.materials) && act.materials.length) ? `\nMaterials: ${act.materials.join(', ')}` : '';
  const actNotes = (act.goal ? `Goal: ${act.goal}${matLine}\n\n` : '') + (act.speakerNotes || '')
    + (diff ? `\n\nSupport (students who find it hard): ${diff.support}\nChallenge (fast finishers): ${diff.stretch}` : '');
  const activityStage = teachingModel.stages.find(stage => /practice|create|elaborate|investigate|independent|you_do/.test(stage.id)) || teachingModel.stages[teachingModel.stages.length - 1];
  const reflectStage = teachingModel.stages.find(stage => /reflect|evaluate|check|share/.test(stage.id)) || teachingModel.stages[teachingModel.stages.length - 1];
  slides.push({ type: 'activity', title: act.title || 'Your Turn', bullets: actBullets, speakerNotes: actNotes, imageQuery: act.imageQuery, differentiation: diff, modelStage: activityStage.id, modelStageLabel: stageLabel(teachingModel, activityStage.id), modelLabel: teachingModel.label });
  slides.push({ type: 'recap', title: 'Recap', bullets: data.recap.points, imageQuery: data.recap.imageQuery, modelStage: reflectStage.id, modelStageLabel: stageLabel(teachingModel, reflectStage.id), modelLabel: teachingModel.label });
  return slides;
}

function placeholderDeck(subject, topic, slideCount, teachingModelId = 'standard') {
  const pretty = topic.replace(/-/g, ' ');
  const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const q = `${subject} ${pretty}`;
  return flattenDeck({
    titleSlide: { title: cap(pretty), subtitle: `${cap(subject)} • a lesson deck`, imageQuery: q },
    objectives: { items: [`Understand ${pretty}`, `Apply ${pretty}`, `Practise ${pretty}`], imageQuery: q },
    slides: Array.from({ length: slideCount }, (_, i) => ({
      title: `${cap(pretty)} — Key Idea ${i + 1}`,
      stageId: 'teach',
      bullets: [`Placeholder point ${i + 1}.1`, `Placeholder point ${i + 1}.2`, `Placeholder point ${i + 1}.3`],
      example: `Example for ${pretty} idea ${i + 1}.`,
      speakerNotes: `Placeholder notes for ${pretty}, idea ${i + 1}.`,
      imageQuery: q,
      visual: { type: 'none', items: [] },
      vocab: [], shortcuts: [], worked: { task: '', steps: [] },
    })),
    check: { question: `What did we learn about ${pretty}?`, answer: ['Placeholder answer.', 'Because… (placeholder reason).'], imageQuery: q },
    activity: { title: 'Your Turn', goal: `Practise ${pretty} together`, materials: [], instructions: [`Estimate first, then try a ${pretty} exercise`, 'Share with a partner'], speakerNotes: 'Placeholder activity notes.', imageQuery: q },
    recap: { points: [`${cap(pretty)} recap point 1`, 'recap point 2', 'recap point 3'], imageQuery: q },
    differentiation: { support: `Give a worked example of ${pretty}.`, stretch: `Try a harder ${pretty} problem.` },
  }, teachingModelId);
}

async function callModel(schema, name, messages, max_tokens = 9000) {
  const client = aiClient();
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
  const teachingModelId = normalizeTeachingModelId(extras.teachingModelId);
  if (!process.env.OPENAI_API_KEY) {
    console.log('No OPENAI_API_KEY set — using placeholder text. Add a key to .env for AI-written slides.');
    return placeholderDeck(subject, topic, slideCount, teachingModelId);
  }
  const { wrap } = require('./cache');
  return wrap('content', {
    subject: String(subject).toLowerCase().trim(),
    topic: String(topic).toLowerCase().trim(),
    slideCount: Number(slideCount),
    grade: String(grade || 'middle school').trim(),
    tone: String(tone || 'clear and engaging').trim(),
    focus: String(focus || '').trim(),
    lessonPlanText: String((extras && extras.lessonPlanText) || '').trim(),
    sourceMaterialText: String((extras && extras.sourceMaterialText) || '').trim(),
    teachingModelId,
    regenerate: !!(extras && extras.regenerate),
  }, async () => {
    const prompt = buildPrompt(subject, topic, grade, slideCount, tone, focus, extras);
    // Structured outputs can't enforce array length; retry until we get the count.
    let best = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const data = await callModel(DECK_SCHEMA, 'lesson_deck', [{ role: 'user', content: prompt }], 12000);
      if (!best || data.slides.length > best.slides.length) best = data;
      if (data.slides.length >= slideCount) break;
      console.log(`Model returned ${data.slides.length}/${slideCount} content slides, retrying (${attempt}/3)…`);
    }
    best.slides = best.slides.slice(0, slideCount);
    return flattenDeck(best, teachingModelId);
  });
}

// Regenerate a single content slide (for the editable preview's "regenerate").
async function generateOneSlide({ subject, topic, grade, tone = 'clear and engaging', focus = '', teachingModelId = 'standard', preferredStage = '', avoidTitles = [] }) {
  const teachingModel = getTeachingModel(teachingModelId);
  if (!process.env.OPENAI_API_KEY) {
    const pretty = topic.replace(/-/g, ' ');
    return { type: 'content', modelStage: preferredStage || teachingModel.stages[0].id, title: `${pretty} — new idea`, bullets: ['Placeholder A', 'Placeholder B'], example: 'Placeholder example.', speakerNotes: 'Placeholder notes.', imageQuery: `${subject} ${pretty}` };
  }
  const p = gradeProfile(grade).content;
  const pretty = topic.replace(/-/g, ' ');
  const avoid = avoidTitles.length ? `\nDo NOT repeat these existing slide titles: ${avoidTitles.join('; ')}.` : '';
  const prompt = `Write ONE fresh content slide for a ${grade} lesson on "${pretty}" (${subject}). ${tone} tone.${focus ? ' Focus: ' + focus + '.' : ''}
${modelPromptBlock(teachingModel)}
The slide must use stageId "${preferredStage || teachingModel.stages[0].id}" so it fits the existing lesson sequence.
Give a clear title, ${p.bullets} bullets (${p.wordsPerBullet}), a concrete real-world example sentence, speaker notes (${p.notes}), and a 2-4 keyword imageQuery. If the slide introduces vocabulary/key terms, fill "vocab" with each term and a short clear definition a ${grade} student understands; otherwise "vocab" is []. If it teaches keyboard shortcuts / tool buttons / key combos, fill "shortcuts" with each action and its EXACT keys (e.g. {"action":"Undo","keys":"Ctrl + Z"}); otherwise "shortcuts" is []. If it teaches how to DO/perform a method, calculation or technique, fill "worked" with a task + the actual ordered steps (real values); otherwise "worked" is {"task":"","steps":[]}. ${p.depth}${avoid}`;
  const s = await callModel(ONE_SLIDE_SCHEMA, 'one_slide', [{ role: 'user', content: prompt }], 1800);
  const vocab = Array.isArray(s.vocab) ? s.vocab.filter(v => v && v.term) : [];
  if (vocab.length) s.bullets = vocab.map(v => `${v.term} — ${v.definition}`);
  const shortcuts = Array.isArray(s.shortcuts) ? s.shortcuts.filter(x => x && x.action && x.keys) : [];
  const worked = (s.worked && s.worked.task && Array.isArray(s.worked.steps) && s.worked.steps.length) ? s.worked : null;
  return { type: 'content', modelStage: s.stageId || preferredStage || teachingModel.stages[0].id, ...s, vocab, shortcuts, worked };
}

module.exports = { generateContent, generateOneSlide };
