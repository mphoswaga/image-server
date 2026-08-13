const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-week-planner-library-'));

const planner = require('../week-planner');

async function workbookBuffer(week, marker) {
  const wb = new planner.ExcelJS.Workbook();
  const sheet = wb.addWorksheet(`Week ${week}`);
  ['Subject', 'Learning objectives', 'Success criteria', 'Intro', 'Activities', 'Assessment']
    .forEach((label, index) => { sheet.getRow(index + 2).getCell(1).value = label; });
  sheet.getRow(2).getCell(2).value = marker;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('uploading another week workbook adds it instead of replacing the first', async () => {
  const userId = 'teacher-two-classes';
  const first = await planner.installPlanner(userId, await workbookBuffer(1, 'Grade 5'), 'grade-5.xlsx', {
    name: 'Grade 5 Science', grade: 'Grade 5',
  });
  const second = await planner.installPlanner(userId, await workbookBuffer(1, 'Grade 7'), 'grade-7.xlsx', {
    name: 'Grade 7 Science', grade: 'Grade 7',
  });

  assert.notEqual(first.id, second.id);
  assert.equal(planner.listPlanners(userId).length, 2);
  assert.equal(planner.activePlannerId(userId), second.id, 'the newly added workbook is selected');
  assert.equal(planner.deletePlanner(userId, 'not-a-real-template'), false);
  assert.equal(planner.listPlanners(userId).length, 2, 'an invalid id cannot delete the active workbook');

  assert.equal(planner.selectPlanner(userId, first.id).name, 'Grade 5 Science');
  assert.equal(planner.activePlannerId(userId), first.id);
  assert.equal(planner.readPlannerMeta(userId).filename, 'grade-5.xlsx');
});

test('deleting one workbook leaves the other available and selected', async () => {
  const userId = 'teacher-delete-one';
  const first = await planner.installPlanner(userId, await workbookBuffer(2, 'Class A'), 'class-a.xlsx', { name: 'Class A' });
  const second = await planner.installPlanner(userId, await workbookBuffer(2, 'Class B'), 'class-b.xlsx', { name: 'Class B' });

  assert.equal(planner.deletePlanner(userId, second.id), true);
  assert.equal(planner.listPlanners(userId).length, 1);
  assert.equal(planner.activePlannerId(userId), first.id);
  assert.equal(planner.hasPlanner(userId), true);
});

test('the old single workbook is copied into the library without deleting it', async () => {
  const userId = 'teacher-legacy-workbook';
  const oldDir = path.join(process.env.DATA_DIR, 'users', userId, 'week-planner');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'planner.xlsx'), Buffer.from('legacy-workbook'));
  fs.writeFileSync(path.join(oldDir, 'planner.json'), JSON.stringify({
    filename: 'official-plan.xlsx', uploadedAt: '2026-01-01T00:00:00.000Z',
  }));

  const saved = planner.listPlanners(userId);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'official-plan');
  assert.equal(fs.existsSync(path.join(oldDir, 'planner.xlsx')), true, 'legacy rollback copy remains');
  assert.equal((await planner.plannerBuffer(userId)).toString(), 'legacy-workbook');

  assert.equal(planner.deletePlanner(userId, saved[0].id), true);
  assert.equal(planner.listPlanners(userId).length, 0, 'deleting the migrated item does not import the rollback copy again');
  assert.equal(fs.existsSync(path.join(oldDir, 'planner.xlsx')), true, 'rollback copy is still untouched');
});
