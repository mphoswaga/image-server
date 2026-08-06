// Guard: the EducScope website quotes LessonScope's prices in its copy, and
// nothing at runtime connects the two repos. When these numbers last changed,
// three separate hardcoded strings went stale at once and the plan finder
// started recommending teachers a subscription too small to cover their work.
//
// Both repos now derive their copy from one table each — this checks those two
// tables still agree. It is skipped when the website isn't checked out beside
// this repo, so CI elsewhere doesn't fail on a missing sibling.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prices = require('../credit-prices.js');

const WEBSITE_PRICES = path.resolve(__dirname, '../../website/src/lib/usagePrices.ts');

// action in credit-prices.js  ->  key in the website's USAGE_PRICES
const MIRRORED = {
  'lessonscope.generate_lesson_plan': 'lessonPlan',
  'lessonscope.generate_slide_deck': 'slideDeck',
  'lessonscope.import_plan_to_slides': 'importPlanToSlides',
  'lessonscope.generate_pack_item': 'packItem',
  'lessonscope.generate_lesson_pack': 'fullResourcePack',
  'lessonscope.generate_game': 'studentGame',
  'lessonscope.generate_diagram': 'aiDiagram',
  'lessonscope.generate_ai_image': 'aiImage',
};

function websiteUsagePrices() {
  const src = fs.readFileSync(WEBSITE_PRICES, 'utf8');
  const block = src.match(/export const USAGE_PRICES = \{([\s\S]*?)\}/);
  if (!block) throw new Error('could not find USAGE_PRICES in the website');
  const found = {};
  for (const [, key, value] of block[1].matchAll(/(\w+):\s*(\d+)/g)) found[key] = Number(value);
  return found;
}

test('the website quotes the same prices LessonScope charges', { skip: !fs.existsSync(WEBSITE_PRICES) && 'website repo not checked out beside this one' }, () => {
  const site = websiteUsagePrices();
  for (const [action, key] of Object.entries(MIRRORED)) {
    assert.equal(
      site[key],
      prices.priceFor(action),
      `website USAGE_PRICES.${key} is ${site[key]} but ${action} costs ${prices.priceFor(action)} — ` +
      `update ../website/src/lib/usagePrices.ts so the marketing copy matches what teachers are charged`,
    );
  }
});

test('every priced action the website mirrors actually exists', { skip: !fs.existsSync(WEBSITE_PRICES) && 'website repo not checked out beside this one' }, () => {
  for (const action of Object.keys(MIRRORED)) {
    assert.doesNotThrow(() => prices.assertKnown(action), `${action} is mirrored on the website but not catalogued here`);
  }
  // Anything priced here but absent from the map is copy nobody is checking.
  const unmirrored = Object.keys(prices.PRICES).filter((a) => !(a in MIRRORED));
  assert.deepEqual(unmirrored, [], `these priced actions aren't mirrored on the website: ${unmirrored.join(', ')}`);
});
