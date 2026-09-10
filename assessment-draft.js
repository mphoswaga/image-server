const PURPOSES = new Set(['lesson', 'project', 'test']);
const STRUCTURES = new Set(['balanced', 'knowledge', 'practical', 'mixed', 'custom']);
const SECTION_TYPES = new Set(['mcq', 'short-answer', 'extended-response', 'practical']);

function normalizeLessonPurpose(value) {
  const purpose = String(value || '').trim().toLowerCase();
  return PURPOSES.has(purpose) ? purpose : 'lesson';
}

function normalizeAssessmentOptions(input = {}) {
  const total = Math.min(1000, Math.max(1, parseInt(input.assessmentTotalMarks ?? input.totalMarks, 10) || 50));
  const structure = String(input.assessmentStructure || input.structure || '').trim().toLowerCase();
  const delivery = String(input.assessmentDeliveryMode || input.deliveryMode || '').trim().toLowerCase();
  const rawTypes = input.assessmentQuestionTypes || input.questionTypes || [];
  const suppliedTypes = Array.isArray(rawTypes) ? rawTypes : String(rawTypes).split(',');
  let questionTypes = [...new Set(suppliedTypes.map(value => String(value).trim().toLowerCase()).filter(value => SECTION_TYPES.has(value)))];
  if (!questionTypes.length) questionTypes = structure === 'knowledge' ? ['mcq', 'short-answer', 'extended-response']
    : structure === 'practical' ? ['practical'] : structure === 'mixed' ? [...SECTION_TYPES] : ['mcq', 'practical'];
  const requestedMcq = parseInt(input.assessmentMcqCount ?? input.mcqCount, 10);
  const otherTypeMinimum = questionTypes.filter(type => type !== 'mcq').length;
  const maximumMcq = Math.max(1, Math.min(50, total - otherTypeMinimum));
  const mcqCount = questionTypes.includes('mcq')
    ? Math.min(maximumMcq, Math.max(1, Number.isInteger(requestedMcq) ? requestedMcq : 15))
    : 0;
  return {
    totalMarks: total,
    structure: STRUCTURES.has(structure) ? structure : 'balanced',
    deliveryMode: delivery === 'self-paced' ? 'self-paced' : 'live',
    brief: String(input.assessmentBrief || input.brief || '').trim().slice(0, 1200),
    questionTypes,
    mcqCount,
  };
}

const ASSESSMENT_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    instructions: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: [...SECTION_TYPES] },
          instructions: { type: 'string' },
          objectiveIndexes: { type: 'array', items: { type: 'integer' } },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                prompt: { type: 'string' },
                marks: { type: 'integer' },
                options: { type: 'array', items: { type: 'string' } },
                correctIndex: { type: 'integer' },
                answerKey: { type: 'string' },
              },
              required: ['prompt', 'marks', 'options', 'correctIndex', 'answerKey'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'type', 'instructions', 'objectiveIndexes', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'instructions', 'sections'],
  additionalProperties: false,
};

function objectiveRecords(objectives) {
  const used = new Set();
  return String(objectives || '').replace(/\r/g, '').split('\n')
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean)
    .map((text, index) => {
      let id = `objective-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}`;
      if (id === 'objective-') id += `skill-${index + 1}`;
      while (used.has(id)) id += '-2';
      used.add(id);
      return { id, text };
    });
}

function allocateMarks(items, totalMarks) {
  const list = items.slice(0, totalMarks);
  if (!list.length) return [];
  const weights = list.map(item => Math.max(1, Number(item.marks) || 1));
  if (weights.reduce((sum, value) => sum + value, 0) === totalMarks) {
    return list.map((item, index) => ({ ...item, marks: weights[index] }));
  }
  const remaining = totalMarks - list.length;
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map(weight => remaining * weight / weightTotal);
  const marks = exact.map(value => 1 + Math.floor(value));
  let left = totalMarks - marks.reduce((sum, value) => sum + value, 0);
  exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, left).forEach(entry => { marks[entry.index] += 1; });
  return list.map((item, index) => ({ ...item, marks: marks[index] }));
}

function fallbackDraft({ subject, topic, grade, objectives, lessonPurpose, assessmentTotalMarks, assessmentStructure, assessmentDeliveryMode, assessmentBrief, assessmentQuestionTypes, assessmentMcqCount }) {
  const purpose = normalizeLessonPurpose(lessonPurpose);
  if (purpose === 'lesson') return null;
  const opts = normalizeAssessmentOptions({ assessmentTotalMarks, assessmentStructure, assessmentDeliveryMode, assessmentBrief, assessmentQuestionTypes, assessmentMcqCount });
  const objectiveList = objectiveRecords(objectives);
  const title = `${String(topic || 'Learning').replace(/-/g, ' ')} ${purpose === 'test' ? 'Test' : 'Project'}`;
  const practical = {
    title: purpose === 'test' ? 'Practical task' : 'Project task', type: 'practical',
    instructions: 'Complete the task independently. The teacher records evidence against each criterion.',
    objectiveIndexes: objectiveList.map((_, index) => index),
    items: objectiveList.map(objective => ({ prompt: `Demonstrate: ${objective.text}`, marks: 1, options: [], correctIndex: 0, answerKey: '' })),
  };
  const knowledge = {
    title: 'Knowledge and understanding', type: 'short-answer',
    instructions: 'Answer each question clearly.', objectiveIndexes: objectiveList.map((_, index) => index),
    items: objectiveList.map(objective => ({ prompt: `Explain or apply: ${objective.text}`, marks: 1, options: [], correctIndex: 0, answerKey: `A correct response demonstrates: ${objective.text}` })),
  };
  const mcq = {
    title: 'Multiple choice', type: 'mcq', instructions: 'Choose the best answer.', objectiveIndexes: objectiveList.map((_, index) => index),
    items: Array.from({ length: Math.max(1, opts.mcqCount || Math.min(15, opts.totalMarks)) }, (_, index) => ({
      prompt: `Knowledge question ${index + 1} about ${title}`, marks: 1,
      options: ['Correct answer', 'Plausible alternative', 'Plausible alternative', 'Plausible alternative'], correctIndex: 0, answerKey: '',
    })),
  };
  const byType = { mcq, 'short-answer': knowledge, 'extended-response': { ...knowledge, title: 'Extended response', type: 'extended-response' }, practical };
  const sections = opts.questionTypes.map(type => byType[type]).filter(Boolean);
  const mcqItems = sections.filter(section => section.type === 'mcq').flatMap(section => section.items);
  const otherItems = sections.filter(section => section.type !== 'mcq').flatMap(section => section.items);
  if (otherItems.length && mcqItems.length < opts.totalMarks) {
    const available = opts.totalMarks - mcqItems.length;
    otherItems.forEach((item, index) => { item.marks = Math.floor(available / otherItems.length) + (index < available % otherItems.length ? 1 : 0); });
  }
  return normalizeAssessmentDraft({ title, instructions: opts.brief || `Complete this ${purpose}.`, sections }, {
    subject, grade, objectives, lessonPurpose: purpose, ...opts,
  });
}

function normalizeAssessmentDraft(raw, context = {}) {
  const purpose = normalizeLessonPurpose(context.lessonPurpose);
  if (purpose === 'lesson') return null;
  const opts = normalizeAssessmentOptions({
    assessmentTotalMarks: context.totalMarks || context.assessmentTotalMarks,
    assessmentStructure: context.structure || context.assessmentStructure,
    assessmentDeliveryMode: context.deliveryMode || context.assessmentDeliveryMode,
    assessmentBrief: context.brief || context.assessmentBrief,
    assessmentQuestionTypes: context.questionTypes || context.assessmentQuestionTypes,
    assessmentMcqCount: context.mcqCount || context.assessmentMcqCount,
  });
  const objectives = objectiveRecords(context.objectives);
  if (!objectives.length) return null;
  let sections = (Array.isArray(raw && raw.sections) ? raw.sections : []).map((section, sectionIndex) => {
    const type = SECTION_TYPES.has(section && section.type) ? section.type : 'short-answer';
    const objectiveIds = (Array.isArray(section && section.objectiveIndexes) ? section.objectiveIndexes : [])
      .map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < objectives.length)
      .map(index => objectives[index].id);
    const items = (Array.isArray(section && section.items) ? section.items : []).map((item, itemIndex) => {
      const prompt = String(item && item.prompt || '').trim().slice(0, 2000);
      if (!prompt) return null;
      const normalized = { id: `auto-${sectionIndex + 1}-${itemIndex + 1}`, prompt, marks: Math.max(1, parseInt(item.marks, 10) || 1) };
      if (type === 'mcq') {
        const options = (Array.isArray(item.options) ? item.options : []).map(String).map(value => value.trim()).filter(Boolean).slice(0, 6);
        if (options.length < 2) return null;
        normalized.options = options;
        normalized.correctIndex = Math.min(options.length - 1, Math.max(0, parseInt(item.correctIndex, 10) || 0));
      } else if (type !== 'practical') {
        normalized.answerKey = String(item && item.answerKey || '').trim().slice(0, 4000) || 'Accept an accurate response that demonstrates the linked objective.';
      }
      return normalized;
    }).filter(Boolean);
    if (!items.length) return null;
    return {
      id: `auto-section-${sectionIndex + 1}`,
      title: String(section.title || `Section ${sectionIndex + 1}`).trim().slice(0, 120),
      type,
      instructions: String(section.instructions || '').trim().slice(0, 2000),
      objectiveIds: objectiveIds.length ? [...new Set(objectiveIds)] : objectives.map(objective => objective.id),
      items,
    };
  }).filter(Boolean);
  if (!sections.length) return fallbackDraft({ ...context, lessonPurpose: purpose, assessmentTotalMarks: opts.totalMarks, assessmentQuestionTypes: opts.questionTypes, assessmentMcqCount: opts.mcqCount });
  const flat = sections.flatMap((section, sectionIndex) => section.items.map((item, itemIndex) => ({ sectionIndex, itemIndex, type: section.type, item })));
  const mcqEntries = flat.filter(entry => entry.type === 'mcq');
  const otherEntries = flat.filter(entry => entry.type !== 'mcq');
  const fixedMcqMarks = opts.questionTypes.includes('mcq') && otherEntries.length && mcqEntries.length < opts.totalMarks;
  const otherAllocation = fixedMcqMarks
    ? allocateMarks(otherEntries.map(entry => entry.item), opts.totalMarks - mcqEntries.length)
    : [];
  const allocated = fixedMcqMarks
    ? flat.map(entry => entry.type === 'mcq'
      ? { ...entry.item, marks: 1 }
      : otherAllocation[otherEntries.indexOf(entry)])
    : allocateMarks(flat.map(entry => entry.item), opts.totalMarks);
  sections = sections.map((section, sectionIndex) => ({
    ...section,
    items: section.items.map((item, itemIndex) => allocated[flat.findIndex(entry => entry.sectionIndex === sectionIndex && entry.itemIndex === itemIndex)]).filter(Boolean),
  })).filter(section => section.items.length);
  return {
    title: String(raw && raw.title || `${context.topic || purpose} ${purpose}`).trim().slice(0, 160),
    subject: String(context.subject || '').trim().slice(0, 100),
    grade: String(context.grade || '').trim().slice(0, 60),
    assessmentType: purpose,
    deliveryMode: opts.deliveryMode,
    totalMarks: opts.totalMarks,
    objectives,
    instructions: String(raw && raw.instructions || opts.brief || '').trim().slice(0, 2000),
    sections,
  };
}

function assessmentDraftIssues(draft, options = {}) {
  const opts = normalizeAssessmentOptions(options);
  if (!draft) return ['assessment draft is missing'];
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const issues = [];
  const selected = new Set(opts.questionTypes);
  for (const section of sections) {
    if (!selected.has(section.type)) issues.push(`unselected ${section.type} section was added`);
  }
  for (const type of opts.questionTypes) {
    if (!sections.some(section => section.type === type && Array.isArray(section.items) && section.items.length)) issues.push(`${type} section is missing`);
  }
  const mcqCount = sections.filter(section => section.type === 'mcq').reduce((sum, section) => sum + (section.items || []).length, 0);
  if (opts.questionTypes.includes('mcq') && mcqCount !== opts.mcqCount) issues.push(`expected ${opts.mcqCount} multiple-choice items but received ${mcqCount}`);
  const mcqMarks = sections.filter(section => section.type === 'mcq').flatMap(section => section.items || []).map(item => Number(item.marks) || 0);
  if (opts.questionTypes.includes('mcq') && opts.questionTypes.length > 1 && mcqMarks.some(mark => mark !== 1)) issues.push('each multiple-choice item must be worth exactly 1 mark');
  const allocated = sections.reduce((sum, section) => sum + (section.items || []).reduce((itemSum, item) => itemSum + (Number(item.marks) || 0), 0), 0);
  if (allocated !== opts.totalMarks) issues.push(`expected ${opts.totalMarks} total marks but received ${allocated}`);
  return issues;
}

function assessmentPromptBlock(purpose, options = {}) {
  purpose = normalizeLessonPurpose(purpose);
  if (purpose === 'lesson') return '';
  const opts = normalizeAssessmentOptions(options);
  const structureText = {
    balanced: 'a balanced combination of knowledge questions and practical/application evidence',
    knowledge: 'knowledge questions only, using suitable selected-response and written-response formats',
    practical: 'practical, performance, product or observation criteria only',
    mixed: 'a varied mix of selected response, short response, extended response and practical evidence where appropriate',
    custom: `the teacher's custom structure: ${opts.brief || 'choose the most suitable sections for the objectives'}`,
  }[opts.structure];
  const typeNames = { mcq: 'multiple choice', 'short-answer': 'short answer', 'extended-response': 'extended response', practical: 'practical / observation' };
  const typeRule = opts.questionTypes.map(type => typeNames[type]).join(', ');
  const otherTypes = opts.questionTypes.filter(type => type !== 'mcq');
  const mcqMarks = opts.questionTypes.includes('mcq') && otherTypes.length ? opts.mcqCount : null;
  const remainingMarks = mcqMarks == null ? null : opts.totalMarks - mcqMarks;
  const deliveryFlow = opts.questionTypes.map((type, index) => {
    if (type === 'mcq') return `Phase ${index + 1}: students complete ${opts.mcqCount} multiple-choice questions independently in LessonScope${mcqMarks == null ? '' : ` (${mcqMarks} marks)`}; the teacher opens and supervises the section but does not display, read aloud, explain or answer the questions.`;
    if (type === 'practical') return `Phase ${index + 1}: students complete the practical, performance or product task while the teacher observes and records evidence${remainingMarks != null && otherTypes.length === 1 ? ` (${remainingMarks} marks)` : ''}.`;
    if (type === 'short-answer') return `Phase ${index + 1}: students complete the short-answer section independently in LessonScope.`;
    return `Phase ${index + 1}: students complete the extended-response section independently in LessonScope.`;
  }).join('\n');
  return `\nAUTOMATIC ${purpose.toUpperCase()} DRAFT:
Also return assessmentDraft. It is an editable draft for the teacher, never a published assessment.
Create a subject-neutral ${purpose} worth exactly ${opts.totalMarks} marks, structured as ${structureText}.
Use these teacher-selected item types: ${typeRule}. Do not add other item types.
${opts.questionTypes.includes('mcq') ? `Create exactly ${opts.mcqCount} multiple-choice items. ${otherTypes.length ? 'Each multiple-choice item is worth exactly 1 mark; allocate all remaining marks across the other selected sections.' : 'Distribute the total marks across those items.'}` : 'Do not create a multiple-choice section.'}
The LESSON PLAN content must visibly schedule every selected assessment phase in this order, while keeping the school template headings unchanged:
${deliveryFlow}
Mention the LessonScope phase, item count and marks in the teacher-facing plan, but never copy the actual questions, answer choices, solutions or private marking guidance into the plan.
Use only the supplied objectives and source material. Match the exact grade. Give every section a clear type, instructions, and objectiveIndexes using zero-based positions in the supplied objective list.
Every item needs a prompt and positive whole-number marks. The marks across all items must total exactly ${opts.totalMarks}.
For multiple choice, provide 2-6 plausible options and the correct zero-based correctIndex. For written responses, provide concise marking guidance in answerKey. For practical criteria, describe observable evidence and leave options empty and answerKey empty.
${purpose === 'test' ? 'The test must be valid for independent work. Do not put any test question, answer, hint, worked solution, marking key or assessed procedure into the public lesson-plan presentation directions.' : 'Break the project into meaningful stages and assess both the process and the final product where appropriate. Questions may guide student thinking, but keep marking guidance private.'}
${opts.brief ? `Teacher requirements: ${opts.brief}` : ''}\n`;
}

function assessmentOnlyPrompt({ subject, topic, grade, objectives, sourceMaterialText = '', lessonPurpose = 'project', ...options } = {}) {
  const purpose = normalizeLessonPurpose(lessonPurpose);
  const opts = normalizeAssessmentOptions(options);
  const typeNames = { mcq: 'multiple choice', 'short-answer': 'short answer', 'extended-response': 'extended response', practical: 'practical / observation' };
  const selectedTypes = opts.questionTypes.map(type => typeNames[type]).join(', ');
  const otherTypes = opts.questionTypes.filter(type => type !== 'mcq');
  const mcqAllocation = opts.questionTypes.includes('mcq') && otherTypes.length
    ? `${opts.mcqCount} marks belong to the ${opts.mcqCount} multiple-choice items and the remaining ${opts.totalMarks - opts.mcqCount} marks belong to the other selected section(s).`
    : '';
  const source = String(sourceMaterialText || '').trim();
  return `Create ONLY the editable assessment draft described below. Do not return a lesson plan or commentary.

Assessment type: ${purpose}
Subject: ${String(subject || '').trim()}
Topic: ${String(topic || '').replace(/-/g, ' ').trim()}
Grade level: ${String(grade || '').trim()}
Learning objectives:
${String(objectives || '').trim()}

Teacher settings:
- Total marks: exactly ${opts.totalMarks}
- Selected section types, in this order: ${selectedTypes}
- Delivery: ${opts.deliveryMode === 'live' ? 'live in the classroom under teacher control' : 'self-paced'}
${opts.questionTypes.includes('mcq') ? `- Multiple choice: exactly ${opts.mcqCount} different questions; do not return ${opts.mcqCount - 1} or any other number` : '- Do not create multiple-choice questions'}
${opts.brief ? `- Teacher requirements: ${opts.brief}` : ''}

Use every selected section type and no unselected type. ${mcqAllocation}
Make every question accurate, unambiguous, different from the others, appropriate for the stated grade, and directly connected to the objectives or source material. Multiple-choice items need 2-6 plausible options and one correct zero-based correctIndex. Written items need concise answerKey marking guidance. Practical items must describe observable evidence; leave their options and answerKey empty. Use zero-based objectiveIndexes. Every item must have positive whole-number marks, and all marks together must total exactly ${opts.totalMarks}.
${purpose === 'test'
    ? 'The test must be suitable for independent work and must not reveal answers or hints in student-facing wording.'
    : 'The project must assess meaningful stages of the process and the completed outcome while keeping marking guidance private.'}
${source ? `\nRelevant source material:\n${source.slice(0, 5000)}` : ''}`;
}

module.exports = {
  ASSESSMENT_DRAFT_SCHEMA, normalizeLessonPurpose, normalizeAssessmentOptions,
  normalizeAssessmentDraft, assessmentDraftIssues, fallbackDraft, assessmentPromptBlock, assessmentOnlyPrompt,
};
