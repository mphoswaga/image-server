// AI-assisted grading for free-text answers against a teacher-provided answer
// key. Only ever called on a genuine cache miss — assignments.js's verdict
// cache skips this once a teacher has confirmed how a given answer (or an
// exact rephrasing of it) should be graded for that question.
const { client: aiClient } = require('./ai-client');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['correct', 'partial', 'incorrect'] },
    marksAwarded: { type: 'integer' },
    rationale: { type: 'string' },
  },
  required: ['verdict', 'marksAwarded', 'rationale'],
  additionalProperties: false,
};

async function gradeAnswer({ question, answerKey, studentAnswer, maxMarks, grade }) {
  const max = Math.max(1, parseInt(maxMarks, 10) || 1);
  if (!process.env.OPENAI_API_KEY) {
    // No key: fall back to an exact-ish match rather than blocking grading.
    const norm = s => String(s || '').toLowerCase().trim();
    const correct = !!norm(studentAnswer) && norm(studentAnswer) === norm(answerKey);
    return { verdict: correct ? 'correct' : 'incorrect', marksAwarded: correct ? max : 0, rationale: 'Automatic exact-match check (set OPENAI_API_KEY for AI grading).' };
  }
  if (!String(studentAnswer || '').trim()) {
    return { verdict: 'incorrect', marksAwarded: 0, rationale: 'No answer was given.' };
  }
  const client = aiClient();
  const prompt = `You are grading one short-answer question for a ${grade || 'school'} student.

Question: ${question}
Teacher's expected answer / marking guide: ${answerKey}
Maximum marks available: ${max}
Student's answer: ${studentAnswer}

Judge the student's answer on MEANING, not exact wording — a correct answer phrased differently is still correct. Award "correct" (full marks) if it captures the key idea(s) in the marking guide; "partial" (some but not all marks) if it's on the right track but missing something material; "incorrect" (0 marks) if it's wrong, off-topic, or doesn't address the question. marksAwarded must be an integer between 0 and ${max}. Give a one-sentence rationale a teacher could show the student explaining the verdict — specific to what THIS answer did or didn't cover, not a generic statement.`;
  const res = await client.chat.completions.create({
    model: MODEL, max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_schema', json_schema: { name: 'grade_answer', strict: true, schema: VERDICT_SCHEMA } },
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error('No content returned from the model');
  const out = JSON.parse(text);
  out.marksAwarded = Math.max(0, Math.min(max, Math.round(out.marksAwarded)));
  return out;
}

module.exports = { gradeAnswer };
