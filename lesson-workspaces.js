const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const STAGES = new Set(['draft', 'plan', 'slides', 'resources', 'assigned']);
const MAX_LINKED_ITEMS = 100;

function safePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function safeId(value) {
  const id = String(value || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : '';
}

function workspaceDir(teacherId) {
  return path.join(DATA_DIR, 'users', safePart(teacherId), 'lesson-workspaces');
}

function workspacePath(teacherId, id) {
  return path.join(workspaceDir(teacherId), `${id}.json`);
}

function clone(value, fallback) {
  if (value === undefined) return fallback;
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return fallback; }
}

function cleanText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(item, 120)).filter(Boolean))].slice(0, MAX_LINKED_ITEMS);
}

function normalizeStage(value, fallback = 'draft') {
  return STAGES.has(value) ? value : fallback;
}

function normalizeInput(input = {}, previous = null) {
  const context = clone(input.context, previous ? previous.context : {}) || {};
  const subject = cleanText(input.subject !== undefined ? input.subject : context.subject, 60)
    || cleanText(previous && previous.subject, 60);
  const topic = cleanText(input.topic !== undefined ? input.topic : context.topic, 120)
    || cleanText(previous && previous.topic, 120);
  const grade = cleanText(input.grade !== undefined ? input.grade : context.grade, 80)
    || cleanText(previous && previous.grade, 80);
  const title = cleanText(input.title, 180)
    || [subject, topic].filter(Boolean).join(' - ')
    || cleanText(previous && previous.title, 180)
    || 'Untitled lesson';

  return {
    title,
    subject,
    topic,
    grade,
    stage: normalizeStage(input.stage, previous ? previous.stage : 'draft'),
    context,
    plan: clone(input.plan, previous ? previous.plan : null),
    sequencePlans: clone(input.sequencePlans, previous ? previous.sequencePlans : []),
    activeSequencePlanIndex: Number.isInteger(input.activeSequencePlanIndex)
      ? Math.max(0, input.activeSequencePlanIndex)
      : Number(previous && previous.activeSequencePlanIndex) || 0,
    deckSnapshots: clone(input.deckSnapshots, previous ? previous.deckSnapshots : []),
    activeDeckId: cleanText(input.activeDeckId, 120) || cleanText(previous && previous.activeDeckId, 120) || null,
    packs: clone(input.packs, previous ? previous.packs : {}),
    activePackType: cleanText(input.activePackType, 40) || cleanText(previous && previous.activePackType, 40) || null,
    assignmentIds: input.assignmentIds === undefined
      ? cleanIds(previous && previous.assignmentIds)
      : cleanIds(input.assignmentIds),
    gameIds: input.gameIds === undefined
      ? cleanIds(previous && previous.gameIds)
      : cleanIds(input.gameIds),
    archived: input.archived === undefined ? !!(previous && previous.archived) : !!input.archived,
  };
}

function create(teacherId, input = {}) {
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    ...normalizeInput(input),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  writeJsonAtomic(workspacePath(teacherId, record.id), record);
  return record;
}

function get(teacherId, id) {
  const validId = safeId(id);
  if (!validId) return null;
  try { return JSON.parse(fs.readFileSync(workspacePath(teacherId, validId), 'utf8')); }
  catch { return null; }
}

function update(teacherId, id, input = {}) {
  const previous = get(teacherId, id);
  if (!previous) return null;
  const record = {
    ...previous,
    ...normalizeInput(input, previous),
    id: previous.id,
    createdAt: previous.createdAt,
    updatedAt: new Date().toISOString(),
    version: Math.max(1, Number(previous.version) || 1) + 1,
  };
  writeJsonAtomic(workspacePath(teacherId, record.id), record);
  return record;
}

function summary(record) {
  const packs = record && record.packs && typeof record.packs === 'object' ? Object.keys(record.packs) : [];
  return {
    id: record.id,
    title: record.title,
    subject: record.subject,
    topic: record.topic,
    grade: record.grade,
    stage: normalizeStage(record.stage),
    hasPlan: !!(record.plan && Array.isArray(record.plan.sections) && record.plan.sections.length)
      || !!(Array.isArray(record.sequencePlans) && record.sequencePlans.some(Boolean)),
    deckCount: Array.isArray(record.deckSnapshots) ? record.deckSnapshots.length : 0,
    resourceCount: packs.length,
    assignmentCount: cleanIds(record.assignmentIds).length,
    gameCount: cleanIds(record.gameIds).length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function list(teacherId, { includeArchived = false } = {}) {
  const dir = workspaceDir(teacherId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
      catch { return null; }
    })
    .filter(record => record && (includeArchived || !record.archived))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(summary);
}

function withoutDeckSnapshots(record) {
  if (!record) return null;
  const copy = { ...record };
  delete copy.deckSnapshots;
  copy.deckCount = Array.isArray(record.deckSnapshots) ? record.deckSnapshots.length : 0;
  return copy;
}

module.exports = { STAGES, create, get, update, list, summary, withoutDeckSnapshots };
