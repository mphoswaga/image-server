const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');
const { normalizeAssessment } = require('./assignments');

const presets = [
  { id: 'starter-codequest', versions: [require('./activity-templates/codequest-first-project'), require('./activity-templates/codequest-voyage'), require('./activity-templates/codequest-class-expedition')], starter: true },
  { id: 'starter-codequest-stages', versions: [require('./activity-templates/codequest-stages')], starter: true },
  { id: 'starter-data', versions: [require('./activity-templates/data-handling-first-project'), require('./activity-templates/data-everyday-project'), require('./activity-templates/data-school-fair'), require('./activity-templates/data-school-fair-entry'), require('./activity-templates/data-school-fair-order'), require('./activity-templates/data-school-fair-mission'), require('./activity-templates/data-class-investigation'), require('./activity-templates/data-fair-stations')], starter: true },
];
const directory = path.join(DATA_DIR, 'activity-templates');
const file = teacherId => path.join(directory, crypto.createHash('sha256').update(String(teacherId)).digest('hex') + '.json');
function personal(teacherId) {
  const location = file(teacherId);
  return fs.existsSync(location) ? JSON.parse(fs.readFileSync(location, 'utf8')) : [];
}
function list(teacherId) { return [...presets, ...personal(teacherId)]; }
function get(teacherId, id, version) {
  if (!Number.isInteger(version) || version < 1) throw new Error('Choose an available activity version.');
  const record = list(teacherId).find(item => item.id === id);
  const data = record?.versions[version - 1];
  if (!data) throw new Error('Choose an available activity version.');
  return data;
}
function save(teacherId, sourceId, baseVersion, data, duplicate) {
  get(teacherId, sourceId, baseVersion);
  const records = personal(teacherId);
  const existing = records.find(item => item.id === sourceId);
  if (existing && !duplicate && existing.versions.length !== baseVersion) throw new Error('A newer version exists. Reload it or save a separate copy.');
  const { questions, ...snapshot } = normalizeAssessment({
    ...data, assessmentType: 'project', deliveryMode: 'live', lessonWorkspaceId: null, unitId: null, unitName: null,
  });
  if (questions.some(question => !['codequest', 'data-table'].includes(question.kind))) throw new Error('Choose practical activity tasks.');
  const target = existing && !duplicate ? existing : { id: crypto.randomUUID(), versions: [] };
  if (target !== existing) records.push(target);
  target.versions.push(snapshot);
  fs.mkdirSync(directory, { recursive: true });
  writeJsonAtomic(file(teacherId), records);
  return { id: target.id, version: target.versions.length };
}
module.exports = { list, get, save };
