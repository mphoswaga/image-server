const { normalizeAssessmentOptions } = require('./assessment-draft');
function objectiveAssessmentContext(body = {}) {
  const subject = String(body.subject || '').trim().slice(0, 100);
  const grade = String(body.grade || '').trim().slice(0, 60);
  const objectives = String(body.objectives || '').trim().slice(0, 12000);
  const lessonPurpose = body.kind;
  const totalMarks = Number(body.totalMarks);
  if (!subject || !grade || !objectives) throw new Error('Enter the subject, grade and learning objectives.');
  if (!['test', 'project'].includes(lessonPurpose)) throw new Error('Choose Test or Project to generate an assessment.');
  if (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000) throw new Error('Enter a total from 1 to 1000 whole marks.');
  const options = normalizeAssessmentOptions({ totalMarks, deliveryMode: body.deliveryMode,
    questionTypes: lessonPurpose === 'project' ? ['practical'] : ['short-answer'],
    brief: String(body.brief || '').slice(0, 1200) });
  return { subject, grade, objectives, lessonPurpose,
    topic: String(body.title || '').trim().slice(0, 160) || `${subject} ${lessonPurpose}`, ...options };
}
async function generateObjectiveAssessment(body, { client, generate } = {}) {
  const context = objectiveAssessmentContext(body);
  const draft = await (generate || require('./lesson-plan').repairAssessmentDraft)(
    client || require('./ai-client').client(), null, context, context);
  return draft;
}
module.exports = { objectiveAssessmentContext, generateObjectiveAssessment };
