// Fills the ORIGINAL uploaded template (Word/Excel) with generated lesson-plan
// content, preserving the exact layout — only the contents change.
//
// docx: find each section heading in the document; write its content into the
// adjacent value cell (label|value tables) or append into the heading's own
// cell, cloning existing paragraph styling so fonts/borders are untouched.
const PizZip = require('pizzip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const XLSX = require('xlsx');

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function elemText(node) {
  const ts = node.getElementsByTagName('w:t');
  let s = '';
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
  return s;
}
function closestTag(node, tag) {
  let n = node;
  while (n) { if (n.nodeName === tag) return n; n = n.parentNode; }
  return null;
}
function directCells(row) {
  const cells = [];
  let c = row.firstChild;
  while (c) { if (c.nodeName === 'w:tc') cells.push(c); c = c.nextSibling; }
  return cells;
}
function firstChildByTag(node, tag) {
  const els = node.getElementsByTagName(tag);
  return els.length ? els[0] : null;
}
// Turn content (possibly a run-on string with markdown / inline numbering) into
// clean bullet lines: drop markdown, break inline "1." / "-" / "•" enumerations
// onto their own lines, strip leading markers.
function smartLines(raw) {
  let s = String(raw || '').replace(/\*\*|__|`/g, '').replace(/\r/g, '');
  s = s.replace(/\s+(?=\d+\.\s)/g, '\n').replace(/\s+(?=[-•]\s)/g, '\n');
  return s.split('\n')
    .map(l => l.replace(/^\s*(?:\d+\.|[-•*])\s*/, '').trim())
    .filter(Boolean);
}

// Prefer a real list paragraph (numPr) as the style template so new lines render
// as proper bullets like the template's examples; fall back to the first para.
function listStyleParagraph(cell) {
  const ps = cell.getElementsByTagName('w:p');
  for (let i = 0; i < ps.length; i++) if (ps[i].getElementsByTagName('w:numPr').length) return ps[i];
  return ps.length ? ps[0] : null;
}

// Replace a value cell's content with clean bullet lines, cloning the example's
// list-paragraph style (numPr) and run style (rPr) so fonts/bullets match.
function replaceCellContent(doc, cell, rawText) {
  const lines = smartLines(rawText);
  if (!lines.length) return;

  const src = listStyleParagraph(cell);
  const base = src ? src.cloneNode(true) : doc.createElement('w:p');
  const exampleRpr = (() => { const r = firstChildByTag(base, 'w:r'); const rpr = r ? firstChildByTag(r, 'w:rPr') : null; return rpr ? rpr.cloneNode(true) : null; })();
  const baseRuns = base.getElementsByTagName('w:r');
  for (let i = baseRuns.length - 1; i >= 0; i--) baseRuns[i].parentNode.removeChild(baseRuns[i]);

  // remove all existing paragraphs from the cell
  let p = cell.firstChild;
  const toRemove = [];
  while (p) { if (p.nodeName === 'w:p') toRemove.push(p); p = p.nextSibling; }
  toRemove.forEach(n => cell.removeChild(n));

  for (const line of lines) {
    const para = base.cloneNode(true); // keeps pPr incl. numPr (bullet style)
    const r = doc.createElement('w:r');
    if (exampleRpr) r.appendChild(exampleRpr.cloneNode(true));
    const t = doc.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(doc.createTextNode(line));
    r.appendChild(t);
    para.appendChild(r);
    cell.appendChild(para);
  }
}
function stripRuns(p) {
  const rs = p.getElementsByTagName('w:r');
  for (let i = rs.length - 1; i >= 0; i--) rs[i].parentNode.removeChild(rs[i]);
}
function stripNumPr(p) {
  const ns = p.getElementsByTagName('w:numPr');
  for (let i = ns.length - 1; i >= 0; i--) ns[i].parentNode.removeChild(ns[i]);
}
function makeRun(doc, text, bold) {
  const r = doc.createElement('w:r');
  if (bold) { const rpr = doc.createElement('w:rPr'); rpr.appendChild(doc.createElement('w:b')); r.appendChild(rpr); }
  const t = doc.createElement('w:t');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}

// Append a sub-section (bold heading + bullet lines) to an already-filled cell.
// Used when the plan splits a cell's content into sub-sections (Starter / Main
// / Plenary) that the template keeps inside one "Activities & Timing" cell.
function appendCellContent(doc, cell, heading, rawText) {
  const lines = smartLines(rawText);
  if (!lines.length) return;
  const ps = cell.getElementsByTagName('w:p');
  let listP = null;
  for (let i = 0; i < ps.length; i++) if (ps[i].getElementsByTagName('w:numPr').length) { listP = ps[i]; break; }
  const listBase = (listP || ps[ps.length - 1] || doc.createElement('w:p')).cloneNode(true);
  stripRuns(listBase);
  const headBase = listBase.cloneNode(true); stripNumPr(headBase); // bold, non-bulleted sub-heading

  const hp = headBase.cloneNode(true);
  hp.appendChild(makeRun(doc, String(heading).replace(/[*_`]/g, '').trim(), true));
  cell.appendChild(hp);
  for (const line of lines) {
    const p = listBase.cloneNode(true);
    p.appendChild(makeRun(doc, line, false));
    cell.appendChild(p);
  }
}

function findHeadingParagraph(paras, heading) {
  const target = norm(heading);
  if (target.length < 3) return null;
  // exact / prefix match first
  for (const p of paras) {
    const pt = norm(elemText(p));
    if (!pt) continue;
    if (pt === target || pt.startsWith(target) || (target.startsWith(pt) && pt.length > 4)) return p;
  }
  // then contains
  for (const p of paras) {
    const pt = norm(elemText(p));
    if (pt && target.length > 4 && pt.includes(target)) return p;
  }
  return null;
}

function fillDocx(buffer, sections) {
  const zip = new PizZip(buffer);
  const xml = zip.file('word/document.xml').asText();
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const paras = Array.from(doc.getElementsByTagName('w:p'));
  const usedRows = new Set();
  const skipped = [];

  let filled = 0;
  let lastFilledCell = null;
  for (const sec of sections) {
    const content = String(sec.content || '');
    if (!content.trim()) continue;

    const hp = findHeadingParagraph(paras, sec.heading);
    const cell = hp && closestTag(hp, 'w:tc');
    const row = cell && closestTag(cell, 'w:tr');
    const cells = row ? directCells(row) : [];

    // Clean "label | value" row (2 cells, heading on the left) → replace the
    // value cell's example content. Leaves multi-label metadata grids alone.
    if (row && cells.length === 2 && cells[0] === cell && !usedRows.has(row)) {
      replaceCellContent(doc, cells[1], content);
      usedRows.add(row);
      lastFilledCell = cells[1];
      filled++;
    } else if (lastFilledCell && content.trim().length > 40) {
      // Orphaned sub-section (e.g. Main activities / Plenary that live inside
      // the previous cell in the template) → append under the last filled cell.
      appendCellContent(doc, lastFilledCell, sec.heading, content);
      filled++;
    } else {
      skipped.push(sec.heading);
    }
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), filled, total: sections.length, skipped };
}

// Excel: write each section's content into the cell to the right of (or below)
// the matching label cell, preserving the sheet.
function fillXlsx(buffer, sections) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  let filled = 0;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (const sec of sections) {
      const target = norm(sec.heading);
      if (target.length < 3) continue;
      for (let R = range.s.r; R <= range.e.r; R++) {
        let placed = false;
        for (let C = range.s.c; C <= range.e.c; C++) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          if (!cell || !norm(String(cell.v)).includes(target)) continue;
          const rightAddr = XLSX.utils.encode_cell({ r: R, c: C + 1 });
          const belowAddr = XLSX.utils.encode_cell({ r: R + 1, c: C });
          const dest = (!ws[rightAddr] || !String(ws[rightAddr].v).trim()) ? rightAddr : belowAddr;
          ws[dest] = { t: 's', v: sec.content };
          if (XLSX.utils.decode_cell(dest).c > range.e.c) range.e.c = XLSX.utils.decode_cell(dest).c;
          if (XLSX.utils.decode_cell(dest).r > range.e.r) range.e.r = XLSX.utils.decode_cell(dest).r;
          filled++; placed = true; break;
        }
        if (placed) break;
      }
    }
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), filled, total: sections.length };
}

module.exports = { fillDocx, fillXlsx };
