// Generates a lesson plan that mirrors the teacher's uploaded template format,
// filled in from the pasted objectives. Output is a list of {heading, content}
// sections so it can be rendered, edited, and then drive slide creation.
const { client: aiClient } = require('./ai-client');
const { gradeProfile } = require('./grade');
const { getTeachingModel, normalizeTeachingModelId, modelPromptBlock } = require('./teaching-models');
const {
  ASSESSMENT_DRAFT_SCHEMA, normalizeLessonPurpose, normalizeAssessmentOptions,
  normalizeAssessmentDraft, assessmentDraftIssues, fallbackDraft, assessmentPromptBlock,
} = require('./assessment-draft');

// How much of an uploaded template reaches the prompt. Exported so the upload
// endpoint can warn when a template exceeds it instead of silently dropping the end.
const TEMPLATE_PROMPT_LIMIT = 6000;

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function planSchema(model, sequence = null, structuredSequence = false, includeAssessment = false) {
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
  const properties = {
    successCriteria: {
      type: 'array',
      items: { type: 'string' },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: sectionProperties,
        required: sectionRequired,
        additionalProperties: false,
      },
    },
  };
  const required = ['successCriteria', 'sections'];
  if (includeAssessment) {
    properties.assessmentDraft = ASSESSMENT_DRAFT_SCHEMA;
    required.push('assessmentDraft');
  }
  return {
    type: 'object',
    properties,
    required,
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

function sequenceStepPromptBlock(sequence, lessonNumber, previousLessonPlanText = '') {
  if (!sequence || !sequence.enabled || !lessonNumber) return '';
  const lessonCount = Math.min(5, Math.max(2, parseInt(sequence.lessonCount, 10) || 3));
  const periodMinutes = Math.min(180, Math.max(5, parseInt(sequence.periodMinutes, 10) || 35));
  const step = Math.min(lessonCount, Math.max(1, parseInt(lessonNumber, 10) || 1));
  const previous = String(previousLessonPlanText || '').slice(0, 8000).trim();
  return `\nSTAGED WEEKLY LESSON SEQUENCE:
Create ONLY Lesson ${step} of ${lessonCount}. Do not create, outline, preview, or append any other lesson in this response.
This lesson lasts exactly ${periodMinutes} minutes. Its activities and timing must total ${periodMinutes} minutes.
The complete sequence covers the same objectives across the week, but this response must contain a complete, classroom-ready plan for period ${step} only.
${step > 1 ? `Build naturally on the earlier lesson plans below. Advance the learning instead of repeating them.\n\n--- EARLIER LESSONS START ---\n${previous || 'No earlier lesson summary was supplied.'}\n--- EARLIER LESSONS END ---` : 'Establish the foundations that later lessons can build on.'}
Include teacher actions, student practice, a check for understanding, and useful resources or homework in the relevant fields.
Do not put "Lesson ${step}" into school template headings; the app labels the step outside the plan.\n`;
}

function buildPrompt({ subject, topic, grade, tone, objectives, successCriteria = [], templateText, unitBlock, sourceMaterialText, planningFrameworkText = '', teachingModel, sequence, structuredSequence = false, sequenceLessonNumber = null, previousLessonPlanText = '', lessonPurpose = 'lesson', assessmentOptions = {} }) {
  const pretty = topic.replace(/-/g, ' ');
  const depth = gradeProfile(grade).content.depth;
  const model = getTeachingModel(teachingModel);
  const purpose = normalizeLessonPurpose(lessonPurpose);
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
  const frameworkBlock = planningFrameworkText
    ? `\nThe teacher approved the PLANNING FRAMEWORK below. It guides the quality of teaching, student thinking, assessment and reflection. Apply requirements where they are relevant to this lesson without changing supplied curriculum objectives, inventing school rules, adding new template headings, or mechanically forcing every strategy into every lesson.\n\n--- PLANNING FRAMEWORK START ---\n${String(planningFrameworkText).slice(0, 7000)}\n--- PLANNING FRAMEWORK END ---\n`
    : '';
  const sequenceBlock = sequenceLessonNumber
    ? sequenceStepPromptBlock(sequence, sequenceLessonNumber, previousLessonPlanText)
    : sequencePromptBlock(sequence, !!templateText, structuredSequence);
  const outputShapeRule = structuredSequence
    ? 'Output one section per template heading PER LESSON, in lesson order, each as {heading, content, stageId, lesson}. The lesson number must match the period the content belongs to.'
    : 'Output one section per template heading, in the same order, each as {heading, content, stageId}.';
  const templateRule = templateText
    ? (structuredSequence
      ? 'A school template is provided, so it decides the fields outright: for every lesson output every authored template heading exactly once and in template order. Do not add, rename, merge or omit fields.'
      : 'A school template is provided, so it decides the sections outright: output exactly its headings, exactly once each, in its order — no extras, no renames, nothing merged or split, even if the teaching method would suggest a different arrangement.')
    : 'There is no school template, so create clear headings that follow the selected model stages in order.';
  const suppliedCriteria = (Array.isArray(successCriteria) ? successCriteria : [])
    .map(value => String(value || '').trim()).filter(Boolean);
  const criteriaBlock = suppliedCriteria.length
    ? `The teacher/school supplied these SUCCESS CRITERIA. Return them exactly in successCriteria, without rewriting or adding to them:\n${suppliedCriteria.join('\n')}`
    : `No success criteria were supplied. Create 2-5 concise, observable success criteria from the learning objectives. Every item must begin "I can..." and describe evidence a student can demonstrate by the end of this lesson; do not use vague verbs such as understand, know, or learn.`;
  const modelDetailRule = model.id === 'gradual_release'
    ? `GRADUAL RELEASE REQUIREMENT:
In the main teaching/activity field, begin with "Teaching model: Gradual Release" and use these labels exactly: "I Do", "We Do", "You Do Together", and "You Do Alone". Under every label give concrete teacher actions, concrete student actions, the example/task or materials, and a check for understanding or transition. Do not reduce a phase to a single generic sentence. The closing/plenary must provide the Exit and Reflect phase.`
    : '';
  const purposeBlock = purpose === 'lesson'
    ? '\nLESSON PURPOSE: Normal taught lesson. The teacher introduces and teaches new content, then students practise and demonstrate learning.\n'
    : purpose === 'project'
      ? `\nLESSON PURPOSE: PROJECT SESSION.
The school template headings and front matter stay exactly as supplied, but the teaching strategy changes. The teacher briefly launches the project, explains the outcome and success criteria, then facilitates while students do the work. Write context-specific student stages that become more independent as the grade rises. Include teacher circulation, checkpoints, observation and feedback. Preparation resources must teach or rehearse prerequisite knowledge and skills without completing the assessed product for students.\n`
      : `\nLESSON PURPOSE: TEST SESSION.
The school template headings and front matter stay exactly as supplied, but the teaching strategy changes. The teacher may introduce procedures and expectations before the test, then does not teach, prompt, explain answers or lead checks while students work. Write administration, timing, access arrangements, independent student work, teacher supervision, collection and marking steps. Preparation resources belong before the test and must cover prerequisite knowledge without reproducing live questions or answers.\n`;

  return `You are an experienced teacher writing a complete lesson plan.

Subject: ${subject}
Topic: ${pretty}
Grade level: ${grade}
Tone: ${tone}
${modelPromptBlock(model, { structureFromTemplate: !!templateText })}
${purposeBlock}
${unitSection}
${sourceBlock}${frameworkBlock}
${sequenceBlock}
Learning objectives provided by the teacher (the plan MUST address these):
${objectives}

${criteriaBlock}

${templateBlock}
${assessmentPromptBlock(purpose, assessmentOptions)}

Rules:
  - ${outputShapeRule}
  - stageId MUST be one of: ${model.stages.map(stage => stage.id).join(', ')}. This is only a tag saying which part of the method a section serves — mapping a heading to a stage must NEVER change that heading's name, wording or position.
  - ${templateRule}
  - "content": write as short bullet points, ONE idea per line, separated by newlines. Plain text ONLY — no markdown symbols (no **, no #, no backticks) and do NOT manually number the lines. Keep each line concise and classroom-ready.
- VOCABULARY: whenever you list key words or vocabulary, give each one a short, clear definition on the same line (e.g. "Cooperate: to work together to get something done") — never list a term without explaining what it means.
- GAMES & ACTIVITIES: whenever the plan includes a game or activity, spell it out so another teacher could run it without guessing — state the goal (how to "win" / what success looks like), the materials needed, and the step-by-step rules of how to play. Never just name an activity.
- SUCCESS CRITERIA: return the lesson's final criteria in the top-level successCriteria array. They must be usable in the downloaded plan even when the school template excluded this field from AI-authored headings.
- ${modelDetailRule || (purpose === 'test' ? 'Make test administration specific: state what the teacher does before, during and after the test, what students do independently, and how work is collected and marked. Do not include in-test teaching or answer checks.' : `Make every phase specific: state what the teacher does, what students do, the concrete task, and how progress or understanding is checked.`)}
- ${depth}
  - Make the plan fully address the objectives above and be appropriate for ${grade}.
  - ${templateText
    ? `The teaching should feel like ${model.label} in HOW each section is written — the teacher actions, student actions, practice and checks. The section headings and their order come from the school's template ONLY; never add, rename or reorder a section to fit the method.`
    : `The lesson must visibly feel like ${model.label}; do not merely mention the model in a note. The activities, teacher actions, student actions, checks, and closing must follow its sequence.`}`;
}

function objectiveLines(objectives) {
  return String(objectives || '').replace(/\r/g, '').split('\n')
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

function criterionFromObjective(objective) {
  let text = String(objective || '').trim()
    .replace(/^\s*[A-Z]{0,5}\d+(?:\.\d+)*\s*[:.)-]?\s*/i, '')
    .replace(/[.!?]+$/, '');
  const colon = text.indexOf(':');
  if (colon >= 0 && text.slice(colon + 1).trim()) text = text.slice(colon + 1).trim();
  text = text.replace(/^(?:students?\s+(?:will|can|should)\s+|learners?\s+(?:will|can|should)\s+)/i, '');
  if (/^understand\b/i.test(text)) text = text.replace(/^understand\b/i, 'explain');
  if (/^know\b/i.test(text)) text = text.replace(/^know\b/i, 'describe');
  if (!text) return '';
  return `I can ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}

function deriveSuccessCriteria(objectives, limit = 5) {
  return objectiveLines(objectives).map(criterionFromObjective).filter(Boolean).slice(0, limit);
}

function normalizeGeneratedCriteria(criteria, objectives) {
  const generated = (Array.isArray(criteria) ? criteria : [])
    .map(value => String(value || '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .map(value => {
      const sentence = /^i can\b/i.test(value) ? value : `I can ${value.charAt(0).toLowerCase()}${value.slice(1)}`;
      return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
    });
  return generated.length ? generated.slice(0, 5) : deriveSuccessCriteria(objectives);
}

function ensureGradualReleaseVisible(sections) {
  const list = Array.isArray(sections) ? sections.map(section => ({ ...section })) : [];
  const activityIndex = list.findIndex(section => /activit|main teaching|teacher steps|lesson development/i.test(String(section.heading || '')));
  if (activityIndex < 0) return list;
  const section = list[activityIndex];
  let content = String(section.content || '').trim();
  if (!/^teaching model:\s*gradual release/im.test(content)) content = `Teaching model: Gradual Release\n${content}`.trim();
  const required = [
    ['I Do', 'Teacher: Model the target skill with a worked example and verbalise each decision.\nStudents: Watch, listen, and respond to a quick check.'],
    ['We Do', 'Teacher: Guide a shared example with prompts and immediate feedback.\nStudents: Suggest each step and explain their reasoning.'],
    ['You Do Together', 'Teacher: Monitor paired practice and address misconceptions.\nStudents: Complete a supported example together and compare their process with the success criteria.'],
    ['You Do Alone', 'Teacher: Set an independent task and collect evidence of learning.\nStudents: Complete the task independently and self-check against the success criteria.'],
  ];
  for (const [label, fallback] of required) {
    if (!new RegExp(`(?:^|\\n)${label.replace(/ /g, '\\s+')}\\s*(?:[:(]|$)`, 'i').test(content)) {
      content += `\n${label}\n${fallback}`;
    }
  }
  list[activityIndex] = { ...section, content: content.trim() };
  return list;
}

function ensureAssessmentFlowVisible(sections, lessonPurpose, options = {}) {
  const purpose = normalizeLessonPurpose(lessonPurpose);
  if (purpose === 'lesson') return Array.isArray(sections) ? sections : [];
  const opts = normalizeAssessmentOptions(options);
  const list = Array.isArray(sections) ? sections.map(section => ({ ...section })) : [];
  if (!list.length) return list;
  const allContent = list.map(section => section.content || '').join('\n').toLowerCase();
  const typeNames = { mcq: 'multiple-choice', 'short-answer': 'short-answer', 'extended-response': 'extended-response', practical: purpose === 'project' ? 'project practical' : 'practical' };
  const otherTypes = opts.questionTypes.filter(type => type !== 'mcq');
  const remainingMarks = opts.questionTypes.includes('mcq') && otherTypes.length ? opts.totalMarks - opts.mcqCount : null;
  const lines = [];
  opts.questionTypes.forEach((type, index) => {
    const alreadyVisible = type === 'mcq'
      ? allContent.includes('multiple-choice') && allContent.includes('lessonscope') && allContent.includes(`${opts.mcqCount} questions`) && (!otherTypes.length || allContent.includes(`${opts.mcqCount} marks`))
      : type === 'practical' && remainingMarks != null && otherTypes.length === 1
        ? allContent.includes(typeNames[type]) && allContent.includes(`${remainingMarks} marks`) && allContent.includes('lessonscope')
        : allContent.includes(typeNames[type]) && allContent.includes('lessonscope');
    if (alreadyVisible) return;
    if (type === 'mcq') {
      lines.push(`Assessment phase ${index + 1} — LessonScope multiple-choice: Students independently answer ${opts.mcqCount} questions${otherTypes.length ? ` (${opts.mcqCount} marks)` : ''}. Teacher starts the section, supervises without explaining answers, and confirms submissions.`);
    } else if (type === 'practical') {
      lines.push(`Assessment phase ${index + 1} — ${purpose === 'project' ? 'Project practical' : 'Practical'}: Students complete the assessed task${remainingMarks != null && otherTypes.length === 1 ? ` (${remainingMarks} marks)` : ''}. Teacher displays only safe stage directions, circulates without giving answers, and records evidence in LessonScope.`);
    } else {
      lines.push(`Assessment phase ${index + 1} — ${typeNames[type]}: Students complete this section independently in LessonScope. Teacher supervises without explaining answers and marks the responses after submission.`);
    }
  });
  if (!lines.length) return list;
  let target = list.findIndex(section => /assessment|evaluat|main activit|learner activit|student activit|procedure/i.test(String(section.heading || '')));
  if (target < 0) target = list.findIndex(section => /plan|create|practi|task|lesson/i.test(String(section.heading || '')));
  if (target < 0) target = list.length - 1;
  list[target].content = [String(list[target].content || '').trim(), ...lines].filter(Boolean).join('\n');
  return list;
}

function finalizeLessonPlan(raw, { objectives = '', suppliedSuccessCriteria = [], teachingModelId = 'standard' } = {}) {
  const supplied = (Array.isArray(suppliedSuccessCriteria) ? suppliedSuccessCriteria : [])
    .map(value => String(value || '').trim()).filter(Boolean);
  const successCriteria = supplied.length ? supplied : normalizeGeneratedCriteria(raw && raw.successCriteria, objectives);
  const sections = teachingModelId === 'gradual_release'
    ? ensureGradualReleaseVisible(raw && raw.sections)
    : (Array.isArray(raw && raw.sections) ? raw.sections : []);
  return { ...(raw || {}), sections, successCriteria };
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

async function generateLessonPlan({ subject, topic, grade = 'middle school', tone = 'clear and engaging', objectives, successCriteria = [], templateText, unitBlock = '', sourceMaterialText = '', planningFrameworkText = '', teachingModel = 'standard', sequence = null, structuredSequence = false, sequenceLessonNumber = null, previousLessonPlanText = '', lessonPurpose = 'lesson', assessmentTotalMarks = 50, assessmentStructure = 'balanced', assessmentDeliveryMode = 'live', assessmentBrief = '', assessmentQuestionTypes = [], assessmentMcqCount = 15, regenerate = false }) {
  const teachingModelId = normalizeTeachingModelId(teachingModel);
  const model = getTeachingModel(teachingModelId);
  const purpose = normalizeLessonPurpose(lessonPurpose);
  const assessmentOptions = normalizeAssessmentOptions({ assessmentTotalMarks, assessmentStructure, assessmentDeliveryMode, assessmentBrief, assessmentQuestionTypes, assessmentMcqCount });
  const cleanSequence = sequence && sequence.enabled ? {
    enabled: true,
    lessonCount: Math.min(5, Math.max(2, parseInt(sequence.lessonCount, 10) || 3)),
    periodMinutes: Math.min(180, Math.max(5, parseInt(sequence.periodMinutes, 10) || 35)),
  } : null;
  const cleanLessonNumber = cleanSequence && sequenceLessonNumber != null
    ? Math.min(cleanSequence.lessonCount, Math.max(1, parseInt(sequenceLessonNumber, 10) || 1))
    : null;
  if (!process.env.OPENAI_API_KEY) {
    console.log('No OPENAI_API_KEY set — using placeholder lesson plan.');
    const placeholder = placeholderPlan(objectives, teachingModelId);
    if (cleanSequence && structuredSequence && !cleanLessonNumber) {
      placeholder.sections = Array.from({ length: cleanSequence.lessonCount }, (_, lessonIndex) =>
        placeholder.sections.map(section => ({ ...section, lesson: lessonIndex + 1 }))
      ).flat();
    }
    const assessmentDraft = fallbackDraft({ subject, topic, grade, objectives, lessonPurpose: purpose, assessmentTotalMarks: assessmentOptions.totalMarks, assessmentStructure: assessmentOptions.structure, assessmentDeliveryMode: assessmentOptions.deliveryMode, assessmentBrief: assessmentOptions.brief, assessmentQuestionTypes: assessmentOptions.questionTypes, assessmentMcqCount: assessmentOptions.mcqCount });
    const finalized = finalizeLessonPlan(placeholder, { objectives, suppliedSuccessCriteria: successCriteria, teachingModelId });
    finalized.sections = ensureAssessmentFlowVisible(finalized.sections, purpose, assessmentOptions);
    return { ...finalized, teachingModelId, lessonPurpose: purpose, assessmentDraft, sequence: cleanSequence, sequenceLessonNumber: cleanLessonNumber };
  }
  const { wrap } = require('./cache');
  const cachedOrGenerated = await wrap('lesson-plan', {
    subject: String(subject || '').toLowerCase().trim(),
    topic: String(topic || '').toLowerCase().trim(),
    grade: String(grade || 'middle school').trim(),
    tone: String(tone || 'clear and engaging').trim(),
    objectives: String(objectives || '').trim(),
    successCriteria: (Array.isArray(successCriteria) ? successCriteria : []).map(String).map(value => value.trim()).filter(Boolean),
    templateText: String(templateText || '').slice(0, TEMPLATE_PROMPT_LIMIT).trim(),
    unitBlock: String(unitBlock || '').slice(0, 2000).trim(),
    sourceMaterialText: String(sourceMaterialText || '').slice(0, 5000).trim(),
    planningFrameworkText: String(planningFrameworkText || '').slice(0, 7000).trim(),
    teachingModelId,
    lessonPurpose: purpose,
    assessmentOptions,
    assessmentDraftVersion: 2,
    sequence: cleanSequence,
    structuredSequence: !!(cleanSequence && structuredSequence && !cleanLessonNumber),
    sequenceLessonNumber: cleanLessonNumber,
    previousLessonPlanText: String(previousLessonPlanText || '').slice(0, 8000).trim(),
    regenerate,
  }, async () => {
    const client = aiClient();
    const basePrompt = buildPrompt({ subject, topic, grade, tone, objectives, successCriteria, templateText, unitBlock, sourceMaterialText, planningFrameworkText, teachingModel: teachingModelId, sequence: cleanSequence, structuredSequence: !!(cleanSequence && structuredSequence && !cleanLessonNumber), sequenceLessonNumber: cleanLessonNumber, previousLessonPlanText, lessonPurpose: purpose, assessmentOptions });
    let lastIssues = [];
    for (let attempt = 1; attempt <= (purpose === 'lesson' ? 1 : 3); attempt++) {
      const correction = lastIssues.length ? `\n\nYour previous draft failed these required checks: ${lastIssues.join('; ')}. Correct every issue in the new response.` : '';
      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: cleanSequence && structuredSequence && !cleanLessonNumber ? 12000 : (purpose === 'lesson' ? 6000 : 12000),
        messages: [{ role: 'user', content: basePrompt + correction }],
        response_format: { type: 'json_schema', json_schema: { name: 'lesson_plan', strict: true, schema: planSchema(model, cleanSequence, !!(cleanSequence && structuredSequence && !cleanLessonNumber), purpose !== 'lesson') } },
      });
      const text = response.choices[0]?.message?.content;
      if (!text) throw new Error('No lesson plan returned from the model');
      const parsed = JSON.parse(text);
      if (purpose === 'lesson') return { ...parsed, teachingModelId, sequence: cleanSequence, sequenceLessonNumber: cleanLessonNumber };
      const normalizedDraft = normalizeAssessmentDraft(parsed.assessmentDraft, { subject, topic, grade, objectives, lessonPurpose: purpose, ...assessmentOptions });
      lastIssues = assessmentDraftIssues(normalizedDraft, assessmentOptions);
      if (!lastIssues.length) return { ...parsed, teachingModelId, sequence: cleanSequence, sequenceLessonNumber: cleanLessonNumber };
    }
    throw new Error(`The automatic ${purpose} draft did not match your selected structure (${lastIssues.join('; ')}). Please generate it again.`);
  });
  const finalized = finalizeLessonPlan(cachedOrGenerated, { objectives, suppliedSuccessCriteria: successCriteria, teachingModelId });
  finalized.sections = ensureAssessmentFlowVisible(finalized.sections, purpose, assessmentOptions);
  const assessmentDraft = normalizeAssessmentDraft(cachedOrGenerated.assessmentDraft, { subject, topic, grade, objectives, lessonPurpose: purpose, ...assessmentOptions });
  return { ...finalized, teachingModelId, lessonPurpose: purpose, assessmentDraft, sequence: cleanSequence, sequenceLessonNumber: cleanLessonNumber };
}

// Render an accepted plan to a compact text block to feed into slide generation.
function planToText(plan) {
  return (plan.sections || []).map(s => `## ${s.heading}${s.stageId ? ` [stage: ${s.stageId}]` : ''}\n${s.content}`).join('\n\n');
}

module.exports = {
  TEMPLATE_PROMPT_LIMIT, generateLessonPlan, planToText, planSchema,
  sequencePromptBlock, sequenceStepPromptBlock, buildPrompt,
  deriveSuccessCriteria, finalizeLessonPlan, ensureGradualReleaseVisible,
  ensureAssessmentFlowVisible,
};
