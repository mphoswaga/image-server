// Planning source: parse Excel pacing guides / year plans / weekly plans into
// structured curriculum data so teachers can select subject → grade → week and
// have objectives + success criteria pulled automatically.
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

function uid()  { return 'ps_' + crypto.randomBytes(8).toString('hex'); }
function iid()  { return 'pi_' + crypto.randomBytes(6).toString('hex'); }

function sourcesDir(userId) {
  return path.join(DATA_DIR, 'users', userId, 'planning-sources');
}
function sourcePath(userId, id) {
  return path.join(sourcesDir(userId), id + '.json');
}

// ── Detection helpers ────────────────────────────────────────────────────────

function gradeFromSheetName(name) {
  const n = String(name || '').trim();
  const m = n.match(/(?:grade|gr\.?|g)\s*(\d+)/i)
          || n.match(/^(\d+)$/)
          || n.match(/(?:form|year|yr)\s*(\d+)/i);
  return m ? 'Grade ' + m[1] : null;
}

function detectSubject(text) {
  const f = String(text || '').toLowerCase();
  if (/ict|comput/.test(f))               return 'ICT';
  if (/\bmath|maths|numeracy/.test(f))    return 'Mathematics';
  if (/\benglish|literacy|reading/.test(f)) return 'English';
  if (/science/.test(f))                  return 'Science';
  if (/social\s+stud|ss\b/.test(f))       return 'Social Studies';
  if (/history/.test(f))                  return 'History';
  if (/geography/.test(f))                return 'Geography';
  if (/\bart\b/.test(f))                  return 'Art';
  if (/music/.test(f))                    return 'Music';
  if (/\bpe\b|physical\s+ed/.test(f))     return 'PE';
  if (/afrikaans/.test(f))                return 'Afrikaans';
  if (/zulu|xhosa|sotho|tswana|venda|tsonga|swati|ndebele/.test(f)) return 'Home Language';
  if (/life\s+(skills?|orient)/.test(f))  return 'Life Skills';
  return null;
}
const subjectFromFilename = detectSubject;

// Column header → field mapping
const COL_PATTERNS = {
  week:            /^(week|wk)(\s|$|#|\s*no)/i,
  date:            /date/i,
  unit:            /^(unit|topic|strand|theme|subject area)/i,
  lesson:          /^lesson(\s+title|\s+no|\s+#)?$/i,
  objectives:      /^(learning\s+obj|objective|lo\b|lesson\s+obj)/i,
  successCriteria: /^(success\s+cri|criteria|i\s+can|learning\s+outcome)/i,
  resources:       /^(resource|material|equipment|tool)/i,
  notes:           /^(note|comment|remark|other)/i,
};

function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || [];
    let hits = 0;
    const colMap = {};
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').trim();
      if (!cell) continue;
      for (const [field, re] of Object.entries(COL_PATTERNS)) {
        if (re.test(cell) && !(field in colMap)) {
          colMap[field] = j;
          hits++;
        }
      }
    }
    if (hits >= 2) return { rowIndex: i, colMap };
  }
  return null;
}

function parseWeekNum(val) {
  if (!val && val !== 0) return null;
  const s = String(val).replace(/[^0-9]/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) || n < 1 || n > 60 ? null : n;
}

function parseObjectiveLines(text) {
  if (!text) return [];
  return String(text)
    .split(/\n|;\s*/)
    .map(l => l.trim())
    .filter(l => l.length > 4)
    .map(line => {
      // Detect optional code prefix: "3CS.01 Know that…"
      const m = line.match(/^([A-Z][A-Z0-9]{0,5}\.?[A-Z0-9]{1,4})\s+(.{8,})/);
      return m ? { code: m[1], text: m[2] } : { code: null, text: line };
    });
}

function parseLines(text) {
  if (!text) return [];
  return String(text).split(/\n|;\s*/).map(l => l.trim()).filter(Boolean);
}

// ── Sheet parser ─────────────────────────────────────────────────────────────

function parseSheet(sheet, grade) {
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const hdr = detectHeader(rawRows);
  if (!hdr) return [];
  const { rowIndex, colMap } = hdr;

  const items = [];
  let lastWeek = null, lastUnit = '', lastDate = null;

  for (let r = rowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r] || [];
    if (row.every(c => !c && c !== 0)) continue;

    const get = f => (colMap[f] !== undefined ? String(row[colMap[f]] || '').trim() : '');

    const weekRaw = get('week');
    const weekNum = parseWeekNum(weekRaw);
    if (weekNum !== null) lastWeek = weekNum;

    const unitRaw = get('unit');
    if (unitRaw) lastUnit = unitRaw;

    const dateRaw = get('date');
    if (dateRaw) lastDate = dateRaw;

    if (lastWeek === null) continue;

    const objText  = get('objectives');
    const scText   = get('successCriteria');
    const resText  = get('resources');
    const lessonRaw = get('lesson');
    const notes    = get('notes');

    if (!objText && !unitRaw && !lessonRaw) continue;

    const objectives      = parseObjectiveLines(objText);
    const successCriteria = parseLines(scText);
    const resources       = parseLines(resText);

    // Split "C3.2 What is a Computer?" → unitCode + unitTitle
    let unitCode = null, unitTitle = lastUnit;
    const um = lastUnit.match(/^([A-Z][0-9]+(?:\.[0-9]+)*)\s+(.+)/);
    if (um) { unitCode = um[1]; unitTitle = um[2]; }

    // Check if an item for this week already exists; if so, merge objectives
    const existing = items.find(x => x.weekNumber === lastWeek);
    if (existing && objectives.length) {
      existing.learningObjectives.push(...objectives);
      if (successCriteria.length) existing.successCriteria.push(...successCriteria);
      if (resources.length) existing.resources.push(...resources);
      continue;
    }
    if (existing) continue; // blank carry-forward row, no new content

    items.push({
      id: iid(), grade, weekNumber: lastWeek,
      startDate: lastDate || null,
      unitCode, unitTitle,
      lessonTitle: lessonRaw || null,
      learningObjectives: objectives,
      successCriteria, resources,
      notes: notes || null,
      extractionConfidence: objectives.length > 0 ? 0.9 : 0.5,
    });
  }
  return items;
}

// ── Main parse entry point ───────────────────────────────────────────────────

function subjectFromSheetNames(sheetNames) {
  for (const name of sheetNames) {
    if (!gradeFromSheetName(name)) continue;
    // Strip the grade portion and test the remainder for a subject keyword
    const stripped = name
      .replace(/(?:grade|gr\.?|g|year|yr|form)\s*\d+/gi, '')
      .replace(/[-_·•\s]+/g, ' ')
      .trim();
    const s = detectSubject(stripped);
    if (s) return s;
  }
  // Also try the full sheet name without stripping (e.g. "ICT Overview")
  for (const name of sheetNames) {
    const s = detectSubject(name);
    if (s) return s;
  }
  return null;
}

function subjectFromCells(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: 0 });
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    for (const cell of (rows[r] || [])) {
      const m = String(cell || '').match(/^subject\s*:\s*(.+)/i);
      if (m) {
        const s = detectSubject(m[1].trim());
        if (s) return s;
      }
    }
  }
  return null;
}

function parseExcelSource(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const items = [];
  const gradesFound = [];

  // Subject detection: filename → sheet names → cell content
  let subject = detectSubject(filename);
  if (!subject) subject = subjectFromSheetNames(wb.SheetNames);
  if (!subject) {
    for (const sn of wb.SheetNames) {
      subject = subjectFromCells(wb.Sheets[sn]);
      if (subject) break;
    }
  }

  for (const sheetName of wb.SheetNames) {
    const grade = gradeFromSheetName(sheetName);
    if (!grade) continue; // skip Overview / Summary sheets for item extraction
    if (!gradesFound.includes(grade)) gradesFound.push(grade);
    const sheetItems = parseSheet(wb.Sheets[sheetName], grade);
    items.push(...sheetItems);
  }

  // Fallback: if no named grade sheets found, try all sheets without a grade label
  if (items.length === 0) {
    for (const sheetName of wb.SheetNames) {
      const sheetItems = parseSheet(wb.Sheets[sheetName], null);
      items.push(...sheetItems);
    }
  }

  gradesFound.sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });

  return { items, gradesFound, subject };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function savePlanningSource(userId, { fileName, items, gradesFound, subject, sourceType }) {
  const dir = sourcesDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const id = uid();
  const rec = {
    id, fileName,
    sourceType: sourceType || 'pacing_guide',
    subject: subject || null,
    gradesFound: gradesFound || [],
    uploadedAt: new Date().toISOString(),
    items,
  };
  await writeJsonAtomic(sourcePath(userId, id), rec);
  return rec;
}

function listPlanningSources(userId) {
  const dir = sourcesDir(userId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return {
          id: rec.id, fileName: rec.fileName, sourceType: rec.sourceType,
          subject: rec.subject, gradesFound: rec.gradesFound,
          uploadedAt: rec.uploadedAt, itemCount: (rec.items || []).length,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

function getPlanningSource(userId, id) {
  const p = sourcePath(userId, id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function deletePlanningSource(userId, id) {
  const p = sourcePath(userId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function queryItems(userId, sourceId, { grade, week } = {}) {
  const src = getPlanningSource(userId, sourceId);
  if (!src) return [];
  let items = src.items || [];
  if (grade) items = items.filter(i => i.grade === grade);
  if (week !== undefined && week !== null && week !== '') {
    const wn = parseInt(week, 10);
    items = items.filter(i => i.weekNumber === wn);
  }
  return items;
}

module.exports = {
  parseExcelSource, savePlanningSource, listPlanningSources,
  getPlanningSource, deletePlanningSource, queryItems,
};
