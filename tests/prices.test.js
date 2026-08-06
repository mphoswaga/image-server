// Pricing guard: pins the credit cost of every paid action so a careless edit
// to credit-prices.js can't silently change what teachers are charged. These
// numbers are the money contract shared with the EducScope wallet — if one
// needs to change, that's a deliberate act that should change this test too.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const prices = require('../credit-prices.js');

// The canonical price list. Update BOTH this and credit-prices.js together.
const EXPECTED = {
  'lessonscope.generate_lesson_pack': 4,
  'lessonscope.generate_slide_deck': 3,
  'lessonscope.import_plan_to_slides': 3,
  'lessonscope.generate_pack_item': 1,
  'lessonscope.generate_game': 1,
  'lessonscope.generate_diagram': 3,
  'lessonscope.generate_ai_image': 5,
  'lessonscope.generate_lesson_plan': 2,
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

test('deliberately-free actions cost nothing', () => {
  assert.equal(prices.priceFor('lessonscope.import_slides'), 0, 'parsing is free');
  assert.equal(prices.priceFor('lessonscope.auto_grade'), 0, 'grading rides on a paid assignment');
  assert.equal(prices.priceFor('lessonscope.parse_pacing_guide'), 0, 'one-off upload');
  assert.equal(prices.isFree('lessonscope.import_slides'), true);
  assert.equal(prices.isFree('lessonscope.generate_slide_deck'), false);
  assert.equal(prices.isFree('lessonscope.generate_lesson_plan'), false, 'lesson plan is now billed');
});

// The guard. An action nobody catalogued used to cost 0 by default, which meant
// a new AI feature could ship free and stay free until someone read the bill.
test('an uncatalogued action is refused, not silently free', () => {
  assert.throws(() => prices.priceFor('lessonscope.brand_new_thing'), /Unknown credit action/);
  assert.throws(() => prices.isFree('lessonscope.brand_new_thing'), /Unknown credit action/);
  assert.throws(() => prices.assertKnown('typo.in_action_name'), /Unknown credit action/);
});

test('every catalogued action is either priced or explicitly free, never both', () => {
  const both = Object.keys(prices.PRICES).filter(a => a in prices.FREE);
  assert.deepEqual(both, [], `these actions are listed as both priced and free: ${both.join(', ')}`);
});

test('every free action documents WHY it is free', () => {
  for (const [action, reason] of Object.entries(prices.FREE)) {
    assert.ok(reason && reason.length > 3, `${action} is free without a stated reason`);
  }
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

// Writing the plan is billed; rewriting it toward the school's format is not,
// on the same fair-use terms slides get. Charging per attempt would tax the
// step teachers repeat most.
test('rewriting a lesson plan is fair-use, not a fresh charge each time', () => {
  assert.equal(prices.isFree('lessonscope.regenerate_lesson_plan'), true);
  assert.equal(prices.isFree('lessonscope.generate_lesson_plan'), false);
  assert.match(prices.FREE['lessonscope.regenerate_lesson_plan'], /fair-use/i);
});

test('publicTable exposes everything the UI needs, no hardcoding', () => {
  const t = prices.publicTable();
  assert.deepEqual(t.prices, prices.PRICES);
  assert.ok(t.labels && t.free);
  assert.equal(t.fairUse.freeRegensPerLesson, 3);
  assert.equal(t.fairUse.regenBatchCost, 1);
});
