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
const { repairMathQuestion } = require('./math-question-validator');
const { assessmentDraftContentIssues } = require('./assessment-draft');

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
      if (/\[REVIEW REQUIRED\]|^\s*REVIEW REQUIRED:/i.test(prompt)
        || /\[REVIEW REQUIRED\]|^\s*REVIEW REQUIRED:/i.test(cleanText(rawItem && rawItem.answerKey, 4000))) {
        throw new Error(`${title}, item ${itemIndex + 1}: replace placeholder text with a real, checked question, criterion, and answer.`);
      }
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
        const uniqueOptions = new Set(options.map(option => option.toLowerCase().replace(/\s+/g, ' ').trim()));
        if (uniqueOptions.size !== options.length) throw new Error(`${title}, item ${itemIndex + 1}: answer options must be different.`);
        if (/^(?:correct answer|plausible alternative|option [a-f])$/i.test(options[correctIndex])
          || /^(?:knowledge|multiple[- ]choice) question \d+ about\b/i.test(prompt)) {
          throw new Error(`${title}, item ${itemIndex + 1}: replace placeholder text with a real, checked question and answer.`);
        }
        const checked = repairMathQuestion({ question: prompt, options, correctIndex });
        if (checked.issue) throw new Error(`${title}, item ${itemIndex + 1}: check the mathematics answer key; ${checked.issue}.`);
        Object.assign(item, { options, correctIndex: checked.question.correctIndex });
        Object.assign(question, { kind: 'mcq', options, correctIndex: checked.question.correctIndex });
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
  const seenPrompts = new Set();
  for (const question of questions) {
    const normalizedPrompt = question.question.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenPrompts.has(normalizedPrompt)) throw new Error('Every assessment question or practical criterion must be unique.');
    seenPrompts.add(normalizedPrompt);
  }
  const contentIssues = assessmentDraftContentIssues({ sections: rawSections });
  if (contentIssues.length) {
    throw new Error(`Assessment: replace placeholder text with real, checked questions, criteria, options and answers (${contentIssues.join('; ')}).`);
  }
  const allocatedMarks = questions.reduce((sum, q) => sum + q.marks, 0);
  if (allocatedMarks !== totalMarks) throw new Error(`Allocated marks (${allocatedMarks}) must equal the assessment total (${totalMarks}).`);
  return {
    title, subject, grade, assessmentType, deliveryMode, totalMarks, objectives, sections, questions,
    instructions: cleanText(data.instructions, 2000),
    lessonWorkspaceId: cleanText(data.lessonWorkspaceId, 120) || null,
    unitId: cleanText(data.unitId, 120) || null,
    unitName: cleanText(data.unitName, 240) || null,
  };
}

function normalizeRosterSnapshot(students) {
  const seen = new Set();
  const snapshot = [];
  for (const student of (Array.isArray(students) ? students : [])) {
    const id = normalizeStudentId(student && (student.id || student.studentId));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    snapshot.push({ id, name: cleanText(student && student.name, 160) || id });
  }
  return snapshot;
}

function createAssessment({ teacherId, teacherName, data, rosterId, rosterSnapshot, cutoffAt }) {
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
    lessonWorkspaceId: normalized.lessonWorkspaceId,
    unitId: normalized.unitId,
    unitName: normalized.unitName,
    delivery: normalized.deliveryMode === 'live'
      ? { mode: 'live', phase: 'lobby', activeSectionIndex: -1, previousPhase: null, updatedAt: new Date().toISOString() }
      : { mode: 'self-paced', phase: 'open', activeSectionIndex: null, previousPhase: null, updatedAt: new Date().toISOString() },
    roomCode, rosterId: rosterId || null, cutoffAt: cutoffAt || null,
    rosterSnapshot: Array.isArray(rosterSnapshot) ? normalizeRosterSnapshot(rosterSnapshot) : null,
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

function assessmentGenerationError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function sameAssessmentContext(left, right) {
  const key = value => String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return key(left) === key(right);
}

// Deck generation must use the immutable server copy created at publication,
// not a browser-supplied draft that can be stale or edited after publishing.
// Subject and grade, plus the unit when supplied, bind that copy to the lesson
// currently being turned into slides. The workspace is mandatory and compared
// byte-for-byte after trimming because it is the saved lesson's identity.
function publishedAssessmentGenerationContext({ assessmentId, teacherId, lessonPurpose, subject, grade, unitId, lessonWorkspaceId }) {
  const purpose = String(lessonPurpose || '').trim().toLowerCase();
  if (!['project', 'test'].includes(purpose)) {
    throw assessmentGenerationError('A published assessment is only required for project or test decks.', 400, 'assessment_purpose_invalid');
  }
  const id = String(assessmentId || '').trim();
  if (!id) {
    throw assessmentGenerationError(`Review and publish the ${purpose} assessment before creating slides.`, 400, 'assessment_publish_required');
  }
  const record = getAssignment(id);
  if (!record || record.type !== 'assessment') {
    throw assessmentGenerationError('The published assessment could not be found. Review and publish it again before creating slides.', 404, 'assessment_not_found');
  }
  if (record.teacherId !== teacherId) {
    throw assessmentGenerationError('This published assessment does not belong to the signed-in teacher.', 403, 'assessment_not_owned');
  }
  if (!['published', 'finalised'].includes(record.status)) {
    throw assessmentGenerationError('This assessment is not published. Review and publish it before creating slides.', 409, 'assessment_not_published');
  }
  const requestedWorkspaceId = String(lessonWorkspaceId || '').trim();
  if (!requestedWorkspaceId) {
    throw assessmentGenerationError(`Save this lesson before creating ${purpose} slides.`, 400, 'assessment_workspace_required');
  }

  const deliveryMode = record.delivery && record.delivery.mode === 'self-paced' ? 'self-paced' : 'live';
  let normalized;
  try {
    normalized = normalizeAssessment({
      title: record.title,
      subject: record.subject,
      grade: record.grade,
      assessmentType: record.assessmentType,
      deliveryMode,
      totalMarks: record.totalMarks,
      objectives: record.objectives,
      instructions: record.content && record.content.instructions,
      sections: record.sections,
      lessonWorkspaceId: record.lessonWorkspaceId,
      unitId: record.unitId,
      unitName: record.unitName,
    });
  } catch {
    throw assessmentGenerationError('The published assessment is incomplete. Review and publish it again before creating slides.', 409, 'assessment_invalid');
  }

  if (normalized.assessmentType !== purpose) {
    throw assessmentGenerationError(`The published assessment is a ${normalized.assessmentType}, not a ${purpose}.`, 409, 'assessment_context_mismatch');
  }
  if (!sameAssessmentContext(normalized.subject, subject) || !sameAssessmentContext(normalized.grade, grade)) {
    throw assessmentGenerationError('The published assessment does not match this lesson subject and grade.', 409, 'assessment_context_mismatch');
  }
  if (unitId !== undefined && !sameAssessmentContext(normalized.unitId, unitId)) {
    throw assessmentGenerationError('The published assessment does not match this lesson unit.', 409, 'assessment_context_mismatch');
  }
  if (!normalized.lessonWorkspaceId) {
    throw assessmentGenerationError('The published assessment is not linked to a saved lesson workspace. Review and publish it again.', 409, 'assessment_workspace_missing');
  }
  if (String(normalized.lessonWorkspaceId).trim() !== requestedWorkspaceId) {
    throw assessmentGenerationError('The published assessment does not match this lesson workspace.', 409, 'assessment_context_mismatch');
  }

  const sections = JSON.parse(JSON.stringify(normalized.sections));
  const assessmentDraft = {
    title: normalized.title,
    subject: normalized.subject,
    grade: normalized.grade,
    assessmentType: normalized.assessmentType,
    deliveryMode: normalized.deliveryMode,
    totalMarks: normalized.totalMarks,
    objectives: JSON.parse(JSON.stringify(normalized.objectives)),
    instructions: normalized.instructions,
    sections,
    lessonWorkspaceId: normalized.lessonWorkspaceId,
    unitId: normalized.unitId,
    unitName: normalized.unitName,
  };
  const assessmentPhases = sections.map(section => ({
    type: section.type,
    title: section.title,
    marks: section.marks,
  }));
  return {
    assessmentPublishedId: record.id,
    assessmentDraft,
    assessmentTotalMarks: normalized.totalMarks,
    assessmentStructure: 'custom',
    assessmentDeliveryMode: normalized.deliveryMode,
    assessmentBrief: normalized.instructions,
    assessmentQuestionTypes: [...new Set(sections.map(section => section.type))],
    assessmentMcqCount: sections.filter(section => section.type === 'mcq').reduce((sum, section) => sum + section.items.length, 0),
    assessmentPhases,
  };
}

function updateAssignmentCutoff(id, cutoffAt) {
  const rec = getAssignment(id);
  if (!rec) return null;
  rec.cutoffAt = cutoffAt || null;
  writeJsonAtomic(recPath(id), rec);
  return rec;
}

function updateAssessmentRoster(id, rosterId, rosterSnapshot) {
  const rec = getAssignment(id);
  if (!rec || rec.type !== 'assessment') return null;
  const nextRosterId = cleanText(rosterId, 160);
  const nextSnapshot = normalizeRosterSnapshot(rosterSnapshot);
  if (!nextRosterId || !nextSnapshot.length) {
    throw assessmentStateError('Choose a class with at least one learner.', 'assessment_roster_required');
  }
  // Saving the already attached class is harmless, but never refresh its
  // snapshot after learners start: the published cohort must stay immutable.
  if (rec.rosterId === nextRosterId) return rec;
  assertAssessmentMutable(rec);
  if (loadSubmissions(id).length || loadDrafts(id).length) {
    throw assessmentStateError('The class cannot be changed after a learner has started this assessment.', 'assessment_roster_locked');
  }
  const delivery = deliveryState(rec);
  if (delivery.mode === 'live' && delivery.phase !== 'lobby') {
    throw assessmentStateError('The class cannot be changed after the first section has started.', 'assessment_roster_locked');
  }
  rec.rosterId = nextRosterId;
  rec.rosterSnapshot = nextSnapshot;
  rec.rosterAssignedAt = new Date().toISOString();
  writeJsonAtomic(recPath(id), rec);
  return rec;
}

function assessmentIsFinalised(record) {
  return !!record && record.type === 'assessment' && (record.resultsReleased || record.status === 'finalised');
}

function assessmentStateError(message, code) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
}

function assertAssessmentMutable(record) {
  if (assessmentIsFinalised(record)) {
    throw assessmentStateError('This assessment is finalised. Unrelease the results before changing marks.', 'assessment_finalised');
  }
}

function releaseResults(id, released) {
  const rec = getAssignment(id);
  if (!rec) return null;
  const targetReleased = !!released;
  const stateAlreadyMatches = rec.type === 'assessment'
    ? targetReleased
      ? !!rec.resultsReleased && rec.status === 'finalised' && !!rec.finalisedAt
      : !rec.resultsReleased && rec.status !== 'finalised' && !rec.finalisedAt
    : !!rec.resultsReleased === targetReleased;
  if (stateAlreadyMatches) return rec;
  rec.resultsReleased = targetReleased;
  if (rec.type === 'assessment') {
    rec.status = targetReleased ? 'finalised' : 'published';
    rec.finalisedAt = targetReleased ? new Date().toISOString() : null;
    if (rec.delivery) rec.delivery = { ...rec.delivery, phase: targetReleased ? 'closed' : 'marking', updatedAt: new Date().toISOString() };
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
  const record = getAssignment(id);
  assertAssessmentMutable(record);
  sub = { ...sub, studentId: normalizeStudentId(sub.studentId) };
  const subs = loadSubmissions(id);
  const i = subs.findIndex(s => normalizeStudentId(s.studentId) === sub.studentId);
  if (i >= 0) subs[i] = sub; else subs.push(sub);
  writeJsonAtomic(subsPath(id), subs);
  return subs;
}
function saveNewSubmission(id, sub) {
  const record = getAssignment(id);
  assertAssessmentMutable(record);
  const studentId = normalizeStudentId(sub && sub.studentId);
  if (record && record.type === 'assessment' && getSubmission(id, studentId)) {
    throw assessmentStateError('This assessment has already been submitted. Ask your teacher if it needs to be reopened.', 'assessment_already_submitted');
  }
  return saveSubmission(id, sub);
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
  assertAssessmentMutable(getAssignment(id));
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

// Practical/project evidence is often awarded while students are still
// working. Keep those teacher marks on the recoverable draft, then carry them
// into the final submission so circulating teachers can grade in real time.
function saveDraftGrade(id, { studentId, name, questionId, grade }) {
  assertAssessmentMutable(getAssignment(id));
  const sid = normalizeStudentId(studentId);
  const drafts = loadDrafts(id);
  const index = drafts.findIndex(draft => normalizeStudentId(draft.studentId) === sid);
  const previous = index >= 0 ? drafts[index] : { studentId: sid, name: name || sid, answers: {}, completedSectionIds: [] };
  const next = {
    ...previous,
    studentId: sid,
    name: name || previous.name || sid,
    observationGrades: { ...(previous.observationGrades || {}), [questionId]: grade },
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
  if (assessmentIsFinalised(record)) throw new Error('Released assessments cannot be restarted.');
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

function sanitizeProjectPresentationText(value) {
  const key = '(?:[a-z0-9]|f\\d{1,2}|enter|return|backspace|delete|tab|escape|esc|home|end|left|right|up|down)';
  const modifiers = '(?:(?:shift|alt|option)(?:\\s*\\+\\s*|\\s*-\\s*|\\s+))*';
  const replacement = (_match, pressedKey) => {
    const action = ({ c: 'copy', v: 'paste', x: 'cut', s: 'save', z: 'undo', y: 'redo' })[String(pressedKey || '').toLowerCase()];
    return action ? `${action} using the keyboard` : 'the keyboard command';
  };
  return String(value || '')
    .replace(new RegExp(`\\b(?:ctrl|control|cmd|command)(?:\\s*\\+\\s*|\\s*-\\s*|\\s+)${modifiers}(${key})\\b`, 'gi'), replacement)
    .replace(new RegExp(`⌘\\s*(?:\\+\\s*|-\\s*)?${modifiers}(${key})\\b`, 'gi'), replacement)
    .trim();
}

function safeProjectPresentationLines(value) {
  return String(value || '').split(/\n+/)
    .map(line => sanitizeProjectPresentationText(line))
    .filter(Boolean)
    .filter(line => !/\b(?:answer key|correct answer|model answer|marking (?:guide|guidance|scheme)|teacher[- ]only|rubric|worked solution)\b/i.test(line));
}

function presentationSlides(record) {
  if (!record || record.type !== 'assessment') throw new Error('Assessment not found.');
  const isTest = record.assessmentType === 'test';
  const slides = [{
    kind: 'title', title: isTest ? `${record.subject || 'Assessment'} test` : sanitizeProjectPresentationText(record.title),
    subtitle: `${record.subject || ''}${record.grade ? ` · ${record.grade}` : ''} · ${record.totalMarks || 0} marks`,
    bullets: [],
  }];
  slides.push({
    kind: 'overview', title: isTest ? 'Test overview' : 'Project overview',
    subtitle: isTest ? 'Listen for instructions before you begin.' : 'Follow each stage and check your progress.',
    bullets: (record.sections || []).map((section, index) => {
      const title = !isTest && section.type === 'practical'
        ? sanitizeProjectPresentationText(section.title)
        : assessmentSectionLabel(section.type);
      return `${index + 1}. ${title} · ${section.marks} marks`;
    }),
  });
  if (isTest) {
    slides.push({
      kind: 'instructions', title: 'Before you begin', subtitle: '',
      bullets: ['Wait until your teacher starts the section.', 'Read the assessment privately on your device.', 'Use only the materials your teacher permits.'],
    });
  } else {
    const instructions = safeProjectPresentationLines(record.content && record.content.instructions);
    if (instructions.length) slides.push({ kind: 'instructions', title: 'Before you begin', subtitle: '', bullets: instructions });
  }
  for (const [index, section] of (record.sections || []).entries()) {
    const safeInstructions = safeProjectPresentationLines(section.instructions);
    let bullets;
    let title;
    if (isTest) {
      // Shared test slides never include question text, options, answers, or
      // rubric criteria. Even teacher-entered section instructions stay
      // private because they may contain assessed procedures or hints.
      const count = (section.items || []).length;
      title = `${index + 1}. ${assessmentSectionLabel(section.type)}`;
      if (section.type === 'mcq') bullets = [`Answer ${count} multiple-choice ${count === 1 ? 'question' : 'questions'} independently in LessonScope.`];
      else if (section.type === 'practical') bullets = ['Begin only when your teacher starts this section.', 'Complete the assessed task independently.'];
      else bullets = [`Complete ${count} ${assessmentSectionLabel(section.type).toLowerCase()} ${count === 1 ? 'item' : 'items'} independently in LessonScope.`];
    } else if (section.type !== 'practical') {
      // Every marked written or multiple-choice item stays private on learner
      // devices. Shared project slides identify only the neutral phase type.
      const count = (section.items || []).length;
      title = `${index + 1}. ${assessmentSectionLabel(section.type)}`;
      bullets = [`Complete ${count} ${assessmentSectionLabel(section.type).toLowerCase()} ${count === 1 ? 'item' : 'items'} independently in LessonScope.`];
    } else {
      title = `${index + 1}. ${sanitizeProjectPresentationText(section.title)}`;
      // Item prompts are private assessment content, including practical
      // observation criteria that may look like ordinary student directions.
      // The shared board receives only explicitly public section instructions.
      bullets = safeInstructions.length
        ? safeInstructions
        : ['Complete this section independently when your teacher asks.'];
    }
    slides.push({
      kind: 'section', title,
      sectionIndex: index,
      subtitle: `${section.marks} marks · ${assessmentSectionLabel(section.type)}`,
      bullets,
    });
  }
  slides.push({ kind: 'finish', title: isTest ? 'Stop and wait' : 'Final check', subtitle: '', bullets: isTest ? ['Check that your work is saved.', 'Wait quietly for your teacher.'] : ['Check every required stage.', 'Save your work.', 'Submit when your teacher asks.'] });
  return slides;
}

function sanitizeLearnerAnswers(questions, rawAnswers) {
  const raw = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {};
  const safe = {};
  for (const question of (questions || [])) {
    if (!Object.prototype.hasOwnProperty.call(raw, question.id) || question.kind === 'practical') continue;
    const value = raw[question.id];
    if (question.kind === 'mcq') {
      const number = typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
      if (Number.isInteger(number) && number >= 0 && number < (question.options || []).length) safe[question.id] = number;
    } else {
      safe[question.id] = String(value == null ? '' : value).slice(0, 20000);
    }
  }
  return safe;
}

function incompleteAssessmentAnswers(questions, answers) {
  const supplied = answers && typeof answers === 'object' ? answers : {};
  return (questions || []).filter(question => {
    if (question.kind === 'practical') return false;
    const value = supplied[question.id];
    if (question.kind === 'mcq') {
      return !Number.isInteger(value) || value < 0 || value >= (question.options || []).length;
    }
    return !String(value == null ? '' : value).trim();
  });
}

function assessmentSectionLabel(type) {
  return ({ mcq: 'Multiple choice', 'short-answer': 'Short answer', 'extended-response': 'Extended response', practical: 'Practical / observation' })[type] || 'Assessment section';
}

function assessmentReleaseReadiness(record, expectedStudentIds = []) {
  if (!record || record.type !== 'assessment') return { ready: true, pendingGrades: 0, submissions: 0 };
  const submissions = loadSubmissions(record.id);
  const submittedIds = new Set(submissions.map(submission => normalizeStudentId(submission.studentId)));
  const missingStudents = [...new Set((expectedStudentIds || []).map(normalizeStudentId).filter(Boolean))].filter(id => !submittedIds.has(id));
  if (missingStudents.length) {
    return {
      ready: false, pendingGrades: 0, submissions: submissions.length, missingStudents: missingStudents.length,
      missingStudentIds: missingStudents,
      reason: `${missingStudents.length} student${missingStudents.length === 1 ? ' has' : 's have'} not submitted yet.`,
    };
  }
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

function filterAssignmentEvidenceForRoster(rows, rosterId) {
  return (rows || []).filter(row => row && row.rosterId === rosterId);
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
      version: a.version || null, status: a.status || null, finalisedAt: a.finalisedAt || null,
      lessonWorkspaceId: a.lessonWorkspaceId || null, unitId: a.unitId || null, unitName: a.unitName || null,
      delivery: a.delivery || null,
      createdAt: a.createdAt, roomCode: a.roomCode, rosterId: a.rosterId, cutoffAt: a.cutoffAt,
      resultsReleased: isReleased(a),
      submissions: loadSubmissions(a.id).length,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = {
  createAssignment, createAssessment, normalizeAssessment, getAssignment, updateAssignmentCutoff, updateAssessmentRoster, getRoomCode,
  publishedAssessmentGenerationContext,
  releaseResults, isReleased,
  assessmentIsFinalised, saveSubmission, saveNewSubmission, getSubmissions, getSubmission,
  assessmentReleaseReadiness, loadDrafts, getDraft, saveDraft, saveDraftGrade, deliveryState, updateDelivery, draftProgress, presentationSlides,
  sanitizeLearnerAnswers, incompleteAssessmentAnswers, filterAssignmentEvidenceForRoster,
  findConfirmedVerdict, recordVerdict, normalizeAnswer, normalizeStudentId,
  listTeacherAssignments,
};
