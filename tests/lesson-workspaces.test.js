const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-lesson-workspaces-'));

const workspaces = require('../lesson-workspaces');

test('lesson workspaces are private, persistent, and listed by recent activity', () => {
  const first = workspaces.create('teacher-a', {
    context: { subject: 'ICT', topic: 'Folders', grade: 'Grade 3' },
    stage: 'plan',
    plan: { sections: [{ heading: 'Objective', content: 'Create a folder.' }] },
  });
  const second = workspaces.create('teacher-a', {
    context: { subject: 'Maths', topic: 'Fractions', grade: 'Grade 4' },
  });

  assert.equal(workspaces.get('teacher-b', first.id), null);
  assert.equal(workspaces.get('teacher-a', first.id).topic, 'Folders');
  assert.deepEqual(workspaces.list('teacher-a').map(item => item.id), [second.id, first.id]);
  assert.equal(workspaces.list('teacher-a')[1].hasPlan, true);
});

test('updating a workspace preserves omitted artefacts and tracks linked work', () => {
  const saved = workspaces.create('teacher-update', {
    context: { subject: 'Science', topic: 'Plants', grade: 'Grade 2' },
    plan: { sections: [{ heading: 'Starter', content: 'Name a plant.' }] },
    deckSnapshots: [{ deckId: 'deck-1', deck: { slides: [{ title: 'Plants' }] } }],
  });
  const updated = workspaces.update('teacher-update', saved.id, {
    stage: 'assigned',
    packs: { worksheet: { title: 'Plants worksheet' } },
    assignmentIds: ['assignment-1', 'assignment-1'],
    gameIds: ['game-1'],
  });

  assert.equal(updated.plan.sections[0].content, 'Name a plant.');
  assert.equal(updated.deckSnapshots.length, 1);
  assert.deepEqual(updated.assignmentIds, ['assignment-1']);
  assert.equal(workspaces.summary(updated).resourceCount, 1);
  assert.equal(workspaces.summary(updated).stage, 'assigned');
});

test('archived workspaces leave the default list without being deleted', () => {
  const saved = workspaces.create('teacher-archive', {
    context: { subject: 'English', topic: 'Adjectives', grade: 'Grade 3' },
  });
  workspaces.update('teacher-archive', saved.id, { archived: true });

  assert.equal(workspaces.list('teacher-archive').length, 0);
  assert.equal(workspaces.list('teacher-archive', { includeArchived: true }).length, 1);
  assert.equal(workspaces.get('teacher-archive', saved.id).archived, true);
});

test('unsafe workspace ids cannot escape a teacher directory', () => {
  assert.equal(workspaces.get('teacher-a', '../../teacher-b/private'), null);
});
