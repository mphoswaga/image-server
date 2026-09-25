const lessonDesign = require('./lesson-design');
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
const { normalizeLessonPurpose, normalizeAssessmentOptions } = require('./assessment-draft');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Keep every accepted plan row available to deck generation. A single prefix
// cut used to remove late Assessment and Plenary rows from longer templates.
// Give each structured row a fair bounded share while preserving row order.
function compactPlanForDeck(value, maxChars = 12000) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const sections = text.split(/(?=^##\s+)/m).map(section => section.trim()).filter(Boolean);
  if (sections.length < 2) return text.slice(0, maxChars);
  const budget = Math.max(320, Math.floor((maxChars - (sections.length - 1) * 2) / sections.length));
  return sections.map(section => section.length <= budget ? section : `${section.slice(0, budget - 1).trimEnd()}…`).join('\n\n').slice(0, maxChars);
}

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
  const lessonPurpose = normalizeLessonPurpose(extras.lessonPurpose);
  const assessmentOptions = normalizeAssessmentOptions(extras);
  const assessmentManifest = assessmentPhaseManifest(extras);
  const schedule = stageSchedule(teachingModel, slideCount);
  const scheduleLine = schedule.map((stageId, index) => `${index + 1}. ${stageLabel(teachingModel, stageId)}`).join('\n');
  const objectivesLine = extras.objectives
    ? `\nThe objectives slide MUST use these teacher-provided objectives:\n${extras.objectives}`
    : '';
  const planBlock = extras.lessonPlanText
    ? `\nIMPORTANT: Base this slide deck on the APPROVED LESSON PLAN below. Turn its flow and steps into slides, in order, so the slides match the plan the teacher accepted:\n--- LESSON PLAN ---\n${compactPlanForDeck(extras.lessonPlanText)}\n${lessonDesign.prompt(extras.lessonSettings, extras.sequenceLessonNumber || 1, true)}\n--- END ---\n`
    : '';
  const sourceBlock = extras.sourceMaterialText
    ? `\nThe teacher also uploaded OPTIONAL SOURCE MATERIALS (for example textbook pages, notes, PDFs, spreadsheets, or reference extracts). Use these to make the explanations, vocabulary, examples and scope more accurate. Do not mention "the uploaded material" to students; just teach the content correctly. If the material conflicts with generic knowledge, prefer the teacher's material.\n--- SOURCE MATERIALS ---\n${String(extras.sourceMaterialText).slice(0, 5000)}\n--- END SOURCE MATERIALS ---\n`
    : '';
  const seq = extras.lessonSequence && extras.lessonSequence.enabled ? {
    lessonCount: Math.min(5, Math.max(2, parseInt(extras.lessonSequence.lessonCount, 10) || 3)),
    periodMinutes: Math.min(180, Math.max(5, parseInt(extras.lessonSequence.periodMinutes, 10) || 35)),
  } : null;
  const sequenceBlock = seq
    ? `\nThis deck supports a weekly lesson sequence: ${seq.lessonCount} connected lessons, ${seq.periodMinutes} minutes each. The approved lesson plan contains the period-by-period details. Make the slides follow those lessons in order, clearly signalling transitions such as "Lesson 1", "Lesson 2", and so on where helpful. Do not flatten the week into one repeated lesson.\n`
    : '';
  const age = ageFor(grade);
  const phaseSummary = phaseSummaryText(assessmentManifest);
  const purposeBlock = lessonPurpose === 'lesson' ? '' : lessonPurpose === 'project'
    ? `\nTHIS IS A PROJECT INTRODUCTION AND PROGRESS DECK, NOT A NORMAL TEACHING DECK.
The teacher briefly launches the project and then displays one context-specific stage at a time while students work. Content slides must state the current project stage, what students should produce or do, and one or two useful progress questions. Scale independence and complexity to ${grade}.
The planned assessment phases are: ${phaseSummary}. Include a safe transition slide for every phase, including the LessonScope multiple-choice phase when selected, but never display its questions or answers.
Do not reveal a rubric, mark allocation, model final product, answer key, or finished response. Do not display exact keyboard shortcuts such as Ctrl+C or Ctrl+V; use phrases such as "copy using the mouse" or "copy using the keyboard" when that action is assessed. The teacher circulates, observes and grades while students work.\n`
    : `\nTHIS IS A TEST INTRODUCTION AND ADMINISTRATION DECK, NOT A NORMAL TEACHING DECK.
The planned assessment phases are: ${phaseSummary}. Show only a safe introduction or transition for each phase.
The deck is safe to leave visible in the room. It may show the test title, purpose, timing, permitted materials, conduct, submission instructions and neutral progress stages. It must NEVER contain live test questions, answer options, answers, hints, worked examples, formulas supplied as help, marking criteria, rubrics, exact assessed procedures, or keyboard shortcuts. The teacher introduces procedures before the test and then supervises silently while students work independently.\n`;
  const finalAssessmentRules = lessonPurpose === 'lesson' ? '' : lessonPurpose === 'project'
    ? `\nFINAL PROJECT-DECK CHECK — THESE RULES OVERRIDE THE GENERIC LESSON STRUCTURE ABOVE:
- This is student work time. Do not create Review, Explain, Model, Mini-Lesson, Worked Example or Guided Practice slides, and do not tell the teacher to demonstrate an assessed skill.
- Begin with the project purpose and conditions. Then include one clearly titled transition slide for EACH selected phase, in this exact order: ${phaseSummary}.
- A LessonScope multiple-choice transition must name LessonScope, state the exact item count and marks shown in the phase list above, and tell students to submit or wait. Never show those questions, options or answers on the shared deck.
- Practical or product slides must use the approved plan's real context and show one manageable stage at a time. Include one or two short progress questions, but no model answer, finished product, rubric, marks or private marking guidance.
- Never show exact keyboard combinations such as Ctrl+C, Ctrl+V, Command+C or their equivalents. Say "copy using the mouse", "copy using the keyboard", "paste using the mouse" or "paste using the keyboard" where relevant.
- The teacher may introduce the project, control each phase, supervise, confirm submissions and record marks. The remaining work belongs to the students.\n`
    : `\nFINAL TEST-DECK CHECK — THESE RULES OVERRIDE THE GENERIC LESSON STRUCTURE ABOVE:
- Every visible slide is for test administration only. Do not teach, explain, review, model, demonstrate or practise assessed content.
- Include one clearly titled transition slide for EACH selected phase, in this exact order: ${phaseSummary}.
- A LessonScope multiple-choice transition must name LessonScope, state the exact item count and marks shown in the phase list above, and tell students to submit or wait.
- Do not include a content question, answer option, answer, hint, worked example, formula, vocabulary definition, rubric, marking criterion, exact assessed procedure or keyboard combination anywhere in the shared deck.
- The activity object required by the JSON schema must contain only neutral test-administration steps such as checking the student's name, opening the correct section, saving, submitting and waiting quietly.\n`;
  return `You are an expert teacher creating a complete, classroom-ready lesson deck.

Subject: ${subject}
Topic: ${pretty}
Grade level: ${grade}
Tone: ${tone}${focusLine}${objectivesLine}${planBlock}${sourceBlock}${sequenceBlock}
${modelPromptBlock(teachingModel)}
${purposeBlock}

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
- check: ${lessonPurpose === 'test' ? 'use a neutral readiness reminder such as checking name, materials and submission steps; do not include a content question or answer' : lessonPurpose === 'project' ? 'use a project progress question that helps students reflect without giving an answer or revealing marking guidance' : 'ONE quick "check for understanding" question about the lesson, plus an "answer" of 2-3 short lines (the answer first, then a one-line why) — the teacher reveals these after students try'}. Include an imageQuery.
- activity: a hands-on "Your Turn" task students physically DO. It MUST be fully runnable, not vague — give: a title; "goal" (one sentence: what students are trying to achieve or how to "win"); "materials" (a list of what's needed, or [] if nothing); "instructions" (3-6 clear, ordered RULES / steps of exactly how to do or play it, including rough timing where useful, so a teacher could run it as-is); and speaker notes. Where it fits the topic, have students ESTIMATE or predict first, then check/try. If it is a game, the instructions ARE the rules of the game.
- recap: 3-4 key takeaways that summarise the lesson.
- differentiation: a "support" tip (1 sentence) to help students who find it difficult (scaffold, simpler version, concrete aid), and a "stretch" challenge (1 sentence) to extend fast finishers — both still on this exact grade's topic.

Rules:
- ${p.depth}
- Every section needs an imageQuery: 2-4 concrete keywords for the ideal photo (e.g. "pizza slices fractions", not "math concept").
- Pitch vocabulary and depth at the ${grade} level. Keep a ${tone} tone throughout.
- Make the content build logically from objectives → ideas → practice → recap.
${finalAssessmentRules}`;
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

const ASSESSMENT_TYPE_LABELS = {
  mcq: 'LessonScope questions',
  'short-answer': 'Short-answer section',
  'extended-response': 'Extended-response section',
  practical: 'Practical task',
};

const ASSESSMENT_TYPES = new Set(Object.keys(ASSESSMENT_TYPE_LABELS));

// The editable assessment is the source of truth once it exists. Keep only
// public phase metadata here: section order, item count and marks. Questions,
// answers and rubrics must never be copied into a shared classroom deck.
function assessmentPhaseManifest(input = {}) {
  const options = normalizeAssessmentOptions(input);
  const draft = input && input.assessmentDraft;
  const sections = Array.isArray(draft && draft.sections) ? draft.sections : [];
  const fromDraft = sections.map((section, index) => {
    const type = String(section && section.type || '').trim().toLowerCase();
    if (!ASSESSMENT_TYPES.has(type)) return null;
    const items = Array.isArray(section.items) ? section.items : [];
    const marks = items.reduce((sum, item) => sum + Math.max(0, Number(item && item.marks) || 0), 0);
    return {
      type,
      title: String(section.title || ASSESSMENT_TYPE_LABELS[type]).trim().slice(0, 120),
      itemCount: items.length,
      marks,
      index,
    };
  }).filter(Boolean);
  if (fromDraft.length) return fromDraft;

  const configured = options.phaseRequirements.length
    ? options.phaseRequirements
    : options.questionTypes.map(type => ({ type, marks: null, title: '' }));
  const otherPhases = configured.filter(phase => phase.type !== 'mcq');
  const mcqPhases = configured.filter(phase => phase.type === 'mcq');
  let remainingMcqItems = options.mcqCount;
  return configured.map((phase, index) => {
    const type = phase.type;
    const remainingMcqPhases = mcqPhases.filter(candidate => configured.indexOf(candidate) >= index).length;
    const itemCount = type === 'mcq'
      ? (Number.isInteger(phase.marks) && otherPhases.length
        ? phase.marks
        : Math.max(1, Math.ceil(remainingMcqItems / Math.max(1, remainingMcqPhases))))
      : null;
    if (type === 'mcq') remainingMcqItems = Math.max(0, remainingMcqItems - itemCount);
    return {
      type,
      title: phase.title || ASSESSMENT_TYPE_LABELS[type],
      itemCount,
      marks: Number.isInteger(phase.marks) ? phase.marks
        : configured.length === 1 ? options.totalMarks
          : type === 'mcq' ? itemCount
            : mcqPhases.length === 1 && otherPhases.length === 1 ? options.totalMarks - options.mcqCount : null,
      index,
    };
  });
}

function phaseSummaryText(manifest) {
  const names = {
    mcq: 'multiple-choice knowledge check',
    'short-answer': 'short-answer work',
    'extended-response': 'extended response',
    practical: 'practical or product task',
  };
  return manifest.map((phase, index) => {
    const count = phase.itemCount ? String(phase.itemCount) + '-item ' : '';
    const marks = phase.marks ? ' (' + phase.marks + ' marks)' : '';
    return String(index + 1) + ') ' + count + (names[phase.type] || 'assessment section') + marks;
  }).join('; ');
}

function slideText(slide) {
  return [slide && slide.title, ...(Array.isArray(slide && slide.bullets) ? slide.bullets : []), slide && slide.example,
    slide && slide.speakerNotes, slide && slide.worked && slide.worked.task,
    ...(Array.isArray(slide && slide.worked && slide.worked.steps) ? slide.worked.steps : [])]
    .filter(Boolean).join(' ');
}

function normalizedPrivateText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function assessmentPrivateStrings(input = {}) {
  const draft = input && input.assessmentDraft;
  const sections = Array.isArray(draft && draft.sections) ? draft.sections : [];
  const privateLabel = value => /\?|\b(?:answer|hint|solution|question|rubric|criterion|marking|award\s+\d*\s*marks?)\b/i.test(String(value || ''));
  const values = sections.flatMap(section => [
    ...(privateLabel(section && section.title) ? [section.title] : []),
    ...(privateLabel(section && section.instructions) ? [section.instructions] : []),
    ...(Array.isArray(section && section.items) ? section.items : []).flatMap(item => [
      item && (item.prompt || item.question),
      item && item.answerKey,
      ...(Array.isArray(item && item.options) ? item.options : []),
    ]),
  ]);
  if (privateLabel(draft && draft.instructions)) values.push(draft.instructions);
  return [...new Set(values.map(normalizedPrivateText).filter(Boolean))];
}

function containsPrivateAssessmentText(value, privateStrings) {
  const text = normalizedPrivateText(value);
  if (!text) return false;
  return privateStrings.some(secret => secret.length < 4 ? text === secret : text.includes(secret));
}

function deckDisplayStrings(data) {
  return [
    data && data.titleSlide && data.titleSlide.title,
    data && data.titleSlide && data.titleSlide.subtitle,
    ...(Array.isArray(data && data.objectives && data.objectives.items) ? data.objectives.items : []),
    ...(Array.isArray(data && data.slides) ? data.slides.flatMap(slide => [slideText(slide), slide && slide.imageQuery]) : []),
    data && data.check && data.check.question,
    ...(Array.isArray(data && data.check && data.check.answer) ? data.check.answer : []),
    data && data.activity && data.activity.title,
    data && data.activity && data.activity.goal,
    ...(Array.isArray(data && data.activity && data.activity.materials) ? data.activity.materials : []),
    ...(Array.isArray(data && data.activity && data.activity.instructions) ? data.activity.instructions : []),
    data && data.activity && data.activity.speakerNotes,
    ...(Array.isArray(data && data.recap && data.recap.points) ? data.recap.points : []),
    data && data.differentiation && data.differentiation.support,
    data && data.differentiation && data.differentiation.stretch,
  ].filter(Boolean);
}

function privateSafeReplacement(privateStrings, candidates) {
  return candidates.find(candidate => !containsPrivateAssessmentText(candidate, privateStrings)) || '';
}

// Even a rejected model response can influence deterministic repair through an
// approved plan. Scrub every student-visible string against the private item
// bank before flattening so questions, options, keys and practical criteria
// cannot reach a shared classroom screen. Phase names/counts/marks remain.
function redactPrivateAssessmentContent(data, assessmentOptions, purpose) {
  const privateStrings = assessmentPrivateStrings(assessmentOptions);
  if (!privateStrings.length) return data;
  const safe = (value, candidates = ['Continue independently.', 'Follow the displayed phase directions.', 'Wait for your teacher.']) => (
    containsPrivateAssessmentText(value, privateStrings)
      ? privateSafeReplacement(privateStrings, candidates)
      : value
  );
  const list = (values, candidates) => (Array.isArray(values) ? values : []).map(value => safe(value, candidates)).filter(Boolean);
  const safeTitle = purpose === 'test' ? ['Assessment instructions', 'Current assessment phase'] : ['Current project stage', 'Project instructions'];
  const safeBullet = purpose === 'test'
    ? ['Continue working independently.', 'Follow the displayed assessment directions.', 'Wait quietly for your teacher.']
    : ['Continue with your own work.', 'Follow the displayed project direction.', 'Check this stage before moving on.'];
  const repaired = {
    ...data,
    titleSlide: data.titleSlide ? {
      ...data.titleSlide,
      title: safe(data.titleSlide.title, safeTitle),
      subtitle: safe(data.titleSlide.subtitle, safeTitle),
      imageQuery: safe(data.titleSlide.imageQuery, ['students working independently']),
    } : data.titleSlide,
    objectives: data.objectives ? {
      ...data.objectives,
      items: list(data.objectives.items, safeBullet),
      imageQuery: safe(data.objectives.imageQuery, ['students working independently']),
    } : data.objectives,
    slides: (Array.isArray(data.slides) ? data.slides : []).map(slide => ({
      ...slide,
      title: safe(slide.title, safeTitle),
      bullets: list(slide.bullets, safeBullet),
      example: safe(slide.example, ['']),
      speakerNotes: safe(slide.speakerNotes, ['Supervise this phase without giving answers.', 'Display the current phase directions.']),
      imageQuery: safe(slide.imageQuery, ['students working independently']),
      vocab: [], shortcuts: [], worked: { task: '', steps: [] },
    })),
    check: data.check ? {
      ...data.check,
      question: safe(data.check.question, safeBullet),
      answer: list(data.check.answer, safeBullet),
      imageQuery: safe(data.check.imageQuery, ['student progress check']),
    } : data.check,
    activity: data.activity ? {
      ...data.activity,
      title: safe(data.activity.title, safeTitle),
      goal: safe(data.activity.goal, safeBullet),
      materials: list(data.activity.materials, safeBullet),
      instructions: list(data.activity.instructions, safeBullet),
      speakerNotes: safe(data.activity.speakerNotes, ['Supervise student work without giving answers.']),
      imageQuery: safe(data.activity.imageQuery, ['students working independently']),
    } : data.activity,
    recap: data.recap ? {
      ...data.recap,
      points: list(data.recap.points, safeBullet),
      imageQuery: safe(data.recap.imageQuery, ['student submission']),
    } : data.recap,
    differentiation: data.differentiation ? {
      ...data.differentiation,
      support: safe(data.differentiation.support, safeBullet),
      stretch: safe(data.differentiation.stretch, safeBullet),
    } : data.differentiation,
  };
  return repaired;
}

const SHORTCUT_KEY = '(?:[a-z0-9]|f\\d{1,2}|enter|return|backspace|delete|tab|escape|esc|home|end|left|right|up|down)';
const SHORTCUT_MODIFIER = '(?:(?:shift|alt|option)(?:\\s*\\+\\s*|\\s*-\\s*|\\s+))*';
const NAMED_SHORTCUT_SOURCE = `\\b(?:ctrl|control|cmd|command)(?:\\s*\\+\\s*|\\s*-\\s*|\\s+)${SHORTCUT_MODIFIER}(${SHORTCUT_KEY})\\b`;
const SYMBOL_SHORTCUT_SOURCE = `⌘\\s*(?:\\+\\s*|-\\s*)?${SHORTCUT_MODIFIER}(${SHORTCUT_KEY})\\b`;

function shortcutReplacement(key) {
  return ({ c: 'copy', v: 'paste', x: 'cut', s: 'save', z: 'undo', y: 'redo' })[String(key || '').toLowerCase()]
    ? `${({ c: 'copy', v: 'paste', x: 'cut', s: 'save', z: 'undo', y: 'redo' })[String(key || '').toLowerCase()]} using the keyboard`
    : 'the keyboard command';
}

function hasShortcutKeys(value) {
  const text = String(value || '');
  return new RegExp(NAMED_SHORTCUT_SOURCE, 'i').test(text) || new RegExp(SYMBOL_SHORTCUT_SOURCE, 'i').test(text);
}

function replacesShortcutKeys(value) {
  return String(value || '')
    .replace(new RegExp(NAMED_SHORTCUT_SOURCE, 'gi'), (_match, key) => shortcutReplacement(key))
    .replace(new RegExp(SYMBOL_SHORTCUT_SOURCE, 'gi'), (_match, key) => shortcutReplacement(key));
}

const PROJECT_ACTION = /\b(?:open|write|type|draft|create|plan|prepare|edit|revise|check|fix|correct|copy|paste|insert|add|format|save|submit|upload|share|complete|choose|find|record|build|design|make|organise|organize|proofread)\b/i;
const PRIVATE_ASSESSMENT_LANGUAGE = /\b(?:multiple[- ]choice|lesson\s*scope|answer\s*key|correct\s*answer|model\s*answer|rubric|marking\s*(?:guide|criteria)|success\s*criteria|marks?\b)/i;

// Pull concrete student actions out of the approved plan for the deterministic
// project fallback. This is deliberately conservative: assessment questions,
// marking guidance and teacher actions stay out, while practical context such
// as "write a letter", "fix the spelling" and "make five copies" survives.
function projectPlanSteps(lessonPlanText, topic = '') {
  const planOnly = String(lessonPlanText || '').split(/--- OPTIONAL TEACHER SOURCE MATERIALS ---/i)[0];
  const cleaned = replacesShortcutKeys(planOnly)
    .replace(/\r/g, '\n')
    .replace(/[•●▪◦]/g, '\n')
    .replace(/\s+\(\s*\d+\s*marks?\s*\)/gi, '')
    .replace(/\s+—\s+\d+\s*marks?\b/gi, '');
  const parts = [];
  for (const rawLine of cleaned.split(/\n+/)) {
    let line = rawLine.replace(/^\s*[-*]+\s*/, '').trim();
    if (!line || /^#{1,6}\s+/.test(line) || /^---/.test(line)) continue;
    line = line.replace(/^(?:phase|step)\s*\d+\s*[-—:]\s*/i, '');
    const sentences = line.split(/(?<=[.!?])\s+|;\s+|,\s+(?=(?:and\s+)?(?:students?|learners?|each\s+student|they|open|write|type|draft|create|plan|prepare|edit|revise|check|fix|correct|copy|paste|insert|add|format|save|submit|upload|share|complete|choose|find|record|build|design|make|organise|organize|proofread)\b)/i);
    for (const sentence of sentences) {
      const clauses = sentence.split(/\s+(?:and\s+then|then)\s+(?=(?:open|write|type|draft|create|edit|revise|check|fix|correct|copy|paste|insert|add|format|save|submit|upload|complete|proofread)\b)/i);
      for (let clause of clauses) {
        clause = clause.trim()
          .replace(/^(?:phase|step)\s*\d+\s*[-—:]\s*/i, '')
          .replace(/^(?:students?|learners?|each\s+student|they)\s+(?:will\s+|must\s+|should\s+|can\s+)?/i, '')
          .replace(/^the\s+student\s+(?:will\s+|must\s+|should\s+)?/i, '')
          .replace(/\b(?:his\s+or\s+her|their)\b/gi, 'your')
          .replace(/\s*\(\s*\d+\s*marks?\s*\)\s*/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!clause || /\bteacher\b/i.test(clause) || PRIVATE_ASSESSMENT_LANGUAGE.test(clause) || !PROJECT_ACTION.test(clause)) continue;
        clause = clause.replace(/[,:;]+$/, '').trim();
        if (!clause) continue;
        clause = clause.charAt(0).toUpperCase() + clause.slice(1);
        if (!/[.!?]$/.test(clause)) clause += '.';
        parts.push(clause.length > 180 ? truncateBullet(clause, 180) : clause);
      }
    }
  }
  const seen = new Set();
  const unique = parts.filter(part => {
    const key = part.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length) return unique.slice(0, 12);
  const safeTopic = String(topic || 'project').replace(/-/g, ' ').trim() || 'project';
  return [`Prepare your own ${safeTopic} work.`, `Create the required ${safeTopic} product.`, 'Check that every required part is complete.', 'Save and submit your work.'];
}

function sanitizeProjectSlide(slide) {
  const clean = value => replacesShortcutKeys(value).replace(/\s{2,}/g, ' ').trim();
  const bullets = (Array.isArray(slide.bullets) ? slide.bullets : []).map(clean).filter(Boolean);
  if (!bullets.some(bullet => /\?\s*$/.test(bullet))) {
    if (bullets.length >= 4) bullets[bullets.length - 1] = 'Have you completed and checked this stage?';
    else bullets.push('Have you completed and checked this stage?');
  }
  return {
    ...slide,
    title: clean(slide.title),
    bullets,
    example: '',
    speakerNotes: clean(slide.speakerNotes),
    shortcuts: [],
    worked: { task: '', steps: [] },
    vocab: [],
  };
}

function modelProjectSlideIsUsable(slide) {
  const title = String(slide && slide.title || '').trim();
  const text = slideText(slide);
  if (/\bplaceholder\b|\bkey idea\s*\d*\b/i.test(text)) return false;
  if (/^(?:review|explain|model|mini[- ]lesson|worked example|guided practice)\b/i.test(title)) return false;
  if (/\b(?:teacher|educator)\s*(?::|—|-)?\s*(?:will\s+)?(?:teach|explain|model|demonstrate|show\s+(?:the\s+)?(?:method|procedure|answer|solution))\b/i.test(text)) return false;
  if (/\b(?:answer key|model answer|marking (?:guide|criteria)|assessment rubric|finished (?:answer|response|product))\b/i.test(text)) return false;
  return true;
}

function slideCoversAssessmentType(slide, type) {
  const text = slideText(slide);
  if (type === 'mcq') return /lesson\s*scope/i.test(text) && /multiple[- ]choice|questions?/i.test(text);
  if (type === 'short-answer') return /short[- ]answer/i.test(text);
  if (type === 'extended-response') return /extended[- ]response|long[- ]answer|essay/i.test(text);
  return /practical|performance task|product task|teacher observation/i.test(text);
}

function assessmentPhaseSlide(phaseRecord, index, purpose, topic) {
  const type = phaseRecord.type;
  const phase = index + 1;
  const project = purpose === 'project';
  // A teacher may title a written section with a live question or answer.
  // Shared headings therefore use neutral labels for every knowledge/written
  // phase. A project's practical title can still name the useful work context;
  // scrub any shortcut answer before displaying it.
  const neutralLabel = ASSESSMENT_TYPE_LABELS[type] || 'Assessment section';
  const label = project && type === 'practical'
    ? replacesShortcutKeys(phaseRecord.title || neutralLabel)
    : neutralLabel;
  const phaseMarks = Math.max(0, Number(phaseRecord.marks) || 0);
  const itemCount = Math.max(0, Number(phaseRecord.itemCount) || 0);
  const marksText = phaseMarks ? ` This phase is worth ${phaseMarks} marks.` : '';
  let bullets;
  if (type === 'mcq') {
    bullets = [
      'Open the assessment in LessonScope when your teacher starts this phase.',
      `Answer all ${itemCount || 'the'} multiple-choice questions independently.${marksText}`,
      project ? 'Have you answered every question before you submit?' : 'Check that every question has an answer, then submit.',
      'Wait for your teacher before moving to the next phase.',
    ];
  } else if (type === 'short-answer') {
    bullets = [
      `Open the short-answer section when your teacher starts this phase.${marksText}`,
      'Write your own response to every question.',
      project ? 'Have you checked that each response is complete?' : 'Review your responses without discussing them.',
      'Save your work and wait for your teacher.',
    ];
  } else if (type === 'extended-response') {
    bullets = [
      `Open the extended-response section when your teacher starts this phase.${marksText}`,
      'Plan and write your own complete response.',
      project ? 'Does your response address every part of the task?' : 'Check your work quietly before submitting.',
      'Save your work and wait for your teacher.',
    ];
  } else {
    bullets = project ? [
      `Begin the practical stage of your ${String(topic || 'project').replace(/-/g, ' ')} project.${marksText}`,
      'Follow the current stage shown by your teacher and create your own work.',
      'What stage are you working on now?',
      'Save your work and wait when this stage is complete.',
    ] : [
      `Begin the practical section when your teacher starts this phase.${marksText}`,
      'Complete the task independently using only the permitted materials.',
      'Save your work as instructed.',
      'Stop and wait quietly when you finish.',
    ];
  }
  return {
    title: `Phase ${phase}: ${label}`,
    stageId: `assessment-${phase}-${type}`,
    assessmentProtected: true,
    assessmentPhaseType: type,
    assessmentPhaseIndex: index,
    bullets,
    layoutHint: 'TEXT_HEAVY',
    example: '',
    speakerNotes: project
      ? `Introduce phase ${phase}, start it in LessonScope, supervise student work and confirm completion before moving on.`
      : `Start phase ${phase}, supervise silently and move on only after the section is complete.`,
    imageQuery: `${String(topic || 'assessment').replace(/-/g, ' ')} students working`,
    visual: { type: 'steps', items: ['Open', 'Complete', 'Submit', 'Wait'] },
    vocab: [], shortcuts: [], worked: { task: '', steps: [] },
  };
}

function fallbackProjectSlide(index, topic, lessonPlanText = '', totalStages = 1) {
  const subject = String(topic || 'project').replace(/-/g, ' ');
  const steps = projectPlanSteps(lessonPlanText, topic);
  const count = Math.max(1, Number(totalStages) || 1);
  const start = Math.floor((index * steps.length) / count);
  const end = Math.max(start + 1, Math.floor(((index + 1) * steps.length) / count));
  const selected = steps.slice(start, Math.min(steps.length, end));
  const fallbackStages = [
    [`Prepare the ${subject} project`, [`Read or listen to the project brief for ${subject}.`, 'Identify what you must create or complete.']],
    ['Plan your work', ['Decide what you will do first.', 'Prepare the materials or files you need.']],
    ['Create your own work', ['Complete the current project stage independently.', 'Use the instructions shown for this stage.']],
    ['Check and improve', ['Read or inspect your work carefully.', 'Fix anything that is incomplete.']],
    ['Submit your project', ['Save your final work in the correct place.', 'Submit it when your teacher asks.']],
  ];
  const fallback = fallbackStages[Math.min(index, fallbackStages.length - 1)];
  const taskBullets = selected.length ? selected : fallback[1];
  const titleSeed = taskBullets[0].replace(/[.!?]+$/, '').trim();
  const shortTitle = titleSeed.split(/\s+/).slice(0, 9).join(' ');
  const title = selected.length ? `Stage ${index + 1}: ${shortTitle}` : fallback[0];
  const question = index >= count - 1 ? 'Have you completed, saved and submitted this stage?' : 'What must be complete before you move on?';
  const bullets = [...taskBullets, question];
  if (!bullets.some(bullet => /\bsave\b/i.test(bullet))) bullets.push('Save your work before moving on.');
  return {
    title, stageId: `project-stage-${index + 1}`, bullets, layoutHint: 'TEXT_HEAVY', example: '',
    speakerNotes: 'Display this stage while students work. Circulate, observe and record evidence without completing the task for them.',
    imageQuery: `${subject} student project`, visual: { type: 'steps', items: ['Read', 'Work', 'Check', 'Save'] },
    vocab: [], shortcuts: [], worked: { task: '', steps: [] },
  };
}

function testAdministrationSlide(kind, topic, index = 0) {
  const subject = String(topic || 'test').replace(/-/g, ' ');
  const resolvedKind = typeof kind === 'string' ? kind : (Number(kind) === 0 ? 'before' : 'conditions');
  const conditions = [
    ['Test conditions', ['Work independently and quietly.', 'Use only the materials your teacher permits.', 'Raise your hand only for procedural help.', 'Wait for your teacher to open each section.']],
    ['While you work', ['Read each instruction carefully.', 'Keep your work private.', 'Use your time carefully.', 'Wait quietly when a section is complete.']],
    ['Timing and progress', ['Begin only when your teacher gives the signal.', 'Work independently for the stated time.', 'Follow only procedural directions.', 'Stop when your teacher asks.']],
  ];
  const [title, bullets] = resolvedKind === 'before'
    ? ['Before the test', ['Put your name on your work.', 'Prepare only the materials your teacher permits.', 'Listen to the instructions.', 'Wait for the signal to begin.']]
    : resolvedKind === 'submit'
      ? ['Check and submit', ['Check that every required section is complete.', 'Save your work in the correct place.', 'Submit when your teacher asks.', 'Wait quietly after submitting.']]
      : conditions[index % conditions.length];
  return {
    title, stageId: `test-${resolvedKind}-${index + 1}`, assessmentProtected: true, bullets, layoutHint: 'TEXT_HEAVY', example: '',
    speakerNotes: 'Display neutral administration instructions only. Do not explain assessed content or give hints.',
    imageQuery: `${subject} classroom assessment`, visual: { type: 'steps', items: ['Prepare', 'Complete', 'Submit', 'Wait'] },
    vocab: [], shortcuts: [], worked: { task: '', steps: [] },
  };
}

function assessmentDeckIssues(data, lessonPurpose, assessmentOptions) {
  const purpose = normalizeLessonPurpose(lessonPurpose);
  if (purpose === 'lesson') return [];
  const manifest = assessmentPhaseManifest(assessmentOptions);
  const slides = Array.isArray(data && data.slides) ? data.slides : [];
  const issues = [];
  const privateStrings = assessmentPrivateStrings(assessmentOptions);
  if (privateStrings.length && deckDisplayStrings(data).some(value => containsPrivateAssessmentText(value, privateStrings))) {
    issues.push('private assessment content was exposed');
  }
  let previousIndex = -1;
  for (const [phaseIndex, phase] of manifest.entries()) {
    const foundAt = slides.findIndex((slide, index) => index > previousIndex && slideCoversAssessmentType(slide, phase.type));
    if (foundAt < 0) issues.push(`phase ${phaseIndex + 1} (${phase.type}) is missing or out of order`);
    else previousIndex = foundAt;
  }
  if (purpose === 'project') {
    if (slides.some(slide => !modelProjectSlideIsUsable(slide))) issues.push('teacher-led lesson slides were returned for a project');
    if (slides.some(slide => hasShortcutKeys(slideText(slide)))) issues.push('exact keyboard shortcuts were exposed');
  }
  if (purpose === 'test') {
    const unsafe = slides.some(slide => {
      const text = slideText(slide);
      return /\?|\b(?:correct answer|answer is|solution|worked example|rubric|marking criteria|demonstrate|guided practice|teach|explain how)\b/i.test(text)
        || (Array.isArray(slide.vocab) && slide.vocab.length) || (Array.isArray(slide.shortcuts) && slide.shortcuts.length)
        || !!(slide.worked && slide.worked.task) || !!String(slide.example || '').trim();
    });
    if (unsafe) issues.push('test content or teaching guidance was exposed');
  }
  return issues;
}

function ensureAssessmentDeckCoverage(data, lessonPurpose, assessmentOptions, topic) {
  const purpose = normalizeLessonPurpose(lessonPurpose);
  if (purpose === 'lesson') return data;
  const manifest = assessmentPhaseManifest(assessmentOptions);
  const source = Array.isArray(data && data.slides) ? data.slides : [];
  const target = Math.max(source.length, manifest.length);
  // Phase slides are deterministic. This prevents a model from silently
  // changing the teacher's section order/count/marks or leaking assessed
  // content into the shared deck.
  const phaseSlides = manifest.map((phase, index) => assessmentPhaseSlide(phase, index, purpose, topic));
  let remaining;
  let testClosing = [];
  if (purpose === 'test') {
    const administrationCount = Math.max(2, target - phaseSlides.length);
    remaining = Array.from({ length: administrationCount - 1 }, (_, index) => (
      testAdministrationSlide(index === 0 ? 'before' : 'conditions', topic, Math.max(0, index - 1))
    ));
    testClosing = [testAdministrationSlide('submit', topic)];
  } else {
    const fallbackCount = Math.max(0, target - phaseSlides.length);
    remaining = source
      .filter(modelProjectSlideIsUsable)
      .map((slide, index) => {
        const safe = sanitizeProjectSlide(slide);
        safe.stageId = /^project[-_]/i.test(safe.stageId || '') ? safe.stageId : `project-stage-${index + 1}`;
        return safe;
      })
      .slice(0, fallbackCount);
    while (remaining.length < fallbackCount) {
      remaining.push(fallbackProjectSlide(remaining.length, topic, assessmentOptions && assessmentOptions.lessonPlanText, fallbackCount));
    }
  }
  let orderedSlides;
  if (purpose === 'project') {
    const practicalIndex = manifest.findIndex(phase => phase.type === 'practical');
    const nonMcqIndex = manifest.findIndex(phase => phase.type !== 'mcq');
    const anchorIndex = practicalIndex >= 0 ? practicalIndex : nonMcqIndex;
    // If marks cover MCQs only, the project launch/context comes before the
    // private MCQ phase. It must not look like an extra assessed phase.
    orderedSlides = anchorIndex >= 0
      ? [...phaseSlides.slice(0, anchorIndex + 1), ...remaining, ...phaseSlides.slice(anchorIndex + 1)]
      : [...remaining, ...phaseSlides];
  } else {
    orderedSlides = [...remaining, ...phaseSlides, ...testClosing];
  }
  const safeTopic = String(topic || 'Assessment').replace(/-/g, ' ').trim();
  const displayTopic = safeTopic.replace(/\b[a-z]/g, letter => letter.toUpperCase());
  const title = purpose === 'test' ? `${displayTopic} Test` : `${displayTopic} Project`;
  const repaired = {
    ...data,
    titleSlide: {
      ...(data.titleSlide || {}),
      title,
      subtitle: purpose === 'test' ? 'Test instructions and sections' : 'Project instructions and stages',
    },
    objectives: {
      ...(data.objectives || {}),
      items: purpose === 'test'
        ? ['Follow the test instructions and conditions.', 'Complete every section independently.', 'Save, submit and wait for your teacher.']
        : [`Complete your own ${safeTopic} project.`, 'Follow each project stage and check your progress.', 'Save and submit every required part.'],
    },
    // Project context sits with the practical phase, or the first written
    // phase when there is no practical. For an MCQ-only project it appears
    // before that private phase, without inventing another assessed section.
    slides: orderedSlides,
    check: purpose === 'project' ? {
      question: 'What have you completed, and what is your next project step?',
      answer: [], imageQuery: `${safeTopic} student checklist`,
    } : data.check,
    activity: purpose === 'project' ? {
      title: 'Project work', goal: `Complete your own ${safeTopic} project`, materials: [],
      instructions: ['Follow the project stage shown by your teacher.', 'Complete the work yourself.', 'Save your progress before the next stage.', 'Submit only when your teacher asks.'],
      speakerNotes: 'Display one stage at a time. Circulate, observe and record evidence without completing assessed work for students.',
      imageQuery: `${safeTopic} student project`,
    } : data.activity,
    recap: purpose === 'project' ? {
      points: ['Check every required project stage.', 'Save and submit your work.', 'Wait for your teacher to confirm your submission.'],
      imageQuery: `${safeTopic} project submission`,
    } : data.recap,
    differentiation: purpose === 'project' ? {
      support: 'Repeat or simplify the public stage direction without showing an answer.',
      stretch: 'Use the remaining time to check every required part carefully.',
    } : data.differentiation,
  };
  return redactPrivateAssessmentContent(repaired, assessmentOptions, purpose);
}

// Flatten the structured deck into the ordered slide array the pipeline renders.
function flattenDeck(data, teachingModelId = 'standard', lessonPurpose = 'lesson') {
  const teachingModel = getTeachingModel(teachingModelId);
  const purpose = normalizeLessonPurpose(lessonPurpose);
  const schedule = stageSchedule(teachingModel, data.slides.length);
  const deckLabel = purpose === 'project' ? 'Project session' : purpose === 'test' ? 'Test session' : teachingModel.label;
  const slides = [];
  const projectFlowSlides = [];
  slides.push({ type: 'title', layout: 'title', title: data.titleSlide.title, subtitle: data.titleSlide.subtitle, imageQuery: data.titleSlide.imageQuery, modelLabel: deckLabel, assessmentProtected: purpose === 'test' });
  slides.push({ type: 'objectives', title: purpose === 'test' ? 'Test information' : purpose === 'project' ? 'Project goals' : 'Learning Objectives', bullets: data.objectives.items, imageQuery: data.objectives.imageQuery, modelLabel: deckLabel, assessmentProtected: purpose === 'test' });
  data.slides.forEach((s, i) => {
    const vocab = purpose === 'lesson' ? (Array.isArray(s.vocab) ? s.vocab.filter(v => v && v.term) : []) : [];
    // On a vocabulary slide, the term–definition lines ARE the teaching content,
    // so they become the bullets (rendered by the existing layout). The example
    // and speaker notes still carry extra explanation for the teacher.
    const bullets = (vocab.length ? vocab.map(v => `${v.term} — ${v.definition}`) : s.bullets).map(b => truncateBullet(b));
    const shortcuts = purpose === 'lesson' && Array.isArray(s.shortcuts) ? s.shortcuts.filter(x => x && x.action && x.keys) : [];
    const worked = purpose === 'lesson' && s.worked && s.worked.task && Array.isArray(s.worked.steps) && s.worked.steps.length ? s.worked : null;
    const modelStage = purpose === 'lesson' ? (schedule[i] || teachingModel.stages[0].id) : (s.stageId || `${purpose}_stage_${i + 1}`);
    const modelStageLabel = s.assessmentPhaseType
      ? `Phase ${Number(s.assessmentPhaseIndex) + 1}: ${ASSESSMENT_TYPE_LABELS[s.assessmentPhaseType]}`
      : purpose === 'project' ? 'Project stage' : purpose === 'test' ? 'Test instructions' : stageLabel(teachingModel, modelStage);
    slides.push({
      type: 'content', title: s.title, bullets, example: purpose === 'lesson' ? s.example : '',
      speakerNotes: s.speakerNotes, imageQuery: s.imageQuery, visual: s.visual, vocab, shortcuts, worked,
      modelLabel: deckLabel,
      modelStage,
      modelStageLabel,
      assessmentPhaseType: s.assessmentPhaseType || null,
      assessmentPhaseIndex: Number.isInteger(s.assessmentPhaseIndex) ? s.assessmentPhaseIndex : null,
      assessmentProtected: purpose === 'test' || !!s.assessmentProtected || !!s.assessmentPhaseType,
      side: i % 2 === 0 ? 'right' : 'left', // alternate image side for visual rhythm
      // Missing/unrecognised value (placeholder deck, older cached slide) falls
      // back to 'STANDARD' — today's behaviour, unchanged.
      layoutHint: s.layoutHint === 'TEXT_HEAVY' ? 'TEXT_HEAVY' : 'STANDARD',
    });
  });
  if (data.check && purpose !== 'test') {
    const checkSlide = { type: 'check', title: replacesShortcutKeys(data.check.question), bullets: purpose === 'project' ? [] : data.check.answer, imageQuery: data.check.imageQuery, modelLabel: deckLabel };
    if (purpose === 'project') projectFlowSlides.push(checkSlide); else slides.push(checkSlide);
  }
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
  if (purpose !== 'test') {
    const safeActivityBullets = purpose === 'project' ? actBullets.map(replacesShortcutKeys) : actBullets;
    if (purpose === 'project' && !safeActivityBullets.some(bullet => /\?\s*$/.test(bullet))) safeActivityBullets.push('Have you completed and checked the current stage?');
    const activitySlide = {
      type: 'activity', title: purpose === 'project' ? 'Project work' : (act.title || 'Your Turn'), bullets: safeActivityBullets,
      speakerNotes: purpose === 'project' ? 'Display the current stage while students work. Circulate, observe and record evidence.' : actNotes,
      imageQuery: act.imageQuery, differentiation: purpose === 'lesson' ? diff : null,
      modelStage: purpose === 'project' ? 'project_work' : activityStage.id,
      modelStageLabel: purpose === 'project' ? 'Project stage' : stageLabel(teachingModel, activityStage.id), modelLabel: deckLabel,
    };
    if (purpose === 'project') projectFlowSlides.push(activitySlide); else slides.push(activitySlide);
  }
  if (purpose === 'project' && projectFlowSlides.length) {
    const practicalIndex = data.slides.findIndex(slide => slide.assessmentPhaseType === 'practical');
    const nonMcqIndex = data.slides.findIndex(slide => slide.assessmentPhaseType && slide.assessmentPhaseType !== 'mcq');
    const anchorIndex = practicalIndex >= 0 ? practicalIndex : nonMcqIndex;
    const followingPhaseIndex = anchorIndex >= 0
      ? data.slides.findIndex((slide, index) => index > anchorIndex && slide.assessmentPhaseType)
      : data.slides.findIndex(slide => slide.assessmentPhaseType);
    const insertAt = 2 + (followingPhaseIndex >= 0 ? followingPhaseIndex : data.slides.length);
    slides.splice(insertAt, 0, ...projectFlowSlides);
  }
  const recapBullets = purpose === 'test'
    ? ['Check that every required section is complete.', 'Save and submit your work as instructed.', 'Wait quietly for your teacher.']
    : purpose === 'project'
      ? ['Check every required project stage.', 'Save and submit your work.', 'Wait for your teacher to confirm your submission.']
      : data.recap.points;
  slides.push({ type: 'recap', title: purpose === 'test' ? 'Finish and submit' : purpose === 'project' ? 'Project submission' : 'Recap', bullets: recapBullets, imageQuery: data.recap.imageQuery, modelStage: purpose === 'lesson' ? reflectStage.id : `${purpose}_submit`, modelStageLabel: purpose === 'lesson' ? stageLabel(teachingModel, reflectStage.id) : 'Submit', modelLabel: deckLabel, assessmentProtected: purpose === 'test' });
  return slides;
}

function placeholderDeck(subject, topic, slideCount, teachingModelId = 'standard', lessonPurpose = 'lesson', assessmentOptions = {}) {
  const pretty = topic.replace(/-/g, ' ');
  const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const q = `${subject} ${pretty}`;
  const data = {
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
  };
  return flattenDeck(ensureAssessmentDeckCoverage(data, lessonPurpose, assessmentOptions, topic), teachingModelId, lessonPurpose);
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
  const lessonPurpose = normalizeLessonPurpose(extras.lessonPurpose);
  const assessmentOptions = normalizeAssessmentOptions(extras);
  const assessmentManifest = assessmentPhaseManifest(extras);
  if (!process.env.OPENAI_API_KEY) {
    console.log('No OPENAI_API_KEY set — using placeholder text. Add a key to .env for AI-written slides.');
    return placeholderDeck(subject, topic, slideCount, teachingModelId, lessonPurpose, extras);
  }
  const { wrap } = require('./cache');
  return wrap('content', {
    subject: String(subject).toLowerCase().trim(),
    topic: String(topic).toLowerCase().trim(),
    slideCount: Number(slideCount),
    grade: String(grade || 'middle school').trim(),
    tone: String(tone || 'clear and engaging').trim(),
    focus: String(focus || '').trim(),
    lessonSettings: extras.lessonSettings || null,
    lessonPlanText: String((extras && extras.lessonPlanText) || '').trim(),
    sourceMaterialText: String((extras && extras.sourceMaterialText) || '').trim(),
    lessonSequence: extras && extras.lessonSequence ? {
      enabled: !!extras.lessonSequence.enabled,
      lessonCount: parseInt(extras.lessonSequence.lessonCount, 10) || 0,
      periodMinutes: parseInt(extras.lessonSequence.periodMinutes, 10) || 0,
    } : null,
    teachingModelId,
    lessonPurpose,
    assessmentOptions,
    assessmentManifest,
    assessmentDeckPolicyVersion: 4,
    regenerate: !!(extras && extras.regenerate),
  }, async () => {
    const prompt = buildPrompt(subject, topic, grade, slideCount, tone, focus, extras);
    // Structured outputs enforce shape, but not the number of slides or the
    // assessment contract. Retry a weak response, then apply a deterministic
    // safety repair so a required phase can never disappear from the deck.
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let correction = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const data = await callModel(DECK_SCHEMA, 'lesson_deck', [{ role: 'user', content: prompt + correction }], 12000);
      const issues = assessmentDeckIssues(data, lessonPurpose, extras);
      const missingSlides = Math.max(0, slideCount - data.slides.length);
      const score = (issues.length * 100) + missingSlides;
      if (!best || score < bestScore) { best = data; bestScore = score; }
      if (!issues.length && data.slides.length >= slideCount) break;
      correction = `\n\nYour previous draft failed these required checks: ${[...issues, ...(missingSlides ? [`only ${data.slides.length} of ${slideCount} content slides were returned`] : [])].join('; ')}. Return a corrected complete deck that follows every FINAL project/test rule.`;
      console.log(`Deck response needs repair (${correction.slice(2)}), retrying (${attempt}/3)…`);
    }
    const requiredCount = lessonPurpose === 'lesson' ? slideCount : Math.max(slideCount, assessmentManifest.length);
    best.slides = best.slides.slice(0, requiredCount);
    best = ensureAssessmentDeckCoverage(best, lessonPurpose, extras, topic);
    if (lessonPurpose === 'lesson') best.slides = lessonDesign.applyGameSlide(best.slides, extras.lessonSettings);
    return flattenDeck(best, teachingModelId, lessonPurpose);
  });
}

// Regenerate a single content slide (for the editable preview's "regenerate").
async function generateOneSlide({ subject, topic, grade, tone = 'clear and engaging', focus = '', teachingModelId = 'standard', lessonPurpose = 'lesson', lessonPlanText = '', assessmentDraft = null, preferredStage = '', avoidTitles = [] }) {
  const teachingModel = getTeachingModel(teachingModelId);
  const purpose = normalizeLessonPurpose(lessonPurpose);
  const protect = slide => redactPrivateAssessmentContent({ slides: [slide] }, { assessmentDraft }, purpose).slides[0];
  if (!process.env.OPENAI_API_KEY) {
    if (purpose === 'test') {
      const safe = testAdministrationSlide(0, topic);
      safe.stageId = preferredStage || safe.stageId;
      return protect({ type: 'content', modelStage: safe.stageId, ...safe, modelLabel: 'Test session', modelStageLabel: 'Test instructions' });
    }
    if (purpose === 'project') {
      const steps = projectPlanSteps(lessonPlanText, topic);
      const stageMatch = String(preferredStage || '').match(/project[-_](?:stage[-_])?(\d+)/i);
      const stageIndex = Math.min(steps.length - 1, Math.max(0, stageMatch ? Number(stageMatch[1]) - 1 : 0));
      const safe = fallbackProjectSlide(stageIndex, topic, lessonPlanText, steps.length);
      safe.stageId = preferredStage || safe.stageId;
      return protect({ type: 'content', modelStage: safe.stageId, ...safe, modelLabel: 'Project session', modelStageLabel: 'Project stage' });
    }
    const pretty = topic.replace(/-/g, ' ');
    return { type: 'content', modelStage: preferredStage || teachingModel.stages[0].id, title: `${pretty} — new idea`, bullets: ['Placeholder A', 'Placeholder B'], example: purpose === 'test' ? '' : 'Placeholder example.', speakerNotes: 'Placeholder notes.', imageQuery: `${subject} ${pretty}`, vocab: [], shortcuts: [], worked: null };
  }
  const p = gradeProfile(grade).content;
  const pretty = topic.replace(/-/g, ' ');
  const avoid = avoidTitles.length ? `\nDo NOT repeat these existing slide titles: ${avoidTitles.join('; ')}.` : '';
  const approvedPlan = purpose === 'project' && lessonPlanText
    ? `\nUse this approved project plan to keep the replacement slide in context:\n${compactPlanForDeck(lessonPlanText).slice(0, 6000)}\n`
    : '';
  const purposeRule = purpose === 'test'
    ? '\nThis is a test administration slide. Include no test question, answer, hint, worked example, formula, assessed procedure, rubric, marking criterion, vocabulary teaching, or keyboard shortcut. Show only neutral timing, conduct, permitted materials, progress or submission directions.'
    : purpose === 'project'
      ? '\nThis is a project progress slide. Give a context-specific student stage and useful progress questions without a model answer, rubric, mark allocation, finished product or exact keyboard shortcut.' : '';
  const prompt = `Write ONE fresh content slide for a ${grade} lesson on "${pretty}" (${subject}). ${tone} tone.${focus ? ' Focus: ' + focus + '.' : ''}
${modelPromptBlock(teachingModel)}
${purposeRule}${approvedPlan}
The slide must use stageId "${preferredStage || teachingModel.stages[0].id}" so it fits the existing lesson sequence.
Give a clear title, ${p.bullets} bullets (${p.wordsPerBullet}), a concrete real-world example sentence, speaker notes (${p.notes}), and a 2-4 keyword imageQuery. If the slide introduces vocabulary/key terms, fill "vocab" with each term and a short clear definition a ${grade} student understands; otherwise "vocab" is []. If it teaches keyboard shortcuts / tool buttons / key combos, fill "shortcuts" with each action and its EXACT keys (e.g. {"action":"Undo","keys":"Ctrl + Z"}); otherwise "shortcuts" is []. If it teaches how to DO/perform a method, calculation or technique, fill "worked" with a task + the actual ordered steps (real values); otherwise "worked" is {"task":"","steps":[]}. ${p.depth}${avoid}`;
  const s = await callModel(ONE_SLIDE_SCHEMA, 'one_slide', [{ role: 'user', content: prompt }], 1800);
  if (purpose === 'test') {
    const safe = testAdministrationSlide(0, topic);
    safe.stageId = preferredStage || safe.stageId;
    return protect({ type: 'content', modelStage: safe.stageId, ...safe, modelLabel: 'Test session', modelStageLabel: 'Test instructions' });
  }
  if (purpose === 'project') {
    const safe = modelProjectSlideIsUsable(s) ? sanitizeProjectSlide(s) : fallbackProjectSlide(0, topic);
    safe.stageId = preferredStage || safe.stageId;
    return protect({ type: 'content', modelStage: safe.stageId, ...safe, modelLabel: 'Project session', modelStageLabel: 'Project stage' });
  }
  const vocab = purpose === 'test' ? [] : (Array.isArray(s.vocab) ? s.vocab.filter(v => v && v.term) : []);
  if (vocab.length) s.bullets = vocab.map(v => `${v.term} — ${v.definition}`);
  const shortcuts = purpose === 'lesson' && Array.isArray(s.shortcuts) ? s.shortcuts.filter(x => x && x.action && x.keys) : [];
  const worked = purpose === 'test' ? null : ((s.worked && s.worked.task && Array.isArray(s.worked.steps) && s.worked.steps.length) ? s.worked : null);
  return { type: 'content', modelStage: s.stageId || preferredStage || teachingModel.stages[0].id, ...s, example: purpose === 'test' ? '' : s.example, vocab, shortcuts, worked };
}

module.exports = { generateContent, generateOneSlide, assessmentDeckIssues, ensureAssessmentDeckCoverage, assessmentPhaseManifest, replacesShortcutKeys, compactPlanForDeck, projectPlanSteps };
