// Deterministic checks for objective arithmetic questions used by lesson games.
// AI-written questions still need teacher review, but calculations that can be
// solved unambiguously must never depend on the model's answer index.

const NUMBER_SOURCE = '-?\\d[\\d,]*(?:\\.\\d+)?';

function parseNumber(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^-?\d[\d,]*(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function roundingPlace(value) {
  const key = String(value || '').toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim();
  return {
    '0.01': 0.01,
    hundredth: 0.01,
    '0.1': 0.1,
    tenth: 0.1,
    '1': 1,
    one: 1,
    integer: 1,
    'whole number': 1,
    '10': 10,
    ten: 10,
    '100': 100,
    hundred: 100,
    '1000': 1000,
    thousand: 1000,
  }[key] || null;
}

function rounded(value, place) {
  const sign = value < 0 ? -1 : 1;
  const result = sign * Math.floor(Math.abs(value) / place + 0.5 + Number.EPSILON) * place;
  const decimals = place === 0.01 ? 2 : place === 0.1 ? 1 : 0;
  return Number(result.toFixed(decimals));
}

function inferNumericAnswer(question) {
  const text = String(question || '').trim();
  const roundPattern = new RegExp(`\\bround\\s+(${NUMBER_SOURCE})\\s+to\\s+(?:the\\s+)?nearest\\s+(0\\.01|hundredth|0\\.1|tenth|1|one|integer|whole number|10|ten|100|hundred|1,?000|thousand)\\b`, 'i');
  const roundMatch = text.match(roundPattern);
  if (roundMatch) {
    const value = parseNumber(roundMatch[1]);
    const place = roundingPlace(roundMatch[2]);
    if (value != null && place) return { value: rounded(value, place), kind: 'rounding', source: value, place };
  }

  const operationPattern = new RegExp(`^(?:(?:what is|calculate|work out|solve)\\s+)?(${NUMBER_SOURCE})\\s*(\\+|−|-|×|x|\\*|÷|/)\\s*(${NUMBER_SOURCE})\\s*(?:=\\s*)?[?.]?$`, 'i');
  const operationMatch = text.match(operationPattern);
  if (operationMatch) {
    const left = parseNumber(operationMatch[1]);
    const right = parseNumber(operationMatch[3]);
    const operator = operationMatch[2].toLowerCase();
    if (left == null || right == null || ((operator === '/' || operator === '÷') && right === 0)) return null;
    const value = operator === '+' ? left + right
      : operator === '-' || operator === '−' ? left - right
        : operator === '×' || operator === 'x' || operator === '*' ? left * right
          : left / right;
    if (Number.isFinite(value)) return { value, kind: 'arithmetic', left, right, operator };
  }

  const percentPattern = new RegExp(`^(?:what is|calculate)?\\s*(${NUMBER_SOURCE})%\\s+of\\s+(${NUMBER_SOURCE})\\s*[?.]?$`, 'i');
  const percentMatch = text.match(percentPattern);
  if (percentMatch) {
    const percent = parseNumber(percentMatch[1]);
    const amount = parseNumber(percentMatch[2]);
    if (percent != null && amount != null) return { value: percent / 100 * amount, kind: 'percentage', percent, amount };
  }
  return null;
}

function matchingOptionIndexes(options, expected) {
  return (Array.isArray(options) ? options : []).map(parseNumber)
    .map((value, index) => value != null && Math.abs(value - expected) < 1e-9 ? index : -1)
    .filter(index => index >= 0);
}

function explanationFor(answer) {
  if (answer.kind === 'rounding') return `${answer.source} rounds to ${answer.value} to the nearest ${answer.place}.`;
  if (answer.kind === 'percentage') return `${answer.percent}% of ${answer.amount} is ${answer.value}.`;
  return `The calculation gives ${answer.value}.`;
}

function repairMathQuestion(question) {
  const copy = { ...(question || {}), options: Array.isArray(question && question.options) ? [...question.options] : [] };
  const answer = inferNumericAnswer(copy.question);
  if (!answer) return { question: copy, repaired: false, issue: null };
  const matches = matchingOptionIndexes(copy.options, answer.value);
  if (matches.length !== 1) {
    return {
      question: copy,
      repaired: false,
      issue: matches.length ? 'the calculated answer appears more than once' : `the calculated answer ${answer.value} is missing from the options`,
    };
  }
  const correctIndex = matches[0];
  const repaired = Number(copy.correctIndex) !== correctIndex;
  if (repaired) {
    copy.correctIndex = correctIndex;
    copy.explanation = explanationFor(answer);
  }
  return { question: copy, repaired, issue: null };
}

function repairMathQuestions(questions) {
  const repairedIndexes = [];
  const issues = [];
  const output = (Array.isArray(questions) ? questions : []).map((question, index) => {
    const result = repairMathQuestion(question);
    if (result.repaired) repairedIndexes.push(index);
    if (result.issue) issues.push(`Question ${index + 1}: ${result.issue}`);
    return result.question;
  });
  return { questions: output, repairedIndexes, issues };
}

module.exports = { parseNumber, inferNumericAnswer, repairMathQuestion, repairMathQuestions };
