// Guard: an AI call must name the credit action it belongs to.
//
// The catalogue guard in prices.test.js catches a *wrong* action name. It cannot
// catch the failure that actually costs money — an endpoint that calls the AI
// having never declared an action at all. That is what /api/lesson-plan did for
// its whole life: a full structured generation on every request, billed to
// nobody, and nothing in the code could tell.
//
// ai-client is the one place every chat/image call passes through, so that is
// where the declaration is enforced.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { runWithUser, declareAction, currentAction, client } = require('../ai-client.js');

test('an AI call inside a request must declare its action', async () => {
  await runWithUser('teacher-1', async () => {
    // Nothing declared yet — this is the shape of a route that forgot to bill.
    await assert.rejects(
      () => client().chat.completions.create({ model: 'gpt-4o-mini', messages: [] }),
      /Unbilled AI call/,
      'an undeclared chat call must be refused under test',
    );
    await assert.rejects(
      () => client().images.generate({ prompt: 'x' }),
      /Unbilled AI call/,
      'an undeclared image call must be refused under test',
    );
  });
});

test('declaring an action clears the guard', async () => {
  await runWithUser('teacher-1', async () => {
    declareAction('lessonscope.generate_slide_deck');
    assert.equal(currentAction(), 'lessonscope.generate_slide_deck');
    // Past the guard it fails on the network/API key instead, not on billing.
    await assert.rejects(
      () => client().chat.completions.create({ model: 'gpt-4o-mini', messages: [] }),
      err => !/Unbilled AI call/.test(err.message),
      'a declared call must get past the billing guard',
    );
  });
});

test('a declaration does not leak between requests', async () => {
  await runWithUser('teacher-1', async () => { declareAction('lessonscope.generate_slide_deck'); });
  await runWithUser('teacher-2', async () => {
    assert.equal(currentAction(), null, 'each request starts with nothing declared');
  });
});

test('outside a request there is nothing to bill, so nothing is enforced', () => {
  // CLI tools and the offline captioner run with no wallet context at all.
  assert.equal(currentAction(), null);
});
