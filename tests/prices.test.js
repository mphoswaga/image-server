// Pricing guard: pins the credit cost of every paid action so a careless edit
// to credit-prices.js can't silently change what teachers are charged. These
// numbers are the money contract shared with the EducScope wallet — if one
// needs to change, that's a deliberate act that should change this test too.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const prices = require('../credit-prices.js');

// The canonical price list. Update BOTH this and credit-prices.js together.
const EXPECTED = {
  'lessonscope.generate_lesson_pack': 3,
  'lessonscope.generate_slide_deck': 1,
  'lessonscope.import_plan_to_slides': 1,
  'lessonscope.generate_pack_item': 1,
  'lessonscope.generate_game': 1,
  'lessonscope.generate_diagram': 2,
  'lessonscope.generate_ai_image': 3,
};

test('every paid action costs exactly its agreed price', () => {
  for (const [action, credits] of Object.entries(EXPECTED)) {
    assert.equal(prices.priceFor(action), credits, `${action} must cost ${credits} credits`);
  }
});

test('no unexpected paid actions have crept in', () => {
  assert.deepEqual(
    Object.keys(prices.PRICES).sort(),
    Object.keys(EXPECTED).sort(),
    'PRICES has an action not covered by this test — was a new charge added on purpose?',
  );
});

test('unknown and free actions cost nothing', () => {
  assert.equal(prices.priceFor('lessonscope.generate_lesson_plan'), 0, 'lesson plan is free in beta');
  assert.equal(prices.priceFor('lessonscope.import_slides'), 0, 'parsing is free');
  assert.equal(prices.priceFor('totally.unknown_action'), 0, 'unknown actions never charge');
  assert.equal(prices.isFree('lessonscope.generate_lesson_plan'), true);
  assert.equal(prices.isFree('lessonscope.generate_slide_deck'), false);
});

test('every priced action has a UI label (prices and labels stay in sync)', () => {
  for (const action of Object.keys(prices.PRICES)) {
    const label = prices.label(action);
    assert.ok(label && label !== action, `missing human label for ${action}`);
  }
});

test('slide-regeneration fair-use is 3 free then 1 credit', () => {
  assert.equal(prices.FREE_REGENS, 3);
  assert.equal(prices.REGEN_BATCH_COST, 1);
  assert.equal(prices.isFree('lessonscope.regenerate_slide'), true, 'regen is not in the paid table');
});

test('publicTable exposes everything the UI needs, no hardcoding', () => {
  const t = prices.publicTable();
  assert.deepEqual(t.prices, prices.PRICES);
  assert.ok(t.labels && t.free);
  assert.equal(t.fairUse.freeRegensPerLesson, 3);
  assert.equal(t.fairUse.regenBatchCost, 1);
});
