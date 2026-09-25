// Practical planning guidance distilled from the school's September 2026 CPD
// and observation rubric. This is a planning aid, not an observation score.
// Keep it independent of template fields and out of assessed-content teaching.
const OBSERVATION_GUIDANCE_VERSION = 1;

function observationPromptBlock(purpose = 'lesson') {
  const common = `
OBSERVABLE LEARNING AND SAFE PLANNING:
Use the supplied objectives, subject, age, teaching model, resources and class context. Preserve the school's headings, their order and supplied success criteria. Integrate practical actions into existing fields; do not append an observation checklist, component scores or a new prescribed lesson format.
Plan opportunities for student learning, never claim that students have already achieved them or that an observation rating is guaranteed. Do not invent learner identities, diagnoses, attainment, prior results, classroom facilities or school policies. Where context is missing, propose conditional support and identify resources the teacher must prepare.
Make timing feasible within the requested period, including transitions and checks. Adapt the amount of activity to the time rather than packing in every strategy. In a sequence, apply this guidance within each period, building on previous learning.
Plan respectful participation, a brief task-relevant behaviour expectation, efficient materials/grouping/transition routines and safe accessible use of space. Offer age-appropriate student responsibility rather than requiring the teacher to manage every action. Do not assume technology is available; when it is needed, include a practical alternative if it fails.
Leave the teacher's Reflection/post-lesson reflection field blank. Never fabricate completed reflection or observation evidence. The planned assessment evidence should help the teacher later identify what worked, who needs support and what to change.
`;
  if (purpose !== 'lesson') return common + `
ASSESSMENT INTEGRITY TAKES PRIORITY:
For this ${purpose} session, retain independent assessed work, approved access arrangements, clear procedures, observable student products and collection/recording of evidence. Student responsibility must stay within permitted assessment conditions. Do not introduce peer discussion, answer checking, hints, modelling or reteaching of assessed content to satisfy observation guidance. Any feedback or future teaching based on results belongs after the assessment, subject to its conditions.
`;
  return common + `
WRITE CLASSROOM-READY LESSON STEPS:
Purpose and coherence: connect the opening to relevant prior knowledge using a concrete diagnostic task. Explain what students will learn and why in child-friendly language; have them explain or demonstrate what success means. Revisit the supplied success criteria during practice and at the close, not only at the start.
Thinking and dialogue: include a small number of exact, subject-specific questions requiring explanation, comparison, prediction or justification, with plausible expected reasoning and a likely misconception. Allow thinking time before inviting responses. Plan an equitable way for all students to respond, then a purposeful peer exchange where students explain, question or build on an idea. Supply an age-appropriate language stem where useful. Participation is an opportunity, not a claim that everyone will speak or understand.
Meaningful task: specify what students actually solve, create, investigate or explain, the materials/example, the observable product and how it demonstrates the objective. Give enough instructions for another teacher to run it. Games must elicit reasoning and learning evidence rather than reward only speed or clicks. Offer relevant choice or deeper challenge without adding unrelated busywork.
Assessment and response: plan checks during learning and at the end, each tied to a success criterion. For a key checkpoint give the exact question/task, the response or work to look for, how evidence is gathered from all learners, and a specific if/then response. If a misconception appears, state the alternative explanation/example or scaffold to use and a new short check to see whether it helped. If students are ready, give a connected extension. Replace part of the planned practice when reteaching is needed so timing still works. 'Circulate', 'check understanding' and 'support as needed' alone are insufficient.
Access and challenge: base adaptations on supplied learner needs and strengths. If these are unknown, phrase options conditionally: for learners who need language support, a concrete visual/vocabulary/rehearsal scaffold; for learners ready for more, a reasoning or transfer challenge. Keep the same learning goal and high expectations. Allow suitable spoken, drawn, practical or written ways to demonstrate understanding when the objective permits; do not label groups by fixed ability.
Feedback and ownership: plan one manageable opportunity for students to check work against a specific criterion, identify a gap, request or give constructive feedback and make an improvement. Describe the revision they make, not just 'self-assess'. Include a closing independent demonstration or exit response that informs the next lesson. Plan student help-seeking and self-regulation without assuming these routines already exist.
FINAL INTERNAL REVIEW BEFORE RETURNING THE PLAN:
Check that the steps contain concrete student thinking, a usable question with expected reasoning, an all-learner check with a specific responsive action, feasible support/challenge, and a student self-check followed by improvement. Resolve omissions in the relevant existing sections. Verify content accuracy, objective alignment, age suitability and realistic total time. Do not print this review or add rubric labels to the plan. Quality comes from coherent student learning, not from forcing all thirteen rubric components into every activity.
`;
}

const evidenceFields = ['sectionHeading', 'question', 'expectedReasoning', 'allLearnerCheck', 'ifThenResponse', 'recheck', 'studentReview'];
const evidenceDescriptions = {
  sectionHeading: 'Exact existing teaching or practice heading for this checkpoint.',
  question: 'Exact age-appropriate question requiring reasoning, not just recall.',
  expectedReasoning: 'A concrete correct explanation linked to the objective and the likely misconception to notice.',
  allLearnerCheck: 'An individual visible response from EVERY learner and how the teacher scans or records it simultaneously. Observing engagement, volunteers or a few partners is insufficient. Avoid serial whole-class presentations that cannot fit the allocated time.',
  ifThenResponse: 'If the specified misconception appears, give a concrete alternative example or scaffold; if secure, give a transfer challenge. Replace practice time rather than extending the lesson.',
  recheck: 'A specific different question or task to verify whether the adjustment helped, including expected evidence.',
  studentReview: 'Students themselves compare work already produced in this same activity with a named success criterion, identify a gap and make a specific revision. Not the teacher checking for them; do not refer to work they will only do in a later phase.',
};
function teachingEvidenceSchema() {
  return { type: 'array', items: { type: 'object', additionalProperties: false,
    properties: { lesson: { type: 'integer' }, ...Object.fromEntries(evidenceFields.map(key => [key, { type: 'string', description: evidenceDescriptions[key] }])),
      timings: { type: 'array', description: 'Allocate the full lesson duration once across existing activity headings, including checkpoint, transitions and closing. No time for metadata or reflection fields.', items: {
        type: 'object', additionalProperties: false, properties: { sectionHeading: { type: 'string' }, minutes: { type: 'integer' } }, required: ['sectionHeading', 'minutes'],
      } },
    },
    required: ['lesson', ...evidenceFields, 'timings'],
  } };
}

function integrateTeachingEvidence(plan, { periodMinutes = null } = {}) {
  const sections = (plan.sections || []).map(section => ({ ...section }));
  const evidence = plan.teachingEvidence;
  const periods = new Set(sections.map(section => section.lesson || 1));
  const seen = new Set();
  const issues = [];
  if (!Array.isArray(evidence)) return { plan, issues: ['Supply teachingEvidence for every lesson, as required by the response schema.'] };
  for (const item of evidence) {
    if (!item || typeof item !== 'object') {
      issues.push('Every teachingEvidence checkpoint must be a complete object.');
      continue;
    }
    const period = item.lesson;
    const index = sections.findIndex(section => (section.lesson || 1) === period && section.heading === item.sectionHeading);
    if (!periods.has(period) || seen.has(period) || index < 0
      || /reflection|resources|objectives|overview|phonics/i.test(item.sectionHeading)
      || evidenceFields.some(key => !String(item[key] || '').trim())) {
      issues.push('Each lesson needs one complete teachingEvidence checkpoint targeting an existing teaching or practice heading, never a reflection or administrative field.');
      continue;
    }
    seen.add(period);
    const timed = new Set();
    let total = 0;
    for (const timing of Array.isArray(item.timings) ? item.timings : []) {
      if (!timing || typeof timing !== 'object') {
        issues.push('Each activity timing must identify its heading and minutes.');
        continue;
      }
      const target = sections.findIndex(section => (section.lesson || 1) === period && section.heading === timing.sectionHeading);
      if (target < 0 || timed.has(target) || !Number.isInteger(timing.minutes) || timing.minutes < 1 || timing.minutes > 180
        || /reflection|resources|objectives|overview|phonics/i.test(timing.sectionHeading)) {
        issues.push('Allocate positive minutes once per existing activity heading, excluding administrative fields.');
        continue;
      }
      timed.add(target);
      total += timing.minutes;
      sections[target].content = `Time: ${timing.minutes} minutes (including transitions and learning checks).\n${sections[target].content}`;
    }
    if (!total || (periodMinutes && total !== periodMinutes)) issues.push(`Lesson ${period} activity timings must total ${periodMinutes || 'the planned lesson duration'} minutes.`);
    if (!timed.has(index)) issues.push('Allocate time to the activity containing the learning checkpoint.');
    sections[index].content = [sections[index].content,
      `Learning checkpoint: ${item.question}`,
      `Look for: ${item.expectedReasoning}`,
      `Check every learner: ${item.allLearnerCheck}`,
      `Respond to evidence: ${item.ifThenResponse}`,
      `Check again: ${item.recheck}`,
      `Student self-check and improvement: ${item.studentReview}`,
    ].filter(Boolean).join('\n');
  }
  if ([...periods].some(period => !seen.has(period))) issues.push('Provide one complete teachingEvidence checkpoint for each lesson in the sequence.');
  const { teachingEvidence, ...rest } = plan;
  return { plan: { ...rest, sections }, issues };
}

module.exports = { observationPromptBlock, teachingEvidenceSchema, integrateTeachingEvidence, OBSERVATION_GUIDANCE_VERSION };
