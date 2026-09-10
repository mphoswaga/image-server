// Persistent online assignments (worksheet/exit-ticket/quiz sent to students to
// complete online) — parallel to games.js but for lesson-pack content instead
// of MCQ-only games. Free-text answers get graded by AI against the teacher's
// answer key; a TEACHER-CONFIRMED verdict is cached per question so a later
// student's exact rephrasing doesn't need a fresh AI call — but an unconfirmed
// AI verdict is never reused on its own, so a bad guess can't silently repeat.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const DIR = path.join(DATA_DIR, 'assignments');
const ROOMS_PATH = path.join(DIR, '_rooms.json');
const recPath = id => path.join(DIR, `${id}.json`);
const subsPath = id => path.join(DIR, `${id}.submissions.json`);
const draftsPath = id => path.join(DIR, `${id}.drafts.json`);
const verdictsPath = id => path.join(DIR, `${id}.verdicts.json`);
const isAssignmentFile = f => f.endsWith('.json') && !f.endsWith('.submissions.json') && !f.endsWith('.drafts.json') && !f.endsWith('.verdicts.json') && f !== '_rooms.json';
const normalizeStudentId = value => String(value || '').trim().replace(/\s+/g, '').toUpperCase();

// 6-char room code using unambiguous chars (no 0/O/1/I/L) — same alphabet as games.js.
const ROOM_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function genRoomCode() {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) code += ROOM_CHARS[b % ROOM_CHARS.length];
  return code;
}

function loadRooms() {
  try { return JSON.parse(fs.readFileSync(ROOMS_PATH, 'utf8')); } catch { return {}; }
}
function saveRooms(rooms) {
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonAtomic(ROOMS_PATH, rooms);
}
function getRoomCode(code) {
  if (!code) return null;
  const rooms = loadRooms();
  return rooms[String(code).toUpperCase()] || null;
}

// Give every question a stable ID + explicit marks + answerKey, regardless of
// pack type, so submissions/grading/verdicts can all key off `questionId`
// instead of array position (which would break if a teacher edits the pack).
function normalizeContent(data, type) {
  let n = 0;
  const nextId = () => `q${n++}`;
  if (type === 'worksheet') {
    const answerKey = data.answerKey || [];
    const questions = (data.questions || []).map((q, i) => ({ id: nextId(), question: q, kind: 'text', marks: 1, answerKey: answerKey[i] || '' }));
    const challenge = data.challenge
      ? { id: nextId(), question: data.challenge, kind: 'text', marks: 2, answerKey: answerKey[(data.questions || []).length] || '' }
      : null;
    return { title: data.title, instructions: data.focus || '', questions: challenge ? [...questions, challenge] : questions };
  }
  if (type === 'exit-ticket') {
    const answerKey = data.answerKey || [];
    const questions = (data.questions || []).map((q, i) => ({ id: nextId(), question: q, kind: 'text', marks: 1, answerKey: answerKey[i] || '' }));
    return { title: data.title, instructions: '', questions };
  }
  // quiz — mcq is already auto-gradable (has correctIndex); shortAnswer already has marks.
  const mcq = (data.mcq || []).map(q => ({ id: nextId(), question: q.question, kind: 'mcq', options: q.options, correctIndex: q.correctIndex, marks: 1 }));
  const shortAnswer = (data.shortAnswer || []).map(q => ({ id: nextId(), question: q.question, kind: 'text', marks: q.marks || 1, answerKey: q.answer || '' }));
  return { title: data.title, instructions: data.instructions || '', questions: [...mcq, ...shortAnswer] };
}

const ASSESSMENT_TYPES = new Set(['test', 'project', 'practical', 'performance', 'oral', 'portfolio', 'custom']);
const SECTION_TYPES = new Set(['mcq', 'short-answer', 'extended-response', 'practical']);

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// A test/project is stored beside existing assignments so it immediately uses
// the proven room-code, roster, submission, release, and gradebook paths. The
// section model remains intact on the record; content.questions is a flattened
// compatibility view used by the existing marking and student infrastructure.
function normalizeAssessment(data) {
  if (!data || typeof data !== 'object') throw new Error('Assessment details are required.');
  const title = cleanText(data.title, 160);
  const subject = cleanText(data.subject, 100);
  const grade = cleanText(data.grade, 60);
  const assessmentType = cleanText(data.assessmentType, 30).toLowerCase();
  const deliveryMode = cleanText(data.deliveryMode, 30).toLowerCase() || 'live';
  const totalMarks = Number(data.totalMarks);
  if (!title) throw new Error('Enter an assessment title.');
  if (!subject) throw new Error('Enter a subject.');
  if (!grade) throw new Error('Enter a grade or year group.');
  if (!ASSESSMENT_TYPES.has(assessmentType)) throw new Error('Choose a valid assessment type.');
  if (!['live', 'self-paced'].includes(deliveryMode)) throw new Error('Choose live classroom or self-paced delivery.');
  if (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000) throw new Error('Total marks must be a whole number from 1 to 1000.');

  const objectives = [];
  const objectiveIds = new Set();
  for (const [index, raw] of (Array.isArray(data.objectives) ? data.objectives : []).entries()) {
    const text = cleanText(typeof raw === 'string' ? raw : raw && raw.text, 500);
    if (!text) continue;
    const proposed = cleanText(raw && raw.id, 80) || `objective-${index + 1}`;
    let id = proposed.replace(/[^a-zA-Z0-9_-]/g, '-');
    while (objectiveIds.has(id)) id += '-2';
    objectiveIds.add(id);
    objectives.push({ id, text });
  }
  if (!objectives.length) throw new Error('Add at least one learning objective or skill.');

  const sections = [];
  const questions = [];
  const sectionIds = new Set();
  const questionIds = new Set();
  const rawSections = Array.isArray(data.sections) ? data.sections : [];
  if (!rawSections.length) throw new Error('Add at least one assessment section.');
  for (const [sectionIndex, rawSection] of rawSections.entries()) {
    const type = cleanText(rawSection && rawSection.type, 40).toLowerCase();
    if (!SECTION_TYPES.has(type)) throw new Error(`Section ${sectionIndex + 1} has an unsupported type.`);
    const title = cleanText(rawSection && rawSection.title, 120) || `Section ${sectionIndex + 1}`;
    const instructions = cleanText(rawSection && rawSection.instructions, 2000);
    let id = cleanText(rawSection && rawSection.id, 80).replace(/[^a-zA-Z0-9_-]/g, '-') || `section-${sectionIndex + 1}`;
    while (sectionIds.has(id)) id += '-2';
    sectionIds.add(id);
    const inheritedObjectives = (Array.isArray(rawSection.objectiveIds) ? rawSection.objectiveIds : [])
      .map(x => cleanText(x, 80)).filter(x => objectiveIds.has(x));
    if (!inheritedObjectives.length) throw new Error(`${title}: connect at least one learning objective or skill.`);
    const items = [];
    for (const [itemIndex, rawItem] of (Array.isArray(rawSection.items) ? rawSection.items : []).entries()) {
      const prompt = cleanText(rawItem && (rawItem.prompt || rawItem.question), 2000);
      const marks = Number(rawItem && rawItem.marks);
      if (!prompt) throw new Error(`${title}, item ${itemIndex + 1}: enter a question or criterion.`);
      if (!Number.isInteger(marks) || marks < 1 || marks > 1000) throw new Error(`${title}, item ${itemIndex + 1}: marks must be a positive whole number.`);
      let itemId = cleanText(rawItem && rawItem.id, 80).replace(/[^a-zA-Z0-9_-]/g, '-') || `${id}-item-${itemIndex + 1}`;
      while (questionIds.has(itemId)) itemId += '-2';
      questionIds.add(itemId);
      const refs = (Array.isArray(rawItem && rawItem.objectiveIds) ? rawItem.objectiveIds : inheritedObjectives)
        .map(x => cleanText(x, 80)).filter(x => objectiveIds.has(x));
      const objectiveRefs = refs.length ? [...new Set(refs)] : [...inheritedObjectives];
      const item = { id: itemId, prompt, marks, objectiveIds: objectiveRefs };
      const question = { id: itemId, question: prompt, marks, sectionId: id, sectionTitle: title, sectionInstructions: instructions, sectionType: type, objectiveIds: objectiveRefs };
      if (type === 'mcq') {
        const options = (Array.isArray(rawItem.options) ? rawItem.options : []).map(x => cleanText(x, 500)).filter(Boolean);
        const correctIndex = Number(rawItem.correctIndex);
        if (options.length < 2) throw new Error(`${title}, item ${itemIndex + 1}: add at least two answer options.`);
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) throw new Error(`${title}, item ${itemIndex + 1}: choose the correct answer.`);
        Object.assign(item, { options, correctIndex });
        Object.assign(question, { kind: 'mcq', options, correctIndex });
      } else if (type === 'practical') {
        question.kind = 'practical';
      } else {
        const answerKey = cleanText(rawItem.answerKey, 4000);
        if (!answerKey) throw new Error(`${title}, item ${itemIndex + 1}: add marking guidance or an answer key.`);
        item.answerKey = answerKey;
        Object.assign(question, { kind: type === 'extended-response' ? 'extended' : 'text', answerKey });
      }
      items.push(item);
      questions.push(question);
    }
    if (!items.length) throw new Error(`${title}: add at least one question or criterion.`);
    sections.push({ id, title, type, instructions, objectiveIds: inheritedObjectives, marks: items.reduce((sum, item) => sum + item.marks, 0), items });
  }
  const allocatedMarks = questions.reduce((sum, q) => sum + q.marks, 0);
  if (allocatedMarks !== totalMarks) throw new Error(`Allocated marks (${allocatedMarks}) must equal the assessment total (${totalMarks}).`);
  return { title, subject, grade, assessmentType, deliveryMode, totalMarks, objectives, sections, questions, instructions: cleanText(data.instructions, 2000) };
}

function createAssessment({ teacherId, teacherName, data, rosterId, cutoffAt }) {
  fs.mkdirSync(DIR, { recursive: true });
  const normalized = normalizeAssessment(data);
  const id = crypto.randomUUID().slice(0, 8);
  const roomCode = genRoomCode();
  const rec = {
    id, teacherId, teacherName: teacherName || '', type: 'assessment',
    assessmentType: normalized.assessmentType, title: normalized.title,
    subject: normalized.subject, topic: normalized.title, grade: normalized.grade,
    totalMarks: normalized.totalMarks, objectives: normalized.objectives,
    sections: normalized.sections, version: 1, status: 'published',
    delivery: normalized.deliveryMode === 'live'
      ? { mode: 'live', phase: 'lobby', activeSectionIndex: -1, previousPhase: null, updatedAt: new Date().toISOString() }
      : { mode: 'self-paced', phase: 'open', activeSectionIndex: null, previousPhase: null, updatedAt: new Date().toISOString() },
    roomCode, rosterId: rosterId || null, cutoffAt: cutoffAt || null,
    resultsReleased: false,
    content: { title: normalized.title, instructions: normalized.instructions, questions: normalized.questions },
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(recPath(id), rec);
  const rooms = loadRooms();
  rooms[roomCode] = id;
  saveRooms(rooms);
  return rec;
}

function createAssignment({ teacherId, teacherName, type, subject, topic, grade, data, rosterId, cutoffAt }) {
  fs.mkdirSync(DIR, { recursive: true });
  const id = crypto.randomUUID().slice(0, 8); // short + shareable, same convention as games
  const roomCode = genRoomCode();
  const content = normalizeContent(data, type);
  const rec = {
    id, teacherId, teacherName: teacherName || '',
    type, title: content.title || topic, subject, topic, grade,
    roomCode, rosterId: rosterId || null, cutoffAt: cutoffAt || null,
    resultsReleased: false, // students see their own answers immediately, but
                             // marks/verdicts only once released or overdue
    content,
    createdAt: new Date().toISOString(),
  };
  writeJsonAtomic(recPath(id), rec);
  const rooms = loadRooms();
  rooms[roomCode] = id;
  saveRooms(rooms);
  return rec;
}

function getAssignment(id) {
  try { return JSON.parse(fs.readFileSync(recPath(String(id)), 'utf8')); } catch { return null; }
}

function updateAssignmentCutoff(id, cutoffAt) {
  const rec = getAssignment(id);
  if (!rec) return null;
  rec.cutoffAt = cutoffAt || null;
  writeJsonAtomic(recPath(id), rec);
  return rec;
}

function releaseResults(id, released) {
  const rec = getAssignment(id);
  if (!rec) return null;
  rec.resultsReleased = !!released;
  if (rec.type === 'assessment') {
    rec.status = released ? 'finalised' : 'published';
    rec.finalisedAt = released ? new Date().toISOString() : null;
    if (rec.delivery) rec.delivery = { ...rec.delivery, phase: released ? 'closed' : 'marking', updatedAt: new Date().toISOString() };
  }
  writeJsonAtomic(recPath(id), rec);
  return rec;
}

// True once a teacher has explicitly released results, OR the due date has
// passed (whichever comes first) — matches "released or overdue" for students.
function isReleased(a) {
  if (!a) return false;
  if (a.resultsReleased) return true;
  if (a.type === 'assessment') return false;
  if (a.cutoffAt && Date.now() > new Date(a.cutoffAt).getTime()) return true;
  return false;
}

// ── Submissions ──────────────────────────────────────────────────────────
function loadSubmissions(id) {
  try { return JSON.parse(fs.readFileSync(subsPath(String(id)), 'utf8')); } catch { return []; }
}
function saveSubmission(id, sub) {
  sub = { ...sub, studentId: normalizeStudentId(sub.studentId) };
  const subs = loadSubmissions(id);
  const i = subs.findIndex(s => normalizeStudentId(s.studentId) === sub.studentId);
  if (i >= 0) subs[i] = sub; else subs.push(sub);
  writeJsonAtomic(subsPath(id), subs);
  return subs;
}
function getSubmissions(id) { return loadSubmissions(id); }
function getSubmission(id, studentId) {
  const target = normalizeStudentId(studentId);
  return loadSubmissions(id).find(s => normalizeStudentId(s.studentId) === target) || null;
}

function loadDrafts(id) {
  try { return JSON.parse(fs.readFileSync(draftsPath(String(id)), 'utf8')); } catch { return []; }
}
function getDraft(id, studentId) {
  const target = normalizeStudentId(studentId);
  return loadDrafts(id).find(draft => normalizeStudentId(draft.studentId) === target) || null;
}
function saveDraft(id, { studentId, name, answers, completedSectionId }) {
  const sid = normalizeStudentId(studentId);
  const drafts = loadDrafts(id);
  const index = drafts.findIndex(draft => normalizeStudentId(draft.studentId) === sid);
  const previous = index >= 0 ? drafts[index] : { studentId: sid, name: name || sid, answers: {}, completedSectionIds: [] };
  const next = {
    ...previous, studentId: sid, name: name || previous.name || sid,
    answers: { ...(previous.answers || {}), ...(answers || {}) },
    completedSectionIds: [...new Set([...(previous.completedSectionIds || []), ...(completedSectionId ? [completedSectionId] : [])])],
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) drafts[index] = next; else drafts.push(next);
  writeJsonAtomic(draftsPath(id), drafts);
  return next;
}

function deliveryState(record) {
  if (record && record.delivery) return record.delivery;
  return { mode: 'self-paced', phase: 'open', activeSectionIndex: null, previousPhase: null, updatedAt: record && record.createdAt || null };
}

function updateDelivery(id, action) {
  const record = getAssignment(id);
  if (!record || record.type !== 'assessment') return null;
  const current = deliveryState(record);
  if (current.mode !== 'live') throw new Error('This assessment is self-paced.');
  if (record.resultsReleased) throw new Error('Released assessments cannot be restarted.');
  const last = Math.max(0, (record.sections || []).length - 1);
  const next = { ...current, updatedAt: new Date().toISOString() };
  if (action === 'start') {
    if (current.phase !== 'lobby') throw new Error('The assessment has already started.');
    Object.assign(next, { phase: 'open', activeSectionIndex: 0, startedAt: next.updatedAt, previousPhase: null });
  } else if (action === 'next') {
    if (current.phase !== 'open') throw new Error('Resume the assessment before moving sections.');
    if (current.activeSectionIndex >= last) Object.assign(next, { phase: 'marking', activeSectionIndex: last, endedAt: next.updatedAt, previousPhase: null });
    else Object.assign(next, { activeSectionIndex: current.activeSectionIndex + 1, previousPhase: null });
  } else if (action === 'previous') {
    if (current.phase !== 'open' || current.activeSectionIndex <= 0) throw new Error('There is no previous open section.');
    Object.assign(next, { activeSectionIndex: current.activeSectionIndex - 1, previousPhase: null });
  } else if (action === 'pause') {
    if (current.phase !== 'open') throw new Error('Only an open section can be paused.');
    Object.assign(next, { phase: 'paused', previousPhase: 'open', pausedAt: next.updatedAt });
  } else if (action === 'resume') {
    if (current.phase !== 'paused') throw new Error('This assessment is not paused.');
    Object.assign(next, { phase: current.previousPhase || 'open', previousPhase: null, resumedAt: next.updatedAt });
  } else if (action === 'finish') {
    if (!['open', 'paused'].includes(current.phase)) throw new Error('This assessment is not in progress.');
    Object.assign(next, { phase: 'marking', activeSectionIndex: Math.max(0, current.activeSectionIndex), previousPhase: null, endedAt: next.updatedAt });
  } else throw new Error('Unknown assessment action.');
  record.delivery = next;
  writeJsonAtomic(recPath(id), record);
  return record;
}

function draftProgress(record) {
  const state = deliveryState(record);
  const section = state.mode === 'live' && state.activeSectionIndex >= 0 ? (record.sections || [])[state.activeSectionIndex] : null;
  const drafts = loadDrafts(record.id);
  return {
    draftCount: drafts.length,
    readyCount: section ? drafts.filter(draft => (draft.completedSectionIds || []).includes(section.id)).length : 0,
    activeSectionId: section && section.id || null,
  };
}

function presentationSlides(record) {
  if (!record || record.type !== 'assessment') throw new Error('Assessment not found.');
  const isTest = record.assessmentType === 'test';
  const slides = [{
    kind: 'title', title: record.title,
    subtitle: `${record.subject || ''}${record.grade ? ` · ${record.grade}` : ''} · ${record.totalMarks || 0} marks`,
    bullets: [],
  }];
  slides.push({
    kind: 'overview', title: isTest ? 'Test overview' : 'Project overview',
    subtitle: isTest ? 'Listen for instructions before you begin.' : 'Follow each stage and check your progress.',
    bullets: (record.sections || []).map((section, index) => `${index + 1}. ${section.title} · ${section.marks} marks`),
  });
  if (record.content && record.content.instructions) {
    slides.push({ kind: 'instructions', title: 'Before you begin', subtitle: '', bullets: [record.content.instructions] });
  }
  for (const [index, section] of (record.sections || []).entries()) {
    const safeInstructions = String(section.instructions || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
    let bullets;
    if (isTest) {
      // Shared test slides never include question text, options, answers, or
      // rubric criteria. Students receive the actual questions privately.
      bullets = safeInstructions.length ? safeInstructions : [section.type === 'practical' ? 'Complete the practical task as directed by your teacher.' : 'Complete this section independently on your device.'];
    } else {
      bullets = [...safeInstructions, ...(section.items || []).map(item => item.prompt)].filter(Boolean);
    }
    slides.push({
      kind: 'section', title: `${index + 1}. ${section.title}`,
      sectionIndex: index,
      subtitle: `${section.marks} marks · ${assessmentSectionLabel(section.type)}`,
      bullets,
    });
  }
  slides.push({ kind: 'finish', title: isTest ? 'Stop and wait' : 'Final check', subtitle: '', bullets: isTest ? ['Check that your work is saved.', 'Wait quietly for your teacher.'] : ['Check every required stage.', 'Save your work.', 'Submit when your teacher asks.'] });
  return slides;
}

function assessmentSectionLabel(type) {
  return ({ mcq: 'Multiple choice', 'short-answer': 'Short answer', 'extended-response': 'Extended response', practical: 'Practical / observation' })[type] || 'Assessment section';
}

function assessmentReleaseReadiness(record) {
  if (!record || record.type !== 'assessment') return { ready: true, pendingGrades: 0, submissions: 0 };
  const submissions = loadSubmissions(record.id);
  if (!submissions.length) return { ready: false, pendingGrades: 0, submissions: 0, reason: 'Wait for at least one student submission before releasing results.' };
  let pendingGrades = 0;
  for (const sub of submissions) {
    for (const question of record.content.questions || []) {
      const grade = (sub.grades || {})[question.id];
      const confirmed = grade && (grade.source === 'auto' || grade.source === 'teacher' || grade.source === 'ai-confirmed');
      if (!confirmed) pendingGrades += 1;
    }
  }
  return {
    ready: pendingGrades === 0, pendingGrades, submissions: submissions.length,
    reason: pendingGrades ? `Review ${pendingGrades} pending grade${pendingGrades === 1 ? '' : 's'} before releasing results.` : '',
  };
}

// ── Verdict cache: per-question list of gradings, some teacher-confirmed ───
function loadVerdicts(id) {
  try { return JSON.parse(fs.readFileSync(verdictsPath(String(id)), 'utf8')); } catch { return {}; }
}
function saveVerdicts(id, v) {
  fs.mkdirSync(DIR, { recursive: true });
  writeJsonAtomic(verdictsPath(id), v);
}

function normalizeAnswer(text) {
  return String(text || '').toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// Only reuse a CONFIRMED verdict, and only on an exact normalized-text match —
// never guesses off a fuzzy/semantic match. Returns null on a miss (caller
// falls back to a fresh AI grading call).
function findConfirmedVerdict(id, questionId, answerText) {
  const v = loadVerdicts(id);
  const list = v[questionId] || [];
  const norm = normalizeAnswer(answerText);
  if (!norm) return null;
  return list.find(e => e.confirmed && e.normalizedAnswer === norm) || null;
}

// Store a grading result keyed on the exact normalized answer text for this
// question. `confirmed` starts false for a fresh AI verdict — it only becomes
// reusable once a teacher confirms/corrects it (see confirmVerdict below).
function recordVerdict(id, questionId, { answerText, marksAwarded, verdict, rationale, confirmed = false, source = 'ai' }) {
  const v = loadVerdicts(id);
  const list = v[questionId] || (v[questionId] = []);
  const norm = normalizeAnswer(answerText);
  let entry = list.find(e => e.normalizedAnswer === norm);
  if (entry) Object.assign(entry, { marksAwarded, verdict, rationale, confirmed, source });
  else list.push({ normalizedAnswer: norm, marksAwarded, verdict, rationale, confirmed, source });
  saveVerdicts(id, v);
  return entry;
}

function listTeacherAssignments(teacherId) {
  fs.mkdirSync(DIR, { recursive: true });
  return fs.readdirSync(DIR)
    .filter(isAssignmentFile)
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } })
    .filter(a => a && a.teacherId === teacherId)
    .map(a => ({
      id: a.id, type: a.type, title: a.title, subject: a.subject, topic: a.topic, grade: a.grade,
      assessmentType: a.assessmentType || null, totalMarks: a.totalMarks || null,
      sectionCount: Array.isArray(a.sections) ? a.sections.length : null,
      delivery: a.delivery || null,
      createdAt: a.createdAt, roomCode: a.roomCode, rosterId: a.rosterId, cutoffAt: a.cutoffAt,
      resultsReleased: isReleased(a),
      submissions: loadSubmissions(a.id).length,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = {
  createAssignment, createAssessment, normalizeAssessment, getAssignment, updateAssignmentCutoff, getRoomCode,
  releaseResults, isReleased,
  saveSubmission, getSubmissions, getSubmission,
  assessmentReleaseReadiness, loadDrafts, getDraft, saveDraft, deliveryState, updateDelivery, draftProgress, presentationSlides,
  findConfirmedVerdict, recordVerdict, normalizeAnswer, normalizeStudentId,
  listTeacherAssignments,
};
