const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-template-library-'));

const templates = require('../template');

test('a teacher can keep multiple named templates for different grades', () => {
  const userId = 'teacher-multiple-grades';
  const grade5 = templates.saveTemplate(userId, {
    name: 'Grade 5 ICT plan', grade: 'Grade 5', type: 'detailed',
    filename: 'grade-5.docx', text: 'Starter\nActivities\nPlenary', buffer: Buffer.from('grade-five-file'),
  });
  const grade7 = templates.saveTemplate(userId, {
    name: 'Grade 7 Science plan', grade: 'Grade 7', type: 'weekly',
    filename: 'grade-7.docx', text: 'Learning objectives\nInvestigation\nAssessment', buffer: Buffer.from('grade-seven-file'),
  });

  const saved = templates.listTemplates(userId);
  assert.equal(saved.length, 2);
  assert.deepEqual(new Set(saved.map(item => item.grade)), new Set(['Grade 5', 'Grade 7']));
  assert.equal(templates.getTemplate(userId, grade5.id).name, 'Grade 5 ICT plan');
  assert.equal(templates.loadOriginalById(userId, grade7.id).buffer.toString(), 'grade-seven-file');
});

test('renaming or reassigning a template keeps its original file', () => {
  const userId = 'teacher-edit-template';
  const original = templates.saveTemplate(userId, {
    name: 'Old name', grade: 'Grade 4', type: 'custom',
    filename: 'school-plan.xlsx', text: 'LO\nSC\nActivities', buffer: Buffer.from('original-workbook'),
  });
  const updated = templates.renameTemplate(userId, original.id, { name: 'Grade 6 school plan', grade: 'Grade 6' });

  assert.equal(updated.name, 'Grade 6 school plan');
  assert.equal(updated.grade, 'Grade 6');
  assert.equal(templates.loadOriginalById(userId, original.id).buffer.toString(), 'original-workbook');
});

test('older templates without grade metadata remain readable', () => {
  const userId = 'teacher-general-template';
  const saved = templates.saveTemplate(userId, {
    name: 'Whole-school format', type: 'detailed', filename: 'general.txt', text: 'Starter', buffer: Buffer.from('Starter'),
  });
  assert.equal(templates.getTemplate(userId, saved.id).grade, '');
});
