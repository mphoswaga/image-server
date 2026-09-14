const PURPOSES = new Set(['lesson', 'project', 'test']);
const STRUCTURES = new Set(['balanced', 'knowledge', 'practical', 'mixed', 'custom']);
const SECTION_TYPES = new Set(['mcq', 'short-answer', 'extended-response', 'practical']);
const REVIEW_REQUIRED_MARKER = '[REVIEW REQUIRED]';
const PHASE_TYPE_PATTERNS = [
  ['mcq', /\b(?:multiple[\s-]*choice|mcq)\b/i],
  ['short-answer', /\b(?:short[\s-]*(?:answer|response))\b/i],
  ['extended-response', /\b(?:extended[\s-]*response|essay|long[\s-]*response)\b/i],
  ['practical', /\b(?:practical|investigation|performance|observation|product[\s-]*task|project[\s-]*(?:work|task))\b/i],
];

function normalizeLessonPurpose(value) {
  const purpose = String(value || '').trim().toLowerCase();
  return PURPOSES.has(purpose) ? purpose : 'lesson';
}

function phaseTypesIn(value) {
  const text = String(value || '');
  return PHASE_TYPE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
}

function phaseMarkIn(value) {
  const text = String(value || '');
  const direct = [...text.matchAll(/\b(\d{1,4})\s*(?:-\s*)?marks?\b/gi)].map(match => Number(match[1]));
  const candidates = direct.length ? direct : (/\bmarks?\b/i.test(text)
    ? (text.match(/\b\d{1,4}\b/g) || []).map(Number)
    : []);
  const unique = [...new Set(candidates.filter(mark => Number.isInteger(mark) && mark > 0 && mark <= 1000))];
  return unique.length === 1 ? unique[0] : null;
}

function completePhaseMarks(phases, totalMarks) {
  const normalized = phases.map(phase => ({ ...phase, marks: Number.isInteger(phase.marks) && phase.marks > 0 ? phase.marks : null }));
  const known = normalized.filter(phase => phase.marks != null);
  const missing = normalized.filter(phase => phase.marks == null);
  if (!known.length) return { phases: normalized, issue: '' };
  const knownTotal = known.reduce((sum, phase) => sum + phase.marks, 0);
  if (missing.length === 1) {
    const remainder = totalMarks - knownTotal;
    if (remainder < 1) return { phases: normalized, issue: `the phase marks must total ${totalMarks}` };
    missing[0].marks = remainder;
    return { phases: normalized, issue: '' };
  }
  if (missing.length > 1) {
    return { phases: normalized, issue: 'give every phase a mark allocation when more than one phase allocation is omitted' };
  }
  return knownTotal === totalMarks
    ? { phases: normalized, issue: '' }
    : { phases: normalized, issue: `the phase marks total ${knownTotal}, but the assessment total is ${totalMarks}` };
}

function explicitPhaseRequirements(input, totalMarks) {
  const raw = Array.isArray(input.assessmentPhases) ? input.assessmentPhases
    : Array.isArray(input.phaseRequirements) ? input.phaseRequirements
      : Array.isArray(input.phases) ? input.phases : null;
  if (!raw || !raw.length) return null;
  const phases = raw.map((phase, index) => {
    const type = String(phase && phase.type || '').trim().toLowerCase();
    if (!SECTION_TYPES.has(type)) return null;
    const rawMarks = phase && phase.marks;
    const marks = rawMarks == null || rawMarks === '' ? null : Number(rawMarks);
    if (marks != null && (!Number.isInteger(marks) || marks < 1 || marks > 1000)) return null;
    return {
      type,
      marks,
      title: String(phase && phase.title || '').trim().slice(0, 120),
      source: 'structured',
      index,
    };
  });
  if (phases.some(phase => !phase)) return { phases: [], issue: 'every configured assessment phase needs a supported type and positive whole-number marks' };
  return completePhaseMarks(phases, totalMarks);
}

// The optional Requirements field remains free text, so only convert it into
// enforceable structure when the teacher has named every selected phase in an
// unambiguous sequence. A phrase such as "20 multiple-choice marks, then a
// 30-mark investigation" becomes two ordered, marked phases; ordinary prose
// that happens to mention a practical activity is left untouched.
function briefPhaseRequirements(brief, totalMarks, selectedTypes) {
  const text = String(brief || '').trim();
  if (!text || !selectedTypes.length) return null;
  const segments = text.split(/\s*(?:,|;|\n|→|->|\bthen\b)\s*/i).map(value => value.trim()).filter(Boolean);
  const phases = [];
  for (const segment of segments) {
    const types = phaseTypesIn(segment);
    if (!types.length) continue;
    if (types.length !== 1) return null;
    phases.push({ type: types[0], marks: phaseMarkIn(segment), title: '', source: 'requirements' });
  }
  if (!phases.length) return null;
  const selected = new Set(selectedTypes);
  const parsed = new Set(phases.map(phase => phase.type));
  if (selected.size !== parsed.size || [...selected].some(type => !parsed.has(type)) || [...parsed].some(type => !selected.has(type))) return null;
  return completePhaseMarks(phases, totalMarks);
}

function normalizeAssessmentOptions(input = {}) {
  const total = Math.min(1000, Math.max(1, parseInt(input.assessmentTotalMarks ?? input.totalMarks, 10) || 50));
  const structure = String(input.assessmentStructure || input.structure || '').trim().toLowerCase();
  const delivery = String(input.assessmentDeliveryMode || input.deliveryMode || '').trim().toLowerCase();
  const brief = String(input.assessmentBrief || input.brief || '').trim().slice(0, 1200);
  const rawTypes = input.assessmentQuestionTypes || input.questionTypes || [];
  const suppliedTypes = Array.isArray(rawTypes) ? rawTypes : String(rawTypes).split(',');
  let questionTypes = [...new Set(suppliedTypes.map(value => String(value).trim().toLowerCase()).filter(value => SECTION_TYPES.has(value)))];
  if (!questionTypes.length) questionTypes = structure === 'knowledge' ? ['mcq', 'short-answer', 'extended-response']
    : structure === 'practical' ? ['practical'] : structure === 'mixed' ? [...SECTION_TYPES] : ['mcq', 'practical'];
  const explicit = explicitPhaseRequirements(input, total);
  const parsedBrief = explicit || briefPhaseRequirements(brief, total, questionTypes);
  const phaseRequirements = parsedBrief && parsedBrief.phases.length ? parsedBrief.phases : [];
  if (phaseRequirements.length) questionTypes = [...new Set(phaseRequirements.map(phase => phase.type))];
  let requestedMcq = parseInt(input.assessmentMcqCount ?? input.mcqCount, 10);
  const markedMcqPhases = phaseRequirements.filter(phase => phase.type === 'mcq' && Number.isInteger(phase.marks));
  if (markedMcqPhases.length && phaseRequirements.some(phase => phase.type !== 'mcq')) {
    requestedMcq = markedMcqPhases.reduce((sum, phase) => sum + phase.marks, 0);
  }
  const otherTypeMinimum = phaseRequirements.length
    ? phaseRequirements.filter(phase => phase.type !== 'mcq').length
    : questionTypes.filter(type => type !== 'mcq').length;
  const maximumMcq = Math.max(1, Math.min(50, total - otherTypeMinimum));
  const mcqCount = questionTypes.includes('mcq')
    ? Math.min(maximumMcq, Math.max(1, Number.isInteger(requestedMcq) ? requestedMcq : 15))
    : 0;
  return {
    totalMarks: total,
    structure: STRUCTURES.has(structure) ? structure : 'balanced',
    deliveryMode: delivery === 'self-paced' ? 'self-paced' : 'live',
    brief,
    questionTypes,
    mcqCount,
    phaseRequirements,
    phaseRequirementIssue: parsedBrief && parsedBrief.issue ? parsedBrief.issue : '',
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

function fallbackDraft({ subject, topic, grade, objectives, lessonPurpose, assessmentTotalMarks, assessmentStructure, assessmentDeliveryMode, assessmentBrief, assessmentQuestionTypes, assessmentMcqCount, assessmentPhases, phaseRequirements }) {
  const purpose = normalizeLessonPurpose(lessonPurpose);
  if (purpose === 'lesson') return null;
  const opts = normalizeAssessmentOptions({ assessmentTotalMarks, assessmentStructure, assessmentDeliveryMode, assessmentBrief, assessmentQuestionTypes, assessmentMcqCount, assessmentPhases: assessmentPhases || phaseRequirements });
  const objectiveList = objectiveRecords(objectives);
  const title = `${String(topic || 'Learning').replace(/-/g, ' ')} ${purpose === 'test' ? 'Test' : 'Project'}`;
  const practical = {
    title: purpose === 'test' ? 'Practical task' : 'Project task', type: 'practical',
    instructions: 'Replace every review-required criterion with observable, subject-specific evidence before publishing.',
    objectiveIndexes: objectiveList.map((_, index) => index),
    items: objectiveList.map(objective => ({
      prompt: `${REVIEW_REQUIRED_MARKER} Replace this with an observable criterion for: ${objective.text}`,
      marks: 1, options: [], correctIndex: 0, answerKey: '',
    })),
  };
  const knowledge = {
    title: 'Knowledge and understanding', type: 'short-answer',
    instructions: 'Replace every review-required question and answer key with checked, subject-specific content before publishing.',
    objectiveIndexes: objectiveList.map((_, index) => index),
    items: objectiveList.map(objective => ({
      prompt: `${REVIEW_REQUIRED_MARKER} Replace this with a question that assesses: ${objective.text}`,
      marks: 1, options: [], correctIndex: 0,
      answerKey: `${REVIEW_REQUIRED_MARKER} Add accurate marking guidance for this question.`,
    })),
  };
  const mcq = {
    title: 'Multiple choice', type: 'mcq',
    instructions: 'Replace every review-required item with a checked question and plausible answer choices before publishing.',
    objectiveIndexes: objectiveList.map((_, index) => index),
    items: Array.from({ length: Math.max(1, opts.mcqCount || Math.min(15, opts.totalMarks)) }, (_, index) => ({
      prompt: `${REVIEW_REQUIRED_MARKER} Replace item ${index + 1} with a checked question for: ${objectiveList[index % Math.max(1, objectiveList.length)]?.text || title}`,
      marks: 1,
      options: ['Option A', 'Option B', 'Option C', 'Option D'], correctIndex: 0, answerKey: '',
    })),
  };
  const byType = { mcq, 'short-answer': knowledge, 'extended-response': { ...knowledge, title: 'Extended response', type: 'extended-response' }, practical };
  const configuredPhases = opts.phaseRequirements.length ? opts.phaseRequirements : opts.questionTypes.map(type => ({ type, title: '' }));
  const sections = configuredPhases.map(phase => ({ phase, section: byType[phase.type] })).filter(entry => entry.section).map(({ phase, section }) => ({
    ...section,
    title: phase.title || section.title,
    objectiveIndexes: [...section.objectiveIndexes],
    items: section.items.map(item => ({ ...item, options: [...(item.options || [])] })),
  }));
  const mcqItems = sections.filter(section => section.type === 'mcq').flatMap(section => section.items);
  const otherItems = sections.filter(section => section.type !== 'mcq').flatMap(section => section.items);
  if (otherItems.length && mcqItems.length < opts.totalMarks) {
    const available = opts.totalMarks - mcqItems.length;
    otherItems.forEach((item, index) => { item.marks = Math.floor(available / otherItems.length) + (index < available % otherItems.length ? 1 : 0); });
  }
  return normalizeAssessmentDraft({
    title,
    instructions: `${REVIEW_REQUIRED_MARKER} Automatic question writing was unavailable. Replace every marked item with accurate, grade-appropriate content before publishing.${opts.brief ? ` Teacher requirements: ${opts.brief}` : ''}`,
    sections,
  }, {
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
    assessmentPhases: context.phaseRequirements || context.assessmentPhases || context.phases,
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
  const exactMarkedPhases = opts.phaseRequirements.length === sections.length
    && opts.phaseRequirements.every((phase, index) => phase.type === sections[index].type && Number.isInteger(phase.marks));
  if (exactMarkedPhases) {
    const mixedWithMcq = sections.some(section => section.type === 'mcq') && sections.some(section => section.type !== 'mcq');
    sections = sections.map((section, index) => ({
      ...section,
      items: section.type === 'mcq' && mixedWithMcq
        ? section.items.slice(0, opts.phaseRequirements[index].marks).map(item => ({ ...item, marks: 1 }))
        : allocateMarks(section.items, opts.phaseRequirements[index].marks),
    })).filter(section => section.items.length);
  } else {
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
  }
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
  if (opts.phaseRequirementIssue) issues.push(opts.phaseRequirementIssue);
  const selected = new Set(opts.questionTypes);
  for (const section of sections) {
    if (!selected.has(section.type)) issues.push(`unselected ${section.type} section was added`);
  }
  for (const type of opts.questionTypes) {
    if (!sections.some(section => section.type === type && Array.isArray(section.items) && section.items.length)) issues.push(`${type} section is missing`);
  }
  const expectedPhaseTypes = opts.phaseRequirements.length
    ? opts.phaseRequirements.map(phase => phase.type)
    : opts.questionTypes;
  const actualPhaseTypes = sections.map(section => section.type);
  const expectedCounts = expectedPhaseTypes.reduce((counts, type) => counts.set(type, (counts.get(type) || 0) + 1), new Map());
  const actualCounts = actualPhaseTypes.reduce((counts, type) => counts.set(type, (counts.get(type) || 0) + 1), new Map());
  for (const [type, count] of actualCounts) {
    if (count > (expectedCounts.get(type) || 0)) issues.push(`duplicate ${type} phase was added without being selected`);
  }
  if (actualPhaseTypes.join('|') !== expectedPhaseTypes.join('|')) {
    issues.push(`expected assessment phase order ${expectedPhaseTypes.join(' -> ')} but received ${actualPhaseTypes.join(' -> ') || 'none'}`);
  }
  if (opts.phaseRequirements.length) {
    opts.phaseRequirements.forEach((phase, index) => {
      if (!Number.isInteger(phase.marks) || !sections[index] || sections[index].type !== phase.type) return;
      const received = (sections[index].items || []).reduce((sum, item) => sum + (Number(item.marks) || 0), 0);
      if (received !== phase.marks) issues.push(`phase ${index + 1} (${phase.type}) must be worth ${phase.marks} marks but received ${received}`);
    });
  }
  const mcqCount = sections.filter(section => section.type === 'mcq').reduce((sum, section) => sum + (section.items || []).length, 0);
  if (opts.questionTypes.includes('mcq') && mcqCount !== opts.mcqCount) issues.push(`expected ${opts.mcqCount} multiple-choice items but received ${mcqCount}`);
  const mcqMarks = sections.filter(section => section.type === 'mcq').flatMap(section => section.items || []).map(item => Number(item.marks) || 0);
  if (opts.questionTypes.includes('mcq') && opts.questionTypes.length > 1 && mcqMarks.some(mark => mark !== 1)) issues.push('each multiple-choice item must be worth exactly 1 mark');
  const allocated = sections.reduce((sum, section) => sum + (section.items || []).reduce((itemSum, item) => itemSum + (Number(item.marks) || 0), 0), 0);
  if (allocated !== opts.totalMarks) issues.push(`expected ${opts.totalMarks} total marks but received ${allocated}`);
  issues.push(...assessmentDraftContentIssues(draft));
  return issues;
}

function normalizedContentText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isPlaceholderAssessmentText(value) {
  const text = normalizedContentText(value);
  if (!text) return false;
  return text.includes('[review required]')
    || /^(?:existing\s+)?(?:item|question|mcq)\s*\d+\s*[.:)]?$/.test(text)
    || /^(?:knowledge|multiple[- ]choice) question \d+ about\b/.test(text)
    || /^(?:item \d+\s*:\s*)?which response best demonstrates the learning goal\b/.test(text)
    || /^(?:correct answer|plausible alternative|option [a-f])$/.test(text)
    || /^an accurate response linked to\b/.test(text)
    || /^(?:a response about a different skill|an unrelated response|no response to the learning goal)$/.test(text)
    || /^a correct response demonstrates\s*:/.test(text)
    || /^accept an accurate response that demonstrates the linked objective\.?$/.test(text)
    || /^(?:tbd|todo|placeholder|insert (?:question|answer|criterion)|replace (?:this|me))\b/.test(text);
}

function assessmentDraftContentIssues(draft) {
  const sections = Array.isArray(draft && draft.sections) ? draft.sections : [];
  let placeholderItems = 0;
  let duplicateOptionItems = 0;
  let repeatedPrompts = 0;
  const seenPrompts = new Set();
  for (const section of sections) {
    for (const item of (Array.isArray(section && section.items) ? section.items : [])) {
      const prompt = normalizedContentText(item && (item.prompt || item.question));
      const answerKey = normalizedContentText(item && item.answerKey);
      const options = (Array.isArray(item && item.options) ? item.options : []).map(normalizedContentText).filter(Boolean);
      if (isPlaceholderAssessmentText(prompt)
        || isPlaceholderAssessmentText(answerKey)
        || options.some(isPlaceholderAssessmentText)) placeholderItems += 1;
      if (new Set(options).size !== options.length) duplicateOptionItems += 1;
      const comparablePrompt = prompt.replace(/^(?:item|question)\s+\d+\s*[:.)-]?\s*/, '');
      if (comparablePrompt) {
        if (seenPrompts.has(comparablePrompt)) repeatedPrompts += 1;
        else seenPrompts.add(comparablePrompt);
      }
    }
  }
  const issues = [];
  if (placeholderItems) issues.push(`${placeholderItems} assessment item${placeholderItems === 1 ? '' : 's'} contain placeholder or generic content`);
  if (duplicateOptionItems) issues.push(`${duplicateOptionItems} multiple-choice item${duplicateOptionItems === 1 ? '' : 's'} contain duplicate answer options`);
  if (repeatedPrompts) issues.push(`${repeatedPrompts} assessment item${repeatedPrompts === 1 ? '' : 's'} repeat the same question wording`);
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
  const configuredPhases = opts.phaseRequirements.length
    ? opts.phaseRequirements
    : opts.questionTypes.map(type => ({ type, marks: null }));
  const typeRule = configuredPhases.map(phase => typeNames[phase.type]).join(', ');
  const otherTypes = opts.questionTypes.filter(type => type !== 'mcq');
  const mcqMarks = opts.questionTypes.includes('mcq') && otherTypes.length ? opts.mcqCount : null;
  const remainingMarks = mcqMarks == null ? null : opts.totalMarks - mcqMarks;
  const deliveryFlow = configuredPhases.map((phase, index) => {
    const type = phase.type;
    const marks = Number.isInteger(phase.marks) ? ` (${phase.marks} marks)` : '';
    if (type === 'mcq') return `Phase ${index + 1}: students complete ${opts.mcqCount} multiple-choice questions independently in LessonScope${marks || (mcqMarks == null ? '' : ` (${mcqMarks} marks)`)}; the teacher opens and supervises the section but does not display, read aloud, explain or answer the questions.`;
    if (type === 'practical') return `Phase ${index + 1}: students complete the practical, performance or product task while the teacher observes and records evidence${marks || (remainingMarks != null && otherTypes.length === 1 ? ` (${remainingMarks} marks)` : '')}.`;
    if (type === 'short-answer') return `Phase ${index + 1}: students complete the short-answer section independently in LessonScope${marks}.`;
    return `Phase ${index + 1}: students complete the extended-response section independently in LessonScope${marks}.`;
  }).join('\n');
  const markedFlow = configuredPhases.every(phase => Number.isInteger(phase.marks))
    ? `Return exactly one section for each phase and preserve these exact allocations: ${configuredPhases.map((phase, index) => `Phase ${index + 1} ${typeNames[phase.type]} = ${phase.marks} marks`).join('; ')}.`
    : 'Return exactly one section for each selected phase in the stated order.';
  return `\nAUTOMATIC ${purpose.toUpperCase()} DRAFT:
Also return assessmentDraft. It is an editable draft for the teacher, never a published assessment.
Create a subject-neutral ${purpose} worth exactly ${opts.totalMarks} marks, structured as ${structureText}.
Use these teacher-selected phases in this exact order: ${typeRule}. Do not add, remove, merge, split or reorder phases. ${markedFlow}
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
  const configuredPhases = opts.phaseRequirements.length
    ? opts.phaseRequirements
    : opts.questionTypes.map(type => ({ type, marks: null }));
  const selectedTypes = configuredPhases.map((phase, index) => `Phase ${index + 1}: ${typeNames[phase.type]}${Number.isInteger(phase.marks) ? ` (${phase.marks} marks)` : ''}`).join('; ');
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
- Required sections, in this exact order: ${selectedTypes}
- Delivery: ${opts.deliveryMode === 'live' ? 'live in the classroom under teacher control' : 'self-paced'}
${opts.questionTypes.includes('mcq') ? `- Multiple choice: exactly ${opts.mcqCount} different questions; do not return ${opts.mcqCount - 1} or any other number` : '- Do not create multiple-choice questions'}
${opts.brief ? `- Teacher requirements: ${opts.brief}` : ''}

Use every selected section type and no unselected type. Return exactly one section for every required phase. Do not add, remove, merge, split or reorder phases. ${mcqAllocation}
Make every question accurate, unambiguous, different from the others, appropriate for the stated grade, and directly connected to the objectives or source material. Multiple-choice items need 2-6 plausible options and one correct zero-based correctIndex. Written items need concise answerKey marking guidance. Practical items must describe observable evidence; leave their options and answerKey empty. Use zero-based objectiveIndexes. Every item must have positive whole-number marks, and all marks together must total exactly ${opts.totalMarks}.
${purpose === 'test'
    ? 'The test must be suitable for independent work and must not reveal answers or hints in student-facing wording.'
    : 'The project must assess meaningful stages of the process and the completed outcome while keeping marking guidance private.'}
${source ? `\nRelevant source material:\n${source.slice(0, 5000)}` : ''}`;
}

module.exports = {
  ASSESSMENT_DRAFT_SCHEMA, normalizeLessonPurpose, normalizeAssessmentOptions,
  REVIEW_REQUIRED_MARKER, normalizeAssessmentDraft, assessmentDraftIssues, assessmentDraftContentIssues,
  fallbackDraft, assessmentPromptBlock, assessmentOnlyPrompt,
};
