// Renders lesson-pack artifacts (worksheet, exit ticket) into clean, printable
// .docx files with consistent LessonCope styling. Pure JS via the `docx` lib.
const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = require('docx');

const NAVY = '1F4E79', ORANGE = 'C85A1B', INK = '1B2430', GREY = '697586', LINE = 'CBD5E1';
const cap = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
const prettyTopic = t => String(t || '').replace(/-/g, ' ');

const title = text => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
  children: [new TextRun({ text, bold: true, color: NAVY, size: 34 })] });
const subtitle = text => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
  children: [new TextRun({ text, color: GREY, size: 20 })] });
const heading = text => new Paragraph({ spacing: { before: 240, after: 100 },
  children: [new TextRun({ text: text.toUpperCase(), bold: true, color: ORANGE, size: 20, characterSpacing: 20 })] });
const body = (text, opts = {}) => new Paragraph({ spacing: { after: opts.after != null ? opts.after : 100 },
  children: [new TextRun({ text, color: INK, size: 22, bold: !!opts.bold, italics: !!opts.italics })] });
const numbered = (n, text, opts = {}) => new Paragraph({ spacing: { before: 120, after: opts.after != null ? opts.after : 60 },
  children: [new TextRun({ text: `${n}.  `, bold: true, color: NAVY, size: 22 }), new TextRun({ text, color: INK, size: 22 })] });
// An empty ruled line for the student to write on.
const writeLine = () => new Paragraph({ spacing: { before: 90, after: 90 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 2 } }, children: [] });
const nameDate = () => new Paragraph({ spacing: { after: 220 }, children: [
  new TextRun({ text: 'Name: ', bold: true, color: GREY, size: 20 }),
  new TextRun({ text: '______________________      ', color: GREY, size: 20 }),
  new TextRun({ text: 'Date: ', bold: true, color: GREY, size: 20 }),
  new TextRun({ text: '________________', color: GREY, size: 20 }),
] });
const answerKeyHeading = () => new Paragraph({ pageBreakBefore: true, spacing: { after: 120 },
  children: [new TextRun({ text: 'Answer Key', bold: true, color: NAVY, size: 28 }), new TextRun({ text: '   (for the teacher)', color: GREY, size: 18 })] });

function metaSubtitle(meta) {
  return [cap(meta.subject), prettyTopic(meta.topic), meta.grade].filter(Boolean).join('  ·  ');
}

function doc(children) {
  return new Document({
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children }],
  });
}

function worksheetDocx(data, meta = {}) {
  const c = [];
  c.push(title(data.title || 'Worksheet'), subtitle(metaSubtitle(meta)), nameDate());
  if (data.focus) c.push(body(data.focus, { italics: true, after: 160 }));

  if (Array.isArray(data.warmup) && data.warmup.length) {
    c.push(heading('Warm-up'));
    data.warmup.forEach((q, i) => { c.push(numbered(i + 1, q)); c.push(writeLine()); });
  }

  if (data.example && (data.example.problem || data.example.solution)) {
    c.push(heading('Worked example'));
    if (data.example.problem) c.push(body(data.example.problem, { bold: true, after: 60 }));
    if (data.example.solution) c.push(body(data.example.solution));
  }

  if (Array.isArray(data.questions) && data.questions.length) {
    c.push(heading('Practice'));
    data.questions.forEach((q, i) => { c.push(numbered(i + 1, q)); c.push(writeLine()); c.push(writeLine()); });
  }

  if (data.challenge) {
    c.push(heading('Challenge'));
    c.push(numbered('★', data.challenge)); c.push(writeLine()); c.push(writeLine());
  }

  if (Array.isArray(data.answerKey) && data.answerKey.length) {
    c.push(answerKeyHeading());
    data.answerKey.forEach((a, i) => c.push(numbered(i + 1, a, { after: 40 })));
  }
  return Packer.toBuffer(doc(c));
}

function exitTicketDocx(data, meta = {}) {
  const c = [];
  c.push(title(data.title || 'Exit Ticket'), subtitle(metaSubtitle(meta)), nameDate());
  body && c.push(body('Answer these before you leave:', { italics: true, after: 160 }));
  (data.questions || []).forEach((q, i) => { c.push(numbered(i + 1, q)); c.push(writeLine()); c.push(writeLine()); });
  if (Array.isArray(data.answerKey) && data.answerKey.length) {
    c.push(answerKeyHeading());
    data.answerKey.forEach((a, i) => c.push(numbered(i + 1, a, { after: 40 })));
  }
  return Packer.toBuffer(doc(c));
}

module.exports = { worksheetDocx, exitTicketDocx };
