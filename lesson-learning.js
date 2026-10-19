'use strict';

function cleanOutcome(value) {
  return typeof value === 'string' ? value.trim().slice(0, 600) : '';
}
function periodIntent(input = {}) {
  if (input.lessonPurpose && input.lessonPurpose !== 'lesson') return 'teach';
  const index = Math.max(0, Math.min(4, (Number(input.sequenceLessonNumber) || 1) - 1));
  const enabled = [true, 'true', 'on'].includes(input.sequenceEnabled);
  return enabled && input.sequenceLessonPurposes?.[index] === 'reflect' ? 'reflect' : 'teach';
}
function outcomePrompt() {
  return 'Write learningOutcome as one concise, student-friendly sentence beginning "By the end of this lesson, you will be able to". Derive the intended assessable result from the supplied learning objectives AND the content taught in this period; success criteria are evidence of that result, not a replacement for objectives. Explain the topic through what learners will demonstrate. Use observable verbs such as identify, explain, choose, create or compare; avoid merely "understand" or "learn about". Do not add untaught skills, curriculum codes, answers to assessment questions, or a list of success criteria. Aim for 25–50 words.';
}
function addOutcomeSlide(slides, value, purpose = 'lesson') {
  const outcome = cleanOutcome(value);
  if (!outcome || !Array.isArray(slides)) return slides;
  const result = slides.filter(s => s.title !== 'Lesson outcome');
  const starter = result.findIndex(s => /starter|warm.?up|retriev|hook/i.test(s.title || '') || s.alignment?.kind === 'intro' || /^(starter|engage|activate|hook|intro)$/.test(s.modelStage || ''));
  const firstContent = result.findIndex(s => s.type === 'content');
  // Legacy decks without an identifiable starter use their first teaching slide.
  const after = starter >= 0 ? starter : firstContent >= 0 ? firstContent : Math.max(0, result.findIndex(s => s.type === 'title'));
  result.splice(after + 1, 0, { type: 'objectives', title: 'Lesson outcome', bullets: [outcome], imageQuery: '', modelStage: 'outcome', assessmentProtected: purpose === 'test', speakerNotes: 'Share this intended learning outcome as part of the starter time. Success criteria provide the observable evidence; this statement does not reveal assessment answers.' });
  return result;
}
module.exports = { cleanOutcome, periodIntent, outcomePrompt, addOutcomeSlide };

function reflectionSchema(count) {
  return { type:'array', minItems:count, maxItems:count, items:{ type:'object', additionalProperties:false, properties:{
    question:{type:'string'}, options:{type:'array',minItems:3,maxItems:4,items:{type:'string'}}, correctIndex:{type:'integer'}, explanation:{type:'string'}, objective:{type:'string'},
  }, required:['question','options','correctIndex','explanation','objective'] } };
}
function reflectionIssues(items, count) {
  if (!Array.isArray(items) || items.length !== count) return [`Provide exactly ${count} reflection-check questions.`];
  return items.flatMap((item,i) => !cleanOutcome(item?.question) || !cleanOutcome(item?.explanation) || !cleanOutcome(item?.objective) || !Array.isArray(item.options) || item.options.length < 3 || item.options.length > 4 || item.options.some(x=>typeof x !== 'string' || !x.trim()) || new Set(item.options.map(x=>x.trim().toLowerCase())).size !== item.options.length || !Number.isInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= item.options.length ? [`Reflection question ${i+1} needs distinct options, one valid answer, an explanation and objective link.`] : []);
}
function includeReflectionQuestions(plan) {
  const sections = (plan.sections || []).map(s=>({...s}));
  const target = sections.find(s => /main|activit|teaching|practice/i.test(s.heading) && !/resource|objective|criteria|reflection/i.test(s.heading));
  if (!target) return { plan, issues:['Use an existing main teaching/activity section for the independent reflection check.'] };
  const items = plan.reflectionCheck;
  target.content += '\n\nIndependent multiple-choice check — answer before discussion:\n' + items.map((q,i)=>`${i+1}. ${q.question}\n${q.options.map((v,j)=>String.fromCharCode(65+j)+'. '+v).join('\n')}`).join('\n\n');
  target.content += '\n\nTeacher answer key — reveal only after initial answers are submitted:\n' + items.map((q,i)=>`${i+1}. ${q.options[q.correctIndex]} — ${q.explanation} (Objective: ${q.objective})`).join('\n');
  return {plan:{...plan,sections},issues:[]};
}
Object.assign(module.exports,{reflectionSchema,reflectionIssues,includeReflectionQuestions});
