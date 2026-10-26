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
  const format = body.format || 'auto';
  if (!['auto', 'mixed', 'mcq', 'practical'].includes(format)) throw new Error('Choose a supported question format.');
  let questionTypes = lessonPurpose === 'project' ? ['practical'] : ['short-answer'];
  let phases, mcqCount, practicalCount;
  if (format !== 'auto') {
    questionTypes = format === 'mixed' ? ['mcq', 'practical'] : [format];
    phases = [];
    if (questionTypes.includes('mcq')) {
      mcqCount = Number(body.mcqCount);
      if (!Number.isInteger(mcqCount) || mcqCount < 1 || mcqCount > 50) throw new Error('Choose 1 to 50 multiple-choice questions (1 mark each).');
      phases.push({ type: 'mcq', marks: mcqCount });
    }
    if (questionTypes.includes('practical')) {
      practicalCount = Number(body.practicalCount);
      const marks = Number(body.practicalMarks);
      if (!Number.isInteger(marks) || marks < 1 || marks > 1000) throw new Error('Enter positive whole marks for the practical section.');
      if (!Number.isInteger(practicalCount) || practicalCount < 1 || practicalCount > 50 || practicalCount > marks) throw new Error('Choose 1 to 50 practical tasks, with at least 1 mark per task.');
      phases.push({ type: 'practical', marks });
    }
    if (phases.reduce((sum, phase) => sum + phase.marks, 0) !== totalMarks) throw new Error('Multiple-choice and practical marks must add up to the total marks.');
  }
  const options = normalizeAssessmentOptions({ totalMarks, deliveryMode: body.deliveryMode,
    questionTypes, assessmentPhases: phases, mcqCount, practicalCount,
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
