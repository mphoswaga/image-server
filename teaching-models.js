// Shared teaching-model catalogue. The model id is part of the lesson
// contract so plans, decks, packs, caches, and regenerations stay aligned.

const MODELS = {
  standard: {
    id: 'standard',
    label: 'Standard lesson',
    description: 'A flexible lesson flow that works well for most topics and school templates.',
    whenToUse: 'Use this when you want a dependable, adaptable lesson structure.',
    stages: [
      { id: 'launch', label: 'Launch', purpose: 'Connect to prior knowledge and introduce the lesson.' },
      { id: 'teach', label: 'Teach', purpose: 'Explain and model the new idea clearly.' },
      { id: 'practice', label: 'Practice', purpose: 'Give students guided and independent practice.' },
      { id: 'check', label: 'Check', purpose: 'Check understanding and address misconceptions.' },
      { id: 'reflect', label: 'Reflect', purpose: 'Recap the learning and connect it forward.' },
    ],
  },
  gradual_release: {
    id: 'gradual_release',
    label: 'Gradual Release',
    description: 'Moves responsibility from teacher modelling to confident independent work.',
    whenToUse: 'Especially useful for new skills, procedures, reading, writing, and worked examples.',
    stages: [
      { id: 'i_do', label: 'I Do', purpose: 'The teacher explains and models the skill while thinking aloud.' },
      { id: 'we_do', label: 'We Do', purpose: 'Teacher and class solve or practise an example together.' },
      { id: 'you_do_together', label: 'You Do Together', purpose: 'Pairs or groups practise with structured support.' },
      { id: 'you_do_alone', label: 'You Do Alone', purpose: 'Students independently demonstrate the skill.' },
      { id: 'reflect', label: 'Exit and Reflect', purpose: 'Students show what they can now do and reflect on the learning.' },
    ],
  },
  explicit_instruction: {
    id: 'explicit_instruction',
    label: 'Explicit Instruction',
    description: 'Uses clear explanations, modelling, frequent checks, and carefully guided practice.',
    whenToUse: 'Useful when accuracy, clarity, vocabulary, or a step-by-step method matters most.',
    stages: [
      { id: 'review', label: 'Review', purpose: 'Retrieve prerequisite knowledge and state the objective.' },
      { id: 'explain', label: 'Explain', purpose: 'Teach the new concept in small, clear steps.' },
      { id: 'model', label: 'Model', purpose: 'Demonstrate the exact process and make thinking visible.' },
      { id: 'guided_practice', label: 'Guided Practice', purpose: 'Practise with prompts, feedback, and frequent checks.' },
      { id: 'independent_practice', label: 'Independent Practice', purpose: 'Students complete a similar task independently.' },
      { id: 'check', label: 'Check and Close', purpose: 'Confirm mastery and correct remaining errors.' },
    ],
  },
  five_e: {
    id: 'five_e',
    label: '5E Inquiry',
    description: 'Builds understanding through Engage, Explore, Explain, Elaborate, and Evaluate.',
    whenToUse: 'A strong choice for science, discovery, investigation, and concept-building lessons.',
    stages: [
      { id: 'engage', label: 'Engage', purpose: 'Spark curiosity and surface existing ideas.' },
      { id: 'explore', label: 'Explore', purpose: 'Let students investigate before formal explanation.' },
      { id: 'explain', label: 'Explain', purpose: 'Name and clarify the concept using evidence from the exploration.' },
      { id: 'elaborate', label: 'Elaborate', purpose: 'Apply the idea in a new or more demanding context.' },
      { id: 'evaluate', label: 'Evaluate', purpose: 'Gather evidence of understanding and reflect on learning.' },
    ],
  },
  inquiry: {
    id: 'inquiry',
    label: 'Inquiry-Based',
    description: 'Organises the lesson around a meaningful question, evidence, and student explanation.',
    whenToUse: 'Useful when students should investigate, reason, discuss, and support conclusions with evidence.',
    stages: [
      { id: 'question', label: 'Question', purpose: 'Present a worthwhile question or problem to investigate.' },
      { id: 'predict', label: 'Predict', purpose: 'Students make a prediction and explain their starting thinking.' },
      { id: 'investigate', label: 'Investigate', purpose: 'Students gather, test, sort, or analyse evidence.' },
      { id: 'explain', label: 'Explain with Evidence', purpose: 'Students form and defend an explanation.' },
      { id: 'reflect', label: 'Reflect and Apply', purpose: 'Students revise their thinking and apply the idea elsewhere.' },
    ],
  },
  project_based: {
    id: 'project_based',
    label: 'Project-Based Lesson',
    description: 'Uses a driving question and a real product, performance, or audience within one lesson.',
    whenToUse: 'Choose this for a project session, design challenge, research task, or collaborative product.',
    stages: [
      { id: 'driving_question', label: 'Driving Question', purpose: 'Introduce the authentic problem and success criteria.' },
      { id: 'mini_lesson', label: 'Mini-Lesson', purpose: 'Teach the knowledge or skill students need next.' },
      { id: 'plan', label: 'Plan', purpose: 'Students plan roles, resources, steps, and a workable product.' },
      { id: 'create', label: 'Create and Revise', purpose: 'Students make, test, receive feedback, and improve.' },
      { id: 'share_reflect', label: 'Share and Reflect', purpose: 'Students present evidence of learning and evaluate the process.' },
    ],
  },
};

const DEFAULT_MODEL_ID = 'standard';

function getTeachingModel(id) {
  return MODELS[String(id || '').trim()] || MODELS[DEFAULT_MODEL_ID];
}

function normalizeTeachingModelId(id) {
  return getTeachingModel(id).id;
}

function listTeachingModels() {
  return Object.values(MODELS).map(model => ({
    id: model.id,
    label: model.label,
    description: model.description,
    whenToUse: model.whenToUse,
    stages: model.stages,
  }));
}

function modelPromptBlock(modelOrId) {
  const model = typeof modelOrId === 'string' ? getTeachingModel(modelOrId) : (modelOrId || getTeachingModel());
  const stages = model.stages.map((stage, index) => `${index + 1}. ${stage.label} — ${stage.purpose}`).join('\n');
  return `Teaching model: ${model.label}\nPurpose: ${model.description}\nUse this sequence and keep it visible in the lesson flow:\n${stages}`;
}

function artifactPromptBlock(modelOrId, artifact) {
  const model = typeof modelOrId === 'string' ? getTeachingModel(modelOrId) : (modelOrId || getTeachingModel());
  const guidance = {
    standard: 'Use a balanced mix of recall, explanation, practice, application, and a short check for understanding.',
    gradual_release: 'Move the student material from a worked teacher example, to guided practice, to supported pair practice where suitable, then to independent work. Finish with a brief reflection or exit check.',
    explicit_instruction: 'Use retrieval first, then a clear worked example, carefully scaffolded guided practice, independent practice, and a final error-check or mastery check.',
    five_e: 'Make the material follow Engage, Explore, Explain, Elaborate, and Evaluate. Include opportunities for observation or evidence before asking students to explain the concept.',
    inquiry: 'Anchor the material in a meaningful question. Ask students to predict, use or analyse evidence, explain their reasoning, and reflect or apply the idea in a new context.',
    project_based: 'Connect the material to the driving question and the product or performance. Include planning criteria, making or revising decisions, feedback, and reflection on the final work.',
  }[model.id] || '';
  return `Align this ${artifact} with the selected ${model.label} structure. ${guidance}`;
}

// Assigns content-slide positions to model stages deterministically. Every
// stage is represented when there are enough content slides; with fewer slides
// the schedule samples the model from beginning to end without reordering it.
function stageSchedule(modelOrId, count) {
  const model = typeof modelOrId === 'string' ? getTeachingModel(modelOrId) : (modelOrId || getTeachingModel());
  const n = Math.max(0, Number.parseInt(count, 10) || 0);
  if (!n || !model.stages.length) return [];
  if (n <= model.stages.length) return model.stages.slice(0, n).map(stage => stage.id);
  return Array.from({ length: n }, (_, index) => {
    const stageIndex = Math.round(index * (model.stages.length - 1) / Math.max(n - 1, 1));
    return model.stages[Math.min(stageIndex, model.stages.length - 1)].id;
  });
}

function stageLabel(modelOrId, stageId) {
  const model = typeof modelOrId === 'string' ? getTeachingModel(modelOrId) : (modelOrId || getTeachingModel());
  return model.stages.find(stage => stage.id === stageId)?.label || stageId;
}

module.exports = { DEFAULT_MODEL_ID, getTeachingModel, normalizeTeachingModelId, listTeachingModels, modelPromptBlock, artifactPromptBlock, stageSchedule, stageLabel };
