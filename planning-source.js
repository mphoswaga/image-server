// Planning source: parse Excel pacing guides / year plans / weekly plans into
// structured curriculum data so teachers can select subject → grade → week and
// have objectives + success criteria pulled automatically.
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { client: aiClient } = require('./ai-client');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

function gradeFromText(text) {
  const n = String(text || '').trim();
  const m = n.match(/(?:stage|grade|gr\.?|g|form|year|yr)\s*(\d+)/i);
  return m ? 'Grade ' + m[1] : null;
}

function detectSubject(text) {
  const f = String(text || '').toLowerCase();
  if (/ict|comput/.test(f))               return 'ICT';
  if (/\bmath|maths|numeracy/.test(f))    return 'Mathematics';
  if (/global\s+perspective/.test(f))     return 'Global Perspectives';
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
  const normalized = String(text)
    .replace(/\r/g, '\n')
    .replace(/\s+(?=\d+[A-Za-z]{1,5}\.\d{2}\b)/g, '\n');
  return normalized
    .split(/\n|;\s*/)
    .map(l => l.trim())
    .filter(l => l.length > 4)
    .map(line => {
      // Detect optional code prefix: "3CS.01 Know that…" or "3Rw.02 Read…"
      const m = line.match(/^([A-Z0-9][A-Z0-9a-z]{0,5}\.?[A-Z0-9]{1,4})\s+(.{8,})/);
      return m ? { code: m[1], text: m[2] } : { code: null, text: line };
    });
}

function parseLines(text) {
  if (!text) return [];
  return String(text).split(/\n|;\s*/).map(l => l.trim()).filter(Boolean);
}

function parseBulletLines(text) {
  if (!text) return [];
  return String(text)
    .replace(/\r/g, '\n')
    .split(/\n|;\s*|(?=\s*[-•]\s*)/)
    .map(l => l.replace(/^[-•]\s*/, '').trim())
    .filter(l => l.length > 4);
}

function splitTopicSuccessCriteria(text) {
  const source = String(text || '').replace(/\r/g, '\n').trim();
  const marker = /\b(?:example\s+)?success\s+criteria\b(?:\s*\(\s*i\s+can(?:\.{3}|…)?\s*\))?\s*:*/i;
  const match = marker.exec(source);
  if (!match) return { title: source, criteria: [] };
  const title = source.slice(0, match.index).replace(/[\s:–—-]+$/g, '').trim();
  const criteria = parseBulletLines(source.slice(match.index + match[0].length))
    .map(line => line.replace(/^\(?\s*i\s+can(?:\.{3}|…)?\s*\)?\s*:*/i, 'I can ').trim())
    .filter(line => !/^i can\s*$/i.test(line));
  return { title, criteria };
}

function unitNumberFromText(text) {
  const m = String(text || '').match(/\bunit\s*(\d+)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

function cleanUnitTitle(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^unit\s*\d+\s*:?\s*/i, '')
    .trim();
}

function overviewUnitWeeks(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const out = new Map();
  for (const row of rows) {
    const week = parseWeekNum(row?.[0]);
    if (week === null) continue;
    const unitText = String(row?.[3] || row?.[2] || '').trim();
    const unitNo = unitNumberFromText(unitText);
    if (!unitNo) continue;
    if (!out.has(unitNo)) out.set(unitNo, []);
    out.get(unitNo).push(week);
  }
  return out;
}

function detectCambridgeHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const row = rows[i] || [];
    const unitCol = row.findIndex(c => /^unit\s*$/i.test(String(c || '').trim()));
    const strandCol = row.findIndex(c => /^strand$/i.test(String(c || '').trim()));
    const objectiveCol = row.findIndex(c => /learning\s+objectives?/i.test(String(c || '')));
    const weekCols = [];
    const resourceCols = [];
    row.forEach((cell, col) => {
      const text = String(cell || '');
      const wm = text.match(/\bweek\s*(\d+)\b.*learning\s+outcomes?/i)
              || text.match(/learning\s+outcomes?.*\bweek\s*(\d+)\b/i);
      if (wm) weekCols.push({ localWeek: parseInt(wm[1], 10), col });
      if (/\bweek\s*\d+\b.*resources?/i.test(text) || /resources?.*\bweek\s*\d+\b/i.test(text)) {
        const rm = text.match(/\bweek\s*(\d+)\b/i);
        if (rm) resourceCols.push({ localWeek: parseInt(rm[1], 10), col });
      }
    });
    if (unitCol >= 0 && strandCol >= 0 && objectiveCol >= 0 && weekCols.length) {
      return { rowIndex: i, unitCol, strandCol, objectiveCol, weekCols, resourceCols };
    }
  }
  return null;
}

function parseCambridgeUnitSheet(sheet, sheetName, grade, overviewWeeks) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const hdr = detectCambridgeHeader(rows);
  if (!hdr) return [];

  const unitNo = unitNumberFromText(sheetName) || unitNumberFromText(rows[hdr.rowIndex + 1]?.[hdr.unitCol]);
  if (!unitNo) return [];
  const unitTitle = cleanUnitTitle(rows[hdr.rowIndex + 1]?.[hdr.unitCol] || sheetName);
  const globalWeeks = overviewWeeks.get(unitNo) || [];
  const curriculumObjectives = [];
  const strands = new Set();
  const itemsByLocalWeek = new Map();

  for (let r = hdr.rowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const strand = String(row[hdr.strandCol] || '').trim();
    if (strand) strands.add(strand);
    curriculumObjectives.push(...parseObjectiveLines(row[hdr.objectiveCol]));

    for (const wc of hdr.weekCols) {
      const outcomes = parseBulletLines(row[wc.col]);
      if (!outcomes.length) continue;
      if (!itemsByLocalWeek.has(wc.localWeek)) {
        const globalWeek = globalWeeks[wc.localWeek - 1] || ((globalWeeks[0] || 1) + wc.localWeek - 1);
        const resourceCol = hdr.resourceCols.find(rc => rc.localWeek === wc.localWeek)?.col;
        itemsByLocalWeek.set(wc.localWeek, {
          id: iid(),
          grade,
          weekNumber: globalWeek,
          startDate: null,
          unitCode: `Unit ${unitNo}`,
          unitTitle,
          lessonTitle: `Week ${globalWeek}: ${unitTitle}`,
          learningObjectives: [],
          successCriteria: [],
          resources: resourceCol !== undefined ? parseLines(row[resourceCol]) : [],
          notes: null,
          extractionConfidence: 0.88,
        });
      }
      const item = itemsByLocalWeek.get(wc.localWeek);
      for (const text of outcomes) item.learningObjectives.push({ code: null, text });
      const resourceCol = hdr.resourceCols.find(rc => rc.localWeek === wc.localWeek)?.col;
      if (resourceCol !== undefined) item.resources.push(...parseLines(row[resourceCol]));
    }
  }

  const criteria = curriculumObjectives
    .filter((o, idx, arr) => o.text && arr.findIndex(x => x.code === o.code && x.text === o.text) === idx)
    .map(o => o.code ? `${o.code} ${o.text}` : o.text)
    .slice(0, 16);
  const strandList = Array.from(strands).slice(0, 12);

  return Array.from(itemsByLocalWeek.values()).map(item => ({
    ...item,
    learningObjectives: item.learningObjectives
      .filter((o, idx, arr) => o.text && arr.findIndex(x => x.text === o.text) === idx)
      .slice(0, 14),
    successCriteria: criteria,
    resources: item.resources.filter((x, idx, arr) => x && arr.indexOf(x) === idx).slice(0, 10),
    notes: strandList.length ? `Strands: ${strandList.join('; ')}` : null,
  }));
}

const AI_LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    gradesFound: { type: 'array', items: { type: 'string' } },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          grade: { type: ['string', 'null'] },
          weekNumber: { type: 'integer' },
          startDate: { type: ['string', 'null'] },
          unitCode: { type: ['string', 'null'] },
          unitTitle: { type: 'string' },
          lessonTitle: { type: ['string', 'null'] },
          learningObjectives: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: ['string', 'null'] },
                text: { type: 'string' },
              },
              required: ['code', 'text'],
              additionalProperties: false,
            },
          },
          successCriteria: { type: 'array', items: { type: 'string' } },
          resources: { type: 'array', items: { type: 'string' } },
          notes: { type: ['string', 'null'] },
          extractionConfidence: { type: 'number' },
        },
        required: [
          'grade', 'weekNumber', 'startDate', 'unitCode', 'unitTitle',
          'lessonTitle', 'learningObjectives', 'successCriteria',
          'resources', 'notes', 'extractionConfidence',
        ],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['subject', 'gradesFound', 'items', 'warnings'],
  additionalProperties: false,
};

function extractionScore(parsed) {
  const items = parsed?.items || [];
  const objectiveCount = items.reduce((sum, item) => sum + ((item.learningObjectives || []).length), 0);
  const itemsWithObjectives = items.filter(item => (item.learningObjectives || []).length > 0).length;
  return {
    items: items.length,
    objectiveCount,
    itemsWithObjectives,
    objectiveCoverage: items.length ? itemsWithObjectives / items.length : 0,
    hasGrade: Boolean((parsed?.gradesFound || []).length || items.some(item => item.grade)),
    hasSubject: Boolean(parsed?.subject),
  };
}

function shouldUseAiAssist(parsed) {
  const score = extractionScore(parsed);
  if (score.items === 0) return true;
  if (score.objectiveCount === 0) return true;
  if (score.items >= 4 && score.objectiveCoverage < 0.2) return true;
  return false;
}

function workbookPreview(wb) {
  const parts = [];
  parts.push(`Sheets: ${wb.SheetNames.join(' | ')}`);
  for (const sheetName of wb.SheetNames.slice(0, 14)) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
    parts.push(`\n## ${sheetName} ${ws['!ref'] || ''}`);
    const merges = (ws['!merges'] || []).slice(0, 12).map(m => XLSX.utils.encode_range(m));
    if (merges.length) parts.push(`Merged ranges: ${merges.join(', ')}`);
    let emitted = 0;
    for (let r = 0; r < rows.length && emitted < 34; r++) {
      const row = rows[r] || [];
      const cells = row.slice(0, 12)
        .map((value, c) => {
          const text = String(value || '').replace(/\s+/g, ' ').trim();
          return text ? `${XLSX.utils.encode_col(c)}=${text.slice(0, 160)}` : null;
        })
        .filter(Boolean);
      if (!cells.length) continue;
      parts.push(`R${r + 1}: ${cells.join(' | ')}`);
      emitted++;
    }
  }
  return parts.join('\n').slice(0, 24000);
}

function normalizeAiItems(result, fallback) {
  const fallbackGrade = (fallback?.gradesFound || [])[0] || null;
  const items = [];
  for (const item of (result?.items || [])) {
    const weekNumber = parseWeekNum(item.weekNumber);
    if (weekNumber === null) continue;
    const objectives = (item.learningObjectives || [])
      .map(obj => typeof obj === 'string' ? { code: null, text: obj } : obj)
      .map(obj => ({ code: obj?.code || null, text: String(obj?.text || '').trim() }))
      .filter(obj => obj.text.length > 4)
      .slice(0, 16);
    if (!objectives.length) continue;
    items.push({
      id: iid(),
      grade: item.grade || fallbackGrade,
      weekNumber,
      startDate: item.startDate || null,
      unitCode: item.unitCode || null,
      unitTitle: String(item.unitTitle || item.lessonTitle || `Week ${weekNumber}`).trim(),
      lessonTitle: item.lessonTitle || null,
      learningObjectives: objectives,
      successCriteria: (item.successCriteria || []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 16),
      resources: (item.resources || []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 12),
      notes: item.notes || null,
      extractionConfidence: Math.max(0.35, Math.min(0.95, Number(item.extractionConfidence) || 0.72)),
    });
  }
  items.sort((a, b) => a.weekNumber - b.weekNumber || String(a.unitTitle).localeCompare(String(b.unitTitle)));
  return items;
}

function mergeParsedItems(ruleItems, aiItems) {
  const merged = (ruleItems || []).map(item => ({
    ...item,
    learningObjectives: [...(item.learningObjectives || [])],
    successCriteria: [...(item.successCriteria || [])],
    resources: [...(item.resources || [])],
  }));

  for (const aiItem of (aiItems || [])) {
    let existing = merged.find(item => item.grade === aiItem.grade && item.weekNumber === aiItem.weekNumber);
    if (!existing) {
      const weekMatches = merged.filter(item => item.weekNumber === aiItem.weekNumber && (!item.grade || !aiItem.grade));
      if (weekMatches.length === 1) existing = weekMatches[0];
    }
    if (!existing) {
      merged.push(aiItem);
      continue;
    }
    if (!existing.learningObjectives.length && aiItem.learningObjectives.length) existing.learningObjectives = aiItem.learningObjectives;
    if (!existing.successCriteria.length && aiItem.successCriteria.length) existing.successCriteria = aiItem.successCriteria;
    if (!existing.resources.length && aiItem.resources.length) existing.resources = aiItem.resources;
    if (!existing.unitTitle && aiItem.unitTitle) existing.unitTitle = aiItem.unitTitle;
    if (!existing.lessonTitle && aiItem.lessonTitle) existing.lessonTitle = aiItem.lessonTitle;
    if (!existing.notes && aiItem.notes) existing.notes = aiItem.notes;
    existing.extractionConfidence = Math.max(existing.extractionConfidence || 0, aiItem.extractionConfidence || 0);
  }

  return merged.sort((a, b) => {
    const gradeA = parseInt(String(a.grade || '').replace(/\D/g, ''), 10) || 0;
    const gradeB = parseInt(String(b.grade || '').replace(/\D/g, ''), 10) || 0;
    return gradeA - gradeB || a.weekNumber - b.weekNumber || String(a.unitTitle).localeCompare(String(b.unitTitle));
  });
}

async function parseExcelSourceWithAi(buffer, filename) {
  const parsed = parseExcelSource(buffer, filename);
  if (!shouldUseAiAssist(parsed)) return { ...parsed, extractionMode: 'rules' };
  if (!process.env.OPENAI_API_KEY) return { ...parsed, extractionMode: 'rules_weak_no_ai' };

  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const prompt = `You are helping LessonScope import a teacher pacing guide spreadsheet.

The deterministic parser produced weak output:
${JSON.stringify(extractionScore(parsed))}

Convert the workbook preview below into weekly planning items for the app.

Rules:
- Return only real teaching weeks/lessons that contain usable learning objectives or outcomes.
- Use global week numbers if an overview maps units to school weeks.
- Infer grade from "Stage 3" as "Grade 3", "Year 5" as "Grade 5", etc.
- Infer subject only when clear from sheet names or strands, e.g. Reading/Writing means English.
- learningObjectives should be teacher-friendly outcomes for the selected week, not empty headings.
- successCriteria may include curriculum objective codes or broader criteria.
- Keep each week compact: no more than 16 objectives and 12 resources.
- If the structure is uncertain, include a warning but still extract the best usable data.

Filename: ${filename}

Workbook preview:
${workbookPreview(wb)}`;
    const response = await aiClient().chat.completions.create({
      model: MODEL,
      max_tokens: 7000,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: 'planning_source_layout', strict: true, schema: AI_LAYOUT_SCHEMA } },
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error('AI layout assist returned no content.');
    const ai = JSON.parse(text);
    const aiItems = normalizeAiItems(ai, parsed);
    if (!aiItems.length) return { ...parsed, extractionMode: 'rules_ai_empty', warnings: ai.warnings || [] };
    const mergedItems = mergeParsedItems(parsed.items, aiItems);
    const gradesFound = (ai.gradesFound || [])
      .map(g => gradeFromText(g) || String(g || '').trim())
      .filter(Boolean);
    const uniqueGrades = Array.from(new Set([...gradesFound, ...(parsed.gradesFound || []), ...aiItems.map(i => i.grade).filter(Boolean)]));
    return {
      items: mergedItems,
      gradesFound: uniqueGrades,
      subject: detectSubject(ai.subject) || ai.subject || parsed.subject || null,
      extractionMode: parsed.items.length ? 'rules_ai_enriched' : 'ai_layout_assist',
      warnings: ai.warnings || [],
    };
  } catch (err) {
    console.error('Planning source AI layout assist failed:', err.message);
    return { ...parsed, extractionMode: 'rules_ai_failed', warnings: [err.message] };
  }
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
    const topicSuccess = splitTopicSuccessCriteria(unitRaw);
    if (unitRaw) lastUnit = topicSuccess.title || unitRaw;

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
    const successCriteria = topicSuccess.criteria.length ? topicSuccess.criteria : parseLines(scText);
    if (!objectives.length && topicSuccess.criteria.length) {
      objectives.push(...topicSuccess.criteria.map(text => ({ code: null, text })));
    }
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
      const inferred = detectSubject(cell);
      if (inferred) return inferred;
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

  const workbookGrade = gradeFromText(filename) || wb.SheetNames.map(gradeFromText).find(Boolean) || null;
  const overviewSheetName = wb.SheetNames.find(n => /^overview$/i.test(String(n || '').trim()));
  const overviewWeeks = overviewSheetName ? overviewUnitWeeks(wb.Sheets[overviewSheetName]) : new Map();
  for (const sheetName of wb.SheetNames) {
    if (!unitNumberFromText(sheetName)) continue;
    const sheetItems = parseCambridgeUnitSheet(wb.Sheets[sheetName], sheetName, workbookGrade, overviewWeeks);
    if (sheetItems.length) items.push(...sheetItems);
  }
  if (items.length && workbookGrade && !gradesFound.includes(workbookGrade)) gradesFound.push(workbookGrade);

  if (items.length === 0) {
    for (const sheetName of wb.SheetNames) {
      const grade = gradeFromSheetName(sheetName);
      if (!grade) continue; // skip Overview / Summary sheets for item extraction
      if (!gradesFound.includes(grade)) gradesFound.push(grade);
      const sheetItems = parseSheet(wb.Sheets[sheetName], grade);
      items.push(...sheetItems);
    }
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
  parseExcelSource, parseExcelSourceWithAi, savePlanningSource, listPlanningSources,
  getPlanningSource, deletePlanningSource, queryItems, mergeParsedItems,
};
