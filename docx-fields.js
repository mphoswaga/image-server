// The field labels of a Word lesson-plan template.
//
// Passing the whole template to the model does not work. A real school form
// arrives with a worked example already in it — a full week of somebody else's
// lesson — and the model reads that as content to imitate rather than a form to
// fill, so it writes a generic Starter / Main Activities / Plenary plan. Those
// headings then match nothing in the actual document, and the filled download
// comes back untouched.
//
// The week-by-week workbook already solved this: send the LABELS only, and the
// plan comes back in exactly the teacher's fields. This does the same for .docx.
//
// A label is a short piece of text that names a row rather than fills one:
//   * the left cell of a two-cell row  ("Learning Objectives" | "3MD.04 …")
//   * a bold paragraph in a flowing document, with content beneath it
const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');

// Long enough to be meaningful, short enough that a paragraph of lesson content
// can never be mistaken for a heading.
const MAX_LABEL = 60;
const MIN_LABEL = 2;

function textOf(node) {
  const ts = node.getElementsByTagName('w:t');
  let out = '';
  for (let i = 0; i < ts.length; i++) out += ts[i].textContent;
  return out.replace(/\s+/g, ' ').trim();
}

function directChildren(node, tag) {
  const out = [];
  let child = node.firstChild;
  while (child) { if (child.nodeName === tag) out.push(child); child = child.nextSibling; }
  return out;
}

function isBold(paragraph) {
  return paragraph.getElementsByTagName('w:b').length > 0;
}

// Trailing colons and the decorative emoji schools put in header cells are not
// part of the name — "Topic (s):" and "Learning Objectives 🎯" are the same row.
function cleanLabel(raw) {
  return String(raw || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s*[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function usable(label) {
  if (label.length < MIN_LABEL || label.length > MAX_LABEL) return false;
  // A row of prose is not a label, however short. Sentences end in a full stop
  // and labels do not.
  if (/[.!?]$/.test(label)) return false;
  // Needs at least one letter — "1 & 2" and "✓" are not field names.
  return /[a-z]/i.test(label);
}

// Field labels in document order, de-duplicated.
function docxFieldLabels(buffer) {
  const zip = new PizZip(buffer);
  const file = zip.file('word/document.xml');
  if (!file) return [];
  const doc = new DOMParser().parseFromString(file.asText(), 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) return [];

  const labels = [];
  const seen = new Set();
  const add = (raw) => {
    const label = cleanLabel(raw);
    if (!usable(label)) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };

  // Two-cell rows: the left cell names the row. Checked across the whole
  // document rather than per-table, since these forms nest tables freely.
  const rows = doc.getElementsByTagName('w:tr');
  for (let i = 0; i < rows.length; i++) {
    const cells = directChildren(rows[i], 'w:tc');
    if (cells.length !== 2) continue;
    const left = textOf(cells[0]);
    const right = textOf(cells[1]);
    // A row with text on both sides where the left is short: label | value.
    // If the left side is long it is a two-column layout, not a form.
    if (left && left.length <= MAX_LABEL && (right || cells[1].getElementsByTagName('w:p').length)) add(left);
  }

  // Flowing documents: a bold paragraph followed by something that is not
  // another bold paragraph is a heading with an answer space under it.
  const paras = directChildren(body, 'w:p');
  for (let i = 0; i < paras.length; i++) {
    if (!isBold(paras[i])) continue;
    const text = textOf(paras[i]);
    if (!text) continue;
    const next = paras[i + 1];
    if (next && isBold(next) && textOf(next)) {
      // Two bold lines in a row are more likely a title block than a field.
      if (i > 0) continue;
    }
    add(text);
  }

  return labels;
}

// The block that goes to the model in place of the template's own text: the
// teacher's field names, one per line, and nothing that was already filled in.
function docxTemplateText(buffer) {
  const labels = docxFieldLabels(buffer);
  // Below this it is not a form — a letterhead or a policy document would
  // produce one or two stray labels, and mirroring those would be worse than
  // falling back to the raw text.
  if (labels.length < 4) return '';
  return labels.map((label) => `${label}:`).join('\n');
}

module.exports = { docxFieldLabels, docxTemplateText, cleanLabel, MAX_LABEL };
