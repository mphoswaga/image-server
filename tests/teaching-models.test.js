const test = require('node:test');
const assert = require('node:assert/strict');
const { listTeachingModels, getTeachingModel, normalizeTeachingModelId, artifactPromptBlock, stageSchedule } = require('../teaching-models');
const { generateLessonPlan, planToText } = require('../lesson-plan');
const { generateContent } = require('../content');

test('teaching model catalogue has stable ids and ordered stages', () => {
  const models = listTeachingModels();
  assert.equal(models.length, 6);
  for (const model of models) {
    assert.equal(normalizeTeachingModelId(model.id), model.id);
    assert.ok(model.stages.length >= 5);
    assert.ok(model.stages.every(stage => stage.id && stage.label && stage.purpose));
  }
});

test('lesson plan fallback carries model stages into deck context text', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const plan = await generateLessonPlan({
      subject: 'science',
      topic: 'water cycle',
      grade: 'Grade 5',
      tone: 'clear and engaging',
      objectives: 'Explain the stages of the water cycle.',
      teachingModel: 'gradual_release',
    });

    assert.equal(plan.teachingModelId, 'gradual_release');
    assert.deepEqual(plan.sections.map(section => section.stageId), [
      'i_do', 'we_do', 'you_do_together', 'you_do_alone', 'reflect',
    ]);
    assert.match(planToText(plan), /\[stage: i_do\]/);
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('unknown teaching models safely use Standard', () => {
  assert.equal(getTeachingModel('does-not-exist').id, 'standard');
  assert.equal(normalizeTeachingModelId('does-not-exist'), 'standard');
});

test('stage schedules preserve model order at different slide counts', () => {
  assert.deepEqual(stageSchedule('gradual_release', 5), [
    'i_do', 'we_do', 'you_do_together', 'you_do_alone', 'reflect',
  ]);
  assert.deepEqual(stageSchedule('five_e', 3), ['engage', 'explore', 'explain']);
  assert.deepEqual(stageSchedule('explicit_instruction', 8), [
    'review', 'explain', 'explain', 'model', 'guided_practice', 'independent_practice', 'independent_practice', 'check',
  ]);
});

test('student artifacts receive model-specific alignment guidance', () => {
  assert.match(artifactPromptBlock('gradual_release', 'worksheet'), /worked teacher example/i);
  assert.match(artifactPromptBlock('five_e', 'quiz'), /Engage, Explore, Explain, Elaborate, and Evaluate/);
  assert.match(artifactPromptBlock('project_based', 'revision game'), /driving question/i);
});

test('Standard fallback keeps the existing familiar plan headings', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const plan = await generateLessonPlan({ subject: 'maths', topic: 'fractions', objectives: 'Compare fractions.' });
    assert.deepEqual(plan.sections.map(section => section.heading), [
      'Lesson Overview', 'Learning Objectives', 'Starter', 'Main Teaching', 'Activity', 'Plenary / Exit Card',
    ]);
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('deck fallback follows the selected model stages', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const slides = await generateContent('science', 'water cycle', 5, 'Grade 5', 'clear and engaging', '', { teachingModelId: 'five_e' });
    assert.deepEqual(slides.filter(slide => slide.type === 'content').map(slide => slide.modelStage), [
      'engage', 'explore', 'explain', 'elaborate', 'evaluate',
    ]);
    assert.equal(slides.find(slide => slide.type === 'activity').modelStage, 'elaborate');
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('every teaching model keeps its plan and deck stages aligned', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    for (const model of listTeachingModels()) {
      const plan = await generateLessonPlan({
        subject: 'science',
        topic: 'the water cycle',
        grade: 'Grade 5',
        objectives: 'Explain evaporation, condensation, precipitation, and collection.',
        teachingModel: model.id,
      });
      const deck = await generateContent(
        'science',
        'the water cycle',
        5,
        'Grade 5',
        'clear and engaging',
        '',
        { teachingModelId: model.id },
      );
      const planStages = plan.sections.map(section => section.stageId);
      const deckStages = deck.filter(slide => slide.type === 'content').map(slide => slide.modelStage);

      assert.equal(plan.teachingModelId, model.id);
      assert.equal(deckStages.length, 5);
      assert.ok(deckStages.every(stageId => model.stages.some(stage => stage.id === stageId)));
      assert.ok(planStages.every(stageId => model.stages.some(stage => stage.id === stageId)));
    }
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
